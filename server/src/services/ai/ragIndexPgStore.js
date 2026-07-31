/**
 * P5a WS5：RAG 索引产物的 PostgreSQL 存储（standalone 模式，migration 0005）。
 *
 * 与文件实现同一接口（ragIndexFileStore），语义对齐：
 *   - 版本索引不可变；写入在单事务内完成「版本行 upsert + 分块向量替换 +
 *     回读 digest 校验」，任一失败整体回滚（fail closed），lkg 不推进；
 *   - 序列化索引存 text（与文件字节一致），读路径 parseIndex digest 校验，
 *     损坏/篡改一律视为不可读（null），由服务层回退 lkg/扫描兜底；
 *   - 分块向量同事务落 agent_rag_chunk_vectors（pgvector 列）：先删后插，
 *     重建幂等；向量值来自索引 chunks（确定性 encoder，ADR-0007 单源）；
 *   - 与文件版相同的短 TTL 记忆化（已验证内容才可缓存）。
 *
 * standalone 不再依赖容器文件系统：索引元数据、序列化索引与分块向量全部落 PG。
 */

const { serializeIndex, parseIndex } = require("../../../../packages/rag-runtime");
const { query, withTransaction } = require("../../../../packages/agent-runtime");

const INDEX_MEMO_TTL_MS = 30 * 1000;
const INDEX_MEMO_MAX = 64;
const VECTOR_BATCH_SIZE = 200;

function vectorLiteral(vector) {
  return `[${(vector || []).map((value) => Number(value)).join(",")}]`;
}

function createPgRagIndexStore(options = {}) {
  const pool = options.pool || null;
  if (!pool) {
    const error = new Error("RAG_INDEX_PG_POOL_REQUIRED");
    error.code = "RAG_INDEX_PG_POOL_REQUIRED";
    throw error;
  }
  const logger = typeof options.logger === "function" ? options.logger : () => {};
  const memoTtlMs = Number.isFinite(options.memoTtlMs) ? options.memoTtlMs : INDEX_MEMO_TTL_MS;
  const memo = new Map(); // key `${env}/${kbId}/v${version}` → { at, index }

  const memoKey = (environment, kbId, version) => `${environment}/${kbId}/v${version}`;

  async function readVersion(environment, kbId, version) {
    const key = memoKey(environment, kbId, version);
    const now = Date.now();
    const hit = memo.get(key);
    if (hit && now - hit.at < memoTtlMs) return hit.index;
    let index = null;
    try {
      const result = await query(
        pool,
        "SELECT doc FROM agent_rag_index_versions WHERE environment = $1 AND kb_id = $2 AND version = $3",
        [environment, kbId, version]
      );
      const row = result.rows && result.rows[0];
      if (row && typeof row.doc === "string") {
        index = parseIndex(row.doc); // digest 校验失败即 RAG_INDEX_CORRUPT → 不可读
      }
    } catch (error) {
      // 损坏 fail closed（不可读 → 服务层回退）；连接/语句级故障如实上抛。
      if (error && error.code === "RAG_INDEX_CORRUPT") {
        logger({ event: "rag-index-store-corrupt", environment, kbId, version: String(version) });
        index = null;
      } else {
        throw error;
      }
    }
    if (index) {
      if (memo.size >= INDEX_MEMO_MAX) memo.clear();
      memo.set(key, { at: now, index });
    } else {
      memo.delete(key);
    }
    return index;
  }

  async function writeVersion(environment, kbId, version, index) {
    const serialized = serializeIndex(index);
    const chunks = Array.isArray(index.chunks) ? index.chunks : [];
    await withTransaction(pool, async (client) => {
      await client.query(
        "INSERT INTO agent_rag_index_versions (environment, kb_id, version, digest, doc, built_at) " +
          "VALUES ($1, $2, $3, $4, $5, now()) " +
          "ON CONFLICT (environment, kb_id, version) DO UPDATE SET digest = EXCLUDED.digest, " +
          "doc = EXCLUDED.doc, built_at = EXCLUDED.built_at",
        [environment, kbId, version, index.digest, serialized]
      );
      // 分块向量同事务替换（先删后插，重建幂等）。
      await client.query(
        "DELETE FROM agent_rag_chunk_vectors WHERE environment = $1 AND kb_id = $2 AND version = $3",
        [environment, kbId, version]
      );
      for (let offset = 0; offset < chunks.length; offset += VECTOR_BATCH_SIZE) {
        const batch = chunks.slice(offset, offset + VECTOR_BATCH_SIZE);
        const params = [];
        const values = batch.map((chunk, indexInBatch) => {
          const base = indexInBatch * 6;
          params.push(environment, kbId, version, chunk.chunkId, chunk.docId, vectorLiteral(chunk.vector));
          return `($${base + 1}, $${base + 2}, $${base + 3}, $${base + 4}, $${base + 5}, $${base + 6}::vector)`;
        });
        if (values.length) {
          await client.query(
            "INSERT INTO agent_rag_chunk_vectors (environment, kb_id, version, chunk_id, doc_id, embedding) VALUES " +
              values.join(", "),
            params
          );
        }
      }
      // 回读校验（digest）：写损坏立即失败，事务回滚，不推进 lkg。
      const readback = await client.query(
        "SELECT doc FROM agent_rag_index_versions WHERE environment = $1 AND kb_id = $2 AND version = $3",
        [environment, kbId, version]
      );
      parseIndex(readback.rows && readback.rows[0] && readback.rows[0].doc);
    });
    memo.delete(memoKey(environment, kbId, version));
  }

  async function readLkg(environment, kbId) {
    const result = await query(
      pool,
      "SELECT version, digest, built_at AS \"builtAt\" FROM agent_rag_index_lkg WHERE environment = $1 AND kb_id = $2",
      [environment, kbId]
    );
    const row = result.rows && result.rows[0];
    if (!row) return null;
    return {
      kbId,
      version: Number(row.version),
      environment,
      builtAt: row.builtAt instanceof Date ? row.builtAt.toISOString() : String(row.builtAt || ""),
      digest: row.digest,
    };
  }

  async function writeLkg(environment, kbId, pointer) {
    await query(
      pool,
      "INSERT INTO agent_rag_index_lkg (environment, kb_id, version, digest, built_at) VALUES ($1, $2, $3, $4, $5) " +
        "ON CONFLICT (environment, kb_id) DO UPDATE SET version = EXCLUDED.version, " +
        "digest = EXCLUDED.digest, built_at = EXCLUDED.built_at",
      [environment, kbId, pointer.version, pointer.digest, pointer.builtAt || new Date().toISOString()]
    );
  }

  async function listVersions(environment, kbId) {
    const result = await query(
      pool,
      "SELECT version FROM agent_rag_index_versions WHERE environment = $1 AND kb_id = $2 ORDER BY version DESC",
      [environment, kbId]
    );
    return result.rows.map((row) => Number(row.version)).filter((item) => Number.isInteger(item));
  }

  return Object.freeze({
    kind: "postgres",
    readVersion,
    writeVersion,
    readLkg,
    writeLkg,
    listVersions,
  });
}

module.exports = Object.freeze({ createPgRagIndexStore });
