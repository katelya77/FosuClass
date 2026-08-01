// BM25 词法检索（P4d）。k1=1.5 / b=0.75；tokenize 复用 localEncoder 单源
// （tokenization 属 encoder 语义，ADR-0007 §3：变化即换索引世代）。
//
// 索引结构可序列化：{ k1, b, avgLength, chunkCount, docFreq: {token: n} }，
// 每个 chunk 自带 tokens 数组（tf 由查询时统计，避免第二份倒排表漂移）。

const { tokenizeSemantic } = require("./localEncoder");

const K1 = 1.5;
const B = 0.75;

function buildBm25Index(chunks = []) {
  const docFreq = Object.create(null);
  let totalLength = 0;
  chunks.forEach((chunk) => {
    const seen = new Set(chunk.tokens || []);
    seen.forEach((token) => {
      docFreq[token] = (docFreq[token] || 0) + 1;
    });
    totalLength += (chunk.tokens || []).length;
  });
  return {
    k1: K1,
    b: B,
    chunkCount: chunks.length,
    avgLength: chunks.length ? totalLength / chunks.length : 0,
    docFreq,
  };
}

function bm25ScoreChunk(index, queryTokens, chunk) {
  const tokens = chunk.tokens || [];
  if (!tokens.length) return 0;
  const tf = Object.create(null);
  tokens.forEach((token) => {
    tf[token] = (tf[token] || 0) + 1;
  });
  const avg = index.avgLength || 1;
  let score = 0;
  queryTokens.forEach((token) => {
    const freq = tf[token] || 0;
    if (!freq) return;
    const df = index.docFreq[token] || 0;
    if (!df) return;
    // 标准 BM25 idf（+0.5 防负值主导，保持确定性排序即可，不与外部实现对齐数值）
    const idf = Math.log(1 + (index.chunkCount - df + 0.5) / (df + 0.5));
    score += idf * ((freq * (index.k1 + 1)) / (freq + index.k1 * (1 - index.b + index.b * (tokens.length / avg))));
  });
  return score;
}

/**
 * 返回按分数降序的 [{ chunkId, score }]，平分按 chunkId 字典序决胜（确定性）。
 * 只返回 score > 0 的候选。
 */
function bm25Search(index, chunks, query, options = {}) {
  const topK = Math.max(1, Number(options.topK) || 10);
  const queryTokens = Array.from(new Set(tokenizeSemantic(query)));
  if (!queryTokens.length || !index || !index.chunkCount) return Object.freeze({ queryTokens, hits: [] });
  const hits = [];
  chunks.forEach((chunk) => {
    const score = bm25ScoreChunk(index, queryTokens, chunk);
    if (score > 0) hits.push({ chunkId: chunk.chunkId, score: Number(score.toFixed(6)) });
  });
  hits.sort((a, b) => (b.score - a.score) || (a.chunkId < b.chunkId ? -1 : 1));
  return Object.freeze({ queryTokens, hits: hits.slice(0, topK) });
}

module.exports = Object.freeze({
  BM25_K1: K1,
  BM25_B: B,
  buildBm25Index,
  bm25Search,
  bm25ScoreChunk,
});
