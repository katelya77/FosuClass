const appConfigService = require("./appConfigService");
const platformDataService = require("./platformDataService");
const releasePackService = require("./releasePackService");
const securitySessionService = require("./securitySessionService");
const termConfigService = require("./termConfigService");
const request = require("../utils/request");
const { BOOTSTRAP_CACHE_KEY } = require("../utils/storage");

const STARTED_AT = Date.now();
const PERIODIC_DELAY_MS = 10000;
const inflight = {};

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
  } catch (error) {}
}

function singleflight(key, factory, options = {}) {
  if (inflight[key] && options.dedupe !== false) return inflight[key];
  try {
    inflight[key] = Promise.resolve(factory())
    .finally(() => {
      inflight[key] = null;
    });
  } catch (error) {
    inflight[key] = Promise.reject(error).finally(() => {
      inflight[key] = null;
    });
  }
  return inflight[key];
}

function applyPointerToApp(pointer) {
  if (!pointer) return null;
  const app = getApp && getApp();
  if (app && app.globalData) {
    app.globalData.activeRelease = {
      term: pointer.activeTerm || pointer.term,
      releaseVersion: pointer.releaseVersion,
      cacheEpoch: pointer.cacheEpoch,
      forceRefreshToken: pointer.forceRefreshToken,
      manifest: {
        term: pointer.activeTerm || pointer.term,
        semester: pointer.activeTerm || pointer.term,
        releaseVersion: pointer.releaseVersion,
        version: pointer.releaseVersion,
        cacheEpoch: pointer.cacheEpoch,
        forceRefreshToken: pointer.forceRefreshToken,
        termConfig: pointer.termConfig,
        calendarUrl: pointer.urls && pointer.urls.calendar,
        indexUrls: { class: pointer.urls && pointer.urls.classIndex },
      },
    };
    termConfigService.applyRuntimeTermConfigFromApp(app);
  }
  return pointer;
}

function resolveRuntimePointer(options = {}) {
  return singleflight("runtime-pointer", () => releasePackService.resolveRuntimePointer(options)
    .then(applyPointerToApp), options);
}

function loadAppConfig(options = {}) {
  return singleflight("app-config", () => appConfigService.loadAppConfig(options)
    .then((config) => {
      const app = getApp && getApp();
      if (app && app.globalData) {
        app.globalData.appConfig = config;
        termConfigService.applyRuntimeTermConfigFromApp(app);
      }
      return config;
    }), options);
}

function loadBootstrap(options = {}) {
  const cached = readStorage(BOOTSTRAP_CACHE_KEY);
  if (cached && !options.forceNetwork) return Promise.resolve(cached);
  return singleflight("bootstrap", () => request.get("/api/fosu/bootstrap", options.query || {}, {
    showLoading: false,
    silentError: true,
    timeout: options.timeout || 12000,
    retries: options.retries === undefined ? 1 : options.retries,
    skipSession: options.skipSession === true,
  }).then((payload) => {
    if (payload && payload.success) {
      writeStorage(BOOTSTRAP_CACHE_KEY, payload);
      const app = getApp && getApp();
      if (app && app.globalData) app.globalData.bootstrapData = payload;
    }
    return payload;
  }), options);
}

function warmupSession(options = {}) {
  return singleflight("session", () => securitySessionService.warmupSession(options).catch((error) => {
    if (options.throwOnError) throw error;
    return null;
  }), options);
}

function loadPrefetch(options = {}) {
  return singleflight("prefetch", () => platformDataService.loadPrefetchData(options), options);
}

function loadPeriodicWhenIdle(options = {}) {
  const elapsed = Date.now() - STARTED_AT;
  const delay = Math.max(PERIODIC_DELAY_MS - elapsed, options.delayMs || 0);
  return singleflight("periodic-data", () => new Promise((resolve) => {
    setTimeout(() => {
      platformDataService.loadPeriodicData(Object.assign({}, options, {
        silent: true,
        showLoading: false,
      })).then(resolve).catch(() => resolve(null));
    }, delay);
  }), options);
}

function resolveCriticalRuntime(options = {}) {
  return resolveRuntimePointer(options)
    .catch(() => loadAppConfig(Object.assign({}, options, { force: false })))
    .then((result) => result);
}

function startBackgroundRefresh(options = {}) {
  const sessionReady = warmupSession({ throwOnError: true }).catch(() => null);
  const afterSession = (task, taskOptions) => {
    sessionReady
      .then((session) => task(Object.assign({}, taskOptions, { skipSession: !session })))
      .catch(() => task(Object.assign({}, taskOptions, { skipSession: true })));
  };
  setTimeout(() => afterSession(loadPrefetch, Object.assign({ silent: true }, options)), options.prefetchDelayMs || 1800);
  setTimeout(() => afterSession(loadBootstrap, Object.assign({ silent: true, forceNetwork: true }, options)), options.bootstrapDelayMs || 2400);
  setTimeout(() => afterSession(loadAppConfig, Object.assign({ silent: true }, options)), options.appConfigDelayMs || 3000);
  const elapsed = Date.now() - STARTED_AT;
  const periodicDelay = Math.max(PERIODIC_DELAY_MS - elapsed, options.periodicDelayMs || PERIODIC_DELAY_MS);
  setTimeout(() => afterSession(platformDataService.loadPeriodicData, Object.assign({ silent: true }, options)), periodicDelay);
}

module.exports = {
  loadAppConfig,
  loadBootstrap,
  loadPeriodicWhenIdle,
  loadPrefetch,
  resolveCriticalRuntime,
  resolveRuntimePointer,
  singleflight,
  startBackgroundRefresh,
  warmupSession,
};
