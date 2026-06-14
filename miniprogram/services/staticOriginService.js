const request = require("../utils/request");
const cloudbaseConfig = require("../config/cloudbase");
const {
  ORACLE_STATIC_RELEASE_BASE_URL,
  ORACLE_RUNTIME_BASE_URL,
} = require("../config/api");
const {
  extractPathname,
  isAbsoluteHttpUrl,
} = require("../utils/trustedUrl");

const HEALTH_STORAGE_KEY = "FOSU_STATIC_ORIGIN_HEALTH";
const LAST_HIT_STORAGE_KEY = "FOSU_STATIC_ORIGIN_LAST_HIT";
const DEFAULT_CIRCUIT_MS = 45 * 1000;
const inflight = new Map();
let healthState = {};
let lastHit = null;
let testConfig = null;

const PROFILES = {
  runtime: { timeout: 2200, retries: 0 },
  manifest: { timeout: 4500, retries: 0 },
  index: { timeout: 7500, retries: 1 },
  detail: { timeout: 7500, retries: 1 },
  "empty-room": { timeout: 7500, retries: 1 },
};

function now() {
  return Date.now();
}

function readStorage(key, fallback) {
  if (typeof wx === "undefined") return fallback;
  try {
    const value = wx.getStorageSync(key);
    return value === undefined || value === "" ? fallback : value;
  } catch (error) {
    return fallback;
  }
}

function writeStorage(key, value) {
  if (typeof wx === "undefined") return false;
  try {
    wx.setStorageSync(key, value);
    return true;
  } catch (error) {
    return false;
  }
}

function loadHealthState() {
  const stored = readStorage(HEALTH_STORAGE_KEY, {});
  healthState = stored && typeof stored === "object" && !Array.isArray(stored) ? stored : {};
}

function persistHealthState() {
  writeStorage(HEALTH_STORAGE_KEY, healthState);
}

loadHealthState();
lastHit = readStorage(LAST_HIT_STORAGE_KEY, null);

function trimSlashes(value) {
  return String(value || "").replace(/^\/+|\/+$/g, "");
}

function joinUrl(base, ...parts) {
  const root = String(base || "").replace(/\/+$/g, "");
  const suffix = parts.map(trimSlashes).filter(Boolean).join("/");
  return suffix ? `${root}/${suffix}` : root;
}

function withQuery(url, query) {
  const pairs = Object.keys(query || {})
    .filter((key) => query[key] !== undefined && query[key] !== null && query[key] !== "")
    .map((key) => `${encodeURIComponent(key)}=${encodeURIComponent(String(query[key]))}`);
  if (!pairs.length) return url;
  return `${url}${url.indexOf("?") >= 0 ? "&" : "?"}${pairs.join("&")}`;
}

function mergeCloudbaseConfig() {
  return Object.assign({}, cloudbaseConfig, testConfig && testConfig.cloudbase || {});
}

function getProfile(kind, options = {}) {
  const base = PROFILES[kind] || PROFILES.index;
  const background = options.background === true || options.silentRefresh === true;
  return {
    timeout: options.timeout || (background ? Math.max(base.timeout, 12000) : base.timeout),
    retries: options.retries === undefined ? base.retries : Math.min(Number(options.retries) || 0, base.retries),
  };
}

function isUsableUrl(url) {
  const value = String(url || "").trim();
  return Boolean(value && isAbsoluteHttpUrl(value) && !/[<>{}]/.test(value));
}

function originKey(origin) {
  return origin && origin.name || "unknown";
}

function getOriginHealth(origin) {
  const key = originKey(origin);
  const entry = healthState[key] || {};
  if (entry.openUntil && Number(entry.openUntil) <= now()) {
    delete entry.openUntil;
    healthState[key] = entry;
    persistHealthState();
  }
  return entry;
}

function isCircuitOpen(origin, options = {}) {
  if (options.forceOrigin === originKey(origin) || options.ignoreCircuit === true) return false;
  const entry = getOriginHealth(origin);
  return Number(entry.openUntil || 0) > now();
}

function markSuccess(origin, url) {
  const key = originKey(origin);
  healthState[key] = {
    name: key,
    label: origin.label,
    failCount: 0,
    lastSuccessAt: now(),
    openUntil: 0,
  };
  lastHit = {
    name: key,
    label: origin.label,
    url,
    at: new Date().toISOString(),
  };
  persistHealthState();
  writeStorage(LAST_HIT_STORAGE_KEY, lastHit);
}

function markFailure(origin, error) {
  const key = originKey(origin);
  const previous = getOriginHealth(origin);
  healthState[key] = {
    name: key,
    label: origin.label,
    failCount: Number(previous.failCount || 0) + 1,
    lastFailureAt: now(),
    openUntil: now() + DEFAULT_CIRCUIT_MS,
    reason: error && (error.code || error.reasonCode || error.errMsg || error.message || "networkError") || "networkError",
  };
  persistHealthState();
}

function getOrigins() {
  const config = mergeCloudbaseConfig();
  const origins = [];
  const cloudbaseBase = String(config.CLOUDBASE_HOSTING_BASE_URL || "").trim().replace(/\/+$/g, "");
  if (config.CLOUDBASE_ENABLED !== false && config.CLOUDBASE_HOSTING_ENABLED !== false && isUsableUrl(cloudbaseBase)) {
    origins.push({
      name: "cloudbase",
      label: "CloudBase Hosting",
      releaseRoot: joinUrl(cloudbaseBase, "releases"),
      runtimeRoot: joinUrl(cloudbaseBase, "runtime"),
      staticTicket: false,
    });
  }
  if (testConfig && Array.isArray(testConfig.extraOrigins)) {
    origins.push.apply(origins, testConfig.extraOrigins);
  }
  if (!(testConfig && testConfig.disableOracle === true)) {
    origins.push({
      name: "oracle",
      label: "Oracle Static",
      releaseRoot: ORACLE_STATIC_RELEASE_BASE_URL,
      runtimeRoot: ORACLE_RUNTIME_BASE_URL,
      staticTicket: true,
    });
  }
  return origins.filter((origin) => isUsableUrl(origin.releaseRoot) || isUsableUrl(origin.runtimeRoot));
}

function getOriginSnapshot() {
  return getOrigins().map((origin) => Object.assign({}, origin, {
    health: getOriginHealth(origin),
  }));
}

function normalizeReleasePath(value, releaseVersion) {
  const text = String(value || "").trim();
  if (!text) return "";
  let pathname = text;
  if (isAbsoluteHttpUrl(text)) {
    pathname = extractPathname(text);
  }
  const version = encodeURIComponent(String(releaseVersion || ""));
  const rawVersion = String(releaseVersion || "");
  const candidates = [
    `/static/releases/${version}/`,
    `/static/releases/${rawVersion}/`,
    `/releases/${version}/`,
    `/releases/${rawVersion}/`,
  ];
  for (const prefix of candidates) {
    const index = pathname.indexOf(prefix);
    if (index >= 0) return pathname.slice(index + prefix.length);
  }
  return pathname.replace(/^\/+/, "");
}

function pickClassShardRelativePath(manifest, params = {}) {
  const classShards = manifest && manifest.shards && manifest.shards.class || {};
  const majorKey = [params.collegeCode || params.collegeName, params.grade, params.majorCode || params.majorName]
    .filter(Boolean)
    .join("-");
  const collegeKey = params.collegeCode || params.collegeName || "";
  if (majorKey && classShards.byMajor && classShards.byMajor[majorKey]) return classShards.byMajor[majorKey];
  if (collegeKey && classShards.byCollege && classShards.byCollege[collegeKey]) return classShards.byCollege[collegeKey];
  if (classShards.all) return classShards.all;
  return "";
}

function resolveIndexRelativePath(type, manifest, params = {}) {
  const releaseVersion = params.releaseVersion || params.version || manifest && (manifest.releaseVersion || manifest.version) || "";
  if (type === "class") {
    const shardPath = pickClassShardRelativePath(manifest, params);
    if (shardPath) return normalizeReleasePath(shardPath, releaseVersion);
  }
  const indexUrl = manifest && manifest.indexUrls && manifest.indexUrls[type];
  if (indexUrl) return normalizeReleasePath(indexUrl, releaseVersion);
  return type === "class" ? "index/class/all.json" : `index/${type}/all.json`;
}

function resolveDetailRelativePath(type, id, manifest, params = {}) {
  const releaseVersion = params.releaseVersion || params.version || manifest && (manifest.releaseVersion || manifest.version) || "";
  const encodedId = encodeURIComponent(String(id || ""));
  const pattern = manifest && manifest.detailUrlPattern;
  if (pattern) {
    return normalizeReleasePath(pattern
      .replace("{type}", encodeURIComponent(type))
      .replace("{id}", encodedId), releaseVersion);
  }
  return `detail/${encodeURIComponent(type)}/${encodedId}.json`;
}

function resolveEmptyRoomRelativePath(manifest, params = {}) {
  const releaseVersion = params.releaseVersion || params.version || manifest && (manifest.releaseVersion || manifest.version) || "";
  const url = manifest && manifest.emptyRoomUrl;
  return url ? normalizeReleasePath(url, releaseVersion) : "empty-room/index.json";
}

function annotatePayload(payload, origin, url) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return payload;
  return Object.assign({}, payload, {
    staticOrigin: origin.name,
    staticOriginLabel: origin.label,
    staticOriginUrl: url,
  });
}

async function requestAcrossOrigins(kind, buildUrl, options = {}) {
  const origins = getOrigins();
  const usable = origins.filter((origin) => !isCircuitOpen(origin, options));
  const ordered = usable.length ? usable : origins;
  const profile = getProfile(kind, options);
  const key = `${kind}:${ordered.map((origin) => `${origin.name}:${buildUrl(origin)}`).join("|")}`;
  if (options.dedupe !== false && inflight.has(key)) return inflight.get(key);

  const task = (async () => {
    let lastError = null;
    for (const origin of ordered) {
      const url = buildUrl(origin);
      if (!isUsableUrl(url)) continue;
      try {
        const payload = await request.get(url, {}, {
          showLoading: false,
          silentError: true,
          suppressWarn: options.suppressWarn === undefined ? true : options.suppressWarn,
          timeout: profile.timeout,
          retries: profile.retries,
          skipSession: options.skipSession === true,
          skipStaticTicket: origin.staticTicket !== true,
          diagnosisClass: "static",
          dedupe: options.requestDedupe !== false,
        });
        markSuccess(origin, url);
        return annotatePayload(payload, origin, url);
      } catch (error) {
        lastError = error;
        markFailure(origin, error);
      }
    }
    const error = lastError || new Error("STATIC_ORIGIN_UNAVAILABLE");
    error.code = error.code || "STATIC_ORIGIN_UNAVAILABLE";
    throw error;
  })().finally(() => {
    inflight.delete(key);
  });

  if (options.dedupe !== false) inflight.set(key, task);
  return task;
}

function fetchRuntimePointer(options = {}) {
  const bucket = Math.floor(now() / 60000);
  return requestAcrossOrigins("runtime", (origin) => withQuery(joinUrl(origin.runtimeRoot, "active.json"), { bucket }), Object.assign({
    skipSession: true,
  }, options));
}

function fetchManifest(releaseVersion, options = {}) {
  const version = String(releaseVersion || "").trim();
  if (!version) {
    const error = new Error("STATIC_RELEASE_VERSION_REQUIRED");
    error.code = "STATIC_RELEASE_VERSION_REQUIRED";
    return Promise.reject(error);
  }
  return requestAcrossOrigins("manifest", (origin) => joinUrl(origin.releaseRoot, version, "manifest.json"), options);
}

function fetchIndex(type, params = {}, options = {}) {
  const releaseVersion = params.releaseVersion || params.version || "";
  const manifest = params.manifest || options.manifest || {};
  const relativePath = resolveIndexRelativePath(type, manifest, params);
  return requestAcrossOrigins("index", (origin) => joinUrl(origin.releaseRoot, releaseVersion, relativePath), options);
}

function fetchDetail(type, id, params = {}, options = {}) {
  const releaseVersion = params.releaseVersion || params.version || "";
  const manifest = params.manifest || options.manifest || {};
  const relativePath = resolveDetailRelativePath(type, id, manifest, params);
  return requestAcrossOrigins("detail", (origin) => joinUrl(origin.releaseRoot, releaseVersion, relativePath), options);
}

function fetchEmptyRoom(params = {}, options = {}) {
  const releaseVersion = params.releaseVersion || params.version || "";
  const manifest = params.manifest || options.manifest || {};
  const relativePath = resolveEmptyRoomRelativePath(manifest, params);
  return requestAcrossOrigins("empty-room", (origin) => joinUrl(origin.releaseRoot, releaseVersion, relativePath), options);
}

function getLastHit() {
  return lastHit;
}

function __setTestConfig(next) {
  testConfig = next || null;
  healthState = {};
  lastHit = null;
  inflight.clear();
}

function __resetForTest() {
  testConfig = null;
  healthState = {};
  lastHit = null;
  inflight.clear();
}

module.exports = {
  HEALTH_STORAGE_KEY,
  LAST_HIT_STORAGE_KEY,
  __resetForTest,
  __setTestConfig,
  fetchDetail,
  fetchEmptyRoom,
  fetchIndex,
  fetchManifest,
  fetchRuntimePointer,
  getLastHit,
  getOriginSnapshot,
  isCircuitOpen,
  joinUrl,
  normalizeReleasePath,
  resolveDetailRelativePath,
  resolveEmptyRoomRelativePath,
  resolveIndexRelativePath,
};
