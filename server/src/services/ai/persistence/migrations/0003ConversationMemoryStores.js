/**
 * P5a WS4a：会话 / 持久任务 / 知识审计 / 幂等四类存储的建表 migration。
 *
 * 版本纪律（expand-contract，与 packages/agent-runtime AGENT_CORE_MIGRATIONS 同规）：
 *   - 本文件固定 version 3；0001 = agent_meta（packages 侧核心表）；
 *   - 0002 预留给 config kernel workstream，0004/0005 预留后续 workstream，均不得占用；
 *   - 已应用版本的 statements 永远不得回改（runner 以 sha256 校验，fail closed）；
 *   - 本 migration 只新增表/索引，不触碰既有对象。
 */

const CONVERSATION_MEMORY_STORE_MIGRATIONS = Object.freeze([
  Object.freeze({
    version: 3,
    name: "conversation_memory_stores",
    statements: Object.freeze([
      [
        "CREATE TABLE IF NOT EXISTS agent_conversations (",
        "  principal_key text NOT NULL,",
        "  conversation_id text NOT NULL,",
        "  doc jsonb NOT NULL,",
        "  revision bigint NOT NULL DEFAULT 0,",
        "  updated_at timestamptz NOT NULL DEFAULT now(),",
        "  PRIMARY KEY (principal_key, conversation_id)",
        ")",
      ].join("\n"),
      [
        "CREATE TABLE IF NOT EXISTS agent_durable_tasks (",
        "  task_id text PRIMARY KEY,",
        "  status text NOT NULL,",
        "  expires_at timestamptz,",
        "  doc jsonb NOT NULL,",
        "  updated_at timestamptz NOT NULL DEFAULT now()",
        ")",
      ].join("\n"),
      "CREATE INDEX IF NOT EXISTS agent_durable_tasks_status_idx ON agent_durable_tasks (status)",
      [
        "CREATE TABLE IF NOT EXISTS agent_kb_audit (",
        "  id bigserial PRIMARY KEY,",
        "  entry jsonb NOT NULL,",
        "  created_at timestamptz NOT NULL DEFAULT now()",
        ")",
      ].join("\n"),
      [
        "CREATE TABLE IF NOT EXISTS agent_kb_idempotency (",
        "  key text PRIMARY KEY,",
        "  entry jsonb NOT NULL,",
        "  expires_at timestamptz NOT NULL",
        ")",
      ].join("\n"),
    ]),
  }),
]);

module.exports = Object.freeze({
  CONVERSATION_MEMORY_STORE_MIGRATIONS,
});
