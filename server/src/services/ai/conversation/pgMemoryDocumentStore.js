/**
 * P5a WS4b：user-memory.v2 文档的 PostgreSQL 存储实现（异步）。
 *
 * 与 FileMemoryDocumentStore 对齐的文档级接口，但方法返回 Promise：
 *   - load(principalKey) → Promise<{doc: string, revision: number} | null>
 *     （缺失返回 null；doc 为不透明信封文本——加密层在 store 之上，
 *     本 store 不解析、不校验文档结构）；
 *   - save(principalKey, doc, {expectedRevision, revision}) → Promise<{revision}>
 *     revision CAS：
 *       - expectedRevision 缺省/null → 无条件 upsert（保留给迁移/运维路径；
 *         服务层 mutate 总会带值）；
 *       - 提供 expectedRevision → 单条原子语句
 *         INSERT ... SELECT（$expected = 0 OR 行已存在 门控）
 *         ON CONFLICT DO UPDATE ... WHERE revision = $expected：
 *         行不存在 ≡ 空文档 revision 0（与 userPreferenceService 的
 *         emptyDocument/assertExpectedRevision 语义同构），行存在且
 *         revision 相等才覆盖；rowCount 0 → 抛
 *         ("Memory revision conflict", MEMORY_REVISION_CONFLICT, 409)，
 *         与服务层 typedError 逐字同构；
 *       - revision（新 revision）必填，有限且 >= 0，否则 MEMORY_REVISION_INVALID。
 *
 * 并发模型：CAS 全部落在单条 INSERT ... ON CONFLICT DO UPDATE WHERE 上，
 * 并发写同一 principal 时后到事务在冲突行上等待先到者提交后重评估 WHERE，
 * 恰好一个成功、其余 MEMORY_REVISION_CONFLICT——与文件实现的
 * per-principal 锁内 read-modify-write 等价。
 *
 * 注意：
 *   - 表 agent_user_memory 由 migration 0004 建立，本 store 不自建表；
 *   - 本阶段（WS4b）不接入 userPreferenceService 的同步热链——热链
 *     await 化与后端切换属后续 WS6；本 store 可独立实例化与测试；
 *   - pool 由调用方持有（与 PgConversationRepository 同约定），
 *     缺失时抛 PG_CONFIG_REQUIRED。
 */

const { query } = require("../../../../../packages/agent-runtime");

const TABLE = "agent_user_memory";

// 与 userPreferenceService.typedError 完全一致的 (message, code, statusCode)。
function typedError(message, code, statusCode = 400) {
  const error = new Error(message);
  error.code = code;
  error.statusCode = statusCode;
  return error;
}

class PgMemoryDocumentStore {
  constructor(options = {}) {
    this.pool = options.pool || null;
    if (!this.pool) {
      throw typedError("pg pool required for PgMemoryDocumentStore", "PG_CONFIG_REQUIRED", 500);
    }
  }

  async load(principalKey) {
    const key = String(principalKey || "");
    if (!key) return null;
    const result = await query(
      this.pool,
      `SELECT doc, revision FROM ${TABLE} WHERE principal_key = $1`,
      [key]
    );
    const row = result.rows && result.rows[0];
    if (!row) return null;
    return { doc: String(row.doc), revision: Number(row.revision) };
  }

  async save(principalKey, doc, options = {}) {
    const key = String(principalKey || "");
    if (!key) {
      throw typedError("Authenticated principal required", "PRINCIPAL_REQUIRED", 401);
    }
    const text = String(doc);
    const nextRevision = Number(options.revision);
    if (!Number.isFinite(nextRevision) || nextRevision < 0) {
      throw typedError("Memory revision is invalid", "MEMORY_REVISION_INVALID", 400);
    }
    const expected = options.expectedRevision;
    if (expected === undefined || expected === null) {
      await query(
        this.pool,
        `INSERT INTO ${TABLE} (principal_key, doc, revision) VALUES ($1, $2, $3) ` +
          "ON CONFLICT (principal_key) DO UPDATE SET doc = EXCLUDED.doc, revision = EXCLUDED.revision, updated_at = now()",
        [key, text, nextRevision]
      );
      return { revision: nextRevision };
    }
    const expectedRevision = Number(expected);
    if (!Number.isFinite(expectedRevision) || expectedRevision < 0) {
      throw typedError("Memory revision is invalid", "MEMORY_REVISION_INVALID", 400);
    }
    // 单语句原子 CAS：
    //   - SELECT 门控：行不存在时仅当 expectedRevision = 0 才产生待插入行
    //     （缺失 ≡ 空文档 revision 0，与服务层 emptyDocument 语义同构）；
    //     行已存在时门控恒过，交给 ON CONFLICT 分支判定；
    //   - ON CONFLICT DO UPDATE ... WHERE revision = $expected：存在行仅在
    //     revision 匹配时覆盖；并发写同一 principal 时后到语句在冲突行上
    //     等待先到者提交后重评估 WHERE，恰好一个成功；
    //   - rowCount 0 → 基线过期或缺失行非零基线，一律 MEMORY_REVISION_CONFLICT。
    const result = await query(
      this.pool,
      `INSERT INTO ${TABLE} (principal_key, doc, revision) ` +
        "SELECT $1, $2, $3 " +
        `WHERE $4 = 0 OR EXISTS (SELECT 1 FROM ${TABLE} WHERE principal_key = $1) ` +
        "ON CONFLICT (principal_key) DO UPDATE SET doc = EXCLUDED.doc, revision = EXCLUDED.revision, updated_at = now() " +
        `WHERE ${TABLE}.revision = $4`,
      [key, text, nextRevision, expectedRevision]
    );
    if ((result.rowCount || 0) !== 1) {
      throw typedError("Memory revision conflict", "MEMORY_REVISION_CONFLICT", 409);
    }
    return { revision: nextRevision };
  }
}

function createPgMemoryDocumentStore(options = {}) {
  return new PgMemoryDocumentStore(options);
}

module.exports = {
  PgMemoryDocumentStore,
  createPgMemoryDocumentStore,
};
