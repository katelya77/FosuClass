const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

const campusMapAssetService = require("../campusMapAssetService");

const STORAGE_DIR = path.resolve(process.env.FOSU_STORAGE_DIR || path.join(__dirname, "../../../storage"));
const STORE_DIR = path.join(STORAGE_DIR, "campus-map");
const HISTORY_DIR = path.join(STORE_DIR, "history");
const BACKUP_DIR = path.join(STORE_DIR, "backups");
const DRAFT_PATH = path.join(STORE_DIR, "draft.json");
const PUBLISHED_PATH = path.join(STORE_DIR, "published.json");
const PUBLIC_CONFIG_PATH = path.join(STORE_DIR, "public", "config.json");
const DATA_DIR = path.resolve(__dirname, "../../../data/ai");
const LEGACY_DATA_PATH = path.join(DATA_DIR, "campus-places.json");
const DEFAULT_NOTE = "Q 版地图仅供校园位置参考，具体以学校现场指引为准。";

function nowIso() {
  return new Date().toISOString();
}

function timestampId(prefix) {
  return `${prefix}-${nowIso().replace(/[:.]/g, "-")}`;
}

function ensureDirs() {
  [STORE_DIR, HISTORY_DIR, BACKUP_DIR, path.dirname(PUBLIC_CONFIG_PATH), DATA_DIR].forEach((dir) => {
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

function hashObject(value) {
  return crypto.createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function defaultMapAssets() {
  campusMapAssetService.ensureInitialized();
  return campusMapAssetService.getMapDefinitions().reduce((acc, definition) => {
    acc[definition.mapKey] = campusMapAssetService.getLatestAssetIdForMap(definition.mapKey);
    return acc;
  }, {});
}

function normalizeMapAssets(source = {}) {
  const input = source && typeof source === "object" && !Array.isArray(source) ? source : {};
  const fallback = defaultMapAssets();
  const output = {};
  campusMapAssetService.getMapDefinitions().forEach((definition) => {
    output[definition.mapKey] = String(input[definition.mapKey] || fallback[definition.mapKey] || "");
  });
  return output;
}

function normalizeRegion(region) {
  const source = region && typeof region === "object" && !Array.isArray(region) ? region : {};
  const clamp = (value) => Math.max(0, Math.min(1, Number(value) || 0));
  const x = clamp(source.x);
  const y = clamp(source.y);
  const width = Math.max(0, Math.min(1 - x, clamp(source.width)));
  const height = Math.max(0, Math.min(1 - y, clamp(source.height)));
  return { x, y, width, height };
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
    neighbors: Array.isArray(place.neighbors) ? place.neighbors.slice(0, 12).map((item) => String(item).slice(0, 80)) : [],
    updatedAt: place.updatedAt || nowIso(),
  };
}

function normalizeDocument(input = {}, patch = {}) {
  const source = input && typeof input === "object" && !Array.isArray(input) ? input : {};
  const places = Array.isArray(source.places) ? source.places.map(normalizePlace) : [];
  return Object.assign({
    schemaVersion: 2,
    version: source.version || patch.version || timestampId("campus-map"),
    updatedAt: source.updatedAt || nowIso(),
    publishedAt: source.publishedAt || "",
    note: source.note || DEFAULT_NOTE,
    mapAssets: normalizeMapAssets(source.mapAssets || source.assets || {}),
    places,
  }, patch);
}

function readLegacyDocument() {
  return normalizeDocument(readJson(LEGACY_DATA_PATH, { places: [] }), {
    schemaVersion: 2,
    version: "legacy-campus-places",
    mapAssets: defaultMapAssets(),
  });
}

function ensureInitialDocuments() {
  ensureDirs();
  campusMapAssetService.ensureInitialized();
  const initial = readLegacyDocument();
  let published = readJson(PUBLISHED_PATH, null);
  let draft = readJson(DRAFT_PATH, null);
  if (!published) {
    published = normalizeDocument(initial, {
      version: initial.version || timestampId("campus-map-seed"),
      publishedAt: initial.updatedAt || nowIso(),
      source: "seed",
    });
    writeJsonAtomic(PUBLISHED_PATH, published);
    writePublicConfig(published);
  }
  if (!draft) {
    draft = normalizeDocument(published, {
      source: "published-fallback",
    });
    writeJsonAtomic(DRAFT_PATH, draft);
  }
}

function loadPublishedDocument() {
  ensureInitialDocuments();
  return normalizeDocument(readJson(PUBLISHED_PATH, null) || readLegacyDocument(), {
    source: fs.existsSync(PUBLISHED_PATH) ? "published" : "legacy-fallback",
  });
}

function loadDraftDocument() {
  ensureInitialDocuments();
  return normalizeDocument(readJson(DRAFT_PATH, null) || loadPublishedDocument(), {
    source: fs.existsSync(DRAFT_PATH) ? "draft" : "published-fallback",
  });
}

function validateDocument(document, options = {}) {
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

  campusMapAssetService.getMapDefinitions().forEach((definition) => {
    const assetId = doc.mapAssets[definition.mapKey];
    const asset = campusMapAssetService.getAssetForMap(definition.mapKey, assetId);
    if (!asset) {
      errors.push(`${definition.title} 缺少底图资产`);
      return;
    }
    const local = campusMapAssetService.getLocalStatus(asset);
    if (!local.ok) {
      errors.push(`${definition.title} Oracle 底图不可读：${local.reason || local.status}`);
    }
    if (options.requireCloudbase === true) {
      const cloudbase = asset.cloudbase || {};
      const synced = cloudbase.status === "synced" &&
        cloudbase.sha256 === asset.sha256 &&
        Number(cloudbase.size || 0) === Number(asset.size || 0);
      if (!synced) {
        errors.push(`${definition.title} CloudBase CDN 未同步或校验不一致`);
      }
    }
  });

  return { ok: errors.length === 0, errors, document: doc };
}

function sanitizePlaceForPublic(place = {}) {
  const verified = place.verified === true;
  return {
    id: String(place.id || "").slice(0, 80),
    campus: String(place.campus || "").slice(0, 40),
    area: String(place.area || "").slice(0, 40),
    name: String(place.name || "").slice(0, 80),
    code: String(place.code || "").slice(0, 24),
    type: String(place.type || "place").slice(0, 40),
    aliases: Array.isArray(place.aliases) ? place.aliases.slice(0, 8).map((item) => String(item).slice(0, 40)) : [],
    description: String(place.description || "").slice(0, 240),
    mapKey: getMapKey(place),
    mapRegion: verified ? normalizeRegion(place.mapRegion) : null,
    confidence: Math.max(0, Math.min(1, Number(place.confidence || 0) || 0)),
    verified,
    reviewStatus: verified ? "verified" : "needs-review",
    updatedAt: place.updatedAt || "",
    neighbors: Array.isArray(place.neighbors) ? place.neighbors.slice(0, 8).map((item) => String(item).slice(0, 80)) : [],
  };
}

function getMapKey(place = {}) {
  if (place.campus === "河滨校区") return "hebin";
  if (place.campus === "江湾校区") return "jiangwan";
  if (place.campus === "仙溪校区") return place.area === "南区" ? "xianxiSouth" : "xianxiNorth";
  return "xianxiNorth";
}

function buildPublicMaps(mapAssets = {}) {
  return campusMapAssetService.getMapDefinitions().reduce((acc, definition) => {
    const asset = campusMapAssetService.getAssetForMap(definition.mapKey, mapAssets[definition.mapKey]);
    if (asset) acc[definition.mapKey] = campusMapAssetService.publicAsset(asset);
    return acc;
  }, {});
}

function buildPublicConfig(document) {
  const doc = normalizeDocument(document);
  const maps = buildPublicMaps(doc.mapAssets);
  const places = doc.places.map(sanitizePlaceForPublic);
  const basePayload = {
    schemaVersion: 2,
    version: doc.version,
    updatedAt: doc.publishedAt || doc.updatedAt,
    note: doc.note || DEFAULT_NOTE,
    maps,
    places,
  };
  const hash = hashObject(basePayload);
  return Object.assign({}, basePayload, {
    hash,
    etag: `"${doc.version}-${hash.slice(0, 16)}"`,
  });
}

function writePublicConfig(document) {
  const config = buildPublicConfig(document);
  writeJsonAtomic(PUBLIC_CONFIG_PATH, config);
  return config;
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
        hash: buildPublicConfig(normalizeDocument(doc)).hash,
      };
    })
    .sort((left, right) => String(right.publishedAt).localeCompare(String(left.publishedAt)))
    .slice(0, 50);
}

function mapPlacesById(document) {
  const map = new Map();
  (document.places || []).forEach((place) => map.set(place.id, place));
  return map;
}

function sameRegion(a = {}, b = {}) {
  return ["x", "y", "width", "height"].every((key) => Number(a[key] || 0).toFixed(5) === Number(b[key] || 0).toFixed(5));
}

function computeDiff(previousInput, nextInput) {
  const previous = normalizeDocument(previousInput || {});
  const next = normalizeDocument(nextInput || {});
  const previousMap = mapPlacesById(previous);
  const nextMap = mapPlacesById(next);
  const added = [];
  const removed = [];
  const modified = [];
  const coordinateChanges = [];

  next.places.forEach((place) => {
    const before = previousMap.get(place.id);
    if (!before) {
      added.push(place);
      return;
    }
    const beforeComparable = Object.assign({}, before);
    const afterComparable = Object.assign({}, place);
    delete beforeComparable.updatedAt;
    delete afterComparable.updatedAt;
    if (JSON.stringify(beforeComparable) !== JSON.stringify(afterComparable)) {
      modified.push({ before, after: place });
    }
    if (!sameRegion(before.mapRegion, place.mapRegion)) {
      coordinateChanges.push({
        id: place.id,
        name: place.name,
        before: before.mapRegion,
        after: place.mapRegion,
      });
    }
  });
  previous.places.forEach((place) => {
    if (!nextMap.has(place.id)) removed.push(place);
  });

  const assetChanges = [];
  campusMapAssetService.getMapDefinitions().forEach((definition) => {
    const beforeId = previous.mapAssets[definition.mapKey] || "";
    const afterId = next.mapAssets[definition.mapKey] || "";
    if (beforeId !== afterId) {
      assetChanges.push({
        mapKey: definition.mapKey,
        title: definition.title,
        before: beforeId,
        after: afterId,
      });
    }
  });

  return {
    added,
    removed,
    modified,
    coordinateChanges,
    assetChanges,
    summary: {
      added: added.length,
      removed: removed.length,
      modified: modified.length,
      coordinateChanges: coordinateChanges.length,
      assetChanges: assetChanges.length,
    },
  };
}

function getState() {
  const published = loadPublishedDocument();
  const draft = loadDraftDocument();
  return {
    published,
    draft,
    publicConfig: buildPublicConfig(published),
    assets: campusMapAssetService.listAdminAssets(draft.mapAssets, published.mapAssets),
    history: listHistory(),
    diff: computeDiff(published, draft),
    paths: {
      draft: DRAFT_PATH,
      published: PUBLISHED_PATH,
      publicConfig: PUBLIC_CONFIG_PATH,
      assets: campusMapAssetService.ASSET_STORE_PATH,
    },
  };
}

function saveDraft(payload = {}) {
  const validation = validateDocument(normalizeDocument(payload, {
    version: payload.version || timestampId("draft"),
    updatedAt: nowIso(),
    publishedAt: "",
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

function setDraftMapAsset(mapKey, assetId) {
  const draft = loadDraftDocument();
  const asset = campusMapAssetService.getAssetForMap(mapKey, assetId);
  if (!asset) {
    const error = new Error("Campus map asset was not found for the selected map.");
    error.code = "CAMPUS_MAP_ASSET_NOT_FOUND";
    throw error;
  }
  draft.mapAssets[mapKey] = asset.assetId;
  draft.version = timestampId("draft");
  draft.updatedAt = nowIso();
  return saveDraft(draft);
}

function writeLegacyMirror(document) {
  if (process.env.FOSU_MAP_SKIP_LEGACY_MIRROR === "true") return;
  const legacy = {
    version: document.version,
    updatedAt: document.publishedAt || document.updatedAt,
    note: document.note,
    mapAssets: document.mapAssets,
    places: document.places,
  };
  writeJsonAtomic(LEGACY_DATA_PATH, legacy);
}

function requirePublishReady(document) {
  const requireCloudbase = process.env.FOSU_MAP_REQUIRE_CLOUDBASE_SYNC !== "false";
  const validation = validateDocument(document, { requireCloudbase });
  if (!validation.ok) {
    const error = new Error(requireCloudbase ? "CAMPUS_MAP_PUBLISH_PREFLIGHT_FAILED" : "CAMPUS_MAP_PUBLISH_INVALID");
    error.code = validation.errors.some((item) => item.includes("CloudBase"))
      ? "CAMPUS_MAP_CLOUDBASE_PENDING"
      : error.message;
    error.errors = validation.errors;
    throw error;
  }
  return validation.document;
}

function publishDraft(payload, options = {}) {
  const source = payload && Array.isArray(payload.places) ? payload : loadDraftDocument();
  const nextDocument = normalizeDocument(source, {
    version: options.version || timestampId("campus-map"),
    updatedAt: nowIso(),
    publishedAt: nowIso(),
  });
  const readyDocument = requirePublishReady(nextDocument);
  const current = fs.existsSync(PUBLISHED_PATH) ? loadPublishedDocument() : null;
  if (current && current.places.length) {
    writeJsonAtomic(path.join(HISTORY_DIR, `${timestampId("history")}.json`), current);
  }
  writeJsonAtomic(PUBLISHED_PATH, readyDocument);
  writeJsonAtomic(DRAFT_PATH, readyDocument);
  writePublicConfig(readyDocument);
  writeLegacyMirror(readyDocument);
  return readyDocument;
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
  return publishDraft(document, { version: timestampId("rollback") });
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

function previewPublish(payload) {
  const draft = normalizeDocument(payload && Array.isArray(payload.places) ? payload : loadDraftDocument());
  const published = loadPublishedDocument();
  const validation = validateDocument(draft, {
    requireCloudbase: process.env.FOSU_MAP_REQUIRE_CLOUDBASE_SYNC !== "false",
  });
  return {
    validation,
    diff: computeDiff(published, draft),
    publicConfig: buildPublicConfig(draft),
  };
}

module.exports = {
  BACKUP_DIR,
  DRAFT_PATH,
  HISTORY_DIR,
  LEGACY_DATA_PATH,
  PUBLISHED_PATH,
  PUBLIC_CONFIG_PATH,
  buildPublicConfig,
  computeDiff,
  createBackup,
  getMapKey,
  getState,
  importDocument,
  listHistory,
  loadDraftDocument,
  loadPublishedDocument,
  previewPublish,
  publishDraft,
  rollback,
  saveDraft,
  setDraftMapAsset,
  validateDocument,
  writePublicConfig,
};
