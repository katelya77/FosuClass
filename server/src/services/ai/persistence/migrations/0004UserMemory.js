/**
 * P5a WS4b：用户长期记忆（user-memory.v2 文档）PG 存储的建表 migration。
 *
 * 版本纪律（expand-contract，与 packages/agent-runtime AGENT_CORE_MIGRATIONS 同规）：
 *   - 本文件固定 version 4；0001 = agent_meta（packages 侧核心表），
 *     0002 预留 config kernel workstream，0003 = 会话/任务/审计/幂等存储；
 *   - 已应用版本的 statements 永远不得回改（runner 以 sha256 校验，fail closed）；
 *   - 本 migration 只新增表，不触碰既有对象。
 *
 * 表语义：agent_user_memory 每 principal 一行，doc 存序列化后的
 * user-memory.v2 信封文本（加密层在 store 之上，doc 对 PG 而言是不透明
 * 密文文本）；revision 列与信封内 revision 冗余同步，作为 CAS 令牌
 * （PgMemoryDocumentStore.save 的 ON CONFLICT ... WHERE revision 判定）；
 * updated_at 仅作运维观测，不参与并发判定。
 */

const USER_MEMORY_MIGRATIONS = Object.freeze([
  Object.freeze({
    version: 4,
    name: "user_memory",
    statements: Object.freeze([
      [
        "CREATE TABLE IF NOT EXISTS agent_user_memory (",
        "  principal_key text PRIMARY KEY,",
        "  doc text NOT NULL,",
        "  revision bigint NOT NULL DEFAULT 0,",
        "  updated_at timestamptz NOT NULL DEFAULT now()",
        ")",
      ].join("\n"),
    ]),
  }),
]);

module.exports = Object.freeze({
  USER_MEMORY_MIGRATIONS,
});
