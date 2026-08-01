// 融合与确定性 rerank（P4d，ADR-0007 §4）。
//
// - RRF（Reciprocal Rank Fusion, k=60）：把多条排名链（词法/向量）融合成
//   单一候选集，只吃排名不吃原始分，避免量纲拼接。
// - deterministicRerank：版本化权重的线性重排（lexical/vector/title），
//   权重随发布物进入索引 manifest（0..4，适配器校验）；平分一律 chunkId 决胜。
// 不允许「算了两个分数但永远只用 BM25」：hybrid 模式的真实消费由
// ragRuntime.queryIndex 的 golden query 四组对照证明（证据如实报告）。

const { cosineSimilarity, tokenizeSemantic } = require("./localEncoder");

const RRF_K = 60;

const DEFAULT_RERANK_WEIGHTS = Object.freeze({
  lexical: 1,
  vector: 1,
  title: 0.5,
});

function normalizeWeights(weights) {
  const source = weights && typeof weights === "object" ? weights : {};
  const pick = (key) => {
    const value = Number(source[key]);
    return Number.isFinite(value) && value >= 0 && value <= 4 ? value : DEFAULT_RERANK_WEIGHTS[key];
  };
  return Object.freeze({ lexical: pick("lexical"), vector: pick("vector"), title: pick("title") });
}

/**
 * rankings: [{ name, hits: [{ chunkId, score }] }]（每条链已按名次排序）。
 * 返回 [{ chunkId, rrf, ranks: {name: rank} }]，rank 从 1 起；平分 chunkId 决胜。
 */
function rrfFuse(rankings = [], options = {}) {
  const k = Math.max(1, Number(options.k) || RRF_K);
  const fused = new Map();
  rankings.forEach((ranking) => {
    (ranking.hits || []).forEach((hit, index) => {
      const entry = fused.get(hit.chunkId) || { chunkId: hit.chunkId, rrf: 0, ranks: {} };
      entry.rrf += 1 / (k + index + 1);
      entry.ranks[ranking.name] = index + 1;
      fused.set(hit.chunkId, entry);
    });
  });
  return Array.from(fused.values())
    .map((entry) => ({ chunkId: entry.chunkId, rrf: Number(entry.rrf.toFixed(8)), ranks: entry.ranks }))
    .sort((a, b) => (b.rrf - a.rrf) || (a.chunkId < b.chunkId ? -1 : 1));
}

function titleOverlapScore(queryTokens, title) {
  if (!queryTokens.length || !title) return 0;
  const titleTokens = new Set(tokenizeSemantic(title));
  if (!titleTokens.size) return 0;
  let overlap = 0;
  queryTokens.forEach((token) => {
    if (titleTokens.has(token)) overlap += 1;
  });
  return overlap / queryTokens.length;
}

/**
 * 候选重排。 candidates: [{ chunkId, docId, title, vector, scores: {lexical, vector} }]
 * lexical/vector 通道先做 min-max 归一（基于候选集，确定性），再加权求和。
 * 返回带 rerank 分的降序新数组（不改入参）。
 */
function deterministicRerank(candidates = [], options = {}) {
  const weights = normalizeWeights(options.weights);
  const queryTokens = Array.from(new Set(options.queryTokens || tokenizeSemantic(options.query || "")));
  const totals = weights.lexical + weights.vector + weights.title;
  if (!candidates.length || totals <= 0) return candidates.slice();

  const maxLexical = Math.max(...candidates.map((c) => Number(c.scores && c.scores.lexical) || 0));
  const maxVector = Math.max(...candidates.map((c) => Number(c.scores && c.scores.vector) || 0));
  return candidates
    .map((candidate) => {
      const lexical = maxLexical > 0 ? (Number(candidate.scores && candidate.scores.lexical) || 0) / maxLexical : 0;
      const vector = maxVector > 0 ? (Number(candidate.scores && candidate.scores.vector) || 0) / maxVector : 0;
      const title = titleOverlapScore(queryTokens, candidate.title);
      const rerank = (weights.lexical * lexical + weights.vector * vector + weights.title * title) / totals;
      return Object.assign({}, candidate, {
        scores: Object.assign({}, candidate.scores, {
          lexicalNorm: Number(lexical.toFixed(6)),
          vectorNorm: Number(vector.toFixed(6)),
          title: Number(title.toFixed(6)),
        }),
        rerank: Number(rerank.toFixed(6)),
      });
    })
    .sort((a, b) => (b.rerank - a.rerank) || (a.chunkId < b.chunkId ? -1 : 1));
}

module.exports = Object.freeze({
  RRF_K,
  DEFAULT_RERANK_WEIGHTS,
  normalizeWeights,
  rrfFuse,
  deterministicRerank,
});
