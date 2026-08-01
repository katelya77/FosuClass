// P5a：Agent 核心持久化的首批 migration（PostgreSQL standalone 模式）。
// agent_meta 是跨 workstream 的公共键值表（运行模式标记、schema 元信息等）；
// 各业务 workstream 以更高 version（0002+）在各自的 migration 文件中追加自己的表，
// 已应用版本的 statements 永远不得回改（checksum 校验会 fail closed）。

const AGENT_CORE_MIGRATIONS = Object.freeze([
  Object.freeze({
    version: 1,
    name: "agent_meta",
    statements: Object.freeze([
      [
        "CREATE TABLE IF NOT EXISTS agent_meta (",
        "  key text PRIMARY KEY,",
        "  value jsonb NOT NULL,",
        "  updated_at timestamptz NOT NULL DEFAULT now()",
        ")",
      ].join("\n"),
    ]),
  }),
]);

module.exports = Object.freeze({
  AGENT_CORE_MIGRATIONS,
});
