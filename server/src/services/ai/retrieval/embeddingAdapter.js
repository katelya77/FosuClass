/**
 * Provider-neutral embedding adapter.
 * Modes: disabled | openai-compatible | cloudbase (optional)
 * Never stores secrets in the index.
 */

const crypto = require("crypto");

/**
 * Embedding config schema (env):
 *   AI_EMBEDDING_ENABLED | AI_EMBEDDING_MODE | AI_EMBEDDING_PROVIDER
 *   AI_EMBEDDING_BASE_URL | AI_EMBEDDING_MODEL | AI_EMBEDDING_API_KEY
 *   AI_EMBEDDING_DIMENSIONS | AI_RAG_MIN_CONFIDENCE
 * API keys must never be logged or written into vector index files.
 */
function getEmbeddingMode(env = process.env) {
  const enabledRaw = env.AI_EMBEDDING_ENABLED;
  if (enabledRaw === "0" || String(enabledRaw || "").toLowerCase() === "false") {
    return "disabled";
  }
  const provider = String(env.AI_EMBEDDING_PROVIDER || "").toLowerCase();
  const mode = String(env.AI_EMBEDDING_MODE || env.FOSU_EMBEDDING_MODE || provider || "disabled").toLowerCase();
  if (["disabled", "off", "none", "0", "false", ""].includes(mode) && enabledRaw !== "1" && String(enabledRaw || "").toLowerCase() !== "true") {
    return "disabled";
  }
  if (mode === "local-hash" || provider === "local-hash") return "local-hash";
  if (mode === "cloudbase" || provider === "cloudbase") return "cloudbase";
  if (mode === "openai" || mode === "openai-compatible" || mode === "compatible"
    || provider === "openai" || provider === "openai-compatible") {
    return "openai-compatible";
  }
  // Explicit enable without mode → try openai-compatible if base URL present
  if (enabledRaw === "1" || String(enabledRaw || "").toLowerCase() === "true") {
    if (env.AI_EMBEDDING_BASE_URL || env.OPENAI_BASE_URL) return "openai-compatible";
    return "local-hash";
  }
  return "disabled";
}

function hashContent(text) {
  return crypto.createHash("sha256").update(String(text || "")).digest("hex");
}

/**
 * Deterministic local pseudo-embedding for tests / offline fallback.
 * Not a semantic model — used only when mode is "local-hash" via explicit option.
 */
function localHashEmbedding(text, dimensions = 64) {
  const vec = new Array(dimensions).fill(0);
  const tokens = String(text || "").toLowerCase();
  for (let i = 0; i < tokens.length; i += 1) {
    const code = tokens.charCodeAt(i);
    vec[code % dimensions] += 1;
    if (i + 1 < tokens.length) {
      const big = (code * 31 + tokens.charCodeAt(i + 1)) % dimensions;
      vec[big] += 0.5;
    }
  }
  const norm = Math.sqrt(vec.reduce((s, v) => s + v * v, 0)) || 1;
  return vec.map((v) => v / norm);
}

function cosineSimilarity(a = [], b = []) {
  const len = Math.min(a.length, b.length);
  if (!len) return 0;
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < len; i += 1) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  const denom = Math.sqrt(na) * Math.sqrt(nb);
  return denom ? dot / denom : 0;
}

class EmbeddingAdapter {
  constructor(options = {}) {
    this.mode = options.mode || getEmbeddingMode(options.env || process.env);
    this.env = options.env || process.env;
    this.fetchImpl = options.fetchImpl || null;
    this.dimensions = Number(options.dimensions || 64) || 64;
    this.cache = options.cache || new Map();
  }

  isEnabled() {
    return this.mode !== "disabled";
  }

  async embed(texts = []) {
    const list = (Array.isArray(texts) ? texts : [texts]).map((t) => String(t || "").slice(0, 4000));
    if (!list.length) return [];
    if (this.mode === "disabled") {
      return list.map(() => null);
    }

    // local-hash for tests when explicitly set
    if (this.mode === "local-hash" || this.env.AI_EMBEDDING_MODE === "local-hash") {
      return list.map((text) => {
        const key = hashContent(text);
        if (this.cache.has(key)) return this.cache.get(key);
        const vec = localHashEmbedding(text, this.dimensions);
        this.cache.set(key, vec);
        return vec;
      });
    }

    if (this.mode === "openai-compatible") {
      return this.embedOpenAICompatible(list);
    }

    if (this.mode === "cloudbase") {
      // Optional: not required for delivery; degrade if unavailable
      try {
        return await this.embedOpenAICompatible(list);
      } catch (_) {
        return list.map(() => null);
      }
    }

    return list.map(() => null);
  }

  async embedOpenAICompatible(list) {
    const baseUrl = String(this.env.AI_EMBEDDING_BASE_URL || this.env.OPENAI_BASE_URL || "").replace(/\/$/, "");
    const apiKey = this.env.AI_EMBEDDING_API_KEY || this.env.OPENAI_API_KEY || "";
    const model = this.env.AI_EMBEDDING_MODEL || "text-embedding-3-small";
    if (!baseUrl || !apiKey) {
      // degrade silently
      return list.map(() => null);
    }

    const results = [];
    for (const text of list) {
      const key = hashContent(text);
      if (this.cache.has(key)) {
        results.push(this.cache.get(key));
        continue;
      }
      const fetchFn = this.fetchImpl || (typeof fetch === "function" ? fetch.bind(global) : null);
      if (!fetchFn) {
        results.push(null);
        continue;
      }
      try {
        const response = await fetchFn(`${baseUrl}/embeddings`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${apiKey}`,
          },
          body: JSON.stringify({ model, input: text }),
        });
        if (!response.ok) {
          results.push(null);
          continue;
        }
        const data = await response.json();
        const vec = data && data.data && data.data[0] && data.data[0].embedding;
        if (Array.isArray(vec)) {
          this.cache.set(key, vec);
          results.push(vec);
        } else {
          results.push(null);
        }
      } catch (_) {
        results.push(null);
      }
    }
    return results;
  }
}

module.exports = {
  EmbeddingAdapter,
  getEmbeddingMode,
  hashContent,
  localHashEmbedding,
  cosineSimilarity,
};
