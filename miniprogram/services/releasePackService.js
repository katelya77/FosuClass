const request = require("../utils/request");
const { API_BASE_URL, STATIC_RELEASE_BASE_URL } = require("../config/api");
const { normalizeBuilding, UNKNOWN_BUILDING_NAME } = require("../utils/buildingNormalizer");
const { BOOTSTRAP_CACHE_KEY } = require("../utils/storage");
const appConfigService = require("./appConfigService");
const platformDataService = require("./platformDataService");

const DEFAULT_TERM = "";
const CACHE_PREFIX = "fosu:v6";
const LEGACY_CACHE_PREFIX = "fosu:v5";
const INDEX_TYPES = ["class", "teacher", "classroom", "course"];
const INDEX_CACHE_TTL = 7 * 24 * 60 * 60 * 1000;
const DETAIL_CACHE_TTL = 30 * 24 * 60 * 60 * 1000;
const EMPTY_ROOM_CACHE_TTL = 7 * 24 * 60 * 60 * 1000;
const MAX_EMPTY_ROOM_SECTION = 14;
const MAX_EMPTY_ROOM_WEEK = 30;
const LOCAL_ACTIVE_RELEASE_KEY = `${CACHE_PREFIX}:active-release`;
const RUNTIME_POINTER_CIRCUIT_KEY = `${CACHE_PREFIX}:runtime-pointer-circuit`;
const RUNTIME_POINTER_CIRCUIT_MS = 45 * 1000;
const activeManifestInflight = new Map();
const switchReleaseInflight = new Map();
let runtimePointerInflight = null;
let runtimePointerCircuit = null;

function cachePart(value, fallback = "unknown") {
  return encodeURIComponent(String(value || fallback));
}

function inflightKey(options = {}) {
  return [
    options.term || "",
    options.releaseVersion || options.version || "",
  ].join(":");
}

function getManifestCacheKey(term) {
  return `${CACHE_PREFIX}:manifest:${cachePart(term || DEFAULT_TERM)}`;
}

function getIndexCacheKey(term, releaseVersion, type) {
  return `${CACHE_PREFIX}:index:${cachePart(term || DEFAULT_TERM)}:${cachePart(releaseVersion)}:${cachePart(type)}`;
}

function getDetailCacheKey(term, releaseVersion, type, id) {
  return `${CACHE_PREFIX}:detail:${cachePart(term || DEFAULT_TERM)}:${cachePart(releaseVersion)}:${cachePart(type)}:${cachePart(id)}`;
}

function getEmptyRoomCacheKey(term, releaseVersion) {
  return `${CACHE_PREFIX}:empty-room:${cachePart(term || DEFAULT_TERM)}:${cachePart(releaseVersion)}`;
}

function getLastGoodCacheKey(term) {
  return `${CACHE_PREFIX}:last-good:${cachePart(term || DEFAULT_TERM)}`;
}

function getLegacyLastGoodCacheKey(term) {
  return `${LEGACY_CACHE_PREFIX}:last-good:${cachePart(term || DEFAULT_TERM)}`;
}

function getLocalActiveReleaseKey(term) {
  return term ? `${CACHE_PREFIX}:active-release:${cachePart(term)}` : LOCAL_ACTIVE_RELEASE_KEY;
}

function getLegacyLocalActiveReleaseKey() {
  return `${LEGACY_CACHE_PREFIX}:active-release`;
}

function readStorage(key) {
  try {
    return wx.getStorageSync(key);
  } catch (error) {
    return null;
  }
}

function writeStorage(key, value) {
  try {
    wx.setStorageSync(key, value);
    return true;
  } catch (error) {
    return false;
  }
}

function removeStorage(key) {
  try {
    wx.removeStorageSync(key);
  } catch (error) {
    // ignore storage cleanup failures
  }
}

function getStorageKeys() {
  try {
    const info = wx.getStorageInfoSync();
    return Array.isArray(info.keys) ? info.keys : [];
  } catch (error) {
    return [];
  }
}

function normalizeManifest(payload) {
  const source = payload && payload.data ? payload.data : payload;
  if (!source || source.success === false) return null;
  const releaseVersion = source.releaseVersion || source.version || "";
  if (!releaseVersion) return null;
  const term = source.term || source.semester || DEFAULT_TERM;
  const updatedAt = source.updatedAt || source.publishedAt || "";
  const cacheEpoch = source.cacheEpoch || source.dataEpoch || Date.parse(updatedAt || "") || Date.now();
  const forceRefreshToken = source.forceRefreshToken || source.dataEpoch || `${releaseVersion}:${cacheEpoch}`;
  return Object.assign({}, source, {
    success: true,
    term,
    semester: source.semester || term,
    releaseVersion,
    version: source.version || releaseVersion,
    cacheEpoch,
    dataEpoch: source.dataEpoch || cacheEpoch,
    forceRefreshToken,
    minClientCacheSchema: source.minClientCacheSchema || 5,
    packStatus: source.packStatus || source.pack || {},
  });
}

function trimSlashes(value) {
  return String(value || "").replace(/^\/+|\/+$/g, "");
}

function joinUrl(base, ...parts) {
  const root = String(base || "").replace(/\/+$/g, "");
  const suffix = parts.map(trimSlashes).filter(Boolean).join("/");
  return suffix ? `${root}/${suffix}` : root || "/";
}

function getManifestStaticBaseUrl(manifest, releaseVersion) {
  const normalized = normalizeManifest(manifest);
  const version = releaseVersion || (normalized && normalized.releaseVersion) || "";
  const manifestBase = normalized && (normalized.staticReleaseUrl || normalized.staticBaseUrl);
  if (manifestBase && normalized && normalized.staticReleaseUrl) return manifestBase;
  if (manifestBase && version) return joinUrl(manifestBase, version);
  if (STATIC_RELEASE_BASE_URL && version) return joinUrl(STATIC_RELEASE_BASE_URL, version);
  return API_BASE_URL && version ? joinUrl(API_BASE_URL, "static/releases", version) : "";
}

function resolveIndexUrl(type, manifest, params = {}) {
  const normalized = normalizeManifest(manifest);
  const indexUrls = normalized && normalized.indexUrls || {};
  if (type === "class") {
    const majorKey = [params.collegeCode || params.collegeName, params.grade, params.majorCode || params.majorName]
      .filter(Boolean)
      .join("-");
    const collegeKey = params.collegeCode || params.collegeName || "";
    const classShards = normalized && normalized.shards && normalized.shards.class || {};
    if (majorKey && classShards.byMajor && classShards.byMajor[majorKey]) {
      return classShards.byMajor[majorKey];
    }
    if (collegeKey && classShards.byCollege && classShards.byCollege[collegeKey]) {
      return classShards.byCollege[collegeKey];
    }
    if (classShards.all) return classShards.all;
  }
  if (indexUrls[type]) return indexUrls[type];
  const base = getManifestStaticBaseUrl(normalized, params.releaseVersion || params.version);
  if (!base) return "";
  return type === "class"
    ? joinUrl(base, "index/class/all.json")
    : joinUrl(base, `index/${type}/all.json`);
}

function resolveDetailUrl(type, id, manifest, params = {}) {
  const normalized = normalizeManifest(manifest);
  const pattern = normalized && normalized.detailUrlPattern;
  if (pattern) {
    return pattern
      .replace("{type}", encodeURIComponent(type))
      .replace("{id}", encodeURIComponent(id));
  }
  const base = getManifestStaticBaseUrl(normalized, params.releaseVersion || params.version);
  return base ? joinUrl(base, "detail", type, `${encodeURIComponent(id)}.json`) : "";
}

function resolveEmptyRoomUrl(manifest, params = {}) {
  const normalized = normalizeManifest(manifest);
  if (normalized && normalized.emptyRoomUrl) return normalized.emptyRoomUrl;
  const base = getManifestStaticBaseUrl(normalized, params.releaseVersion || params.version);
  return base ? joinUrl(base, "empty-room/index.json") : "";
}

function assertManifest(manifest) {
  if (!manifest || !manifest.term || !manifest.releaseVersion) {
    const error = new Error("INVALID_RELEASE_PACK_MANIFEST");
    error.code = "INVALID_RELEASE_PACK_MANIFEST";
    throw error;
  }
  return manifest;
}

function assertTermMatch(actualTerm, expectedTerm, code) {
  if (expectedTerm && actualTerm && actualTerm !== expectedTerm) {
    const error = new Error(code || "TERM_DATA_MISMATCH");
    error.code = code || "TERM_DATA_MISMATCH";
    error.expectedTerm = expectedTerm;
    error.actualTerm = actualTerm;
    throw error;
  }
}

function markFromStorage(value, extra = {}) {
  return Object.assign({}, value || {}, extra, { fromStorage: true });
}

function getManifestReleaseKey(manifest) {
  const normalized = normalizeManifest(manifest);
  if (!normalized) return "";
  return [
    normalized.term || DEFAULT_TERM,
    normalized.releaseVersion || "",
    normalized.cacheEpoch || "",
    normalized.forceRefreshToken || "",
  ].join(":");
}

function readCachedManifest(term) {
  if (!term) return null;
  const cached = readStorage(getManifestCacheKey(term || DEFAULT_TERM));
  const manifest = normalizeManifest(cached && (cached.manifest || cached));
  if (!manifest) return null;
  return markFromStorage(manifest, { savedAt: cached.savedAt || 0 });
}

function writeManifestCache(manifest) {
  const normalized = assertManifest(normalizeManifest(manifest));
  const entry = {
    savedAt: Date.now(),
    term: normalized.term,
    releaseVersion: normalized.releaseVersion,
    manifest: normalized,
  };
  writeStorage(getManifestCacheKey(normalized.term), entry);
  writeStorage(getLastGoodCacheKey(normalized.term), entry);
  const activeEntry = {
    savedAt: entry.savedAt,
    term: normalized.term,
    releaseVersion: normalized.releaseVersion,
    cacheEpoch: normalized.cacheEpoch,
    forceRefreshToken: normalized.forceRefreshToken,
    releaseKey: getManifestReleaseKey(normalized),
    manifest: normalized,
  };
  writeStorage(getLocalActiveReleaseKey(normalized.term), activeEntry);
  const activeTerm = normalized.activeTerm || normalized.currentTerm || normalized.activeTermConfig && normalized.activeTermConfig.term || "";
  if (!activeTerm || activeTerm === normalized.term || normalized.isActive === true || normalized.active === true) {
    writeStorage(LOCAL_ACTIVE_RELEASE_KEY, activeEntry);
  }
  return normalized;
}

function normalizeRuntimePointer(payload) {
  const source = payload && payload.data ? payload.data : payload;
  if (!source || source.success === false) return null;
  const term = source.activeTerm || source.term || source.termConfig && source.termConfig.term || "";
  const releaseVersion = source.releaseVersion || source.version || "";
  if (!term || !releaseVersion) return null;
  const termConfig = source.termConfig || {};
  return {
    success: true,
    schemaVersion: source.schemaVersion || 1,
    activeTerm: term,
    term,
    releaseVersion,
    updatedAt: source.updatedAt || "",
    cacheEpoch: source.cacheEpoch || Date.parse(source.updatedAt || "") || Date.now(),
    forceRefreshToken: source.forceRefreshToken || "",
    termConfig: Object.assign({}, termConfig, {
      term: termConfig.term || term,
      releaseVersion: termConfig.releaseVersion || releaseVersion,
    }),
    urls: source.urls || {},
    source: source.source || "runtime-pointer",
  };
}

function isNetworkTimeout(error) {
  const code = String(error && (error.code || error.errMsg || error.message || "") || "").toUpperCase();
  return code.indexOf("TIMEOUT") >= 0 ||
    code.indexOf("REQUEST_TIMEOUT") >= 0 ||
    code.indexOf("NETWORK") >= 0 ||
    code.indexOf("FAIL") >= 0;
}

function readRuntimeCircuit() {
  if (runtimePointerCircuit && runtimePointerCircuit.openUntil > Date.now()) return runtimePointerCircuit;
  const stored = readStorage(RUNTIME_POINTER_CIRCUIT_KEY);
  if (stored && Number(stored.openUntil || 0) > Date.now()) {
    runtimePointerCircuit = stored;
    return stored;
  }
  return null;
}

function openRuntimeCircuit(error) {
  if (!isNetworkTimeout(error)) return null;
  const circuit = {
    openUntil: Date.now() + RUNTIME_POINTER_CIRCUIT_MS,
    openedAt: Date.now(),
    reason: error && (error.code || error.errMsg || error.message || "networkError") || "networkError",
  };
  runtimePointerCircuit = circuit;
  writeStorage(RUNTIME_POINTER_CIRCUIT_KEY, circuit);
  return circuit;
}

function clearRuntimeCircuit() {
  runtimePointerCircuit = null;
  removeStorage(RUNTIME_POINTER_CIRCUIT_KEY);
}

function pointerFromCachedManifest(entry, extra = {}) {
  const manifest = normalizeManifest(entry && (entry.manifest || entry));
  if (!manifest) return null;
  return Object.assign({
    success: true,
    schemaVersion: 1,
    activeTerm: manifest.term,
    term: manifest.term,
    releaseVersion: manifest.releaseVersion,
    updatedAt: manifest.updatedAt || "",
    cacheEpoch: manifest.cacheEpoch,
    forceRefreshToken: manifest.forceRefreshToken,
    termConfig: manifest.termConfig || { term: manifest.term, releaseVersion: manifest.releaseVersion },
    urls: {
      manifest: resolveStaticManifestUrl(manifest.releaseVersion),
      classIndex: resolveIndexUrl("class", manifest, { term: manifest.term, releaseVersion: manifest.releaseVersion }),
      calendar: manifest.calendarUrl || "",
      bootstrap: manifest.bootstrapUrl || manifest.catalogUrl || "",
      catalog: manifest.catalogUrl || manifest.bootstrapUrl || "",
    },
    source: "last-known-good-runtime-pointer",
    fromStorage: true,
  }, extra);
}

function getCachedRuntimePointer(options = {}) {
  const term = options.term || "";
  const entry = term
    ? getLocalActiveRelease(term)
    : (readStorage(LOCAL_ACTIVE_RELEASE_KEY) || scanLastGood({}));
  return pointerFromCachedManifest(entry);
}

function resolveRuntimePointer(options = {}) {
  if (runtimePointerInflight && options.dedupe !== false && !options.forceNetwork) {
    return runtimePointerInflight;
  }
  const openCircuit = !options.forceNetwork && readRuntimeCircuit();
  if (openCircuit) {
    const fallbackPointer = getCachedRuntimePointer(options);
    if (fallbackPointer) {
      return Promise.resolve(Object.assign({}, fallbackPointer, {
        circuitOpen: true,
        circuitReason: openCircuit.reason,
      }));
    }
  }
  const requestOptions = {
    showLoading: false,
    silentError: true,
    timeout: options.timeout || 2000,
    retries: options.retries === undefined ? 0 : options.retries,
    skipSession: true,
    suppressWarn: options.suppressWarn === undefined ? true : options.suppressWarn,
  };
  const staticUrl = joinUrl(API_BASE_URL, "static/runtime/active.json");
  const task = request.get(staticUrl, {}, requestOptions)
    .catch(() => request.get("/api/fosu/runtime/active", {}, Object.assign({}, requestOptions, {
      skipSession: true,
    })))
    .then((payload) => {
      const pointer = normalizeRuntimePointer(payload);
      if (!pointer) {
        const error = new Error("INVALID_RUNTIME_POINTER");
        error.code = "INVALID_RUNTIME_POINTER";
        throw error;
      }
      const manifest = normalizeManifest(Object.assign({}, pointer, {
        term: pointer.activeTerm,
        semester: pointer.activeTerm,
        releaseVersion: pointer.releaseVersion,
        termConfig: pointer.termConfig,
        cacheEpoch: pointer.cacheEpoch,
        forceRefreshToken: pointer.forceRefreshToken,
        activeTerm: pointer.activeTerm,
        isActive: true,
        calendarUrl: pointer.urls && pointer.urls.calendar,
        indexUrls: { class: pointer.urls && pointer.urls.classIndex },
      }));
      if (manifest) writeManifestCache(manifest);
      clearRuntimeCircuit();
      return pointer;
    })
    .catch((error) => {
      const circuit = openRuntimeCircuit(error);
      const fallbackPointer = getCachedRuntimePointer(options);
      if (fallbackPointer) {
        return Object.assign({}, fallbackPointer, {
          fallback: true,
          fallbackReason: error && (error.code || error.reasonCode || error.errMsg || error.message || "networkError"),
          circuitOpen: Boolean(circuit),
        });
      }
      throw error;
    })
    .finally(() => {
      runtimePointerInflight = null;
    });
  runtimePointerInflight = task;
  return task;
}

function scanLastGood(options = {}) {
  const term = options.term || "";
  return getStorageKeys()
    .filter((key) => key.startsWith(`${CACHE_PREFIX}:last-good:`))
    .map((key) => readStorage(key))
    .filter(Boolean)
    .filter((item) => {
      if (!term) return true;
      const manifest = normalizeManifest(item.manifest || item);
      return manifest && manifest.term === term;
    })
    .sort((left, right) => Number(right.savedAt || 0) - Number(left.savedAt || 0))[0] || null;
}

function getLastKnownGood(term) {
  const requestedTerm = term || DEFAULT_TERM;
  if (!requestedTerm) return null;
  let cached = readStorage(getLastGoodCacheKey(requestedTerm));
  if (!cached) {
    const legacy = readStorage(getLegacyLastGoodCacheKey(requestedTerm));
    const legacyManifest = normalizeManifest(legacy && (legacy.manifest || legacy));
    if (legacyManifest && legacyManifest.term === requestedTerm) {
      cached = Object.assign({}, legacy, { manifest: legacyManifest });
      writeStorage(getLastGoodCacheKey(requestedTerm), cached);
    }
  }
  if (!cached) return null;
  const manifest = normalizeManifest(cached.manifest || cached);
  if (!manifest || manifest.term !== requestedTerm) return null;
  return {
    savedAt: cached.savedAt || 0,
    term: manifest.term,
    releaseVersion: manifest.releaseVersion,
    cacheEpoch: manifest.cacheEpoch,
    forceRefreshToken: manifest.forceRefreshToken,
    releaseKey: getManifestReleaseKey(manifest),
    manifest,
  };
}

function pickReleaseVersion(source) {
  if (!source || typeof source !== "object") return "";
  const data = source.data || source;
  const version = data.dataVersion || data.versionData || {};
  return data.releaseVersion ||
    data.activeReleaseVersion ||
    data.version ||
    version.releaseVersion ||
    version.activeReleaseVersion ||
    (data.versions && (data.versions.snapshot || data.versions.releaseVersion)) ||
    "";
}

function readCachedBootstrap() {
  return readStorage(BOOTSTRAP_CACHE_KEY) || null;
}

function getKnownReleaseCandidate(options = {}) {
  const term = options.term || DEFAULT_TERM;
  const explicit = options.releaseVersion || options.version || pickReleaseVersion(options.manifest);
  const explicitManifest = normalizeManifest(options.manifest);
  if (explicit && (!explicitManifest || explicitManifest.term === term)) return String(explicit);

  const cachedConfig = appConfigService.getCachedAppConfig && appConfigService.getCachedAppConfig();
  const configData = cachedConfig && cachedConfig.data ? cachedConfig.data : cachedConfig;
  const configTerm = configData && (configData.term || configData.currentSemester || configData.termConfig && configData.termConfig.term);
  const configVersion = configTerm === term ? pickReleaseVersion(cachedConfig) : "";
  if (configVersion) return String(configVersion);

  const cachedBootstrap = readCachedBootstrap();
  const bootstrapVersion = pickReleaseVersion(cachedBootstrap);
  const bootstrapTerm = cachedBootstrap && (cachedBootstrap.term || cachedBootstrap.semester);
  if (bootstrapVersion && bootstrapTerm === term) return String(bootstrapVersion);

  const platformSnapshot = platformDataService.getCachedPlatformSnapshot && platformDataService.getCachedPlatformSnapshot();
  if (platformSnapshot && platformSnapshot.term === term && platformSnapshot.releaseVersion) return String(platformSnapshot.releaseVersion);

  const localActive = getLocalActiveRelease(term);
  if (localActive && localActive.releaseVersion) return String(localActive.releaseVersion);

  const cachedManifest = readCachedManifest(term);
  if (cachedManifest && cachedManifest.releaseVersion) return String(cachedManifest.releaseVersion);

  return "";
}

function resolveStaticManifestUrl(releaseVersion) {
  return releaseVersion ? joinUrl(STATIC_RELEASE_BASE_URL || joinUrl(API_BASE_URL, "static/releases"), releaseVersion, "manifest.json") : "";
}

function getLocalActiveRelease(term) {
  const requestedTerm = term || DEFAULT_TERM;
  if (!requestedTerm) return null;
  let active = readStorage(getLocalActiveReleaseKey(requestedTerm));
  if (!active) {
    active = readStorage(getLegacyLocalActiveReleaseKey()) || readStorage(LOCAL_ACTIVE_RELEASE_KEY);
    const legacyManifest = normalizeManifest(active && active.manifest);
    if (legacyManifest && legacyManifest.term === requestedTerm) {
      writeStorage(getLocalActiveReleaseKey(requestedTerm), active);
    }
  }
  const manifest = normalizeManifest(active && active.manifest);
  if (manifest && manifest.term === requestedTerm) {
    return {
      savedAt: active.savedAt || 0,
      term: manifest.term,
      releaseVersion: manifest.releaseVersion,
      cacheEpoch: manifest.cacheEpoch,
      forceRefreshToken: manifest.forceRefreshToken,
      releaseKey: active.releaseKey || getManifestReleaseKey(manifest),
      manifest,
    };
  }
  return getLastKnownGood(requestedTerm);
}

function normalizeIndexPayload(type, payload, fallback = {}) {
  const source = payload && payload.data ? payload.data : payload;
  const sourceItems = Array.isArray(source) ? source : source && source.items;
  if (!source || source.success === false || !Array.isArray(sourceItems)) {
    const error = new Error("INVALID_RELEASE_PACK_INDEX");
    error.code = "INVALID_RELEASE_PACK_INDEX";
    throw error;
  }
  const releaseVersion = source.releaseVersion || source.version || fallback.releaseVersion || "";
  const term = source.term || source.semester || fallback.term || DEFAULT_TERM;
  assertTermMatch(term, fallback.term || "", "INDEX_TERM_MISMATCH");
  return Object.assign({}, Array.isArray(source) ? {} : source, {
    success: true,
    type,
    term,
    semester: source.semester || term,
    releaseVersion,
    version: source.version || releaseVersion,
    total: Number(source.total || sourceItems.length) || sourceItems.length,
    items: sourceItems,
  });
}

function readCachedIndex(type, options = {}) {
  const term = options.term || DEFAULT_TERM;
  const releaseVersion = options.releaseVersion || options.version || "";
  if (!releaseVersion) return null;
  const cached = readStorage(getIndexCacheKey(term, releaseVersion, type));
  if (!cached || Date.now() - Number(cached.savedAt || 0) > INDEX_CACHE_TTL) return null;
  try {
    return markFromStorage(normalizeIndexPayload(type, cached.data || cached, { term, releaseVersion }));
  } catch (error) {
    return null;
  }
}

function writeIndexCache(type, payload) {
  const normalized = normalizeIndexPayload(type, payload);
  writeStorage(getIndexCacheKey(normalized.term, normalized.releaseVersion, type), {
    savedAt: Date.now(),
    data: normalized,
  });
  return normalized;
}

function fetchManifest(options = {}) {
  const expectedTerm = options.term || DEFAULT_TERM;
  const releaseVersion = getKnownReleaseCandidate(options);
  const query = {};
  if (releaseVersion) {
    query.releaseVersion = releaseVersion;
  }
  const requestOptions = {
    showLoading: false,
    silentError: true,
    timeout: options.timeout || 8000,
    retries: options.retries === undefined ? 1 : options.retries,
    skipSession: options.skipSession === true,
    suppressWarn: options.suppressWarn === true,
  };
  const staticUrl = resolveStaticManifestUrl(releaseVersion);
  if (expectedTerm) query.term = expectedTerm;
  const loadDynamic = () => request.get("/api/fosu/release-pack/manifest", query, requestOptions)
    .then((payload) => {
      const manifest = assertManifest(normalizeManifest(payload));
      assertTermMatch(manifest.term, expectedTerm, "MANIFEST_TERM_MISMATCH");
      manifest.activeTerm = payload && (payload.activeTerm || payload.term);
      if (!expectedTerm || manifest.activeTerm === manifest.term) manifest.isActive = true;
      return manifest;
    });
  if (!staticUrl) {
    return loadDynamic();
  }
  return request.get(staticUrl, {}, requestOptions)
    .then((payload) => {
      const manifest = assertManifest(normalizeManifest(payload));
      assertTermMatch(manifest.term, expectedTerm, "MANIFEST_TERM_MISMATCH");
      manifest.activeTerm = payload && (payload.activeTerm || payload.term);
      if (!expectedTerm || manifest.activeTerm === manifest.term) manifest.isActive = true;
      return manifest;
    })
    .catch((staticError) => loadDynamic().catch(() => {
      throw staticError;
    }));
}

function getActiveManifest(options = {}) {
  const cached = readCachedManifest(options.term || DEFAULT_TERM);
  if (cached && !options.forceNetwork) {
    return Promise.resolve(cached);
  }
  const key = inflightKey(options);
  if (options.dedupe !== false && activeManifestInflight.has(key)) {
    return activeManifestInflight.get(key);
  }
  const promise = fetchManifest(options)
    .then((manifest) => writeManifestCache(manifest))
    .catch((error) => {
      const fallback = cached || (getLastKnownGood(options.term || DEFAULT_TERM) || {}).manifest;
      if (fallback) {
        return markFromStorage(fallback, {
          fallback: true,
          fallbackReason: error && (error.code || error.reasonCode || error.errMsg || error.message || "networkError"),
        });
      }
      throw error;
    })
    .finally(() => {
      activeManifestInflight.delete(key);
    });
  activeManifestInflight.set(key, promise);
  return promise;
}

function resolveManifest(options = {}) {
  const normalized = normalizeManifest(options.manifest);
  if (normalized) return Promise.resolve(normalized);
  return getActiveManifest(options);
}

function loadIndex(type, params = {}, options = {}) {
  if (!INDEX_TYPES.includes(type)) {
    const error = new Error("INVALID_RELEASE_PACK_INDEX_TYPE");
    error.code = "INVALID_RELEASE_PACK_INDEX_TYPE";
    return Promise.reject(error);
  }
  const manifest = normalizeManifest(options.manifest || params.manifest);
  const term = params.term || params.semester || options.term || (manifest && manifest.term) || DEFAULT_TERM;
  const releaseVersion = params.releaseVersion || params.version || options.releaseVersion || (manifest && manifest.releaseVersion) || "";
  const cached = readCachedIndex(type, { term, releaseVersion });
  if (cached && !options.forceNetwork) {
    return Promise.resolve(cached);
  }
  if (!releaseVersion) {
    return resolveManifest({ term, forceNetwork: options.forceNetwork }).then((nextManifest) => {
      return loadIndex(type, Object.assign({}, params, {
        term: nextManifest.term,
        releaseVersion: nextManifest.releaseVersion,
      }), Object.assign({}, options, { manifest: nextManifest }));
    });
  }

  const cachedManifest = manifest || readCachedManifest(term);
  const manifestForUrl = cachedManifest && cachedManifest.releaseVersion === releaseVersion ? cachedManifest : { releaseVersion, term };
  const staticUrl = resolveIndexUrl(type, manifestForUrl, Object.assign({}, params, { term, releaseVersion }));
  const requestOptions = {
    showLoading: false,
    silentError: true,
    timeout: options.timeout || 25000,
    retries: options.retries === undefined ? 2 : options.retries,
    skipSession: options.skipSession === true,
  };
  const loadStatic = staticUrl
    ? request.get(staticUrl, {}, requestOptions)
    : Promise.reject(Object.assign(new Error("STATIC_RELEASE_URL_MISSING"), { code: "STATIC_RELEASE_URL_MISSING" }));

  return loadStatic
    .catch((staticError) => request.get(`/api/fosu/release-pack/index/${type}`, { term, releaseVersion }, requestOptions)
      .catch(() => {
        throw staticError;
      }))
    .then((payload) => {
      const normalized = normalizeIndexPayload(type, payload, { term, releaseVersion });
      const scopedStaticIndex = type === "class" && /\/index\/class\/by-(college|major)\//.test(staticUrl || "");
      return scopedStaticIndex ? normalized : writeIndexCache(type, normalized);
    })
    .catch((error) => {
      if (cached) {
        return markFromStorage(cached, {
          fallback: true,
          fallbackReason: error && (error.code || error.reasonCode || error.errMsg || error.message || "networkError"),
        });
      }
      if (options.allowLastKnownGood !== false && !options.skipFallback) {
        const lastGood = getLastKnownGood(term);
        if (lastGood && lastGood.releaseVersion && lastGood.releaseVersion !== releaseVersion) {
          return loadIndex(type, {
            term,
            releaseVersion: lastGood.releaseVersion,
          }, {
            allowLastKnownGood: false,
          }).then((payload) => markFromStorage(payload, {
            fallback: true,
            lastKnownGood: true,
            fallbackReason: error && (error.code || error.reasonCode || error.errMsg || error.message || "networkError"),
          }));
        }
      }
      throw error;
    });
}

function warmupIndex(types, options = {}) {
  const list = Array.isArray(types) ? types : INDEX_TYPES;
  const manifest = normalizeManifest(options.manifest) || null;
  return Promise.all(list.map((type) => loadIndex(type, {
    term: options.term || (manifest && manifest.term) || DEFAULT_TERM,
    releaseVersion: options.releaseVersion || (manifest && manifest.releaseVersion) || "",
  }, Object.assign({}, options, {
    manifest,
    forceNetwork: Boolean(options.forceNetwork),
    skipFallback: Boolean(options.skipFallback),
  })))).then((indexes) => {
    indexes.forEach((item, index) => {
      if (!item || item.success === false || !Array.isArray(item.items)) {
        const error = new Error(`INVALID_RELEASE_PACK_INDEX:${list[index]}`);
        error.code = "INVALID_RELEASE_PACK_INDEX";
        throw error;
      }
    });
    return indexes;
  });
}

function switchReleaseSafely(options = {}) {
  const key = inflightKey(options);
  if (options.dedupe !== false && switchReleaseInflight.has(key)) {
    return switchReleaseInflight.get(key);
  }
  const previous = getLocalActiveRelease(options.term || DEFAULT_TERM) || getLastKnownGood(options.term || DEFAULT_TERM);
  const promise = fetchManifest(options)
    .then((manifest) => {
      const sameRelease = previous && previous.manifest &&
        getManifestReleaseKey(previous.manifest) === getManifestReleaseKey(manifest);
      const warmupTypes = Array.isArray(options.warmupTypes) && options.warmupTypes.length
        ? options.warmupTypes
        : [];
      const finishSwitch = (indexes) => {
        const normalized = writeManifestCache(manifest);
        clearOldReleaseCaches({
          keepLatestN: options.keepLatestN || 2,
          keepReleases: [normalized.releaseVersion, previous && previous.releaseVersion].filter(Boolean),
        });
        return {
          success: true,
          switched: true,
          term: normalized.term,
          releaseVersion: normalized.releaseVersion,
          manifest: normalized,
          indexes: indexes || [],
        };
      };
      if (!warmupTypes.length || options.skipWarmup === true) {
        return finishSwitch([]);
      }
      return warmupIndex(warmupTypes, {
        manifest,
        term: manifest.term,
        releaseVersion: manifest.releaseVersion,
        forceNetwork: Boolean(options.forceNetwork && !sameRelease),
        skipFallback: true,
        skipSession: options.skipSession === true,
      }).then(finishSwitch);
    })
    .catch((error) => {
      if (previous && previous.manifest) {
        return {
          success: true,
          switched: false,
          fallback: true,
          fromStorage: true,
          term: previous.term,
          releaseVersion: previous.releaseVersion,
          manifest: previous.manifest,
          fallbackReason: error && (error.code || error.reasonCode || error.errMsg || error.message || "networkError"),
        };
      }
      throw error;
    })
    .finally(() => {
      switchReleaseInflight.delete(key);
    });
  switchReleaseInflight.set(key, promise);
  return promise;
}

function toComparableText(value) {
  return String(value == null ? "" : value).trim().toLowerCase();
}

function normalizeSearchText(value) {
  return String(value == null ? "" : value)
    .trim()
    .replace(/[\u3000\s]+/g, "")
    .replace(/[\uFF01-\uFF5E]/g, (char) => String.fromCharCode(char.charCodeAt(0) - 0xFEE0))
    .replace(/\u3002/g, ".")
    .toLowerCase();
}

function collectSearchFields(item) {
  const source = item || {};
  return [
    source.id,
    source.detailId,
    source.classroomId,
    source.roomId,
    source.name,
    source.displayName,
    source.title,
    source.teacherTitle,
    source.professionalTitle,
    source.rawName,
    source.searchableName,
    Array.isArray(source.keywords) ? source.keywords.join(" ") : source.keywords,
    source.className,
    source.teacherName,
    source.displayTeacherName,
    source.canonicalTeacherName,
    source.roomName,
    source.classroomName,
    source.courseName,
    source.displayCourseName,
    source.canonicalCourseName,
    source.collegeName,
    source.majorName,
    source.grade,
    source.firstCourseName,
  ];
}

function matchesExact(item, expected, keys) {
  const value = String(expected || "").trim();
  if (!value) return true;
  return keys.some((key) => {
    const current = String(item[key] || "").trim();
    return current === value || normalizeSearchText(current) === normalizeSearchText(value);
  });
}

function matchesScopedFilter(type, item, expected, keys, options = {}) {
  const value = String(expected || "").trim();
  if (!value) return true;
  const values = keys
    .map((key) => String(item[key] || "").trim())
    .filter(Boolean);
  if (!values.length && options.allowMissing) {
    return true;
  }
  return matchesExact(item, value, keys);
}

function getTeacherFilterDebug(index, params, q, scopedItems, filteredItems) {
  const baseItems = index.items || [];
  const term = params.semester || params.term;
  const collegeScoped = baseItems.filter((item) => {
    const comparable = Object.assign({
      term: index.term,
      semester: index.semester || index.term,
    }, item || {});
    if (!matchesScopedFilter("teacher", comparable, term, ["semester", "term"])) return false;
    if (!matchesScopedFilter("teacher", comparable, params.collegeCode, ["collegeCode"], { allowMissing: true })) return false;
    if (!matchesScopedFilter("teacher", comparable, params.collegeName, ["collegeName", "college"], { allowMissing: true })) return false;
    return true;
  });
  return {
    releaseVersion: index.releaseVersion || index.version || "",
    teacherIndexTotal: baseItems.length,
    keyword: String(params.q || params.keyword || ""),
    normalizedKeyword: q,
    beforeFilterCount: baseItems.length,
    collegeFilteredCount: collegeScoped.length,
    scopedFilterCount: scopedItems.length,
    keywordHitCount: filteredItems.length,
    sampleItems: filteredItems.slice(0, 5).map((item) => ({
      id: item.id || item.detailId || "",
      name: item.name || item.teacherName || item.displayName || "",
      teacherName: item.teacherName || item.name || "",
      collegeName: item.collegeName || item.college || "",
      title: item.title || item.teacherTitle || item.professionalTitle || "",
      courseCount: Number(item.courseCount || 0) || 0,
    })),
  };
}

function filterIndexPayload(type, payload, params = {}) {
  const index = normalizeIndexPayload(type, payload);
  const q = normalizeSearchText(params.q || params.keyword);
  const limit = Math.min(Math.max(parseInt(params.limit || "30", 10) || 30, 1), 100);
  const offset = Math.max(parseInt(params.offset || "0", 10) || 0, 0);
  const teacherLooseFilter = type === "teacher";
  const scoped = (index.items || []).filter((item) => {
    const comparable = Object.assign({
      term: index.term,
      semester: index.semester || index.term,
    }, item || {});
    if (!matchesScopedFilter(type, comparable, params.semester || params.term, ["semester", "term"])) return false;
    if (!matchesScopedFilter(type, comparable, params.collegeCode, ["collegeCode"], { allowMissing: teacherLooseFilter })) return false;
    if (!matchesScopedFilter(type, comparable, params.collegeName, ["collegeName", "college"], { allowMissing: teacherLooseFilter })) return false;
    if (!matchesScopedFilter(type, comparable, params.grade, ["grade"])) return false;
    if (!matchesScopedFilter(type, comparable, params.majorCode, ["majorCode"])) return false;
    if (!matchesScopedFilter(type, comparable, params.majorName, ["majorName"])) return false;
    if (!matchesScopedFilter(type, comparable, params.campus, ["campus", "campusName"])) return false;
    if (!matchesScopedFilter(type, comparable, params.titleCode || params.title, ["titleCode", "title", "teacherTitle", "professionalTitle"], { allowMissing: teacherLooseFilter })) return false;
    return true;
  });
  const filtered = q
    ? scoped.filter((item) => {
        const haystack = normalizeSearchText(collectSearchFields(item).join(" "));
        return haystack.includes(q);
      })
    : scoped;
  const debug = type === "teacher"
    ? getTeacherFilterDebug(index, params, q, scoped, filtered)
    : undefined;
  return Object.assign({}, index, {
    query: q,
    total: filtered.length,
    limit,
    offset,
    items: filtered.slice(offset, offset + limit),
  }, debug ? { debug } : {});
}

function readCachedSearchIndex(type, params = {}) {
  const term = params.term || params.semester || DEFAULT_TERM;
  const releaseVersion = params.releaseVersion || params.version || "";
  const cached = readCachedIndex(type, { term, releaseVersion });
  if (!cached) return null;
  return filterIndexPayload(type, cached, params);
}

function searchIndex(type, params = {}, options = {}) {
  return loadIndex(type, params, options)
    .then((payload) => filterIndexPayload(type, payload, params));
}

function normalizeDetailPayload(type, id, payload, fallback = {}) {
  const source = payload && payload.data ? payload.data : payload;
  if (!source || source.success === false) {
    const error = new Error("INVALID_RELEASE_PACK_DETAIL");
    error.code = "INVALID_RELEASE_PACK_DETAIL";
    throw error;
  }
  const schedule = source.detail || source.schedule ||
    (type === "class" && Array.isArray(source.classes) ? source.classes[0] : null) ||
    (type === "teacher" && Array.isArray(source.teachers) ? source.teachers[0] : null) ||
    (type === "classroom" && Array.isArray(source.classrooms) ? source.classrooms[0] : null) ||
    (type === "course" && Array.isArray(source.coursesList) ? source.coursesList[0] : null) ||
    (Array.isArray(source.courses) ? source : null) ||
    null;
  if (!schedule) {
    const error = new Error("RELEASE_PACK_DETAIL_NOT_FOUND");
    error.code = "RELEASE_PACK_DETAIL_NOT_FOUND";
    throw error;
  }
  const releaseVersion = source.releaseVersion || source.version || fallback.releaseVersion || "";
  const term = source.term || source.semester || schedule.term || schedule.semester || fallback.term || DEFAULT_TERM;
  assertTermMatch(term, fallback.term || "", "DETAIL_TERM_MISMATCH");
  return Object.assign({}, source, {
    success: true,
    type,
    id: source.id || id,
    term,
    semester: source.semester || term,
    releaseVersion,
    version: source.version || releaseVersion,
    detail: schedule,
    schedule,
  });
}

function readCachedDetail(type, id, options = {}) {
  const term = options.term || options.semester || DEFAULT_TERM;
  const releaseVersion = options.releaseVersion || options.version || "";
  if (!releaseVersion || !id) return null;
  const cached = readStorage(getDetailCacheKey(term, releaseVersion, type, id));
  if (!cached || Date.now() - Number(cached.savedAt || 0) > DETAIL_CACHE_TTL) return null;
  try {
    return markFromStorage(normalizeDetailPayload(type, id, cached.data || cached, { term, releaseVersion }));
  } catch (error) {
    return null;
  }
}

function writeDetailCache(type, id, payload) {
  const normalized = normalizeDetailPayload(type, id, payload);
  writeStorage(getDetailCacheKey(normalized.term, normalized.releaseVersion, type, normalized.id || id), {
    savedAt: Date.now(),
    data: normalized,
  });
  return normalized;
}

function loadDetail(type, id, params = {}, options = {}) {
  const term = params.term || params.semester || options.term || DEFAULT_TERM;
  const releaseVersion = params.releaseVersion || params.version || options.releaseVersion || "";
  if (!type || !id) {
    const error = new Error("INVALID_RELEASE_PACK_DETAIL_TARGET");
    error.code = "INVALID_RELEASE_PACK_DETAIL_TARGET";
    return Promise.reject(error);
  }
  const cached = readCachedDetail(type, id, { term, releaseVersion });
  if (cached && !options.forceNetwork) {
    return Promise.resolve(cached);
  }
  if (!releaseVersion) {
    return resolveManifest({ term, forceNetwork: options.forceNetwork }).then((manifest) => {
      return loadDetail(type, id, Object.assign({}, params, {
        term: manifest.term,
        releaseVersion: manifest.releaseVersion,
      }), options);
    });
  }
  const cachedManifest = readCachedManifest(term);
  const manifestForUrl = cachedManifest && cachedManifest.releaseVersion === releaseVersion ? cachedManifest : { releaseVersion, term };
  const staticUrl = resolveDetailUrl(type, id, manifestForUrl, { term, releaseVersion });
  const requestOptions = {
    showLoading: false,
    silentError: true,
    timeout: options.timeout || 20000,
    retries: options.retries === undefined ? 2 : options.retries,
    skipSession: options.skipSession === true,
  };
  const loadStatic = staticUrl
    ? request.get(staticUrl, {}, requestOptions)
    : Promise.reject(Object.assign(new Error("STATIC_RELEASE_URL_MISSING"), { code: "STATIC_RELEASE_URL_MISSING" }));
  return loadStatic
    .catch((staticError) => {
      if (!type || !id || !releaseVersion) {
        throw staticError;
      }
      return request.get("/api/fosu/schedule-detail", {
        term,
        type,
        id,
        releaseVersion,
      }, requestOptions).catch(() => {
        throw staticError;
      });
    })
    .then((payload) => writeDetailCache(type, id, normalizeDetailPayload(type, id, payload, { term, releaseVersion })))
    .catch((error) => {
      if (cached) {
        return markFromStorage(cached, {
          fallback: true,
          fallbackReason: error && (error.code || error.reasonCode || error.errMsg || error.message || "networkError"),
        });
      }
      throw error;
    });
}

function getClassroomCandidateNames(item) {
  const source = item || {};
  return [
    source.roomName,
    source.classroomName,
    source.displayName,
    source.name,
    source.title,
    source.rawName,
    source.id,
    source.detailId,
    source.classroomId,
    source.roomId,
  ].filter((value) => String(value || "").trim());
}

function getClassroomDetailId(item) {
  const source = item || {};
  return String(source.detailId || source.id || source.classroomId || source.roomId || "").trim();
}

function findClassroomIndexItem(items, roomName) {
  const q = normalizeSearchText(roomName);
  if (!q) return null;
  const list = Array.isArray(items) ? items : [];
  return list.find((item) => getClassroomCandidateNames(item)
    .some((name) => normalizeSearchText(name) === q)) ||
    list.find((item) => getClassroomCandidateNames(item)
      .some((name) => normalizeSearchText(name).includes(q) || q.includes(normalizeSearchText(name))));
}

function resolveClassroomDetail(roomName, params = {}, options = {}) {
  const term = params.term || params.semester || options.term || DEFAULT_TERM;
  const releaseVersion = params.releaseVersion || params.version || options.releaseVersion || "";
  const requestedName = roomName || params.roomName || params.name || "";
  const preferredId = String(params.detailId || params.id || params.classroomId || "").trim();
  if (!requestedName && !preferredId) {
    const error = new Error("CLASSROOM_RESOLVE_TARGET_MISSING");
    error.code = "CLASSROOM_RESOLVE_TARGET_MISSING";
    return Promise.reject(error);
  }

  const loadResolvedDetail = (detailId, item) => {
    if (!detailId) {
      const error = new Error("CLASSROOM_DETAIL_ID_MISSING");
      error.code = "CLASSROOM_DETAIL_ID_MISSING";
      throw error;
    }
    return loadDetail("classroom", detailId, { term, releaseVersion }, options)
      .then((payload) => Object.assign({}, payload, {
        detailId,
        resolvedId: detailId,
        resolvedName: requestedName || item?.roomName || item?.name || "",
        indexItem: item || null,
      }));
  };

  const resolveFromIndex = () => loadIndex("classroom", { term, releaseVersion }, options)
    .then((index) => {
      const item = findClassroomIndexItem(index.items || [], requestedName || preferredId);
      if (!item) {
        const error = new Error("CLASSROOM_DETAIL_NOT_FOUND");
        error.code = "CLASSROOM_DETAIL_NOT_FOUND";
        throw error;
      }
      return loadResolvedDetail(getClassroomDetailId(item), item);
    });

  if (preferredId && normalizeSearchText(preferredId) !== normalizeSearchText(requestedName)) {
    return loadResolvedDetail(preferredId, null).catch(resolveFromIndex);
  }
  return resolveFromIndex();
}

function normalizeEmptyRoomIndex(payload, fallback = {}) {
  const source = payload && payload.data ? payload.data : payload;
  if (!source || source.success === false || !Array.isArray(source.rooms)) {
    const error = new Error("INVALID_RELEASE_PACK_EMPTY_ROOM");
    error.code = "INVALID_RELEASE_PACK_EMPTY_ROOM";
    throw error;
  }
  const releaseVersion = source.releaseVersion || source.version || fallback.releaseVersion || "";
  const term = source.term || source.semester || fallback.term || DEFAULT_TERM;
  assertTermMatch(term, fallback.term || "", "EMPTY_ROOM_TERM_MISMATCH");
  return Object.assign({}, source, {
    success: true,
    term,
    semester: source.semester || term,
    releaseVersion,
    version: source.version || releaseVersion,
    buildings: Array.isArray(source.buildings) ? source.buildings : [],
    rooms: source.rooms,
  });
}

function readCachedEmptyRoom(options = {}) {
  const term = options.term || options.semester || DEFAULT_TERM;
  const releaseVersion = options.releaseVersion || options.version || "";
  if (!releaseVersion) return null;
  const cached = readStorage(getEmptyRoomCacheKey(term, releaseVersion));
  if (!cached || Date.now() - Number(cached.savedAt || 0) > EMPTY_ROOM_CACHE_TTL) return null;
  try {
    return markFromStorage(normalizeEmptyRoomIndex(cached.data || cached, { term, releaseVersion }));
  } catch (error) {
    return null;
  }
}

function writeEmptyRoomCache(payload) {
  const normalized = normalizeEmptyRoomIndex(payload);
  writeStorage(getEmptyRoomCacheKey(normalized.term, normalized.releaseVersion), {
    savedAt: Date.now(),
    data: normalized,
  });
  return normalized;
}

function loadEmptyRoom(params = {}, options = {}) {
  const term = params.term || params.semester || options.term || DEFAULT_TERM;
  const releaseVersion = params.releaseVersion || params.version || options.releaseVersion || "";
  const cached = readCachedEmptyRoom({ term, releaseVersion });
  if (cached && !options.forceNetwork) {
    return Promise.resolve(cached);
  }
  if (!releaseVersion) {
    return resolveManifest({ term, forceNetwork: options.forceNetwork }).then((manifest) => {
      return loadEmptyRoom(Object.assign({}, params, {
        term: manifest.term,
        releaseVersion: manifest.releaseVersion,
      }), options);
    });
  }
  const cachedManifest = readCachedManifest(term);
  const manifestForUrl = cachedManifest && cachedManifest.releaseVersion === releaseVersion ? cachedManifest : { releaseVersion, term };
  const staticUrl = resolveEmptyRoomUrl(manifestForUrl, { term, releaseVersion });
  const requestOptions = {
    showLoading: false,
    silentError: true,
    timeout: options.timeout || 25000,
    retries: options.retries === undefined ? 2 : options.retries,
    skipSession: options.skipSession === true,
  };
  const loadStatic = staticUrl
    ? request.get(staticUrl, {}, requestOptions)
    : Promise.reject(Object.assign(new Error("STATIC_RELEASE_URL_MISSING"), { code: "STATIC_RELEASE_URL_MISSING" }));
  return loadStatic
    .catch((staticError) => request.get("/api/fosu/release-pack/empty-room", { term, releaseVersion }, requestOptions)
      .catch(() => {
        throw staticError;
      }))
    .then((payload) => writeEmptyRoomCache(normalizeEmptyRoomIndex(payload, { term, releaseVersion })))
    .catch((error) => {
      if (cached) {
        return markFromStorage(cached, {
          fallback: true,
          fallbackReason: error && (error.code || error.reasonCode || error.errMsg || error.message || "networkError"),
        });
      }
      throw error;
    });
}

function toInteger(value) {
  if (typeof value === "number" && Number.isFinite(value)) return Math.trunc(value);
  const match = String(value == null ? "" : value).match(/\d+/);
  return match ? parseInt(match[0], 10) : NaN;
}

function uniqueNumbers(values, min, max) {
  const seen = new Set();
  const result = [];
  (values || []).forEach((value) => {
    const num = toInteger(value);
    if (Number.isFinite(num) && num >= min && num <= max && !seen.has(num)) {
      seen.add(num);
      result.push(num);
    }
  });
  return result.sort((left, right) => left - right);
}

function rangeNumbers(start, end, min, max) {
  const first = toInteger(start);
  const last = toInteger(end);
  if (!Number.isFinite(first)) return [];
  const low = Number.isFinite(last) ? Math.min(first, last) : first;
  const high = Number.isFinite(last) ? Math.max(first, last) : first;
  const values = [];
  for (let value = low; value <= high; value += 1) values.push(value);
  return uniqueNumbers(values, min, max);
}

function allSections() {
  return rangeNumbers(1, MAX_EMPTY_ROOM_SECTION, 1, MAX_EMPTY_ROOM_SECTION);
}

function normalizeQuerySections(value) {
  const text = String(value || "").trim();
  if (!text) return [];
  const rangeMatch = text.match(/(\d+)\s*[-~～至到]\s*(\d+)/);
  if (rangeMatch) {
    return rangeNumbers(rangeMatch[1], rangeMatch[2], 1, MAX_EMPTY_ROOM_SECTION);
  }
  return uniqueNumbers(text.split(/[,\s，、]+/), 1, MAX_EMPTY_ROOM_SECTION);
}

function sectionsOverlapValues(left, right) {
  const set = new Set(left || []);
  return (right || []).some((section) => set.has(section));
}

function differenceSections(occupied) {
  const occupiedSet = new Set(occupied || []);
  return allSections().filter((section) => !occupiedSet.has(section));
}

function hasContiguousSections(sections, minCount) {
  const min = Math.max(1, Number(minCount) || 1);
  if (min <= 1) return sections.length > 0;
  let run = 0;
  for (const section of allSections()) {
    if ((sections || []).includes(section)) {
      run += 1;
      if (run >= min) return true;
    } else {
      run = 0;
    }
  }
  return false;
}

function longestContiguousRun(sections) {
  const set = new Set(sections || []);
  let best = 0;
  let run = 0;
  for (const section of allSections()) {
    if (set.has(section)) {
      run += 1;
      best = Math.max(best, run);
    } else {
      run = 0;
    }
  }
  return best;
}

function inferBuilding(roomName) {
  const normalized = normalizeBuilding(roomName);
  return normalized.unknown ? UNKNOWN_BUILDING_NAME : normalized.buildingCode;
}

function formatSectionRange(sections) {
  const list = uniqueNumbers(sections, 1, MAX_EMPTY_ROOM_SECTION);
  if (!list.length) return "";
  return list.length === 1 ? `第${list[0]}节` : `第${list[0]}-${list[list.length - 1]}节`;
}

function getNextOccupiedCourse(courses, weekday, week, afterSection) {
  const next = (courses || [])
    .filter((course) => Number(course.weekday) === Number(weekday))
    .filter((course) => Array.isArray(course.weeks) ? course.weeks.includes(Number(week)) : true)
    .filter((course) => Number(course.startSection) > Number(afterSection))
    .sort((left, right) => Number(left.startSection) - Number(right.startSection))[0];
  if (!next) return null;
  return {
    courseName: next.courseName || "",
    teacherName: next.teacherName || "",
    sections: next.sections || [],
    sectionText: `第${next.startSection}-${next.endSection}节`,
  };
}

function filterEmptyRoomIndex(indexPayload, params = {}) {
  const index = normalizeEmptyRoomIndex(indexPayload);
  const weekday = Number(params.weekday || 1);
  const week = Math.max(1, Math.min(MAX_EMPTY_ROOM_WEEK, Number(params.week || 1) || 1));
  const requestedSections = normalizeQuerySections(params.sections || params.section || "1-2");
  const building = String(params.building || "").trim();
  const minFreeSections = Math.max(1, Number(params.minFreeSections || 1) || 1);
  const excludeUnknown = params.excludeUnknown === true || params.excludeUnknown === "1" || params.excludeUnknown === "true";
  const commonOnly = params.commonOnly === true || params.commonOnly === "1" || params.commonOnly === "true";
  const normalizedBuilding = building && building !== "全部" ? building.toLowerCase() : "";
  const buildingPriority = ["C7", "B8", "B5", "会通楼", "致用楼"];
  const requestedSet = requestedSections.length ? requestedSections : allSections();
  const maxRequestedSection = requestedSet[requestedSet.length - 1] || 0;
  const rooms = (index.rooms || []).filter((room) => {
    if (excludeUnknown && (!room.roomName || room.roomName.includes("未知") || room.building === "未知")) return false;
    if (commonOnly && !/[A-Za-z]\d|楼/.test(room.roomName || "")) return false;
    if (normalizedBuilding) {
      const buildingText = String(room.building || "").toLowerCase();
      const roomText = String(room.roomName || "").toLowerCase();
      if (buildingText !== normalizedBuilding && !roomText.includes(normalizedBuilding)) return false;
    }
    return true;
  }).map((room) => {
    const occupiedCourses = (room.courses || [])
      .filter((course) => Number(course.weekday) === weekday)
      .filter((course) => Array.isArray(course.weeks) ? course.weeks.includes(week) : true);
    const occupiedSections = uniqueNumbers(
      occupiedCourses.reduce((list, course) => list.concat(course.sections || []), []),
      1,
      MAX_EMPTY_ROOM_SECTION
    );
    const freeSections = differenceSections(occupiedSections);
    const requestedIsFree = !sectionsOverlapValues(occupiedSections, requestedSet);
    const continuousFreeSections = longestContiguousRun(freeSections);
    const enoughFree = requestedSections.length
      ? continuousFreeSections >= minFreeSections
      : hasContiguousSections(freeSections, minFreeSections);
    const detailId = room.detailId || room.classroomId || room.roomId || "";
    const courseCount = Number(room.courseCount || 0) || 0;
    const hasScheduleDetail = room.hasScheduleDetail !== false && Boolean(detailId);
    return {
      roomName: room.roomName,
      roomId: room.roomId,
      detailId,
      classroomId: room.classroomId || detailId,
      normalizedRoomName: room.normalizedRoomName || normalizeSearchText(room.roomName),
      building: room.building || inferBuilding(room.roomName),
      buildingCode: room.buildingCode || normalizeBuilding(room.roomName).buildingCode,
      buildingName: room.buildingName || normalizeBuilding(room.roomName).buildingName,
      campus: room.campus || normalizeBuilding(room.roomName).campus || "",
      confidence: room.confidence == null ? normalizeBuilding(room.roomName).confidence : room.confidence,
      source: room.source || "",
      capacity: room.capacity || null,
      capacityText: room.capacity ? `${room.capacity}座` : "容量未知",
      freeText: `${formatSectionRange(requestedSet)}空闲`,
      sectionChips: requestedSet.slice(0, 8).map((section) => `第${section}节`),
      continuousFreeSections,
      continuousText: `连续 ${continuousFreeSections} 节空闲`,
      freeSections,
      occupiedSections,
      todayCourses: occupiedCourses.map((course) => ({
        courseName: course.courseName || "",
        teacherName: course.teacherName || "",
        sections: course.sections || [],
        sectionText: `第${course.startSection}-${course.endSection}节`,
      })),
      courseCount,
      hasScheduleDetail,
      scheduleBadgeText: hasScheduleDetail ? "课表" : "仅空闲数据",
      nextOccupiedCourse: getNextOccupiedCourse(occupiedCourses, weekday, week, maxRequestedSection),
      _matched: requestedIsFree && enoughFree,
    };
  }).filter((room) => room._matched)
    .map((room) => {
      const copy = Object.assign({}, room);
      delete copy._matched;
      return copy;
    })
    .sort((left, right) => {
      const continuousDiff = Number(right.continuousFreeSections || 0) - Number(left.continuousFreeSections || 0);
      if (continuousDiff !== 0) return continuousDiff;
      const leftPriority = buildingPriority.indexOf(left.building);
      const rightPriority = buildingPriority.indexOf(right.building);
      const normalizedLeftPriority = leftPriority >= 0 ? leftPriority : 999;
      const normalizedRightPriority = rightPriority >= 0 ? rightPriority : 999;
      if (normalizedLeftPriority !== normalizedRightPriority) return normalizedLeftPriority - normalizedRightPriority;
      return String(left.roomName || "").localeCompare(String(right.roomName || ""), "zh-CN", { numeric: true });
    });

  return Object.assign({}, index, {
    query: {
      term: params.term || index.term || index.semester || "",
      releaseVersion: index.releaseVersion || index.version || "",
      date: params.date || "",
      week,
      weekday,
      sections: requestedSections.length ? requestedSections.join("-") : "all",
      building: building || "全部",
      minFreeSections,
      excludeUnknown,
      commonOnly,
    },
    total: rooms.length,
    rooms,
  });
}

function queryEmptyRooms(params = {}, options = {}) {
  return loadEmptyRoom(params, options).then((index) => filterEmptyRoomIndex(index, params));
}

function getVersionFromCacheKey(key) {
  const parts = String(key || "").split(":");
  if (parts[0] !== "fosu" || (parts[1] !== "v6" && parts[1] !== "v5")) return "";
  if (parts[2] === "index" || parts[2] === "detail" || parts[2] === "empty-room") {
    return decodeURIComponent(parts[4] || "");
  }
  return "";
}

function clearOldReleaseCaches(options = {}) {
  const keep = new Set(options.keepReleases || []);
  const keepLatestN = Math.max(1, Number(options.keepLatestN || 2) || 2);
  const versionStats = new Map();
  getStorageKeys().forEach((key) => {
    if (!key.startsWith(`${CACHE_PREFIX}:`)) return;
    const version = getVersionFromCacheKey(key);
    if (!version) return;
    const cached = readStorage(key) || {};
    const current = versionStats.get(version) || 0;
    versionStats.set(version, Math.max(current, Number(cached.savedAt || 0)));
  });
  const lastGood = getLastKnownGood(options.term || "");
  if (lastGood && lastGood.releaseVersion) keep.add(lastGood.releaseVersion);
  Array.from(versionStats.entries())
    .sort((left, right) => Number(right[1] || 0) - Number(left[1] || 0))
    .slice(0, keepLatestN)
    .forEach(([version]) => keep.add(version));

  let removed = 0;
  getStorageKeys().forEach((key) => {
    if (!key.startsWith(`${CACHE_PREFIX}:`)) return;
    const version = getVersionFromCacheKey(key);
    if (version && !keep.has(version)) {
      removeStorage(key);
      removed += 1;
    }
  });
  return { removed, keepReleases: Array.from(keep) };
}

module.exports = {
  CACHE_PREFIX,
  DEFAULT_TERM,
  LOCAL_ACTIVE_RELEASE_KEY,
  RUNTIME_POINTER_CIRCUIT_KEY,
  getLocalActiveReleaseKey,
  getManifestCacheKey,
  getIndexCacheKey,
  getDetailCacheKey,
  getEmptyRoomCacheKey,
  getLastGoodCacheKey,
  getManifestReleaseKey,
  getLocalActiveRelease,
  resolveRuntimePointer,
  getActiveManifest,
  loadEmptyRoom,
  filterEmptyRoomIndex,
  loadIndex,
  loadDetail,
  loadEmptyRoom,
  queryEmptyRooms,
  readCachedIndex,
  readCachedSearchIndex,
  readCachedDetail,
  readCachedEmptyRoom,
  searchIndex,
  resolveClassroomDetail,
  warmupIndex,
  switchReleaseSafely,
  getLastKnownGood,
  getCachedRuntimePointer,
  readRuntimeCircuit,
  openRuntimeCircuit,
  clearRuntimeCircuit,
  clearOldReleaseCaches,
  filterIndexPayload,
  filterEmptyRoomIndex,
  normalizeSearchText,
  resolveIndexUrl,
  resolveDetailUrl,
  resolveEmptyRoomUrl,
  getManifestStaticBaseUrl,
};
