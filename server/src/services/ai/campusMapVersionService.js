const fs = require("fs");
const path = require("path");

const DATA_DIR = path.resolve(__dirname, "../../../data/ai");
const LEGACY_DATA_PATH = path.join(DATA_DIR, "campus-places.json");
const STORE_DIR = path.join(DATA_DIR, "campus-map");
const HISTORY_DIR = path.join(STORE_DIR, "history");
const BACKUP_DIR = path.join(STORE_DIR, "backups");
const DRAFT_PATH = path.join(STORE_DIR, "draft.json");
const PUBLISHED_PATH = path.join(STORE_DIR, "published.json");

function nowIso() {
  return new Date().toISOString();
}

function timestampId(prefix) {
  return `${prefix}-${nowIso().replace(/[:.]/g, "-")}`;
}

function ensureDirs() {
  [DATA_DIR, STORE_DIR, HISTORY_DIR, BACKUP_DIR].forEach((dir) => {
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  });
}

function readJson(filePath, fallback = null) {
  try {
    if (!fs.existsSync(filePath)) return fallback;
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch (error) {
    return fallback;
  }
}

function writeJsonAtomic(filePath, value) {
  ensureDirs();
  const tempPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(tempPath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  fs.renameSync(tempPath, filePath);
}

function normalizeRegion(region) {
  const source = region && typeof region === "object" && !Array.isArray(region) ? region : {};
  const clamp = (value) => Math.max(0, Math.min(1, Number(value) || 0));
  const width = clamp(source.width);
  const height = clamp(source.height);
  return {
    x: Math.min(1, clamp(source.x)),
    y: Math.min(1, clamp(source.y)),
    width,
    height,
  };
}

function normalizePlace(place = {}) {
  const verified = place.verified === true || place.reviewStatus === "verified";
  return {
    id: String(place.id || "").trim().slice(0, 80),
    campus: String(place.campus || "").trim().slice(0, 40),
    area: String(place.area || "").trim().slice(0, 40),
    name: String(place.name || "").trim().slice(0, 80),
    code: String(place.code || "").trim().slice(0, 24),
    type: String(place.type || "place").trim().slice(0, 40),
    aliases: Array.isArray(place.aliases)
      ? place.aliases.map((item) => String(item || "").trim()).filter(Boolean).slice(0, 12)
      : [],
    description: String(place.description || "").trim().slice(0, 260),
    mapRegion: normalizeRegion(place.mapRegion),
    confidence: Math.max(0, Math.min(1, Number(place.confidence || 0) || 0)),
    verified,
    reviewStatus: verified ? "verified" : "needs-review",
    neighbors: Array.isArray(place.neighbors) ? place.neighbors.slice(0, 12) : [],
    updatedAt: place.updatedAt || nowIso(),
  };
}

function normalizeDocument(input = {}, patch = {}) {
  const source = input && typeof input === "object" && !Array.isArray(input) ? input : {};
  const places = Array.isArray(source.places) ? source.places.map(normalizePlace) : [];
  return Object.assign({
    schemaVersion: 1,
    version: source.version || patch.version || timestampId("campus-map"),
    updatedAt: source.updatedAt || nowIso(),
    publishedAt: source.publishedAt || "",
    note: source.note || "Q 版地图仅供校园位置参考，具体以学校现场指引为准。",
    places,
  }, patch);
}

function validateDocument(document) {
  const doc = normalizeDocument(document);
  const errors = [];
  const ids = new Set();
  doc.places.forEach((place, index) => {
    if (!place.id) errors.push(`第 ${index + 1} 个地点缺少 id`);
    if (!place.name) errors.push(`第 ${index + 1} 个地点缺少名称`);
    if (!place.campus) errors.push(`${place.name || place.id || index} 缺少校区`);
    if (ids.has(place.id)) errors.push(`重复地点 id: ${place.id}`);
    ids.add(place.id);
    if (place.verified && (!place.mapRegion.width || !place.mapRegion.height)) {
      errors.push(`${place.name || place.id} 已核对但没有有效矩形框`);
    }
  });
  return { ok: errors.length === 0, errors, document: doc };
}

function readLegacyDocument() {
  return normalizeDocument(readJson(LEGACY_DATA_PATH, { places: [] }), {
    version: "legacy-campus-places",
  });
}

function loadPublishedDocument() {
  return normalizeDocument(readJson(PUBLISHED_PATH, null) || readLegacyDocument(), {
    source: fs.existsSync(PUBLISHED_PATH) ? "published" : "legacy-fallback",
  });
}

function loadDraftDocument() {
  return normalizeDocument(readJson(DRAFT_PATH, null) || loadPublishedDocument(), {
    source: fs.existsSync(DRAFT_PATH) ? "draft" : "published-fallback",
  });
}

function listHistory() {
  ensureDirs();
  return fs.readdirSync(HISTORY_DIR)
    .filter((name) => name.endsWith(".json"))
    .map((name) => {
      const filePath = path.join(HISTORY_DIR, name);
      const stat = fs.statSync(filePath);
      const doc = readJson(filePath, {});
      return {
        id: name.replace(/\.json$/, ""),
        filename: name,
        version: doc.version || "",
        publishedAt: doc.publishedAt || stat.mtime.toISOString(),
        placeCount: Array.isArray(doc.places) ? doc.places.length : 0,
      };
    })
    .sort((left, right) => String(right.publishedAt).localeCompare(String(left.publishedAt)))
    .slice(0, 50);
}

function getState() {
  const published = loadPublishedDocument();
  const draft = loadDraftDocument();
  return {
    published,
    draft,
    history: listHistory(),
    paths: {
      draft: DRAFT_PATH,
      published: PUBLISHED_PATH,
    },
  };
}

function saveDraft(payload = {}) {
  const validation = validateDocument(normalizeDocument(payload, {
    version: payload.version || timestampId("draft"),
    updatedAt: nowIso(),
  }));
  if (!validation.ok) {
    const error = new Error("CAMPUS_MAP_DRAFT_INVALID");
    error.code = "CAMPUS_MAP_DRAFT_INVALID";
    error.errors = validation.errors;
    throw error;
  }
  writeJsonAtomic(DRAFT_PATH, validation.document);
  return validation.document;
}

function writeLegacyMirror(document) {
  const legacy = {
    version: document.version,
    updatedAt: document.publishedAt || document.updatedAt,
    note: document.note,
    places: document.places,
  };
  writeJsonAtomic(LEGACY_DATA_PATH, legacy);
}

function publishDraft(payload) {
  const source = payload && Array.isArray(payload.places) ? payload : loadDraftDocument();
  const validation = validateDocument(normalizeDocument(source, {
    version: source.version || timestampId("published"),
    updatedAt: nowIso(),
    publishedAt: nowIso(),
  }));
  if (!validation.ok) {
    const error = new Error("CAMPUS_MAP_PUBLISH_INVALID");
    error.code = "CAMPUS_MAP_PUBLISH_INVALID";
    error.errors = validation.errors;
    throw error;
  }
  const current = fs.existsSync(PUBLISHED_PATH) ? loadPublishedDocument() : null;
  if (current && current.places.length) {
    writeJsonAtomic(path.join(HISTORY_DIR, `${timestampId("history")}.json`), current);
  }
  writeJsonAtomic(PUBLISHED_PATH, validation.document);
  writeLegacyMirror(validation.document);
  return validation.document;
}

function rollback(historyId) {
  const safeId = path.basename(String(historyId || "")).replace(/\.json$/, "");
  const filePath = path.join(HISTORY_DIR, `${safeId}.json`);
  const document = readJson(filePath, null);
  if (!document) {
    const error = new Error("CAMPUS_MAP_HISTORY_NOT_FOUND");
    error.code = "CAMPUS_MAP_HISTORY_NOT_FOUND";
    throw error;
  }
  return publishDraft(normalizeDocument(document, {
    version: timestampId("rollback"),
    updatedAt: nowIso(),
    publishedAt: nowIso(),
  }));
}

function createBackup(label = "manual") {
  const document = loadPublishedDocument();
  const filePath = path.join(BACKUP_DIR, `${timestampId(label || "manual")}.json`);
  writeJsonAtomic(filePath, document);
  return {
    filename: path.basename(filePath),
    path: filePath,
    placeCount: document.places.length,
    createdAt: nowIso(),
  };
}

function importDocument(payload = {}) {
  return saveDraft(payload);
}

module.exports = {
  BACKUP_DIR,
  DRAFT_PATH,
  HISTORY_DIR,
  LEGACY_DATA_PATH,
  PUBLISHED_PATH,
  createBackup,
  getState,
  importDocument,
  listHistory,
  loadDraftDocument,
  loadPublishedDocument,
  publishDraft,
  rollback,
  saveDraft,
  validateDocument,
};
