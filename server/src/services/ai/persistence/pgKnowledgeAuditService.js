/**
 * P5a WS4a：PostgreSQL 版 KnowledgeAuditService。
 *
 * 与文件实现同一行为语义：
 *   - record(event)：条目整形/脱敏复用 knowledgeAuditEntry.buildAuditEntry（不复制），
 *     INSERT entry jsonb，返回整形后的条目；
 *   - list(limit)：ORDER BY id DESC LIMIT —— 与文件实现"取尾部 max 行后反转"同序同限量
 *     （limit 同样钳制在 1..200，默认 50）。
 * 方法为 async（文件实现为 sync）；postgres 模式下的调用方必须 await。
 * 文件实现的内存镜像/坏盘兜底在 PG 下无对应物：失败直接以 coded error
 * （PG_UNAVAILABLE / PG_QUERY_FAILED）抛出，由调用方决定兜底策略
 * （knowledgeControlPlane 的仓储层按文件语义做 best-effort 处理）。
 */

const { query } = require("../../../../../packages/agent-runtime");
const { buildAuditEntry } = require("../knowledgeAuditEntry");

function typedError(message, code, statusCode = 400) {
  const error = new Error(message);
  error.code = code;
  error.statusCode = statusCode;
  return error;
}

class PgKnowledgeAuditService {
  constructor(options = {}) {
    this.pool = options.pool || null;
    if (!this.pool) {
      throw typedError("pg pool required for PgKnowledgeAuditService", "PG_CONFIG_REQUIRED", 500);
    }
    this.maxEntries = Math.max(10, Number(options.maxEntries || 2000) || 2000);
    this.memoryOnly = false;
  }

  async record(event = {}) {
    const item = buildAuditEntry(event);
    await query(this.pool, "INSERT INTO agent_kb_audit (entry) VALUES ($1)", [JSON.stringify(item)]);
    return item;
  }

  async list(limit = 50) {
    const max = Math.max(1, Math.min(200, Number(limit) || 50));
    const result = await query(
      this.pool,
      "SELECT entry FROM agent_kb_audit ORDER BY id DESC LIMIT $1",
      [max]
    );
    return result.rows.map((row) => row.entry);
  }
}

module.exports = {
  PgKnowledgeAuditService,
};
