/**
 * P5b WS-A：standalone migrate 角色——跑版本化迁移后退出。
 *
 * 语义：runMigrations()（并发安全、checksum fail closed、目录自动发现全量
 * migration 列表）成功 → 打印 migration status → exit 0；失败 → 结构化日志
 * （errorClass = 底层 coded code）→ exit 1。compose 依赖序
 * （service_completed_successfully）即以退出码为准。
 */

const pgPersistenceService = require("../services/ai/persistence/pgPersistenceService");
const { errorClassOf } = require("./standaloneLogger");

/**
 * @param {{logger?: (event: string, fields?: object, level?: string) => void}} options
 * @returns {Promise<number>} 进程退出码（0=成功，1=失败）。
 */
async function runMigrate(options = {}) {
  const logger = typeof options.logger === "function" ? options.logger : () => {};
  try {
    const result = await pgPersistenceService.runMigrations();
    const status = await pgPersistenceService.getMigrationStatus();
    logger("migrate-completed", {
      applied: result.applied,
      alreadyAppliedCount: result.alreadyApplied.length,
      schemaVersion: status.schemaVersion,
      pendingCount: status.pending.length,
    });
    return 0;
  } catch (error) {
    logger("migrate-failed", { errorClass: errorClassOf(error) }, "error");
    return 1;
  } finally {
    try {
      await pgPersistenceService.closeForTests(); // 关闭共享池（进程即退，语义同生产 close）
    } catch (_) {
      /* 尽力而为 */
    }
  }
}

module.exports = Object.freeze({
  runMigrate,
});
