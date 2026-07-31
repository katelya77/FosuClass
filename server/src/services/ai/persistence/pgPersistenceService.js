/**
 * P5a WS4a：server 侧 PostgreSQL 持久化统一入口（懒单例）。
 *
 * 职责：
 *   - getPool()：进程级共享连接池。配置与 packages/agent-runtime pgClient 约定一致——
 *     AGENT_PG_URL 或离散 AGENT_PG_HOST/PORT/USER/PASSWORD/DATABASE/SSL；
 *     池为 lazy（首次 query 才触网），未配置时首次调用抛 PG_CONFIG_REQUIRED。
 *   - runMigrations() / getMigrationStatus()：聚合全部已知 migration 列表
 *     （packages 侧 agent_meta=0001 + 本目录 migrations/ 下各 workstream 追加项）
 *     按版本序执行 / 查询；并发安全与 checksum 校验由 runner 保证。
 *   - closeForTests()：测试收尾关闭池并重置单例（生产路径不调用）。
 *
 * 注意：只有 FOSU_AGENT_REPOSITORY_BACKEND=postgres 时才应有调用方触达本模块；
 * file（默认）模式下各 facade 不 require 本模块的连接路径。
 */

const {
  AGENT_CORE_MIGRATIONS,
  closePool,
  createMigrationRunner,
  createPgPool,
} = require("../../../../../packages/agent-runtime");
const {
  CONVERSATION_MEMORY_STORE_MIGRATIONS,
} = require("./migrations/0003ConversationMemoryStores");

let sharedPool = null;
let sharedRunner = null;

function getPool() {
  if (!sharedPool) {
    sharedPool = createPgPool(); // env 解析与 coded error 纪律全部沿用 pgClient
  }
  return sharedPool;
}

/** 聚合全部已知 migration（版本序）：0002 预留 config kernel，见 migrations/ 目录纪律。 */
function getMigrationList() {
  return AGENT_CORE_MIGRATIONS.concat(CONVERSATION_MEMORY_STORE_MIGRATIONS);
}

function getMigrationRunner() {
  if (!sharedRunner) {
    sharedRunner = createMigrationRunner({ pool: getPool(), migrations: getMigrationList() });
  }
  return sharedRunner;
}

async function runMigrations() {
  return getMigrationRunner().migrate();
}

async function getMigrationStatus() {
  return getMigrationRunner().getStatus();
}

async function closeForTests() {
  const pool = sharedPool;
  sharedPool = null;
  sharedRunner = null;
  if (pool) {
    await closePool(pool);
  }
}

module.exports = {
  closeForTests,
  getMigrationList,
  getMigrationStatus,
  getPool,
  runMigrations,
};
