/**
 * P5a WS4a：PostgreSQL 版 ConversationRepository。
 *
 * 与 FileConversationRepository 同一接口、同一行为语义、同一错误码——
 * 本类不含任何领域规则副本：
 *   - 文档整存 agent_conversations.doc jsonb（含 schemaVersion 字段）；
 *   - 读取一律走 conversationSchema.migrateConversationState（v1→v2 迁移不复制）；
 *   - createEmptyConversationState / isExpired / publicConversationView /
 *     hashConversationId 等全部复用 conversationSchema；
 *   - 错误 (message, code, statusCode) 与文件实现逐字一致。
 *
 * 并发模型：文件实现靠 per-principal 文件锁串行化；本实现以
 * SELECT ... FOR UPDATE 事务获得同等串行语义——update 的乐观并发
 * （expectedRevision）在锁内判定，过期 expectedRevision → CONVERSATION_REVISION_CONFLICT。
 *
 * 存储差异（不影响行为契约）：
 *   - 文件实现的 index.json / 损坏文件隔离在 PG 下无对应物（jsonb 写入即校验）；
 *   - revision 列与 doc.revision 冗余同步，便于运维核查，读取以 doc 为准；
 *   - 方法均为 async（文件实现为 sync）——facade 按后端返回对应实现，
 *     调用方在 postgres 模式下必须 await（同步消费链的异步化属后续集成 WS）。
 */

const { query, withTransaction } = require("../../../../../packages/agent-runtime");
const {
  createEmptyConversationState,
  hashConversationId,
  isExpired,
  migrateConversationState,
  nowIso,
  publicConversationView,
} = require("./conversationSchema");

const DEFAULT_MAX_PER_PRINCIPAL = 20;

// 与 fileConversationRepository.typedError 完全一致的 (message, code, statusCode)。
function typedError(message, code, statusCode = 400) {
  const error = new Error(message);
  error.code = code;
  error.statusCode = statusCode;
  return error;
}

class PgConversationRepository {
  constructor(options = {}) {
    this.pool = options.pool || null;
    if (!this.pool) {
      throw typedError("pg pool required for PgConversationRepository", "PG_CONFIG_REQUIRED", 500);
    }
    this.maxPerPrincipal = Math.max(1, Number(options.maxPerPrincipal || DEFAULT_MAX_PER_PRINCIPAL) || DEFAULT_MAX_PER_PRINCIPAL);
  }

  /** 读取一行并迁移到当前 schema；归属判定留给调用方（各方法判定次序与文件实现一致）。 */
  async _selectState(queryable, principalKey, conversationId, forUpdate = false) {
    const result = await queryable.query(
      `SELECT doc FROM agent_conversations WHERE principal_key = $1 AND conversation_id = $2${forUpdate ? " FOR UPDATE" : ""}`,
      [principalKey, conversationId]
    );
    const row = result.rows && result.rows[0];
    if (!row || !row.doc || typeof row.doc !== "object") return null;
    return migrateConversationState(row.doc, { conversationId, principalKey });
  }

  async _deleteRow(principalKey, conversationId) {
    const result = await query(
      this.pool,
      "DELETE FROM agent_conversations WHERE principal_key = $1 AND conversation_id = $2",
      [principalKey, conversationId]
    );
    return result.rowCount || 0;
  }

  /** 删除该 principal 下所有过期行，返回删除数（量小，JS 过滤从简）。 */
  async _pruneExpiredRows(principalKey) {
    const result = await query(
      this.pool,
      "SELECT conversation_id AS id, doc FROM agent_conversations WHERE principal_key = $1",
      [principalKey]
    );
    const expiredIds = result.rows
      .filter((row) => isExpired(row.doc && typeof row.doc === "object" ? row.doc : {}))
      .map((row) => row.id);
    if (!expiredIds.length) return 0;
    const deleted = await query(
      this.pool,
      "DELETE FROM agent_conversations WHERE principal_key = $1 AND conversation_id = ANY($2::text[])",
      [principalKey, expiredIds]
    );
    return deleted.rowCount || 0;
  }

  /** 容量裁减：每 principal 最多 maxPerPrincipal 条，淘汰 doc.updatedAt 最旧者。 */
  async _enforceCapacity(principalKey) {
    const result = await query(
      this.pool,
      "SELECT conversation_id AS id, doc FROM agent_conversations WHERE principal_key = $1",
      [principalKey]
    );
    if (result.rows.length <= this.maxPerPrincipal) return;
    const sorted = result.rows.slice().sort((a, b) => {
      const left = a.doc && a.doc.updatedAt;
      const right = b.doc && b.doc.updatedAt;
      return String(left || "").localeCompare(String(right || ""));
    });
    const overflow = sorted.slice(0, result.rows.length - this.maxPerPrincipal).map((row) => row.id);
    if (overflow.length) {
      await query(
        this.pool,
        "DELETE FROM agent_conversations WHERE principal_key = $1 AND conversation_id = ANY($2::text[])",
        [principalKey, overflow]
      );
    }
  }

  async get(principalKey, conversationId) {
    if (!principalKey) return null;
    const id = String(conversationId || "");
    const state = await this._selectState({ query: (text, params) => query(this.pool, text, params) }, principalKey, id);
    if (!state) return null;
    // 判定次序与文件实现一致：先归属（不符 → null，不删行），后过期（删行 → null）。
    if (state.principalKey && state.principalKey !== principalKey) return null;
    if (isExpired(state)) {
      await this._deleteRow(principalKey, id);
      return null;
    }
    // 与文件实现一致：get 触达 lastAccessedAt（不递增 revision）。
    state.lastAccessedAt = nowIso();
    await query(
      this.pool,
      "UPDATE agent_conversations SET doc = $3, updated_at = now() WHERE principal_key = $1 AND conversation_id = $2",
      [principalKey, id, JSON.stringify(state)]
    );
    return state;
  }

  async create(principalKey, input = {}) {
    if (!principalKey) {
      throw typedError("Authenticated principal required", "PRINCIPAL_REQUIRED", 401);
    }
    const conversationId = String(input.conversationId || input.clientConversationId || "").trim();
    if (!conversationId || conversationId.length > 80) {
      throw typedError("conversationId invalid", "CONVERSATION_ID_INVALID", 400);
    }
    await this._pruneExpiredRows(principalKey);
    const state = createEmptyConversationState({
      conversationId,
      principalKey,
      runtimeMode: input.runtimeMode,
      memoryMode: input.memoryMode || "session_state",
      title: input.title,
    });
    state.contextSlots = input.contextSlots || state.contextSlots;
    // createIfMissing 语义：已存在存活行 → 原样返回（prune 后仍能冲突的一定是存活行）。
    const inserted = await query(
      this.pool,
      "INSERT INTO agent_conversations (principal_key, conversation_id, doc, revision) VALUES ($1, $2, $3, 0) " +
        "ON CONFLICT (principal_key, conversation_id) DO NOTHING RETURNING doc",
      [principalKey, conversationId, JSON.stringify(state)]
    );
    if (inserted.rows && inserted.rows[0]) {
      await this._enforceCapacity(principalKey);
      return state;
    }
    const existing = await this._selectState({ query: (text, params) => query(this.pool, text, params) }, principalKey, conversationId);
    if (existing && !isExpired(existing)) return existing;
    // 极端竞态：冲突行在插入与重读之间被并发删除——重试一次插入即可。
    await query(
      this.pool,
      "INSERT INTO agent_conversations (principal_key, conversation_id, doc, revision) VALUES ($1, $2, $3, 0) " +
        "ON CONFLICT (principal_key, conversation_id) DO NOTHING",
      [principalKey, conversationId, JSON.stringify(state)]
    );
    await this._enforceCapacity(principalKey);
    return state;
  }

  async list(principalKey, options = {}) {
    if (!principalKey) return [];
    await this._pruneExpiredRows(principalKey);
    const result = await query(
      this.pool,
      "SELECT doc FROM agent_conversations WHERE principal_key = $1",
      [principalKey]
    );
    const items = [];
    result.rows.forEach((row) => {
      if (!row.doc || typeof row.doc !== "object") return;
      const state = migrateConversationState(row.doc, { principalKey });
      // 与文件实现一致：list 只按过期过滤（键空间即 principal 隔离，不再判归属）。
      if (isExpired(state)) return;
      items.push(options.raw ? state : publicConversationView(state));
    });
    items.sort((a, b) => String(b.updatedAt || "").localeCompare(String(a.updatedAt || "")));
    return items;
  }

  async update(principalKey, conversationId, patch = {}, options = {}) {
    if (!principalKey) {
      throw typedError("Authenticated principal required", "PRINCIPAL_REQUIRED", 401);
    }
    const id = String(conversationId || "");
    // FOR UPDATE 行锁串行化，等价于文件实现的 per-principal 文件锁。
    return withTransaction(this.pool, async (client) => {
      let current = await this._selectState(client, principalKey, id, true);
      let wasCreated = false;
      if (!current || isExpired(current)) {
        if (options.createIfMissing) {
          current = createEmptyConversationState({
            conversationId: id,
            principalKey,
            runtimeMode: patch.runtimeMode || options.runtimeMode,
            memoryMode: patch.memoryPolicy && patch.memoryPolicy.mode || options.memoryMode || "session_state",
            title: patch.title,
          });
          // revision starts at 1 after first upsert write below
          current.revision = 0;
          wasCreated = true;
        } else {
          throw typedError("Conversation not found", "CONVERSATION_NOT_FOUND", 404);
        }
      }
      if (current.principalKey && current.principalKey !== principalKey) {
        throw typedError("Conversation ownership mismatch", "CONVERSATION_FORBIDDEN", 403);
      }
      const expectedRevision = options.expectedRevision;
      // Skip revision check on first create so client can pass local revision 0 safely.
      if (!wasCreated && expectedRevision !== undefined && expectedRevision !== null
        && Number(expectedRevision) !== Number(current.revision)) {
        throw typedError("Conversation revision conflict", "CONVERSATION_REVISION_CONFLICT", 409);
      }
      const next = migrateConversationState(Object.assign({}, current, patch, {
        principalKey,
        conversationIdHash: hashConversationId(id),
        clientConversationId: current.clientConversationId || id,
        revision: wasCreated ? 1 : Number(current.revision || 0) + 1,
        updatedAt: nowIso(),
        lastAccessedAt: nowIso(),
      }), { conversationId: id, principalKey });
      if (wasCreated) {
        // 覆盖可能的过期残留行（键相同），语义同文件实现的原子覆盖写。
        await client.query(
          "INSERT INTO agent_conversations (principal_key, conversation_id, doc, revision) VALUES ($1, $2, $3, $4) " +
            "ON CONFLICT (principal_key, conversation_id) DO UPDATE SET doc = EXCLUDED.doc, revision = EXCLUDED.revision, updated_at = now()",
          [principalKey, id, JSON.stringify(next), next.revision]
        );
      } else {
        await client.query(
          "UPDATE agent_conversations SET doc = $3, revision = $4, updated_at = now() WHERE principal_key = $1 AND conversation_id = $2",
          [principalKey, id, JSON.stringify(next), next.revision]
        );
      }
      return next;
    });
  }

  async delete(principalKey, conversationId) {
    if (!principalKey) return { success: true, deleted: false };
    const deleted = await this._deleteRow(principalKey, String(conversationId || ""));
    return { success: true, deleted: deleted > 0 };
  }

  async clearPrincipal(principalKey) {
    if (!principalKey) return { success: true, deleted: 0 };
    const result = await query(
      this.pool,
      "DELETE FROM agent_conversations WHERE principal_key = $1",
      [principalKey]
    );
    return { success: true, deleted: result.rowCount || 0 };
  }

  async pruneExpired(principalKey) {
    if (!principalKey) return { pruned: 0 };
    return { pruned: await this._pruneExpiredRows(principalKey) };
  }

  async migrate(principalKey, conversationId) {
    if (!principalKey) return null;
    const state = await this.get(principalKey, conversationId);
    if (!state) return null;
    return this.update(principalKey, conversationId, {}, { expectedRevision: state.revision });
  }
}

module.exports = {
  PgConversationRepository,
};
