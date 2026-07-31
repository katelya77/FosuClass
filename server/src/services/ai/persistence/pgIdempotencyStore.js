/**
 * P5a WS4a：PostgreSQL 版 IdempotencyStore。
 *
 * 与文件实现同一行为语义：
 *   - TTL 口径一致（默认 24h，下限 60s）；
 *   - get(key, body)：未命中 → null；已过期 → 删除并返回 null；
 *     指纹不符 → IDEMPOTENCY_KEY_CONFLICT 409（message 与文件实现逐字一致）；
 *     命中 → 返回缓存 response；
 *   - set(key, body, response)：upsert（同键覆盖，同文件 Map.set 语义），
 *     顺带清理过期行，并按文件实现的 500 条上限裁减最旧条目
 *     （文件按 Map 插入序淘汰；此处按 entry.createdAt 近似，注释说明）。
 * 指纹算法复用 knowledgeAuditEntry.fingerprintBody（不复制）。
 * 方法为 async（文件实现为 sync）；postgres 模式下的调用方必须 await。
 */

const { query } = require("../../../../../packages/agent-runtime");
const { fingerprintBody, nowIso, typedError } = require("../knowledgeAuditEntry");

const MAX_ENTRIES = 500; // 与文件实现 Map 上限一致

class PgIdempotencyStore {
  constructor(options = {}) {
    this.pool = options.pool || null;
    if (!this.pool) {
      throw typedError("pg pool required for PgIdempotencyStore", "PG_CONFIG_REQUIRED", 500);
    }
    this.ttlMs = Math.max(60 * 1000, Number(options.ttlMs || 24 * 60 * 60 * 1000) || 24 * 60 * 60 * 1000);
    this.memoryOnly = false;
  }

  fingerprint(body) {
    return fingerprintBody(body);
  }

  async get(key, body) {
    if (!key) return null;
    const result = await query(
      this.pool,
      'SELECT entry, expires_at AS "expiresAt" FROM agent_kb_idempotency WHERE key = $1',
      [String(key)]
    );
    const row = result.rows && result.rows[0];
    if (!row || !row.entry) return null;
    const item = row.entry;
    const expiresAt = Number(item.expiresAt)
      || (row.expiresAt instanceof Date ? row.expiresAt.getTime() : 0);
    if (expiresAt <= Date.now()) {
      await query(this.pool, "DELETE FROM agent_kb_idempotency WHERE key = $1", [String(key)]);
      return null;
    }
    if (item.fingerprint !== this.fingerprint(body)) {
      throw typedError("Idempotency-Key reused with different payload", "IDEMPOTENCY_KEY_CONFLICT", 409);
    }
    return item.response;
  }

  async set(key, body, response) {
    if (!key) return;
    const entry = {
      fingerprint: this.fingerprint(body),
      response,
      expiresAt: Date.now() + this.ttlMs,
      createdAt: nowIso(),
    };
    await query(
      this.pool,
      "INSERT INTO agent_kb_idempotency (key, entry, expires_at) VALUES ($1, $2, $3) " +
        "ON CONFLICT (key) DO UPDATE SET entry = EXCLUDED.entry, expires_at = EXCLUDED.expires_at",
      [String(key), JSON.stringify(entry), new Date(entry.expiresAt)]
    );
    // 与文件实现一致的卫生语义：过期即清（文件在 load/get 时清理），总量封顶。
    await query(this.pool, "DELETE FROM agent_kb_idempotency WHERE expires_at <= now()");
    await query(
      this.pool,
      "DELETE FROM agent_kb_idempotency WHERE key NOT IN (" +
        "SELECT key FROM agent_kb_idempotency ORDER BY entry->>'createdAt' DESC LIMIT $1" +
        ")",
      [MAX_ENTRIES]
    );
  }
}

module.exports = {
  PgIdempotencyStore,
};
