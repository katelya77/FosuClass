/**
 * Knowledge chunk ingestion for hybrid index.
 * Does NOT ingest personal schedules or full course tables.
 */

const crypto = require("crypto");
const safetyGuard = require("../safetyGuard");

function chunkText(text, options = {}) {
  const max = Math.max(80, Number(options.maxChars || 400) || 400);
  const raw = safetyGuard.redactSensitiveText(String(text || "")).trim();
  if (!raw) return [];
  const parts = [];
  let i = 0;
  while (i < raw.length) {
    parts.push(raw.slice(i, i + max));
    i += max;
  }
  return parts;
}

function buildChunksFromDocs(docs = []) {
  const chunks = [];
  (Array.isArray(docs) ? docs : []).forEach((doc) => {
    // Never index personal schedule payloads
    if (doc && (doc.type === "personal_schedule" || doc.forbidden === true)) return;
    const body = doc.body || doc.text || doc.reply || "";
    const pieces = chunkText(body);
    if (!pieces.length && doc.title) pieces.push(String(doc.title));
    pieces.forEach((text, index) => {
      const contentHash = crypto.createHash("sha256").update(`${doc.sourceId || doc.id}:${text}`).digest("hex").slice(0, 16);
      chunks.push({
        sourceId: doc.sourceId || doc.id,
        chunkId: `${doc.sourceId || doc.id}#${index}`,
        title: doc.title || "",
        text,
        body: text,
        keywords: doc.keywords || [],
        authorityLevel: Number(doc.priority || doc.authorityLevel || 50) || 50,
        sourcePublisher: doc.sourcePublisher || "fosuclass",
        sourceUrl: doc.sourceUrl || "",
        updatedAt: doc.updatedAt || "",
        contentHash,
        scope: doc.scope || ["public", "trial", "dev"],
        campus: doc.campus || "",
        category: doc.category || doc.type || "knowledge",
      });
    });
  });
  return chunks;
}

module.exports = {
  chunkText,
  buildChunksFromDocs,
};
