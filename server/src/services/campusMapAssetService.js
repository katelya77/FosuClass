const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

const config = require("../config");

const STORAGE_DIR = path.resolve(process.env.FOSU_STORAGE_DIR || path.join(__dirname, "../../storage"));
const STORE_DIR = path.join(STORAGE_DIR, "campus-map");
const PUBLIC_ROOT = path.join(STORE_DIR, "public");
const ASSET_FILES_ROOT = path.join(PUBLIC_ROOT, "assets");
const ASSET_STORE_PATH = path.join(STORE_DIR, "assets.json");
const DEFAULT_CLOUDBASE_BASE_URL = "https://cloud1-d3g17rpe7566d3d5c-1442900641.tcloudbaseapp.com";
const DEFAULT_CLOUDBASE_ENV_ID = "cloud1-d3g17rpe7566d3d5c";
const MAX_UPLOAD_BYTES = Number(process.env.FOSU_CAMPUS_MAP_MAX_UPLOAD_BYTES || 8 * 1024 * 1024);

const MAP_DEFINITIONS = [
  {
    mapKey: "xianxiNorth",
    assetId: "xianxi-north",
    campus: "仙溪校区",
    area: "北区",
    title: "仙溪校区北区",
    seedFileName: "campus-map-xianxi-north.jpg",
  },
  {
    mapKey: "xianxiSouth",
    assetId: "xianxi-south",
    campus: "仙溪校区",
    area: "南区",
    title: "仙溪校区南区",
    seedFileName: "campus-map-xianxi-south.jpg",
  },
  {
    mapKey: "jiangwan",
    assetId: "jiangwan",
    campus: "江湾校区",
    area: "江湾校区",
    title: "江湾校区",
    seedFileName: "campus-map-jiangwan.jpg",
  },
  {
    mapKey: "hebin",
    assetId: "hebin",
    campus: "河滨校区",
    area: "河滨校区",
    title: "河滨校区",
    seedFileName: "campus-map-hebin.jpg",
  },
];

const MAP_DEFINITION_BY_KEY = MAP_DEFINITIONS.reduce((acc, item) => {
  acc[item.mapKey] = item;
  return acc;
}, {});

const SEED_DIRS = [
  path.resolve(__dirname, "../../assets/maps"),
  path.resolve(__dirname, "../../../miniprogram/assets/maps"),
];

function nowIso() {
  return new Date().toISOString();
}

function ensureDirs() {
  [STORE_DIR, PUBLIC_ROOT, ASSET_FILES_ROOT].forEach((dir) => {
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  });
}

function toPosixPath(value) {
  return String(value || "").replace(/\\/g, "/");
}

function trimSlashes(value) {
  return String(value || "").replace(/^\/+|\/+$/g, "");
}

function joinUrl(base, ...parts) {
  const root = String(base || "").trim().replace(/\/+$/g, "");
  const suffix = parts.map(trimSlashes).filter(Boolean).join("/");
  return suffix ? `${root}/${suffix}` : root;
}

function getOracleBaseUrl() {
  return String(
    process.env.FOSU_MAP_ORACLE_BASE_URL ||
    process.env.PUBLIC_API_ORIGIN ||
    process.env.FOSU_API_BASE_URL ||
    config.FOSU_API_BASE_URL ||
    config.PUBLIC_API_ORIGIN ||
    "http://localhost:3000"
  ).replace(/\/+$/g, "");
}

function getCloudbaseBaseUrl() {
  return String(
    process.env.FOSU_MAP_CLOUDBASE_BASE_URL ||
    process.env.CLOUDBASE_HOSTING_BASE_URL ||
    process.env.FOSU_CLOUDBASE_HOSTING_BASE_URL ||
    DEFAULT_CLOUDBASE_BASE_URL
  ).replace(/\/+$/g, "");
}

function getCloudbaseEnvId() {
  return String(process.env.FOSU_MAP_CLOUDBASE_ENV_ID || process.env.CLOUDBASE_ENV_ID || DEFAULT_CLOUDBASE_ENV_ID);
}

function sha256(buffer) {
  return crypto.createHash("sha256").update(buffer).digest("hex");
}

function readJson(filePath, fallback) {
  try {
    if (!fs.existsSync(filePath)) return fallback;
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch (error) {
    return fallback;
  }
}

function writeJsonAtomic(filePath, value) {
  ensureDirs();
  const tmpPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(tmpPath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  fs.renameSync(tmpPath, filePath);
}

function createEmptyStore() {
  return {
    schemaVersion: 1,
    updatedAt: nowIso(),
    cloudbaseBaseUrl: getCloudbaseBaseUrl(),
    maps: MAP_DEFINITIONS.reduce((acc, item) => {
      acc[item.mapKey] = {
        mapKey: item.mapKey,
        campus: item.campus,
        area: item.area,
        title: item.title,
        currentAssetId: "",
      };
      return acc;
    }, {}),
    assets: {},
    mapVersions: {},
    cloudbaseSync: {
      status: "pending",
      updatedAt: "",
      message: "CloudBase has not been verified for campus map assets.",
    },
  };
}

function normalizeStore(store) {
  const source = store && typeof store === "object" && !Array.isArray(store) ? store : {};
  const normalized = Object.assign(createEmptyStore(), source, {
    maps: Object.assign(createEmptyStore().maps, source.maps || {}),
    assets: source.assets && typeof source.assets === "object" && !Array.isArray(source.assets) ? source.assets : {},
    mapVersions: source.mapVersions && typeof source.mapVersions === "object" && !Array.isArray(source.mapVersions) ? source.mapVersions : {},
    cloudbaseSync: Object.assign(createEmptyStore().cloudbaseSync, source.cloudbaseSync || {}),
  });
  MAP_DEFINITIONS.forEach((definition) => {
    normalized.maps[definition.mapKey] = Object.assign({
      mapKey: definition.mapKey,
      campus: definition.campus,
      area: definition.area,
      title: definition.title,
      currentAssetId: "",
    }, normalized.maps[definition.mapKey] || {});
    if (!Array.isArray(normalized.mapVersions[definition.mapKey])) normalized.mapVersions[definition.mapKey] = [];
  });
  return normalized;
}

function sanitizeFileName(input, fallback = "campus-map.jpg") {
  const ext = path.extname(String(input || "")).toLowerCase();
  const base = path.basename(String(input || fallback), ext)
    .replace(/[^a-zA-Z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80) || "campus-map";
  const safeExt = [".jpg", ".jpeg", ".png", ".webp"].includes(ext) ? ext : path.extname(fallback) || ".jpg";
  return `${base}${safeExt}`;
}

function normalizeMime(mime) {
  const value = String(mime || "").split(";")[0].trim().toLowerCase();
  if (value === "image/jpg") return "image/jpeg";
  return value;
}

function detectMime(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length < 12) return "";
  if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) return "image/jpeg";
  if (buffer.slice(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return "image/png";
  if (buffer.slice(0, 4).toString("ascii") === "RIFF" && buffer.slice(8, 12).toString("ascii") === "WEBP") return "image/webp";
  return "";
}

function readJpegDimensions(buffer) {
  let offset = 2;
  while (offset + 9 < buffer.length) {
    if (buffer[offset] !== 0xff) {
      offset += 1;
      continue;
    }
    const marker = buffer[offset + 1];
    const length = buffer.readUInt16BE(offset + 2);
    if (length < 2) break;
    if (
      marker >= 0xc0 && marker <= 0xcf &&
      ![0xc4, 0xc8, 0xcc].includes(marker)
    ) {
      return {
        height: buffer.readUInt16BE(offset + 5),
        width: buffer.readUInt16BE(offset + 7),
      };
    }
    offset += 2 + length;
  }
  return null;
}

function readPngDimensions(buffer) {
  if (buffer.length < 24) return null;
  return {
    width: buffer.readUInt32BE(16),
    height: buffer.readUInt32BE(20),
  };
}

function readWebpDimensions(buffer) {
  const chunk = buffer.slice(12, 16).toString("ascii");
  if (chunk === "VP8X" && buffer.length >= 30) {
    return {
      width: 1 + buffer.readUIntLE(24, 3),
      height: 1 + buffer.readUIntLE(27, 3),
    };
  }
  if (chunk === "VP8L" && buffer.length >= 25 && buffer[20] === 0x2f) {
    const bits = buffer.readUInt32LE(21);
    return {
      width: (bits & 0x3fff) + 1,
      height: ((bits >> 14) & 0x3fff) + 1,
    };
  }
  if (chunk === "VP8 " && buffer.length >= 30) {
    return {
      width: buffer.readUInt16LE(26) & 0x3fff,
      height: buffer.readUInt16LE(28) & 0x3fff,
    };
  }
  return null;
}

function readImageDimensions(buffer, mime) {
  if (mime === "image/jpeg") return readJpegDimensions(buffer);
  if (mime === "image/png") return readPngDimensions(buffer);
  if (mime === "image/webp") return readWebpDimensions(buffer);
  return null;
}

function validateImageBuffer(buffer, declaredMime) {
  if (!Buffer.isBuffer(buffer) || !buffer.length) {
    const error = new Error("Campus map image is empty.");
    error.code = "CAMPUS_MAP_IMAGE_EMPTY";
    throw error;
  }
  if (buffer.length > MAX_UPLOAD_BYTES) {
    const error = new Error(`Campus map image exceeds ${MAX_UPLOAD_BYTES} bytes.`);
    error.code = "CAMPUS_MAP_IMAGE_TOO_LARGE";
    throw error;
  }
  const actualMime = detectMime(buffer);
  const mime = normalizeMime(declaredMime || actualMime);
  if (!["image/jpeg", "image/png", "image/webp"].includes(mime) || actualMime !== mime) {
    const error = new Error(`Unsupported or mismatched image MIME: declared=${declaredMime || "-"} actual=${actualMime || "-"}`);
    error.code = "CAMPUS_MAP_IMAGE_MIME_INVALID";
    throw error;
  }
  const dimensions = readImageDimensions(buffer, mime);
  if (!dimensions || !dimensions.width || !dimensions.height) {
    const error = new Error("Campus map image dimensions could not be read.");
    error.code = "CAMPUS_MAP_IMAGE_DIMENSIONS_INVALID";
    throw error;
  }
  if (dimensions.width < 320 || dimensions.height < 240 || dimensions.width > 12000 || dimensions.height > 12000) {
    const error = new Error(`Campus map image dimensions are out of range: ${dimensions.width}x${dimensions.height}.`);
    error.code = "CAMPUS_MAP_IMAGE_DIMENSIONS_OUT_OF_RANGE";
    throw error;
  }
  return { mime, width: dimensions.width, height: dimensions.height, size: buffer.length, sha256: sha256(buffer) };
}

function getAssetAbsolutePath(asset) {
  const relative = toPosixPath(asset && asset.oraclePath || "");
  const absolute = path.resolve(PUBLIC_ROOT, relative);
  const root = path.resolve(PUBLIC_ROOT);
  if (absolute !== root && !absolute.startsWith(`${root}${path.sep}`)) {
    const error = new Error("Campus map asset path escapes public root.");
    error.code = "CAMPUS_MAP_ASSET_PATH_INVALID";
    throw error;
  }
  return absolute;
}

function enrichAsset(asset) {
  if (!asset) return null;
  const oraclePath = toPosixPath(asset.oraclePath || "");
  const cloudbasePath = toPosixPath(asset.cloudbasePath || joinUrl("campus-maps", oraclePath));
  const oracleUrl = joinUrl(getOracleBaseUrl(), "static/campus-maps", oraclePath);
  const cloudbaseUrl = joinUrl(getCloudbaseBaseUrl(), cloudbasePath);
  return Object.assign({}, asset, {
    oraclePath,
    oracleUrl,
    cloudbasePath,
    cloudbaseUrl,
    adminUrl: `/static/campus-maps/${oraclePath}`,
    localStatus: getLocalStatus(asset),
  });
}

function getLocalStatus(asset) {
  try {
    const filePath = getAssetAbsolutePath(asset);
    if (!fs.existsSync(filePath)) {
      return { ok: false, status: 404, reason: "ORACLE_FILE_MISSING" };
    }
    const buffer = fs.readFileSync(filePath);
    const actualHash = sha256(buffer);
    const ok = actualHash === asset.sha256 && buffer.length === Number(asset.size);
    return {
      ok,
      status: ok ? 200 : 500,
      mime: detectMime(buffer),
      size: buffer.length,
      sha256: actualHash,
      reason: ok ? "" : "ORACLE_FILE_HASH_OR_SIZE_MISMATCH",
    };
  } catch (error) {
    return { ok: false, status: 500, reason: error.code || error.message };
  }
}

function findSeedFile(seedFileName) {
  for (const dir of SEED_DIRS) {
    const filePath = path.join(dir, seedFileName);
    if (fs.existsSync(filePath)) return filePath;
  }
  return "";
}

function addAssetToStore(store, mapKey, buffer, options = {}) {
  const definition = MAP_DEFINITION_BY_KEY[mapKey];
  if (!definition) {
    const error = new Error(`Unknown campus map key: ${mapKey}`);
    error.code = "CAMPUS_MAP_KEY_INVALID";
    throw error;
  }
  const meta = validateImageBuffer(buffer, options.mime);
  const existingId = Object.keys(store.assets || {}).find((assetId) => {
    const asset = store.assets[assetId];
    return asset && asset.mapKey === mapKey && asset.sha256 === meta.sha256;
  });
  if (existingId) {
    const existing = store.assets[existingId];
    const absolutePath = getAssetAbsolutePath(existing);
    if (!fs.existsSync(absolutePath)) {
      fs.mkdirSync(path.dirname(absolutePath), { recursive: true });
      fs.writeFileSync(absolutePath, buffer);
    }
    store.maps[mapKey].currentAssetId = store.maps[mapKey].currentAssetId || existingId;
    return { asset: enrichAsset(existing), duplicate: true };
  }

  const assetVersion = `sha256-${meta.sha256.slice(0, 16)}`;
  const originalFileName = sanitizeFileName(options.originalFileName || definition.seedFileName, definition.seedFileName);
  const oraclePath = toPosixPath(path.join("assets", mapKey, assetVersion, originalFileName));
  const assetId = `${mapKey}-${assetVersion}`;
  const absolutePath = path.join(PUBLIC_ROOT, ...oraclePath.split("/"));
  fs.mkdirSync(path.dirname(absolutePath), { recursive: true });
  fs.writeFileSync(absolutePath, buffer);

  const createdAt = nowIso();
  const asset = {
    assetId,
    mapKey,
    campus: definition.campus,
    area: definition.area,
    title: definition.title,
    originalFileName,
    mime: meta.mime,
    width: meta.width,
    height: meta.height,
    size: meta.size,
    sha256: meta.sha256,
    assetVersion,
    oraclePath,
    cloudbasePath: toPosixPath(path.join("campus-maps", oraclePath)),
    status: "available",
    source: options.source || "upload",
    createdAt,
    updatedAt: createdAt,
    cloudbase: {
      status: "pending",
      updatedAt: "",
      statusCode: 0,
      size: 0,
      sha256: "",
      message: "CloudBase mirror has not been verified.",
    },
  };
  store.assets[assetId] = asset;
  store.mapVersions[mapKey] = [assetId].concat((store.mapVersions[mapKey] || []).filter((id) => id !== assetId));
  store.maps[mapKey].currentAssetId = store.maps[mapKey].currentAssetId || assetId;
  store.updatedAt = createdAt;
  return { asset: enrichAsset(asset), duplicate: false };
}

function readStoreWithoutSeed() {
  ensureDirs();
  return normalizeStore(readJson(ASSET_STORE_PATH, null));
}

function writeStore(store) {
  writeJsonAtomic(ASSET_STORE_PATH, normalizeStore(Object.assign({}, store, { updatedAt: nowIso(), cloudbaseBaseUrl: getCloudbaseBaseUrl() })));
}

function seedDefaultAssets() {
  const store = readStoreWithoutSeed();
  let changed = false;
  MAP_DEFINITIONS.forEach((definition) => {
    const versions = store.mapVersions[definition.mapKey] || [];
    if (versions.length && versions.some((id) => store.assets[id])) return;
    const seedFile = findSeedFile(definition.seedFileName);
    if (!seedFile) return;
    const buffer = fs.readFileSync(seedFile);
    const result = addAssetToStore(store, definition.mapKey, buffer, {
      originalFileName: definition.seedFileName,
      mime: "image/jpeg",
      source: "seed",
    });
    store.maps[definition.mapKey].currentAssetId = result.asset.assetId;
    changed = true;
  });
  if (changed || !fs.existsSync(ASSET_STORE_PATH)) writeStore(store);
  return normalizeStore(store);
}

function ensureInitialized() {
  return seedDefaultAssets();
}

function getStore() {
  return ensureInitialized();
}

function getMapDefinitions() {
  return MAP_DEFINITIONS.map((item) => Object.assign({}, item));
}

function getLatestAssetIdForMap(mapKey) {
  const store = getStore();
  const current = store.maps[mapKey] && store.maps[mapKey].currentAssetId;
  if (current && store.assets[current]) return current;
  const versions = store.mapVersions[mapKey] || [];
  return versions.find((id) => store.assets[id]) || "";
}

function getAsset(assetId) {
  const store = getStore();
  return enrichAsset(store.assets[String(assetId || "")] || null);
}

function getAssetForMap(mapKey, assetId) {
  const id = assetId || getLatestAssetIdForMap(mapKey);
  const asset = getAsset(id);
  if (!asset || asset.mapKey !== mapKey) return null;
  return asset;
}

function listAssetsByMap() {
  const store = getStore();
  const result = {};
  MAP_DEFINITIONS.forEach((definition) => {
    const versions = (store.mapVersions[definition.mapKey] || [])
      .map((assetId) => store.assets[assetId])
      .filter(Boolean)
      .map(enrichAsset);
    result[definition.mapKey] = {
      definition: Object.assign({}, definition),
      currentAssetId: store.maps[definition.mapKey] && store.maps[definition.mapKey].currentAssetId || "",
      versions,
    };
  });
  return result;
}

function importAssetFromBuffer(mapKey, buffer, options = {}) {
  const store = getStore();
  const result = addAssetToStore(store, mapKey, buffer, options);
  store.maps[mapKey].currentAssetId = result.asset.assetId;
  writeStore(store);
  return result;
}

function importAssetFromFile(mapKey, filePath, options = {}) {
  const buffer = fs.readFileSync(filePath);
  return importAssetFromBuffer(mapKey, buffer, Object.assign({
    originalFileName: path.basename(filePath),
  }, options));
}

function restoreMapAsset(mapKey, assetId) {
  const store = getStore();
  const asset = store.assets[String(assetId || "")];
  if (!asset || asset.mapKey !== mapKey) {
    const error = new Error("Campus map asset version was not found for this map.");
    error.code = "CAMPUS_MAP_ASSET_NOT_FOUND";
    throw error;
  }
  const local = getLocalStatus(asset);
  if (!local.ok) {
    const error = new Error(`Campus map asset cannot be restored because Oracle copy is not readable: ${local.reason || local.status}`);
    error.code = "CAMPUS_MAP_ASSET_ORACLE_UNREADABLE";
    throw error;
  }
  store.maps[mapKey].currentAssetId = asset.assetId;
  writeStore(store);
  return enrichAsset(asset);
}

function repairAsset(assetId) {
  const store = getStore();
  const asset = store.assets[String(assetId || "")];
  if (!asset) {
    const error = new Error("Campus map asset was not found.");
    error.code = "CAMPUS_MAP_ASSET_NOT_FOUND";
    throw error;
  }
  const local = getLocalStatus(asset);
  if (local.ok) return { repaired: false, asset: enrichAsset(asset), local };

  const definition = MAP_DEFINITION_BY_KEY[asset.mapKey];
  const candidates = [
    asset.originalFileName,
    definition && definition.seedFileName,
  ].filter(Boolean);
  for (const fileName of candidates) {
    const seedFile = findSeedFile(fileName);
    if (!seedFile) continue;
    const buffer = fs.readFileSync(seedFile);
    if (sha256(buffer) !== asset.sha256) continue;
    const absolutePath = getAssetAbsolutePath(asset);
    fs.mkdirSync(path.dirname(absolutePath), { recursive: true });
    fs.writeFileSync(absolutePath, buffer);
    return { repaired: true, asset: enrichAsset(asset), local: getLocalStatus(asset) };
  }

  const error = new Error(`Unable to repair campus map asset ${asset.assetId}: no seed file with matching SHA-256 was found.`);
  error.code = "CAMPUS_MAP_ASSET_REPAIR_FAILED";
  throw error;
}

function markCloudbaseResult(assetId, result = {}) {
  const store = getStore();
  const asset = store.assets[String(assetId || "")];
  if (!asset) {
    const error = new Error("Campus map asset was not found.");
    error.code = "CAMPUS_MAP_ASSET_NOT_FOUND";
    throw error;
  }
  asset.cloudbase = Object.assign({}, asset.cloudbase || {}, {
    status: result.ok ? "synced" : (result.status || "failed"),
    updatedAt: nowIso(),
    statusCode: Number(result.statusCode || result.status || 0) || 0,
    size: Number(result.size || result.contentLength || 0) || 0,
    sha256: result.sha256 || "",
    mime: result.mime || result.contentType || "",
    message: result.message || "",
  });
  asset.updatedAt = nowIso();
  store.cloudbaseSync = {
    status: result.ok ? "synced" : "pending",
    updatedAt: nowIso(),
    message: result.ok ? "CloudBase mirror verified." : (result.message || "CloudBase mirror is pending or failed."),
  };
  writeStore(store);
  return enrichAsset(asset);
}

function isCloudbaseSynced(asset) {
  if (!asset) return false;
  const cloudbase = asset.cloudbase || {};
  const cloudbaseMime = normalizeMime(cloudbase.mime || "");
  return cloudbase.status === "synced" &&
    Number(cloudbase.size || 0) === Number(asset.size || 0) &&
    cloudbase.sha256 === asset.sha256 &&
    (!asset.mime || cloudbaseMime === asset.mime || cloudbaseMime.indexOf(asset.mime) === 0);
}

async function fetchBinaryMeta(url, expected = {}, options = {}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), Number(options.timeoutMs || 10000));
  try {
    const response = await fetch(url, {
      method: "GET",
      redirect: "follow",
      signal: controller.signal,
      headers: {
        "Cache-Control": "no-cache",
      },
    });
    const contentType = response.headers.get("content-type") || "";
    if (!response.ok) {
      return {
        ok: false,
        status: response.status,
        mime: contentType,
        size: Number(response.headers.get("content-length") || 0) || 0,
        sha256: "",
        message: `HTTP ${response.status}`,
      };
    }
    const arrayBuffer = await response.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);
    const hash = sha256(buffer);
    const mime = normalizeMime(contentType);
    const ok = (!expected.sha256 || expected.sha256 === hash) &&
      (!expected.size || Number(expected.size) === buffer.length) &&
      (!expected.mime || mime.indexOf(expected.mime) === 0 || contentType.indexOf(expected.mime) === 0);
    return {
      ok,
      status: response.status,
      mime: contentType,
      size: buffer.length,
      sha256: hash,
      message: ok ? "" : "HTTP body hash, size, or MIME does not match Oracle asset metadata.",
    };
  } catch (error) {
    return {
      ok: false,
      status: 0,
      mime: "",
      size: 0,
      sha256: "",
      message: error.name === "AbortError" ? "request timeout" : (error.code || error.message || "network error"),
    };
  } finally {
    clearTimeout(timeout);
  }
}

async function checkAssetHealth(assetId, options = {}) {
  const asset = getAsset(assetId);
  if (!asset) {
    const error = new Error("Campus map asset was not found.");
    error.code = "CAMPUS_MAP_ASSET_NOT_FOUND";
    throw error;
  }
  const local = getLocalStatus(asset);
  const expected = { sha256: asset.sha256, size: asset.size, mime: asset.mime };
  const oracle = options.skipHttp ? Object.assign({ source: "filesystem" }, local) : await fetchBinaryMeta(asset.oracleUrl, expected, options);
  const cloudbase = options.skipCloudbase
    ? Object.assign({}, asset.cloudbase || {}, { skipped: true })
    : await fetchBinaryMeta(asset.cloudbaseUrl, expected, options);
  return {
    asset: enrichAsset(asset),
    local,
    oracle,
    cloudbase,
    consistent: Boolean(local.ok && oracle.ok && cloudbase.ok && oracle.sha256 === asset.sha256 && cloudbase.sha256 === asset.sha256),
  };
}

async function checkAllAssetsHealth(options = {}) {
  const byMap = listAssetsByMap();
  const result = {};
  for (const definition of MAP_DEFINITIONS) {
    const asset = byMap[definition.mapKey].versions[0];
    result[definition.mapKey] = asset ? await checkAssetHealth(asset.assetId, options) : null;
  }
  return result;
}

function getCloudbaseTask(assetIds) {
  const ids = Array.isArray(assetIds) ? assetIds.filter(Boolean) : [];
  const args = ids.length ? ids.map((id) => `--asset-id=${id}`) : ["--all-current"];
  return {
    status: "pending",
    envId: getCloudbaseEnvId(),
    command: `node tools/cloudbase/deploy-campus-map-assets.js ${args.join(" ")} --execute`,
    dryRunCommand: `node tools/cloudbase/deploy-campus-map-assets.js ${args.join(" ")} --dry-run`,
  };
}

function publicAsset(asset) {
  const enriched = enrichAsset(asset);
  if (!enriched) return null;
  return {
    assetId: enriched.assetId,
    mapKey: enriched.mapKey,
    campus: enriched.campus,
    area: enriched.area,
    title: enriched.title,
    originalFileName: enriched.originalFileName,
    mime: enriched.mime,
    width: enriched.width,
    height: enriched.height,
    size: enriched.size,
    sha256: enriched.sha256,
    assetVersion: enriched.assetVersion,
    oracleUrl: enriched.oracleUrl,
    cloudbaseUrl: enriched.cloudbaseUrl,
    cdnUrl: enriched.cloudbaseUrl,
    fallbackUrl: enriched.oracleUrl,
    status: enriched.status,
    updatedAt: enriched.updatedAt,
  };
}

function adminAsset(asset, roles = {}) {
  const enriched = enrichAsset(asset);
  if (!enriched) return null;
  return Object.assign({}, publicAsset(enriched), {
    adminUrl: enriched.adminUrl,
    oraclePath: enriched.oraclePath,
    cloudbasePath: enriched.cloudbasePath,
    localStatus: enriched.localStatus,
    cloudbase: enriched.cloudbase || {},
    source: enriched.source || "",
    createdAt: enriched.createdAt || "",
    isDraft: Boolean(roles.isDraft),
    isPublished: Boolean(roles.isPublished),
    deleteProtected: Boolean(roles.isPublished),
  });
}

function listAdminAssets(draftMapAssets = {}, publishedMapAssets = {}) {
  const store = getStore();
  const result = {};
  MAP_DEFINITIONS.forEach((definition) => {
    const draftAssetId = draftMapAssets[definition.mapKey] || getLatestAssetIdForMap(definition.mapKey);
    const publishedAssetId = publishedMapAssets[definition.mapKey] || "";
    const versions = (store.mapVersions[definition.mapKey] || [])
      .map((assetId) => store.assets[assetId])
      .filter(Boolean)
      .map((asset) => adminAsset(asset, {
        isDraft: asset.assetId === draftAssetId,
        isPublished: asset.assetId === publishedAssetId,
      }));
    result[definition.mapKey] = {
      definition: Object.assign({}, definition),
      draftAssetId,
      publishedAssetId,
      current: versions.find((item) => item.assetId === draftAssetId) || versions[0] || null,
      versions,
    };
  });
  return result;
}

module.exports = {
  ASSET_FILES_ROOT,
  ASSET_STORE_PATH,
  DEFAULT_CLOUDBASE_BASE_URL,
  DEFAULT_CLOUDBASE_ENV_ID,
  MAP_DEFINITIONS,
  PUBLIC_ROOT,
  STORE_DIR,
  checkAllAssetsHealth,
  checkAssetHealth,
  detectMime,
  enrichAsset,
  ensureInitialized,
  fetchBinaryMeta,
  getAsset,
  getAssetAbsolutePath,
  getAssetForMap,
  getCloudbaseBaseUrl,
  getCloudbaseEnvId,
  getCloudbaseTask,
  getLatestAssetIdForMap,
  getLocalStatus,
  getMapDefinitions,
  importAssetFromBuffer,
  importAssetFromFile,
  joinUrl,
  listAdminAssets,
  listAssetsByMap,
  isCloudbaseSynced,
  markCloudbaseResult,
  publicAsset,
  readImageDimensions,
  repairAsset,
  restoreMapAsset,
  sha256,
  validateImageBuffer,
};
