/**
 * Hybrid knowledge retriever (lexical + optional vector + RRF).
 * Schedule facts must never come from this path.
 */

const knowledgeBaseService = require("../knowledgeBaseService");
const safetyGuard = require("../safetyGuard");
const { searchLexical } = require("./lexicalIndex");
const { EmbeddingAdapter } = require("./embeddingAdapter");
const { VectorIndex } = require("./vectorIndex");
const { fuseRanks } = require("./rankFusion");
const { verifyHits } = require("./retrievalVerifier");
const { buildChunksFromDocs } = require("./ingestionService");

const PROMPT_INJECTION = /(ignore\s+previous|system\s+prompt|忽略.*(规则|指令)|覆盖.*(规则|指令))/i;

function rewriteQueryDeterministic(query) {
  let q = safetyGuard.redactSensitiveText(String(query || "")).slice(0, 200);
  const synonyms = [
    [/咋用|怎么用|如何使用/, "使用说明"],
    [/隐私|安全吗|会不会泄露/, "隐私 个人课表"],
    [/导入课表|导课表/, "导入 个人课表"],
    [/你是谁|你是什么/, "小佛 能力介绍"],
  ];
  synonyms.forEach(([pattern, repl]) => {
    if (pattern.test(q)) q = `${q} ${repl}`;
  });
  return q.slice(0, 240);
}

function loadKnowledgeDocuments(environment = "public") {
  try {
    if (typeof knowledgeBaseService.listPublishedDocuments === "function") {
      return knowledgeBaseService.listPublishedDocuments({ environment }) || [];
    }
  } catch (_) {
    // fall through
  }
  try {
    // fallback: searchKnowledge internal data via empty search + rules
    if (typeof knowledgeBaseService.getStoreSnapshot === "function") {
      const snap = knowledgeBaseService.getStoreSnapshot();
      return (snap && snap.documents) || [];
    }
  } catch (_) {
    // ignore
  }
  // Minimal built-in docs if service API differs
  try {
    const result = knowledgeBaseService.searchKnowledge({
      query: "佛课小表",
      environment,
      limit: 20,
    });
    const docs = [];
    (result && result.hits || result && result.documents || []).forEach((hit) => {
      docs.push({
        sourceId: hit.sourceId || hit.id,
        title: hit.title,
        body: hit.excerpt || hit.body || hit.text || "",
        keywords: hit.keywords || [],
        updatedAt: hit.updatedAt,
        priority: hit.score || 50,
      });
    });
    return docs;
  } catch (_) {
    return [];
  }
}

class KnowledgeRetriever {
  constructor(options = {}) {
    this.embedder = options.embedder || new EmbeddingAdapter(options.embedding || {});
    this.vectorIndex = options.vectorIndex || new VectorIndex(options.vector || {});
    this.minConfidence = Number(options.minConfidence || 0.12);
  }

  async ensureVectorIndex(docs) {
    if (!this.embedder.isEnabled()) return null;
    const status = this.vectorIndex.status();
    if (status.itemCount > 0 && status.version > 0) return status;
    const chunks = buildChunksFromDocs(docs);
    return this.vectorIndex.rebuild(chunks, this.embedder);
  }

  async retrieve(input = {}) {
    const environment = input.environment || input.runtimeMode || "public";
    const originalQuery = safetyGuard.redactSensitiveText(String(input.query || input.q || "")).slice(0, 200);
    if (!originalQuery) {
      return {
        query: "",
        rewrittenQuery: "",
        hits: [],
        confidence: 0,
        citations: [],
        noAnswer: true,
        reason: "EMPTY_QUERY",
      };
    }

    if (PROMPT_INJECTION.test(originalQuery)) {
      return {
        query: originalQuery,
        rewrittenQuery: originalQuery,
        hits: [],
        confidence: 0,
        citations: [],
        noAnswer: true,
        reason: "INJECTION_BLOCKED",
      };
    }

    let rewrittenQuery = rewriteQueryDeterministic(originalQuery);
    // trial/dev optional model rewrite — only once, still scoped
    if (input.rewrittenQuery && environment !== "public") {
      const candidate = safetyGuard.redactSensitiveText(String(input.rewrittenQuery)).slice(0, 200);
      if (candidate && !PROMPT_INJECTION.test(candidate)) {
        rewrittenQuery = candidate;
      }
    }

    const docs = loadKnowledgeDocuments(environment);
    const chunks = buildChunksFromDocs(docs);

    // Lexical / BM25
    const lexicalHits = searchLexical(rewrittenQuery, chunks.length ? chunks : docs.map((d) => ({
      sourceId: d.sourceId || d.id,
      chunkId: d.sourceId || d.id,
      title: d.title,
      body: d.body || d.text || d.reply || "",
      keywords: d.keywords || [],
      authorityLevel: d.priority || 50,
      updatedAt: d.updatedAt,
    })), { limit: 10 });

    // Vector (optional)
    let vectorHits = [];
    try {
      await this.ensureVectorIndex(docs);
      if (this.embedder.isEnabled()) {
        const [qVec] = await this.embedder.embed([rewrittenQuery]);
        if (qVec) vectorHits = this.vectorIndex.search(qVec, { limit: 10 });
      }
    } catch (_) {
      vectorHits = [];
    }

    // Rule matches from existing KB when available
    let ruleHits = [];
    try {
      if (typeof knowledgeBaseService.searchKnowledge === "function") {
        const legacy = knowledgeBaseService.searchKnowledge({
          query: originalQuery,
          environment,
          limit: 8,
        });
        const hits = legacy && (legacy.hits || legacy.results || []);
        ruleHits = (Array.isArray(hits) ? hits : []).map((hit, index) => ({
          sourceId: hit.sourceId || hit.id || `rule-${index}`,
          chunkId: hit.chunkId || hit.id || `rule-${index}`,
          title: hit.title || "",
          excerpt: hit.excerpt || hit.body || hit.reply || "",
          authorityLevel: hit.priority || 80,
          sourcePublisher: hit.sourcePublisher || "",
          sourceUrl: hit.sourceUrl || "",
          updatedAt: hit.updatedAt || "",
          score: hit.score || 1,
          matchType: "rule",
        }));
      }
    } catch (_) {
      ruleHits = [];
    }

    const fused = fuseRanks([
      { name: "rule", hits: ruleHits, weight: 1.2 },
      { name: "bm25", hits: lexicalHits, weight: 1.0 },
      { name: "vector", hits: vectorHits, weight: vectorHits.length ? 1.0 : 0 },
    ], {
      limit: 8,
      campus: input.campus,
      category: input.category,
    });

    const verified = verifyHits(fused, { minConfidence: this.minConfidence });
    const citations = (verified.hits || []).slice(0, 5).map((hit) => ({
      sourceId: hit.sourceId,
      title: hit.title,
      sourcePublisher: hit.sourcePublisher,
      updatedAt: hit.updatedAt,
    }));

    return {
      query: originalQuery,
      rewrittenQuery,
      hits: verified.hits || [],
      confidence: verified.confidence || 0,
      citations,
      noAnswer: verified.noAnswer === true,
      reason: verified.reason || "OK",
      vectorUsed: vectorHits.length > 0,
      lexicalCount: lexicalHits.length,
      vectorIndex: this.vectorIndex.status(),
    };
  }
}

const defaultRetriever = new KnowledgeRetriever();

async function retrieveKnowledge(input = {}) {
  return defaultRetriever.retrieve(input);
}

module.exports = {
  KnowledgeRetriever,
  defaultRetriever,
  retrieveKnowledge,
  rewriteQueryDeterministic,
};
