// P5a WS5：pgvector 最近邻查询的 rag-runtime 统一接口（ADR-0007 §6）。
//
// standalone 模式的向量通道只替换存储与检索执行点（pgvector 列 + <=> 距离
// 排序），encoder 仍是单一事实源 deterministic-local-v3（localEncoder.js），
// 查询向量生成与排序纪律与内存版 vectorSearch 完全一致：
//   - cosine 降序（实现为 cosine distance 升序）、chunkId 升序决胜；
//   - 只返回 cosine > 0 的命中（与 vectorSearch 的 score>0 过滤一致）；
//   - 得分 6 位小数截断，结果确定性可复现。
//
// 本模块不引入 pg 依赖：pool 由调用方注入（server 侧 pgPersistenceService）。
// 禁止用于结构化校园事实（课表/教室等只走确定性 Tool，摄取链有 kind 守卫）。

const { encodeSemanticVector, tokenizeSemantic } = require("./localEncoder");
const { cleanText } = require("./textProcessing");

const DEFAULT_TABLE = "agent_rag_chunk_vectors";
// 表名会插值进 SQL 标识符位置，必须是安全的裸标识符。
const TABLE_NAME_PATTERN = /^[a-z_][a-z0-9_]*$/i;

function codedError(code, message) {
  const error = new Error(message || code);
  error.code = code;
  return error;
}

// 错误纪律与 server 侧 pgClient 对齐（rag-runtime 不反向依赖 agent-runtime，
// 保持最小副本）：连接类失败 RAG_PG_UNAVAILABLE，其余语句级失败
// RAG_PG_QUERY_FAILED；message 剔除任何 password= 片段。
const PG_CONNECTION_FAILURE_PATTERN = /ECONNREFUSED|ETIMEDOUT|ENOTFOUND|EAI_AGAIN|ECONNRESET|EPIPE|ENETUNREACH|EHOSTUNREACH|timeout exceeded when trying to connect|connection terminated|server closed the connection|could not connect/i;

function wrapPgError(error) {
  const raw = String((error && error.message) || error || "unknown pg error");
  const unavailable = PG_CONNECTION_FAILURE_PATTERN.test(raw)
    || PG_CONNECTION_FAILURE_PATTERN.test(String((error && error.code) || ""));
  return codedError(unavailable ? "RAG_PG_UNAVAILABLE" : "RAG_PG_QUERY_FAILED", raw.replace(/\s*password=\S*/gi, "").slice(0, 300));
}

async function runQuery(pool, text, params) {
  try {
    return await pool.query(text, params);
  } catch (error) {
    throw wrapPgError(error);
  }
}

function vectorLiteral(vector) {
  return `[${(vector || []).map((value) => Number(value)).join(",")}]`;
}

/**
 * 创建 pgvector 最近邻查询器。
 * @param {object} options { pool, table = "agent_rag_chunk_vectors" }
 * pool 为任何带 query(text, params) 的 pg Pool/Client。
 */
function createPgVectorSearch(options = {}) {
  const pool = options.pool;
  if (!pool || typeof pool.query !== "function") {
    throw codedError("RAG_PG_POOL_REQUIRED", "pgvector search requires an injected pg pool");
  }
  const table = options.table === undefined ? DEFAULT_TABLE : String(options.table);
  if (!TABLE_NAME_PATTERN.test(table)) {
    throw codedError("RAG_PG_TABLE_INVALID", `unsafe table identifier: ${JSON.stringify(table)}`);
  }

  /**
   * 最近邻查询。input: { environment, kbId, version, query, topK = 5 }。
   * 返回 { queryTokens, hits: [{chunkId, score}] }（cosine，0..1，6 位小数），
   * 排序与 ragRuntime.vectorSearch 逐位一致（确定性）。
   */
  async function nearest(input = {}) {
    const environment = String(input.environment || "");
    const kbId = String(input.kbId || "");
    const version = Number(input.version);
    if (!environment || !kbId || !Number.isInteger(version) || version < 1) {
      throw codedError("RAG_PG_QUERY_INVALID", "environment/kbId/version required");
    }
    const topK = Number.isInteger(input.topK) && input.topK >= 1 ? Math.min(input.topK, 100) : 5;
    const text = cleanText(String(input.query || ""));
    const queryTokens = Array.from(new Set(tokenizeSemantic(text)));
    const queryVector = encodeSemanticVector(text);
    const result = await runQuery(
      pool,
      `SELECT chunk_id AS "chunkId", 1 - (embedding <=> $1::vector) AS score ` +
        `FROM ${table} WHERE environment = $2 AND kb_id = $3 AND version = $4 ` +
        `ORDER BY embedding <=> $1::vector ASC, chunk_id ASC LIMIT $5`,
      [vectorLiteral(queryVector), environment, kbId, version, topK]
    );
    const hits = (result.rows || [])
      .map((row) => ({ chunkId: row.chunkId, score: Number(Number(row.score).toFixed(6)) }))
      .filter((hit) => hit.score > 0);
    return Object.freeze({ queryTokens, hits: Object.freeze(hits) });
  }

  return Object.freeze({ nearest });
}

module.exports = Object.freeze({ createPgVectorSearch });
