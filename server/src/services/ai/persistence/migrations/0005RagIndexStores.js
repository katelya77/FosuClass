/**
 * P5a WS5：RAG 索引产物与分块向量的 PostgreSQL 存储（standalone 模式）。
 *
 * 版本纪律（expand-contract，与既有 migration 同规）：
 *   - 本文件固定 version 5；version 6 已分配给另一并行 workstream，不得占用；
 *   - 已应用版本的 statements 永远不得回改（runner 以 sha256 校验，fail closed）；
 *   - 本 migration 只新增扩展/表/索引，不触碰既有对象。
 *
 * 表设计：
 *   - agent_rag_index_versions：不可变版本索引（序列化 rag-index.v1 全文存 text，
 *     与文件存储字节一致——避免 jsonb 数字规范化破坏 digest 自校验；读路径
 *     parseIndex digest 校验失败即不可读，fail closed 语义与文件版一致）；
 *   - agent_rag_index_lkg：每 (environment, kb_id) 单指针 last-known-good，
 *     只在版本索引写入并回读校验成功后推进（rollback 语义由服务层保证）；
 *   - agent_rag_chunk_vectors：分块向量列（pgvector）。维度 64 =
 *     deterministic-local-v3（ADR-0007 一体化/standalone 同一确定性 encoder，
 *     单一事实源 packages/rag-runtime/src/localEncoder.js）；encoder 世代
 *     变化触发索引重建与列维度迁移（新 migration），不静默换向量空间。
 *     禁止向量化课表等结构化校园事实（摄取链 kind 守卫在 rag-runtime）。
 */

const RAG_INDEX_STORE_MIGRATIONS = Object.freeze([
  Object.freeze({
    version: 5,
    name: "rag_index_stores",
    statements: Object.freeze([
      "CREATE EXTENSION IF NOT EXISTS vector",
      [
        "CREATE TABLE IF NOT EXISTS agent_rag_index_versions (",
        "  environment text NOT NULL,",
        "  kb_id text NOT NULL,",
        "  version integer NOT NULL,",
        "  digest text NOT NULL,",
        "  doc text NOT NULL,",
        "  built_at timestamptz NOT NULL DEFAULT now(),",
        "  PRIMARY KEY (environment, kb_id, version)",
        ")",
      ].join("\n"),
      [
        "CREATE TABLE IF NOT EXISTS agent_rag_index_lkg (",
        "  environment text NOT NULL,",
        "  kb_id text NOT NULL,",
        "  version integer NOT NULL,",
        "  digest text NOT NULL,",
        "  built_at timestamptz NOT NULL,",
        "  PRIMARY KEY (environment, kb_id)",
        ")",
      ].join("\n"),
      [
        "CREATE TABLE IF NOT EXISTS agent_rag_chunk_vectors (",
        "  environment text NOT NULL,",
        "  kb_id text NOT NULL,",
        "  version integer NOT NULL,",
        "  chunk_id text NOT NULL,",
        "  doc_id text NOT NULL,",
        "  embedding vector(64) NOT NULL,",
        "  PRIMARY KEY (environment, kb_id, version, chunk_id)",
        ")",
      ].join("\n"),
      "CREATE INDEX IF NOT EXISTS agent_rag_chunk_vectors_lookup_idx ON agent_rag_chunk_vectors (environment, kb_id, version)",
    ]),
  }),
]);

module.exports = Object.freeze({
  RAG_INDEX_STORE_MIGRATIONS,
});
