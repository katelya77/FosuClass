// RAG 索引生命周期与查询链（P4d，ADR-0007 §4）。
//
// - buildIndex：摄取 → 清洗 → 确定性切块 → BM25 统计 + 本地向量 →
//   内容 digest（stable stringify，无时间戳 → 全索引字节级确定性可重建）。
// - queryIndex：真实四模式链 lexical / vector / hybrid(RRF) / hybrid_rerank
//   （RRF 候选 → 版本化权重确定性 rerank）。minScore 门控空答案正确率。
// - serialize/parse：digest 校验失败即 RAG_INDEX_CORRUPT（fail closed）；
//   encoder manifest 不匹配即 RAG_ENCODER_MISMATCH（触发重建，不静默换向量空间）。

const crypto = require("crypto");
const { encoderManifest, encodeSemanticVector, cosineSimilarity, tokenizeSemantic, ENCODER_VERSION } = require("./localEncoder");
const { cleanText, chunkDocument } = require("./textProcessing");
const { buildBm25Index, bm25Search } = require("./bm25");
const { rrfFuse, deterministicRerank, normalizeWeights, DEFAULT_RERANK_WEIGHTS } = require("./fusion");
const { ingestDocuments } = require("./ingestion");

const RAG_INDEX_FORMAT = "rag-index.v1";
const QUERY_MODES = Object.freeze(["lexical", "vector", "hybrid", "hybrid_rerank"]);

// 无支撑命中抑制（deterministic-local-v3 校准策略）：64 维 hash 投影的
// 碰撞噪声底实测 0.2..0.5，与弱真实信号同量级——纯向量余弦不能单独创造命中，
// 命中必须有词元支撑（chunk∩query 非空；别名表扩展产生的语义匹配同样带有
// 共享词元，不受此门影响）。向量通道仍真实参与排序：RRF 名次与 rerank 权重
// 改变候选顺序（golden query 四组对照的 MRR/引用正确率差异证明），这不是
// 假混合。该策略随 encoder 世代校准；未来神经 Embedding Adapter（P5，仅
// trial/dev 显式授权）可按新世代校准放宽。
const UNSUPPORTED_VECTOR_HITS_ALLOWED = false;

const DEFAULT_RETRIEVAL = Object.freeze({
  defaultMode: "hybrid_rerank",
  topK: 5,
  minScore: 0.05,
  rerankWeights: DEFAULT_RERANK_WEIGHTS,
});

function codedError(code, message) {
  const error = new Error(message || code);
  error.code = code;
  return error;
}

// 键序稳定的序列化：digest 只对内容负责，与对象构建顺序无关。
function stableStringify(value) {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  const keys = Object.keys(value).sort();
  return `{${keys.map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(",")}}`;
}

function digestOf(content) {
  return crypto.createHash("sha256").update(stableStringify(content)).digest("hex");
}

function normalizeRetrieval(retrieval) {
  const source = retrieval && typeof retrieval === "object" ? retrieval : {};
  const mode = QUERY_MODES.includes(source.defaultMode) ? source.defaultMode : DEFAULT_RETRIEVAL.defaultMode;
  const topK = Number.isInteger(source.topK) && source.topK >= 1 && source.topK <= 20
    ? source.topK
    : DEFAULT_RETRIEVAL.topK;
  const minScore = Number.isFinite(source.minScore) && source.minScore >= 0 && source.minScore <= 1
    ? source.minScore
    : DEFAULT_RETRIEVAL.minScore;
  return Object.freeze({
    defaultMode: mode,
    topK,
    minScore,
    rerankWeights: normalizeWeights(source.rerankWeights),
  });
}

/**
 * 构建确定性索引。documents 为发布物归一化文档（text/uri 二选一，uri 经摄取抓取）。
 * options.fetcher 可注入（测试不触网）。返回可序列化索引对象（冻结）。
 */
async function buildIndex(input = {}, options = {}) {
  const kbId = String(input.kbId || "").trim();
  const version = Number(input.version);
  if (!kbId) throw codedError("RAG_INDEX_KB_REQUIRED");
  if (!Number.isInteger(version) || version < 1) throw codedError("RAG_INDEX_VERSION_INVALID");
  const retrieval = normalizeRetrieval(input.retrieval);

  const ingested = await ingestDocuments(input.documents || [], options);
  if (!ingested.documents.length) {
    throw codedError("RAG_INDEX_EMPTY", "no usable documents after ingestion");
  }

  const chunks = [];
  ingested.documents.forEach((doc) => {
    chunkDocument({ docId: doc.docId, title: doc.title, text: doc.text }, options.chunking || {}).forEach((chunk) => {
      const tokens = tokenizeSemantic(`${doc.title}\n${chunk.text}`);
      chunks.push(Object.freeze({
        chunkId: chunk.chunkId,
        docId: doc.docId,
        title: doc.title,
        kind: doc.kind,
        tags: chunk.tags || doc.tags,
        order: chunk.order,
        text: chunk.text,
        tokens,
        vector: encodeSemanticVector(`${doc.title}\n${chunk.text}`),
      }));
    });
  });
  if (!chunks.length) throw codedError("RAG_INDEX_EMPTY", "documents produced no chunks");

  const bm25 = buildBm25Index(chunks);
  const encoder = encoderManifest();
  const content = {
    format: RAG_INDEX_FORMAT,
    kbId,
    version,
    encoder,
    retrieval,
    documents: ingested.documents.map((doc) => ({
      docId: doc.docId,
      title: doc.title,
      kind: doc.kind,
      tags: doc.tags,
      source: doc.source,
      contentHash: doc.contentHash,
    })),
    ingestFailures: ingested.failures,
    chunks,
    bm25,
  };
  return Object.freeze(Object.assign({}, content, { digest: digestOf(content) }));
}

function vectorSearch(index, queryTokens, queryVector, topK) {
  const hits = [];
  index.chunks.forEach((chunk) => {
    const score = cosineSimilarity(queryVector, chunk.vector);
    if (score > 0) hits.push({ chunkId: chunk.chunkId, score: Number(score.toFixed(6)) });
  });
  hits.sort((a, b) => (b.score - a.score) || (a.chunkId < b.chunkId ? -1 : 1));
  return Object.freeze({ queryTokens, hits: hits.slice(0, topK) });
}

function toSnippet(text) {
  return String(text || "").replace(/\s+/g, " ").trim().slice(0, 140);
}

/**
 * 查询索引。options: { mode?, topK?, minScore?, weights? }（缺省取索引 retrieval 配置）。
 * 返回 { mode, hits, reason?, encoder }；hit 含 citation {docId, chunkId, title}。
 * 得分经 max 归一（0..1）；最高分 < minScore → hits 为空且 reason="low_confidence"。
 */
function queryIndex(index, query, options = {}) {
  if (!index || index.format !== RAG_INDEX_FORMAT) throw codedError("RAG_INDEX_CORRUPT", "not a rag-index.v1 document");
  if (!index.encoder || index.encoder.encoderType !== ENCODER_VERSION) {
    throw codedError("RAG_ENCODER_MISMATCH", "index was built with a different encoder generation");
  }
  const published = normalizeRetrieval(index.retrieval);
  // 已发布检索策略是门控边界（M-3）：请求只能收紧（更小 topK、更高
  // minScore），不得削弱已发布的空答案门控。mode/weights 属排序旋钮，
  // 可覆盖（weights 仍经 normalizeWeights 有界）。
  const topK = Number.isInteger(options.topK) && options.topK >= 1
    ? Math.min(options.topK, published.topK)
    : published.topK;
  const minScore = Number.isFinite(options.minScore)
    ? Math.max(options.minScore, published.minScore)
    : published.minScore;
  const retrieval = Object.freeze({
    defaultMode: published.defaultMode,
    topK,
    minScore,
    rerankWeights: options.weights ? normalizeWeights(options.weights) : published.rerankWeights,
  });
  const mode = QUERY_MODES.includes(options.mode) ? options.mode : retrieval.defaultMode;
  const text = cleanText(query);
  const queryTokens = Array.from(new Set(tokenizeSemantic(text)));
  const chunkById = new Map(index.chunks.map((chunk) => [chunk.chunkId, chunk]));

  const lexical = bm25Search(index.bm25, index.chunks, text, { topK: retrieval.topK * 4 });
  const vector = vectorSearch(index, queryTokens, encodeSemanticVector(text), retrieval.topK * 4);

  let ranked;
  let scoreOf;
  if (mode === "lexical") {
    const max = lexical.hits.length ? lexical.hits[0].score : 0;
    ranked = lexical.hits;
    scoreOf = (hit) => (max > 0 ? hit.score / max : 0);
  } else if (mode === "vector") {
    ranked = vector.hits;
    scoreOf = (hit) => hit.score; // cosine 天然 0..1
  } else {
    const fused = rrfFuse([{ name: "lexical", hits: lexical.hits }, { name: "vector", hits: vector.hits }]);
    if (mode === "hybrid") {
      const max = fused.length ? fused[0].rrf : 0;
      ranked = fused;
      scoreOf = (hit) => (max > 0 ? hit.rrf / max : 0);
    } else {
      // hybrid_rerank：RRF 候选（放大池）→ 版本化权重确定性 rerank
      const poolSize = Math.max(retrieval.topK * 2, 10);
      const lexicalById = new Map(lexical.hits.map((hit) => [hit.chunkId, hit.score]));
      const vectorById = new Map(vector.hits.map((hit) => [hit.chunkId, hit.score]));
      const candidates = fused.slice(0, poolSize).map((entry) => {
        const chunk = chunkById.get(entry.chunkId);
        return {
          chunkId: entry.chunkId,
          docId: chunk ? chunk.docId : "",
          title: chunk ? chunk.title : "",
          scores: {
            lexical: lexicalById.get(entry.chunkId) || 0,
            vector: vectorById.get(entry.chunkId) || 0,
          },
        };
      });
      const reranked = deterministicRerank(candidates, { weights: retrieval.rerankWeights, queryTokens });
      ranked = reranked;
      scoreOf = (hit) => hit.rerank;
    }
  }

  const queryVector = mode === "lexical" ? null : encodeSemanticVector(text);
  const hits = ranked.slice(0, retrieval.topK * 2).map((hit) => {
    const chunk = chunkById.get(hit.chunkId);
    const chunkTokens = new Set(chunk && chunk.tokens || []);
    const support = queryTokens.filter((token) => chunkTokens.has(token)).length;
    const vectorCosine = queryVector && chunk ? cosineSimilarity(queryVector, chunk.vector) : 0;
    return {
      chunkId: hit.chunkId,
      docId: chunk ? chunk.docId : "",
      title: chunk ? chunk.title : "",
      score: Number(scoreOf(hit).toFixed(6)),
      vectorCosine: Number(vectorCosine.toFixed(6)),
      tokenSupport: support,
      snippet: toSnippet(chunk && chunk.text),
      citation: Object.freeze({ docId: chunk ? chunk.docId : "", chunkId: hit.chunkId, title: chunk ? chunk.title : "" }),
    };
  })
    .filter((hit) => hit.score > 0)
    // 无支撑命中抑制：碰撞噪声不得单独创造命中（见文件头校准策略）。
    .filter((hit) => UNSUPPORTED_VECTOR_HITS_ALLOWED || hit.tokenSupport > 0)
    .slice(0, retrieval.topK);

  if (!hits.length) {
    return Object.freeze({ mode, queryTokens, hits: Object.freeze([]), reason: "no_candidate", encoder: index.encoder });
  }
  if (hits[0].score < retrieval.minScore) {
    return Object.freeze({ mode, queryTokens, hits: Object.freeze([]), reason: "low_confidence", encoder: index.encoder });
  }
  return Object.freeze({ mode, queryTokens, hits: Object.freeze(hits), encoder: index.encoder });
}

function serializeIndex(index) {
  if (!index || index.format !== RAG_INDEX_FORMAT || !index.digest) {
    throw codedError("RAG_INDEX_CORRUPT", "serialize requires a complete rag-index.v1 document");
  }
  return JSON.stringify(index);
}

// 读取侧 fail closed：digest 覆盖全部内容字段，任何存储位损坏/篡改都可检出。
function parseIndex(serialized) {
  let parsed;
  try {
    parsed = typeof serialized === "string" ? JSON.parse(serialized) : serialized;
  } catch (_) {
    throw codedError("RAG_INDEX_CORRUPT", "index payload is not valid JSON");
  }
  if (!parsed || parsed.format !== RAG_INDEX_FORMAT || !parsed.digest) {
    throw codedError("RAG_INDEX_CORRUPT", "missing format or digest");
  }
  const content = Object.assign({}, parsed);
  delete content.digest;
  if (digestOf(content) !== parsed.digest) {
    throw codedError("RAG_INDEX_CORRUPT", "digest mismatch");
  }
  return Object.freeze(parsed);
}

// encoder 世代检查：不兼容 = 需要重建（由调用方决策），查询侧硬失败。
function checkIndexCompatibility(index) {
  if (!index || !index.encoder) return Object.freeze({ compatible: false, reason: "encoder_manifest_missing" });
  const current = encoderManifest();
  if (index.encoder.encoderType !== current.encoderType) {
    return Object.freeze({ compatible: false, reason: "encoder_version_mismatch", expected: current.encoderType, actual: index.encoder.encoderType });
  }
  if (index.encoder.dimensions !== current.dimensions) {
    return Object.freeze({ compatible: false, reason: "encoder_dimensions_mismatch" });
  }
  return Object.freeze({ compatible: true });
}

module.exports = Object.freeze({
  RAG_INDEX_FORMAT,
  QUERY_MODES,
  DEFAULT_RETRIEVAL,
  UNSUPPORTED_VECTOR_HITS_ALLOWED,
  buildIndex,
  queryIndex,
  serializeIndex,
  parseIndex,
  checkIndexCompatibility,
  stableStringify,
  digestOf,
});
