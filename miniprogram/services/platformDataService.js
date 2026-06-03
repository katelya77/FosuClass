const request = require("../utils/request");

const PLATFORM_PREFETCH_CACHE_KEY = "FOSU_PLATFORM_PREFETCH_DATA";
const PLATFORM_PERIODIC_CACHE_KEY = "FOSU_PLATFORM_PERIODIC_DATA";

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
  };
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
    timeout: 10000,
  }).then((data) => {
    writeCache(PLATFORM_PREFETCH_CACHE_KEY, data);
    return Object.assign({ source: "api-prefetch" }, data);
  }).catch(() => readCache(PLATFORM_PREFETCH_CACHE_KEY));
}

async function loadPeriodicData(options = {}) {
  const platformData = await readBackgroundFetchData("periodic");
  if (platformData) {
    writeCache(PLATFORM_PERIODIC_CACHE_KEY, platformData);
    return Object.assign({ source: "wechat-periodic" }, platformData);
  }
  if (options.network === false) {
    return readCache(PLATFORM_PERIODIC_CACHE_KEY);
  }
  return request.get("/api/fosu/periodic-data", {}, {
    showLoading: false,
    silentError: true,
    timeout: 12000,
  }).then((data) => {
    writeCache(PLATFORM_PERIODIC_CACHE_KEY, data);
    return Object.assign({ source: "api-periodic" }, data);
  }).catch(() => readCache(PLATFORM_PERIODIC_CACHE_KEY));
}

function getCachedPlatformSnapshot() {
  return extractActiveSnapshot(readCache(PLATFORM_PREFETCH_CACHE_KEY)) ||
    extractActiveSnapshot(readCache(PLATFORM_PERIODIC_CACHE_KEY));
}

module.exports = {
  PLATFORM_PREFETCH_CACHE_KEY,
  PLATFORM_PERIODIC_CACHE_KEY,
  extractActiveSnapshot,
  getCachedPlatformSnapshot,
  loadPeriodicData,
  loadPrefetchData,
  readBackgroundFetchData,
};
