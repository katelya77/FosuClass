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

const fs = require("fs");
const path = require("path");

const MIGRATIONS_DIR = path.join(__dirname, "migrations");

let sharedPool = null;
let sharedRunner = null;

function getPool() {
  if (!sharedPool) {
    sharedPool = createPgPool(); // env 解析与 coded error 纪律全部沿用 pgClient
  }
  return sharedPool;
}

/** 聚合全部已知 migration（版本序）：自动发现 migrations/ 下 NNNN*.js 文件，
 * 每个文件须导出一个 migration 数组（版本全局唯一、严格递增由 runner 校验）。
 * 各 workstream 只新增文件、不改本模块，避免并行改动冲突。 */
function getMigrationList() {
  const files = fs.readdirSync(MIGRATIONS_DIR)
    .filter((name) => /^\d{4}.+\.js$/.test(name))
    .sort();
  const list = AGENT_CORE_MIGRATIONS.slice();
  files.forEach((name) => {
    const mod = require(path.join(MIGRATIONS_DIR, name));
    const migrations = Object.keys(mod).map((key) => mod[key]).find((value) => Array.isArray(value) && value.length && typeof value[0].version === "number");
    if (!migrations) {
      const error = new Error(`migration file ${name} must export a non-empty migration array`);
      error.code = "MIGRATION_DEFINITION_INVALID";
      throw error;
    }
    list.push(...migrations);
  });
  return list.sort((a, b) => a.version - b.version);
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
