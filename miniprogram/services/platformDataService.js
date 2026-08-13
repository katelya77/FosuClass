const request = require("../utils/request");

const PLATFORM_PREFETCH_CACHE_KEY = "FOSU_PLATFORM_PREFETCH_DATA";
const PLATFORM_PERIODIC_CACHE_KEY = "FOSU_PLATFORM_PERIODIC_DATA";
const PERIODIC_CACHE_TTL_MS = 10 * 60 * 1000;
const PERIODIC_BACKGROUND_TIMEOUT_MS = 6000;

let periodicInflight = null;

function parseFetchedData(raw) {
  if (!raw) return null;
  if (typeof raw === "object") return raw;
  try {
    return JSON.parse(String(raw));
  } catch (error) {
    return null;
  }
}

function readBackgroundFetchData(fetchType) {
  return new Promise((resolve) => {
    if (typeof wx === "undefined" || typeof wx.getBackgroundFetchData !== "function") {
      resolve(null);
      return;
    }
    wx.getBackgroundFetchData({
      fetchType,
      success: (res) => {
        resolve(parseFetchedData(res && (res.fetchedData || res.data || res.payload)));
      },
      fail: () => resolve(null),
    });
  });
}

function readCache(key) {
  try {
    return wx.getStorageSync(key) || null;
  } catch (error) {
    return null;
  }
}

function isFreshCache(data, ttlMs) {
  if (!data || typeof data !== "object") return false;
  const savedAt = Number(data.savedAt || 0);
  return Boolean(savedAt && Date.now() - savedAt < ttlMs);
}

function writeCache(key, data) {
  if (!data) return;
  try {
    wx.setStorageSync(key, Object.assign({ savedAt: Date.now() }, data));
  } catch (error) {
    // 平台数据只是加速缓存，写入失败不影响主流程。
  }
}

function extractActiveSnapshot(data) {
  const payload = data && data.data ? data.data : data;
  if (!payload) return null;
  const active = payload.activeSnapshot || payload.manifest || payload;
  const releaseVersion = active.releaseVersion || active.activeReleaseVersion || active.version || "";
  if (!releaseVersion) return null;
  return {
    term: active.term || active.semester || "",
    releaseVersion,
    scheduleUpdatedAt: active.updatedAt || active.publishedAt || active.dataUpdatedAt || "",
    catalogUpdatedAt: active.catalogUpdatedAt || active.updatedAt || "",
    cacheEpoch: active.cacheEpoch || active.updatedAt || releaseVersion,
    counts: active.counts || {},
    savedAt: Number(data && data.savedAt || payload.savedAt || 0) || 0,
  };
}

function comparableSnapshotTime(snapshot) {
  if (!snapshot) return 0;
  const cacheEpoch = Number(snapshot.cacheEpoch || 0) || 0;
  const updatedAt = Date.parse(snapshot.scheduleUpdatedAt || snapshot.catalogUpdatedAt || "") || 0;
  const savedAt = Number(snapshot.savedAt || 0) || 0;
  return Math.max(cacheEpoch, updatedAt) || savedAt;
}

function selectNewestActiveSnapshot(values) {
  return (Array.isArray(values) ? values : [])
    .map(extractActiveSnapshot)
    .filter(Boolean)
    .sort((left, right) => comparableSnapshotTime(right) - comparableSnapshotTime(left))[0] || null;
}

async function loadPrefetchData(options = {}) {
  const platformData = await readBackgroundFetchData("pre");
  if (platformData) {
    writeCache(PLATFORM_PREFETCH_CACHE_KEY, platformData);
    return Object.assign({ source: "wechat-prefetch" }, platformData);
  }
  if (options.network === false) {
    return readCache(PLATFORM_PREFETCH_CACHE_KEY);
  }
  return request.get("/api/fosu/prefetch", {}, {
    showLoading: false,
    silentError: true,
    timeout: options.timeout || 15000,
    retries: options.retries === undefined ? 1 : options.retries,
    skipSession: options.skipSession === true,
  }).then((data) => {
    writeCache(PLATFORM_PREFETCH_CACHE_KEY, data);
    return Object.assign({ source: "api-prefetch" }, data);
  }).catch(() => readCache(PLATFORM_PREFETCH_CACHE_KEY));
}

async function loadPeriodicData(options = {}) {
  const cached = readCache(PLATFORM_PERIODIC_CACHE_KEY);
  if (!options.forceNetwork && isFreshCache(cached, options.cacheTtlMs || PERIODIC_CACHE_TTL_MS)) {
    return Object.assign({ source: "cache-periodic" }, cached);
  }
  const platformData = await readBackgroundFetchData("periodic");
  if (platformData) {
    writeCache(PLATFORM_PERIODIC_CACHE_KEY, platformData);
    return Object.assign({ source: "wechat-periodic" }, platformData);
  }
  if (options.network === false) {
    return cached;
  }
  if (periodicInflight) {
    return periodicInflight;
  }
  periodicInflight = request.get("/api/fosu/periodic-data", {}, {
    showLoading: false,
    silentError: true,
    suppressWarn: true,
    timeout: options.periodicTimeout || Math.min(options.timeout || PERIODIC_BACKGROUND_TIMEOUT_MS, PERIODIC_BACKGROUND_TIMEOUT_MS),
    retries: options.retries === undefined ? 0 : options.retries,
    skipSession: options.skipSession === true,
  }).then((data) => {
    writeCache(PLATFORM_PERIODIC_CACHE_KEY, data);
    return Object.assign({ source: "api-periodic" }, data);
  }).catch((error) => {
    if (!options.silent) {
      console.warn("[platform-data] periodic-data background refresh failed", {
        code: error && (error.code || error.reasonCode),
        elapsedMs: error && error.elapsedMs,
      });
    }
    return cached || readCache(PLATFORM_PERIODIC_CACHE_KEY);
  }).finally(() => {
    periodicInflight = null;
  });
  return periodicInflight;
}

function getCachedPlatformSnapshot() {
  return selectNewestActiveSnapshot([
    readCache(PLATFORM_PREFETCH_CACHE_KEY),
    readCache(PLATFORM_PERIODIC_CACHE_KEY),
  ]);
}

module.exports = {
  PLATFORM_PREFETCH_CACHE_KEY,
  PLATFORM_PERIODIC_CACHE_KEY,
  extractActiveSnapshot,
  getCachedPlatformSnapshot,
  loadPeriodicData,
  loadPrefetchData,
  readBackgroundFetchData,
  readCache,
  selectNewestActiveSnapshot,
};
