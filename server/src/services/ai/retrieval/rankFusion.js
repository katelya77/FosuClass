/**
 * Reciprocal Rank Fusion + authority/freshness/scope boosts.
 */

function rrfScore(rank, k = 60) {
  return 1 / (k + Math.max(1, rank));
}

function daysSince(iso) {
  if (!iso) return 365;
  const t = Date.parse(String(iso));
  if (!Number.isFinite(t)) return 365;
  return Math.max(0, (Date.now() - t) / (24 * 60 * 60 * 1000));
}

/**
 * Fuse multiple ranked lists.
 * lists: [{ name, hits: [{ sourceId, chunkId, score, ... }] }]
 */
function fuseRanks(lists = [], options = {}) {
  const k = Number(options.k || 60) || 60;
  const map = new Map();

  lists.forEach((list) => {
    const hits = Array.isArray(list.hits) ? list.hits : [];
    hits.forEach((hit, index) => {
      const key = `${hit.sourceId || ""}::${hit.chunkId || hit.title || index}`;
      const prev = map.get(key) || {
        sourceId: hit.sourceId,
        chunkId: hit.chunkId,
        title: hit.title || "",
        excerpt: hit.excerpt || "",
        authorityLevel: hit.authorityLevel || 0,
        sourcePublisher: hit.sourcePublisher || "",
        sourceUrl: hit.sourceUrl || "",
        updatedAt: hit.updatedAt || "",
        score: 0,
        signals: {},
      };
      const add = rrfScore(index + 1, k) * (Number(list.weight || 1) || 1);
      prev.score += add;
      prev.signals[list.name || "list"] = (prev.signals[list.name || "list"] || 0) + add;
      // prefer richer metadata
      if (!prev.excerpt && hit.excerpt) prev.excerpt = hit.excerpt;
      if (!prev.title && hit.title) prev.title = hit.title;
      if ((hit.authorityLevel || 0) > (prev.authorityLevel || 0)) prev.authorityLevel = hit.authorityLevel;
      if (hit.updatedAt && (!prev.updatedAt || String(hit.updatedAt) > String(prev.updatedAt))) {
        prev.updatedAt = hit.updatedAt;
      }
      map.set(key, prev);
    });
  });

  const authorityWeight = Number(options.authorityWeight || 0.02);
  const freshnessWeight = Number(options.freshnessWeight || 0.01);

  return Array.from(map.values())
    .map((item) => {
      let score = item.score;
      score += (Number(item.authorityLevel) || 0) * authorityWeight;
      const age = daysSince(item.updatedAt);
      score += Math.max(0, 1 - age / 365) * freshnessWeight;
      if (options.campus && item.excerpt && String(item.excerpt).includes(options.campus)) {
        score += 0.05;
      }
      if (options.category && item.title && String(item.title).includes(options.category)) {
        score += 0.03;
      }
      return Object.assign({}, item, { score });
    })
    .sort((a, b) => b.score - a.score)
    .slice(0, Math.max(1, Number(options.limit || 8) || 8));
}

module.exports = {
  fuseRanks,
  rrfScore,
  daysSince,
};
