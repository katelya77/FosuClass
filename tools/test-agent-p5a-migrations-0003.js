#!/usr/bin/env node
// P5a WS4a：server 侧 pgPersistenceService 聚合迁移（含 version 3 四类存储建表、
// version 4 用户记忆文档表）的真实验证。
//
// 覆盖：空库 runMigrations → 已知版本按序应用 → 幂等重跑 → getMigrationStatus 形状 →
// 五表 + durable status 索引存在 → 关键 DDL（复合主键 / bigserial / NOT NULL 约束 /
// agent_user_memory 单列主键）→ closeForTests 重置单例。聚合列表随 workstream 追加
// （0002 预留 config kernel），本套件断言「严格递增 + 必含 1/3/4」，不锁死精确序列。
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
  "agent_user_memory",
];

// 版本断言纪律：聚合列表随 workstream 追加（0002 config kernel / 0004 user memory），
// 本套件不再锁死精确序列，只断言「严格递增 + 必含版本」，避免并行 workstream 相互踩碎。
const REQUIRED_VERSIONS = [1, 3, 4];

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
  // 不触网：聚合列表定义期校验（严格递增 + 必含 0001/0003/0004；0002 由 config kernel
  // workstream 追加，本套件不锁死其在场与否）。
  delete process.env.AGENT_PG_URL;
  const { getMigrationList } = require("../server/src/services/ai/persistence/pgPersistenceService");
  const versions = getMigrationList().map((migration) => migration.version);
  REQUIRED_VERSIONS.forEach((version) => {
    assert.ok(versions.includes(version), `聚合 migration 列表必须包含 version ${version}`);
  });
  const sorted = versions.slice().sort((a, b) => a - b);
  assert.deepStrictEqual(versions, sorted, "聚合 migration 列表必须按版本序");
  assert.strictEqual(new Set(versions).size, versions.length, "migration version 不得重复");
  const v3 = getMigrationList().find((migration) => migration.version === 3);
  assert.strictEqual(v3.name, "conversation_memory_stores");
  const v4 = getMigrationList().find((migration) => migration.version === 4);
  assert.strictEqual(v4.name, "user_memory");
  console.log(`✓ 聚合 migration 列表版本序 [${versions.join(", ")}]，含 0001/0003/0004`);
}

async function testFreshMigrateAndStatus(pgPersistenceService, pool) {
  const expectedVersions = pgPersistenceService.getMigrationList().map((migration) => migration.version);
  const expectedNames = pgPersistenceService.getMigrationList().map((migration) => migration.name);
  const first = await pgPersistenceService.runMigrations();
  assert.deepStrictEqual(first, {
    applied: expectedVersions,
    alreadyApplied: [],
    schemaVersion: Math.max(...expectedVersions),
  });

  const second = await pgPersistenceService.runMigrations();
  assert.deepStrictEqual(second, {
    applied: [],
    alreadyApplied: expectedVersions,
    schemaVersion: Math.max(...expectedVersions),
  }, "重复 migrate 必须是幂等 no-op");

  const status = await pgPersistenceService.getMigrationStatus();
  assert.strictEqual(status.schemaVersion, Math.max(...expectedVersions));
  assert.deepStrictEqual(status.applied.map((row) => row.version), expectedVersions);
  assert.deepStrictEqual(status.applied.map((row) => row.name), expectedNames);
  assert.deepStrictEqual(status.pending, []);

  for (const table of EXPECTED_TABLES) {
    const reg = await query(pool, "SELECT to_regclass($1) AS reg", [table]);
    assert.ok(reg.rows[0].reg, `${table} 必须存在`);
  }
  const index = await query(pool, "SELECT to_regclass('agent_durable_tasks_status_idx') AS reg");
  assert.ok(index.rows[0].reg, "agent_durable_tasks(status) 索引必须存在");
  console.log(`✓ 空库迁移 [${expectedVersions.join(",")}]、幂等重跑、getMigrationStatus 形状、五表与索引存在`);
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

  // agent_user_memory（0004）：principal_key 单列主键；doc/revision/updated_at 均 NOT NULL。
  const memoryPk = await query(
    pool,
    "SELECT kcu.column_name FROM information_schema.table_constraints tc " +
      "JOIN information_schema.key_column_usage kcu ON tc.constraint_name = kcu.constraint_name " +
      "WHERE tc.table_name = 'agent_user_memory' AND tc.constraint_type = 'PRIMARY KEY' " +
      "ORDER BY kcu.ordinal_position"
  );
  assert.deepStrictEqual(memoryPk.rows.map((row) => row.column_name), ["principal_key"]);
  const memoryCols = await query(
    pool,
    "SELECT column_name, data_type, is_nullable, column_default FROM information_schema.columns " +
      "WHERE table_name = 'agent_user_memory'"
  );
  const memoryByName = Object.fromEntries(memoryCols.rows.map((row) => [row.column_name, row]));
  assert.strictEqual(memoryByName.doc.data_type, "text");
  assert.strictEqual(memoryByName.doc.is_nullable, "NO");
  assert.strictEqual(memoryByName.revision.data_type, "bigint");
  assert.strictEqual(memoryByName.revision.is_nullable, "NO");
  assert.strictEqual(String(memoryByName.revision.column_default), "0");
  assert.strictEqual(memoryByName.updated_at.is_nullable, "NO");
  console.log("✓ DDL 细节：复合主键 / bigserial / expires_at 约束 / agent_user_memory 主键与非空列");
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
  // P5a WS5：migration 0005 起基线镜像为 pgvector/pgvector:pg16（CREATE EXTENSION vector）。
  const env = await ensurePg({ image: "pgvector/pgvector:pg16", onReason: (text) => {
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
