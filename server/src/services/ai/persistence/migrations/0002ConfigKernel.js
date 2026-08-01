/**
 * P5a WS2：Config Kernel（统一配置发布内核）PostgreSQL 存储的建表 migration。
 *
 * 版本纪律（expand-contract，与 packages/agent-runtime AGENT_CORE_MIGRATIONS 同规）：
 *   - 本文件固定 version 2；0001 = agent_meta（packages 侧核心表）；
 *   - 0003 = conversation/memory stores，0004+ 预留后续 workstream，均不得占用；
 *   - 已应用版本的 statements 永远不得回改（runner 以 sha256 校验，fail closed）；
 *   - 本 migration 只新增表，不触碰既有对象。
 *
 * 表布局逐一对齐 configKernel 文件适配器的持久化单元：
 *   config_drafts    可变草稿文档（doc 整体 jsonb 往返）
 *   config_versions  不可变版本文档（digest 列冗余，读回双校验 fail closed）
 *   config_pointers  当前发布指针（environment 单行：seq + artifacts）
 *   config_snapshots 不可变快照文档（digest 列冗余）
 *   config_current   当前快照引用（原子切换的发布点）
 *   config_lkg       最近有效快照副本（last-known-good）
 *   config_audit     追加式审计（id 单调即时间序）
 *
 * updated_at 列的取舍：pointers/current 的 updatedAt 是文档语义字段（内核写入、
 * 读回逐字往返），故为 text；其余表的 updated_at/created_at 仅为元数据，用
 * timestamptz DEFAULT now()，不参与文档往返。
 */

const CONFIG_KERNEL_MIGRATIONS = Object.freeze([
  Object.freeze({
    version: 2,
    name: "config_kernel_stores",
    statements: Object.freeze([
      [
        "CREATE TABLE IF NOT EXISTS config_drafts (",
        "  environment text NOT NULL,",
        "  domain text NOT NULL,",
        "  artifact_id text NOT NULL,",
        "  doc jsonb NOT NULL,",
        "  updated_at timestamptz NOT NULL DEFAULT now(),",
        "  PRIMARY KEY (environment, domain, artifact_id)",
        ")",
      ].join("\n"),
      [
        "CREATE TABLE IF NOT EXISTS config_versions (",
        "  environment text NOT NULL,",
        "  domain text NOT NULL,",
        "  artifact_id text NOT NULL,",
        "  version integer NOT NULL,",
        "  digest text NOT NULL,",
        "  doc jsonb NOT NULL,",
        "  created_at timestamptz NOT NULL DEFAULT now(),",
        "  PRIMARY KEY (environment, domain, artifact_id, version)",
        ")",
      ].join("\n"),
      [
        "CREATE TABLE IF NOT EXISTS config_pointers (",
        "  environment text PRIMARY KEY,",
        "  seq bigint NOT NULL DEFAULT 0,",
        "  artifacts jsonb NOT NULL DEFAULT '{}'::jsonb,",
        "  updated_at text NOT NULL DEFAULT ''",
        ")",
      ].join("\n"),
      [
        "CREATE TABLE IF NOT EXISTS config_snapshots (",
        "  environment text NOT NULL,",
        "  config_version text NOT NULL,",
        "  digest text NOT NULL,",
        "  doc jsonb NOT NULL,",
        "  created_at timestamptz NOT NULL DEFAULT now(),",
        "  PRIMARY KEY (environment, config_version)",
        ")",
      ].join("\n"),
      [
        "CREATE TABLE IF NOT EXISTS config_current (",
        "  environment text PRIMARY KEY,",
        "  config_version text NOT NULL,",
        "  updated_at text NOT NULL DEFAULT ''",
        ")",
      ].join("\n"),
      [
        "CREATE TABLE IF NOT EXISTS config_lkg (",
        "  environment text PRIMARY KEY,",
        "  digest text NOT NULL,",
        "  doc jsonb NOT NULL,",
        "  updated_at timestamptz NOT NULL DEFAULT now()",
        ")",
      ].join("\n"),
      [
        "CREATE TABLE IF NOT EXISTS config_audit (",
        "  id bigserial PRIMARY KEY,",
        "  entry jsonb NOT NULL,",
        "  created_at timestamptz NOT NULL DEFAULT now()",
        ")",
      ].join("\n"),
    ]),
  }),
]);

module.exports = Object.freeze({
  CONFIG_KERNEL_MIGRATIONS,
});
