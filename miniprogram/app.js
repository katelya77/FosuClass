const request = require("./utils/request");
const { BOOTSTRAP_CACHE_KEY } = require("./utils/storage");
const appConfigService = require("./services/appConfigService");
const releasePackService = require("./services/releasePackService");
const platformDataService = require("./services/platformDataService");
const securitySessionService = require("./services/securitySessionService");
const BRAND = require("./config/brand");

function readStorageQuiet(key) {
  try {
    return wx.getStorageSync(key);
  } catch (error) {
    return null;
  }
}

function scheduleLowPriority(task, delay) {
  setTimeout(() => {
    try {
      task();
    } catch (error) {
      // Background startup refresh must never block page rendering.
    }
  }, delay || 1200);
}

App({
  globalData: {
    appName: BRAND.appName,
    logoPath: "/assets/logo/favicon.png",
    env: "",
    bootstrapData: null,
    appConfig: null,
    activeRelease: null,
    platformPrefetchData: null,
    platformPeriodicData: null,
    shownModalNoticeIds: {},
  },

  onLaunch() {
    if (wx.cloud) {
      const cloudConfig = { traceUser: true };
      if (this.globalData.env) {
        cloudConfig.env = this.globalData.env;
      }
      wx.cloud.init(cloudConfig);
    }

    this.loadReleasePackData({ network: false });
    this.loadPlatformData({ network: false, silent: true });
    this.loadBootstrapData({ network: false, silent: true });
    this.loadAppConfigData({ network: false, silent: true });

    scheduleLowPriority(() => this.loadReleasePackData({ forceNetwork: true, silent: true, timeout: 5000, retries: 0 }), 1500);
    scheduleLowPriority(() => securitySessionService.warmupSession(), 1800);
    scheduleLowPriority(() => this.loadPlatformData({ silent: true, timeout: 5000, retries: 0 }), 2200);
    scheduleLowPriority(() => this.loadBootstrapData({ silent: true, timeout: 5000, retries: 0 }), 2600);
    scheduleLowPriority(() => this.loadAppConfigData({ force: true, silent: true, timeout: 5000, retries: 0 }), 3200);
  },

  loadReleasePackData(options) {
    const opt = options || {};
    const localActive = releasePackService.getLocalActiveRelease();
    if (localActive) {
      this.globalData.activeRelease = localActive;
    }
    if (opt.network === false) {
      return Promise.resolve(localActive || null);
    }
    return releasePackService.switchReleaseSafely({
      dedupe: true,
      forceNetwork: Boolean(opt.forceNetwork),
      timeout: opt.timeout || 5000,
      retries: opt.retries === undefined ? 0 : opt.retries,
    })
      .then((result) => {
        if (result && result.manifest) {
          this.globalData.activeRelease = {
            term: result.term,
            releaseVersion: result.releaseVersion,
            cacheEpoch: result.manifest.cacheEpoch,
            forceRefreshToken: result.manifest.forceRefreshToken,
            manifest: result.manifest,
          };
        }
        return result;
      })
      .catch((error) => {
        if (!opt.silent) {
          console.warn("Release Pack 静默刷新失败，继续使用本地缓存", {
            code: error && (error.code || error.reasonCode),
          });
        }
        return localActive || null;
      });
  },

  loadPlatformData(options) {
    const opt = options || {};
    platformDataService.loadPrefetchData(opt)
      .then((data) => {
        if (data) {
          this.globalData.platformPrefetchData = data;
        }
      })
      .catch((error) => {
        if (!opt.silent) {
          console.warn("平台预拉取数据读取失败，已降级", error);
        }
      });

    platformDataService.loadPeriodicData(opt)
      .then((data) => {
        if (data) {
          this.globalData.platformPeriodicData = data;
        }
      })
      .catch((error) => {
        if (!opt.silent) {
          console.warn("平台周期数据读取失败，已降级", error);
        }
      });
  },

  loadAppConfigData(options) {
    const opt = options || {};
    return appConfigService.loadAppConfig(opt)
      .then((config) => {
        this.globalData.appConfig = appConfigService.normalizeConfig
          ? appConfigService.normalizeConfig(config)
          : config;
        if (this.appConfigCallback) {
          this.appConfigCallback(this.globalData.appConfig);
        }
        return this.globalData.appConfig;
      })
      .catch((err) => {
        if (!opt.silent) {
          console.warn("公告配置加载失败，将使用本地缓存", err);
        }
        const cached = appConfigService.getCachedAppConfig && appConfigService.getCachedAppConfig();
        if (cached) {
          this.globalData.appConfig = cached;
        }
        return cached || null;
      });
  },

  loadBootstrapData(options) {
    const opt = options || {};
    const cached = readStorageQuiet(BOOTSTRAP_CACHE_KEY);
    if (cached) {
      this.globalData.bootstrapData = cached;
      if (this.bootstrapCallback) {
        this.bootstrapCallback(cached);
      }
    }
    if (opt.network === false) {
      return Promise.resolve(cached || null);
    }
    return request.get(`/api/fosu/bootstrap?ts=${Date.now()}`, {}, {
      showLoading: false,
      silentError: true,
      timeout: opt.timeout || 8000,
      retries: opt.retries === undefined ? 1 : opt.retries,
    })
      .then((res) => {
        if (res && res.success) {
          this.globalData.bootstrapData = res;
          wx.setStorageSync(BOOTSTRAP_CACHE_KEY, res);
          if (this.bootstrapCallback) {
            this.bootstrapCallback(res);
          }
        }
        return res;
      })
      .catch((err) => {
        if (!opt.silent) {
          console.warn("[Bootstrap] 后台刷新失败，将使用本地缓存", err);
        }
        return cached || null;
      });
  },
});
