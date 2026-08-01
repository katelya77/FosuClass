/**
 * P5a WS6：把 PgMemoryDocumentStore（WS4b，异步 load/save CAS）适配为
 * UserPreferenceService 同步文档存储 seam 的异步同形实现。
 *
 * seam 形状与 fileMemoryDocumentStore 逐字对齐（差异仅在高频方法返回 Promise，
 * 服务层 maybe-async 链按 thenable 检测透传）：
 *   - filePath(principalKey) → 不透明位置描述符。PG 下无文件路径，
 *     描述符即 principalKey 本身（服务层不解释、不回显、不落日志，
 *     仅原样传回 load/save/statMtimeMs）；
 *   - withLock(principalKey, callback) → Promise。PG 无文件锁：并发
 *     read-modify-write 的正确性由 save 的单语句 revision CAS 保证
 *     （WS4b 设计：并发写恰好一个成功，其余 MEMORY_REVISION_CONFLICT，
 *     与服务层 assertExpectedRevision 同码）。入口先 await
 *     ensureAgentPersistenceReady()——表结构由 initPlatform 的迁移链保证，
 *     失败以 coded AGENT_PLATFORM_INIT_FAILED 拒绝（不经 agent-runtime
 *     query 包装，code 原样保留）；
 *   - load(descriptor) → Promise<string|null>：不透明信封文本（加密层在
 *     store 之上，本 adapter 不解析）；
 *   - save(descriptor, text, {expectedRevision, revision}) → Promise：
 *     透传 CAS 参数；服务层 mutate/clear 总会带齐。缺 expectedRevision 时
 *     退化为 WS4b 的无条件 upsert（迁移/运维路径语义）；
 *   - statMtimeMs(descriptor) → Promise<number>：legacy v1 迁移的
 *     updatedAt 回退（文件实现的 fs.statSync(...).mtimeMs 对应物），
 *     取行 updated_at；仅会在 load 返回非 null 后被调用（行必存在），
 *     防御性缺失返回 NaN（entryExpiryMs 据此 fail closed，不复活旧数据）。
 *
 * 加密/迁移/revision 领域逻辑全部留在 UserPreferenceService；本 adapter 只见
 * 不透明信封文本。pool 由调用方持有（默认 WS2 同款 lazy pool：构造不触网）。
 */

const { query } = require("../../../../../packages/agent-runtime");
const { createPgMemoryDocumentStore } = require("./pgMemoryDocumentStore");
const { createLazyPool, ensureAgentPersistenceReady } = require("../persistence/pgReadiness");

const TABLE = "agent_user_memory";

class PgMemoryDocumentStoreAdapter {
  constructor(options = {}) {
    this.pool = options.pool || createLazyPool();
    this.store = options.store || createPgMemoryDocumentStore({ pool: this.pool });
  }

  filePath(principalKey) {
    return String(principalKey || "");
  }

  async withLock(principalKey, callback) {
    await ensureAgentPersistenceReady();
    return callback(this.filePath(principalKey));
  }

  async load(descriptor) {
    const row = await this.store.load(descriptor);
    return row ? row.doc : null;
  }

  async save(descriptor, text, cas = {}) {
    return this.store.save(descriptor, text, cas);
  }

  async statMtimeMs(descriptor) {
    const result = await query(
      this.pool,
      `SELECT updated_at AS "updatedAt" FROM ${TABLE} WHERE principal_key = $1`,
      [String(descriptor || "")]
    );
    const row = result.rows && result.rows[0];
    const ms = row && row.updatedAt instanceof Date ? row.updatedAt.getTime() : Date.parse(row && row.updatedAt || "");
    return Number.isFinite(ms) ? ms : Number.NaN;
  }
}

function createPgMemoryDocumentStoreAdapter(options = {}) {
  return new PgMemoryDocumentStoreAdapter(options);
}

module.exports = {
  PgMemoryDocumentStoreAdapter,
  createPgMemoryDocumentStoreAdapter,
};
