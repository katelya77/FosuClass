#!/usr/bin/env node
// P5a WS1：migration runner 的真实 PostgreSQL 验证（不经过 mock）。
// 环境：AGENT_TEST_PG_URL 优先，否则 docker 临时容器（见 test-helpers/pg-test-env）；
// 都不可用时打印 UNVERIFIED 与原因并 exit 0 —— 诚实标记，绝不假装已验证。
//
// 覆盖：空库 migrate → 幂等重跑 → getStatus 形状与 sha256 → 篡改 checksum
// fail closed → 过新 schema 拒绝启动 → 定义校验 → 单条 migration 事务性
// （失败不留半态）→ 并发 migrate 的 advisory lock 互斥。
// 每个场景使用独立的随机库（CREATE DATABASE / DROP DATABASE），互不污染。

const assert = require("node:assert");
const crypto = require("node:crypto");
const { ensurePg, redactUrl } = require("./test-helpers/pg-test-env");
const {
  AGENT_CORE_MIGRATIONS,
  closePool,
  createMigrationRunner,
  createPgPool,
  query,
} = require("../packages/agent-runtime");

// 每个场景一个随机库：经 postgres 维护库 CREATE/DROP。
async function withTempDatabase(env, label, fn) {
  const adminPool = createPgPool({ connectionString: env.url, max: 2 });
  const dbName = `agent_p5a_${label}_${crypto.randomBytes(5).toString("hex")}`;
  await query(adminPool, `CREATE DATABASE ${dbName}`);
  const url = new URL(env.url);
  url.pathname = `/${dbName}`;
  const pool = createPgPool({ connectionString: url.toString(), max: 4 });
  try {
    await fn(pool);
  } finally {
    await closePool(pool);
    await query(adminPool, `DROP DATABASE IF EXISTS ${dbName} WITH (FORCE)`);
    await closePool(adminPool);
  }
}

async function testFreshMigrateIdempotentStatus(env) {
  await withTempDatabase(env, "fresh", async (pool) => {
    const runner = createMigrationRunner({ pool, migrations: AGENT_CORE_MIGRATIONS });

    const first = await runner.migrate();
    assert.deepStrictEqual(first, { applied: [1], alreadyApplied: [], schemaVersion: 1 });
    const table = await query(pool, "SELECT to_regclass('agent_meta') AS reg");
    assert.ok(table.rows[0].reg, "agent_meta table exists after migrate");

    const second = await runner.migrate();
    assert.deepStrictEqual(second, { applied: [], alreadyApplied: [1], schemaVersion: 1 }, "re-run is an idempotent no-op");

    const status = await runner.getStatus();
    assert.strictEqual(status.schemaVersion, 1);
    assert.strictEqual(status.applied.length, 1);
    assert.strictEqual(status.applied[0].version, 1);
    assert.strictEqual(status.applied[0].name, "agent_meta");
    assert.match(status.applied[0].sha256, /^[0-9a-f]{64}$/, "applied row carries a sha256 digest");
    assert.ok(Number.isFinite(Date.parse(status.applied[0].appliedAt)), "appliedAt is an ISO timestamp");
    assert.deepStrictEqual(status.pending, []);
  });
  console.log("✓ fresh migrate, idempotent re-run, getStatus shape");
}

async function testChecksumMismatch(env) {
  await withTempDatabase(env, "checksum", async (pool) => {
    const runner = createMigrationRunner({ pool, migrations: AGENT_CORE_MIGRATIONS });
    await runner.migrate();
    await query(pool, "UPDATE schema_migrations SET sha256 = $1 WHERE version = 1", ["0".repeat(64)]);
    await assert.rejects(runner.migrate(), (e) => e.code === "MIGRATION_CHECKSUM_MISMATCH");
  });
  console.log("✓ tampered checksum fails closed (MIGRATION_CHECKSUM_MISMATCH)");
}

async function testSchemaTooNew(env) {
  await withTempDatabase(env, "toonew", async (pool) => {
    const runner = createMigrationRunner({ pool, migrations: AGENT_CORE_MIGRATIONS });
    await runner.migrate();
    // 伪造一行来自「未来代码」的已应用版本。
    await query(pool, "INSERT INTO schema_migrations (version, name, sha256) VALUES ($1, $2, $3)", [
      999,
      "from_the_future",
      "f".repeat(64),
    ]);
    await assert.rejects(runner.assertCompatible(), (e) => e.code === "MIGRATION_SCHEMA_TOO_NEW");
    await assert.rejects(runner.migrate(), (e) => e.code === "MIGRATION_SCHEMA_TOO_NEW");
  });
  console.log("✓ newer schema refused (MIGRATION_SCHEMA_TOO_NEW)");
}

function testDefinitionValidation() {
  const pool = { query: async () => ({ rows: [] }) }; // 工厂期不触网
  assert.throws(
    () =>
      createMigrationRunner({
        pool,
        migrations: [
          { version: 1, name: "first", statements: ["SELECT 1"] },
          { version: 1, name: "duplicate", statements: ["SELECT 2"] },
        ],
      }),
    (e) => e.code === "MIGRATION_DEFINITION_INVALID"
  );
  assert.throws(
    () => createMigrationRunner({ pool, migrations: [{ version: 1, name: "empty", statements: [] }] }),
    (e) => e.code === "MIGRATION_DEFINITION_INVALID"
  );
  assert.throws(
    () =>
      createMigrationRunner({
        pool,
        migrations: [
          { version: 2, name: "out_of_order", statements: ["SELECT 1"] },
          { version: 1, name: "late", statements: ["SELECT 2"] },
        ],
      }),
    (e) => e.code === "MIGRATION_DEFINITION_INVALID"
  );
  console.log("✓ definition validation (duplicate version, empty statements, non-increasing)");
}

async function testMigrationTransactionality(env) {
  await withTempDatabase(env, "tx", async (pool) => {
    const runner = createMigrationRunner({
      pool,
      migrations: [
        {
          version: 1,
          name: "tx_probe",
          statements: [
            "CREATE TABLE tx_probe (id integer PRIMARY KEY)",
            "THIS IS NOT VALID SQL", // 故意语法错误：第二条 statement 必须拖垮整条 migration
          ],
        },
      ],
    });
    await assert.rejects(runner.migrate(), (e) => e.code === "MIGRATION_FAILED");
    const table = await query(pool, "SELECT to_regclass('tx_probe') AS reg");
    assert.strictEqual(table.rows[0].reg, null, "statement 1 must be rolled back with the failed migration");
    const rows = await query(pool, "SELECT COUNT(*)::int AS n FROM schema_migrations");
    assert.strictEqual(rows.rows[0].n, 0, "failed migration leaves no record row");
  });
  console.log("✓ failed migration rolls back fully (MIGRATION_FAILED, no partial state)");
}

async function testConcurrentMigrate(env) {
  await withTempDatabase(env, "race", async (pool) => {
    const runnerA = createMigrationRunner({ pool, migrations: AGENT_CORE_MIGRATIONS });
    const runnerB = createMigrationRunner({ pool, migrations: AGENT_CORE_MIGRATIONS });
    const [a, b] = await Promise.all([runnerA.migrate(), runnerB.migrate()]);
    assert.strictEqual(a.schemaVersion, 1);
    assert.strictEqual(b.schemaVersion, 1);
    assert.strictEqual(a.applied.length + b.applied.length, 1, "exactly one runner applies the migration");
    const rows = await query(pool, "SELECT COUNT(*)::int AS n FROM schema_migrations WHERE version = 1");
    assert.strictEqual(rows.rows[0].n, 1, "single applied record under advisory lock");
  });
  console.log("✓ concurrent migrate serialized by advisory lock");
}

(async () => {
  testDefinitionValidation(); // 不依赖数据库，任何环境下都执行

  let reason = "no PostgreSQL available";
  const env = await ensurePg({ onReason: (text) => {
    reason = text;
  } });
  if (!env) {
    console.log(`\ntest-agent-persistence-migrations: UNVERIFIED (${reason})`);
    process.exit(0);
  }
  console.log(`pg-test-env: ${env.owned ? `docker container ${env.containerName}` : "external AGENT_TEST_PG_URL"} (${redactUrl(env.url)})`);
  try {
    await testFreshMigrateIdempotentStatus(env);
    await testChecksumMismatch(env);
    await testSchemaTooNew(env);
    await testMigrationTransactionality(env);
    await testConcurrentMigrate(env);
  } finally {
    await env.cleanup();
  }
  console.log("\ntest-agent-persistence-migrations: PASS");
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
