/**
 * BM25-style lexical scoring for campus knowledge chunks.
 */

function tokenize(text) {
  const value = String(text || "").toLowerCase();
  const tokens = [];
  // latin words
  const latin = value.match(/[a-z0-9_]+/g) || [];
  tokens.push(...latin);
  // chinese bigrams + unigrams for short queries
  const cn = value.replace(/[a-z0-9_\s]+/g, " ");
  for (let i = 0; i < cn.length; i += 1) {
    const ch = cn[i];
    if (/[\u4e00-\u9fff]/.test(ch)) {
      tokens.push(ch);
      if (i + 1 < cn.length && /[\u4e00-\u9fff]/.test(cn[i + 1])) {
        tokens.push(cn[i] + cn[i + 1]);
      }
    }
  }
  return tokens.filter(Boolean);
}

function buildDocumentStats(documents = []) {
  const N = documents.length || 1;
  const df = new Map();
  let totalLen = 0;
  const docs = documents.map((doc) => {
    const text = `${doc.title || ""} ${doc.body || doc.text || ""} ${(doc.keywords || []).join(" ")}`;
    const tokens = tokenize(text);
    totalLen += tokens.length;
    const tf = new Map();
    tokens.forEach((t) => tf.set(t, (tf.get(t) || 0) + 1));
    const seen = new Set(tokens);
    seen.forEach((t) => df.set(t, (df.get(t) || 0) + 1));
    return {
      id: doc.id || doc.chunkId || doc.sourceId,
      tokens,
      tf,
      length: tokens.length || 1,
      doc,
    };
  });
  return {
    N,
    avgdl: totalLen / N || 1,
    df,
    docs,
  };
}

/**
 * BM25 score. k1=1.2, b=0.75
 */
function bm25Score(queryTokens, docEntry, stats, options = {}) {
  const k1 = Number(options.k1 || 1.2);
  const b = Number(options.b || 0.75);
  const { N, avgdl, df } = stats;
  let score = 0;
  const qSet = queryTokens;
  qSet.forEach((term) => {
    const f = docEntry.tf.get(term) || 0;
    if (!f) return;
    const n = df.get(term) || 0;
    const idf = Math.log(1 + (N - n + 0.5) / (n + 0.5));
    const denom = f + k1 * (1 - b + b * (docEntry.length / avgdl));
    score += idf * ((f * (k1 + 1)) / denom);
  });
  return score;
}

function searchLexical(query, documents = [], options = {}) {
  const qTokens = tokenize(query);
  if (!qTokens.length || !documents.length) return [];
  const stats = buildDocumentStats(documents);
  const limit = Math.max(1, Number(options.limit || 8) || 8);
  return stats.docs
    .map((entry) => {
      let score = bm25Score(qTokens, entry, stats, options);
      // synonym / keyword boost
      const keywords = entry.doc.keywords || [];
      keywords.forEach((kw) => {
        if (String(query).includes(kw) || String(kw).includes(String(query).slice(0, 4))) {
          score += 1.5;
        }
      });
      const authority = Number(entry.doc.authorityLevel || entry.doc.priority || 0) || 0;
      score += authority * 0.05;
      return {
        sourceId: entry.doc.sourceId || entry.id,
        chunkId: entry.doc.chunkId || entry.id,
        title: entry.doc.title || "",
        excerpt: String(entry.doc.body || entry.doc.text || "").slice(0, 240),
        authorityLevel: authority,
        sourcePublisher: entry.doc.sourcePublisher || entry.doc.publisher || "",
        sourceUrl: entry.doc.sourceUrl || "",
        updatedAt: entry.doc.updatedAt || "",
        score,
        matchType: "bm25",
      };
    })
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
}

module.exports = {
  tokenize,
  buildDocumentStats,
  bm25Score,
  searchLexical,
};
