#!/usr/bin/env node
// P5a WS4a：server 侧 pgPersistenceService 聚合迁移（含 version 3 四类存储建表）的真实验证。
//
// 覆盖：空库 runMigrations → 版本序 [1,3] 应用 → 幂等重跑 → getMigrationStatus 形状 →
// 四表 + durable status 索引存在 → 关键 DDL（复合主键 / bigserial / NOT NULL 约束）→
// closeForTests 重置单例。0002 为 config kernel 预留版本，本套件断言聚合列表含 1、3 且不含 2。
//
// 环境：AGENT_TEST_PG_URL 优先，否则 docker 临时容器（test-helpers/pg-test-env）；
// 不可用 → 打印 UNVERIFIED 与原因并 exit 0。

const assert = require("assert");
const crypto = require("crypto");
const { ensurePg, redactUrl } = require("./test-helpers/pg-test-env");
const { closePool, createPgPool, query } = require("../packages/agent-runtime");

const EXPECTED_TABLES = [
  "agent_conversations",
  "agent_durable_tasks",
  "agent_kb_audit",
  "agent_kb_idempotency",
];

async function withPgDatabase(env, fn) {
  const adminPool = createPgPool({ connectionString: env.url, max: 2 });
  const dbName = `agent_p5a_m0003_${crypto.randomBytes(5).toString("hex")}`;
  await query(adminPool, `CREATE DATABASE ${dbName}`);
  const url = new URL(env.url);
  url.pathname = `/${dbName}`;
  process.env.AGENT_PG_URL = url.toString();
  // 注意：必须在设置 AGENT_PG_URL 之后首次触达 pgPersistenceService。
  const pgPersistenceService = require("../server/src/services/ai/persistence/pgPersistenceService");
  try {
    await fn(pgPersistenceService, pgPersistenceService.getPool());
  } finally {
    await pgPersistenceService.closeForTests();
    delete process.env.AGENT_PG_URL;
    await query(adminPool, `DROP DATABASE IF EXISTS ${dbName} WITH (FORCE)`);
    await closePool(adminPool);
  }
}

async function testMigrationListShape() {
  // 不触网：聚合列表定义期校验（0002 预留，不得被占用）。
  delete process.env.AGENT_PG_URL;
  const { getMigrationList } = require("../server/src/services/ai/persistence/pgPersistenceService");
  const versions = getMigrationList().map((migration) => migration.version);
  assert.deepStrictEqual(versions, [1, 3], "聚合 migration 列表必须按版本序为 [1, 3]（0002 预留）");
  const v3 = getMigrationList().find((migration) => migration.version === 3);
  assert.strictEqual(v3.name, "conversation_memory_stores");
  console.log("✓ 聚合 migration 列表版本序 [1, 3]，0002 未被占用");
}

async function testFreshMigrateAndStatus(pgPersistenceService, pool) {
  const first = await pgPersistenceService.runMigrations();
  assert.deepStrictEqual(first, { applied: [1, 3], alreadyApplied: [], schemaVersion: 3 });

  const second = await pgPersistenceService.runMigrations();
  assert.deepStrictEqual(second, { applied: [], alreadyApplied: [1, 3], schemaVersion: 3 }, "重复 migrate 必须是幂等 no-op");

  const status = await pgPersistenceService.getMigrationStatus();
  assert.strictEqual(status.schemaVersion, 3);
  assert.deepStrictEqual(status.applied.map((row) => row.version), [1, 3]);
  assert.deepStrictEqual(status.applied.map((row) => row.name), ["agent_meta", "conversation_memory_stores"]);
  assert.deepStrictEqual(status.pending, []);

  for (const table of EXPECTED_TABLES) {
    const reg = await query(pool, "SELECT to_regclass($1) AS reg", [table]);
    assert.ok(reg.rows[0].reg, `${table} 必须存在`);
  }
  const index = await query(pool, "SELECT to_regclass('agent_durable_tasks_status_idx') AS reg");
  assert.ok(index.rows[0].reg, "agent_durable_tasks(status) 索引必须存在");
  console.log("✓ 空库迁移 [1,3]、幂等重跑、getMigrationStatus 形状、四表与索引存在");
}

async function testDdlDetails(pool) {
  // agent_conversations 复合主键 (principal_key, conversation_id)。
  const pk = await query(
    pool,
    "SELECT kcu.column_name FROM information_schema.table_constraints tc " +
      "JOIN information_schema.key_column_usage kcu ON tc.constraint_name = kcu.constraint_name " +
      "WHERE tc.table_name = 'agent_conversations' AND tc.constraint_type = 'PRIMARY KEY' " +
      "ORDER BY kcu.ordinal_position"
  );
  assert.deepStrictEqual(pk.rows.map((row) => row.column_name), ["principal_key", "conversation_id"]);

  // agent_kb_audit.id 为自增（bigserial → nextval default），created_at 非空。
  const auditCols = await query(
    pool,
    "SELECT column_name, is_nullable, column_default FROM information_schema.columns " +
      "WHERE table_name = 'agent_kb_audit' AND column_name IN ('id', 'created_at')"
  );
  const idCol = auditCols.rows.find((row) => row.column_name === "id");
  assert.match(String(idCol.column_default), /^nextval\(/, "agent_kb_audit.id 必须是自增序列");
  const createdCol = auditCols.rows.find((row) => row.column_name === "created_at");
  assert.strictEqual(createdCol.is_nullable, "NO");

  // agent_kb_idempotency.expires_at 非空；agent_durable_tasks.expires_at 可空。
  const nullable = await query(
    pool,
    "SELECT table_name, is_nullable FROM information_schema.columns " +
      "WHERE column_name = 'expires_at' AND table_name IN ('agent_kb_idempotency', 'agent_durable_tasks')"
  );
  const byTable = Object.fromEntries(nullable.rows.map((row) => [row.table_name, row.is_nullable]));
  assert.strictEqual(byTable.agent_kb_idempotency, "NO", "agent_kb_idempotency.expires_at 必须 NOT NULL");
  assert.strictEqual(byTable.agent_durable_tasks, "YES", "agent_durable_tasks.expires_at 必须可空");
  console.log("✓ DDL 细节：复合主键 / bigserial / expires_at 约束");
}

async function testCloseForTests(pgPersistenceService) {
  const poolA = pgPersistenceService.getPool();
  await pgPersistenceService.closeForTests();
  const poolB = pgPersistenceService.getPool();
  assert.notStrictEqual(poolA, poolB, "closeForTests 后 getPool 必须重建单例");
  console.log("✓ closeForTests 关闭并重置连接池单例");
}

(async () => {
  await testMigrationListShape(); // 不依赖数据库，任何环境下都执行

  let reason = "no PostgreSQL available";
  const env = await ensurePg({ onReason: (text) => {
    reason = text;
  } });
  if (!env) {
    console.log(`\ntest-agent-p5a-migrations-0003: UNVERIFIED (${reason})`);
    process.exit(0);
  }
  console.log(`pg-test-env: ${env.owned ? `docker container ${env.containerName}` : "external AGENT_TEST_PG_URL"} (${redactUrl(env.url)})`);
  try {
    await withPgDatabase(env, async (pgPersistenceService, pool) => {
      await testFreshMigrateAndStatus(pgPersistenceService, pool);
      await testDdlDetails(pool);
      await testCloseForTests(pgPersistenceService);
    });
  } finally {
    await env.cleanup();
  }
  console.log("\ntest-agent-p5a-migrations-0003: PASS");
})().catch((error) => {
  console.error(error && error.stack || error);
  process.exit(1);
});
