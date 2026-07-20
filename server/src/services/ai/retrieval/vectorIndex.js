/**
 * Lightweight local file vector index for knowledge chunks only.
 * Versioned, contentHash-cached, atomic write, rollback-friendly.
 */

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { cosineSimilarity, hashContent } = require("./embeddingAdapter");

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function writeJsonAtomic(filePath, value) {
  ensureDir(path.dirname(filePath));
  const tmp = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(tmp, `${JSON.stringify(value)}\n`, "utf8");
  fs.renameSync(tmp, filePath);
}

class VectorIndex {
  constructor(options = {}) {
    this.rootDir = path.resolve(
      options.dataDir
      || process.env.FOSU_VECTOR_INDEX_DIR
      || path.join(process.env.FOSU_DATA_DIR || path.join(__dirname, "../../../../data"), "ai", "vector-index")
    );
    this.currentPath = path.join(this.rootDir, "current.json");
    this.metaPath = path.join(this.rootDir, "meta.json");
  }

  load() {
    try {
      if (!fs.existsSync(this.currentPath)) {
        return { version: 0, items: [], builtAt: "", contentHash: "" };
      }
      return JSON.parse(fs.readFileSync(this.currentPath, "utf8"));
    } catch (_) {
      return { version: 0, items: [], builtAt: "", contentHash: "" };
    }
  }

  loadMeta() {
    try {
      if (!fs.existsSync(this.metaPath)) return { versions: [], currentVersion: 0 };
      return JSON.parse(fs.readFileSync(this.metaPath, "utf8"));
    } catch (_) {
      return { versions: [], currentVersion: 0 };
    }
  }

  async rebuild(chunks = [], embedder) {
    const items = [];
    const texts = chunks.map((c) => `${c.title || ""}\n${c.text || c.body || ""}`.slice(0, 2000));
    const vectors = embedder && embedder.isEnabled()
      ? await embedder.embed(texts)
      : texts.map(() => null);

    chunks.forEach((chunk, index) => {
      const text = texts[index];
      const contentHash = hashContent(text);
      const vector = vectors[index];
      if (!vector) return;
      items.push({
        sourceId: chunk.sourceId,
        chunkId: chunk.chunkId || chunk.id || `chunk-${index}`,
        title: chunk.title || "",
        excerpt: String(chunk.text || chunk.body || "").slice(0, 240),
        authorityLevel: Number(chunk.authorityLevel || chunk.priority || 0) || 0,
        sourcePublisher: chunk.sourcePublisher || "",
        sourceUrl: chunk.sourceUrl || "",
        updatedAt: chunk.updatedAt || "",
        contentHash,
        vector,
      });
    });

    const previous = this.load();
    const version = Number(previous.version || 0) + 1;
    const payload = {
      version,
      items,
      builtAt: new Date().toISOString(),
      contentHash: crypto.createHash("sha256").update(JSON.stringify(items.map((i) => i.contentHash))).digest("hex").slice(0, 16),
      // never store secrets
    };

    // keep previous as rollback
    if (fs.existsSync(this.currentPath)) {
      const bak = path.join(this.rootDir, `v${previous.version || 0}.json`);
      try {
        fs.copyFileSync(this.currentPath, bak);
      } catch (_) {
        // ignore
      }
    }
    writeJsonAtomic(this.currentPath, payload);
    const meta = this.loadMeta();
    meta.currentVersion = version;
    meta.versions = (meta.versions || []).concat([{
      version,
      builtAt: payload.builtAt,
      itemCount: items.length,
      contentHash: payload.contentHash,
    }]).slice(-10);
    writeJsonAtomic(this.metaPath, meta);
    return payload;
  }

  rollback(version) {
    const target = path.join(this.rootDir, `v${Number(version)}.json`);
    if (!fs.existsSync(target)) {
      const error = new Error("Vector index version not found");
      error.code = "VECTOR_VERSION_NOT_FOUND";
      throw error;
    }
    fs.copyFileSync(target, this.currentPath);
    const meta = this.loadMeta();
    meta.currentVersion = Number(version);
    writeJsonAtomic(this.metaPath, meta);
    return this.load();
  }

  search(queryVector, options = {}) {
    if (!queryVector || !Array.isArray(queryVector)) return [];
    const index = this.load();
    const limit = Math.max(1, Number(options.limit || 8) || 8);
    return (index.items || [])
      .map((item) => ({
        sourceId: item.sourceId,
        chunkId: item.chunkId,
        title: item.title,
        excerpt: item.excerpt,
        authorityLevel: item.authorityLevel,
        sourcePublisher: item.sourcePublisher,
        sourceUrl: item.sourceUrl,
        updatedAt: item.updatedAt,
        score: cosineSimilarity(queryVector, item.vector || []),
        matchType: "vector",
      }))
      .filter((item) => item.score > (options.minScore || 0.05))
      .sort((a, b) => b.score - a.score)
      .slice(0, limit);
  }

  status() {
    const index = this.load();
    const meta = this.loadMeta();
    return {
      version: index.version || 0,
      itemCount: (index.items || []).length,
      builtAt: index.builtAt || "",
      contentHash: index.contentHash || "",
      versions: meta.versions || [],
      enabled: (index.items || []).length > 0,
    };
  }
}

module.exports = {
  VectorIndex,
};
