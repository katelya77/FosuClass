const request = require("./utils/request");
const { BOOTSTRAP_CACHE_KEY } = require("./utils/storage");
const appConfigService = require("./services/appConfigService");
const releasePackService = require("./services/releasePackService");
const platformDataService = require("./services/platformDataService");
const BRAND = require("./config/brand");

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
      const cloudConfig = {
        traceUser: true,
      };
      if (this.globalData.env) {
        cloudConfig.env = this.globalData.env;
      }
      wx.cloud.init(cloudConfig);
    }

    this.loadReleasePackData();
    this.loadPlatformData();
    this.loadBootstrapData();
    this.loadAppConfigData();
  },

  loadReleasePackData() {
    const localActive = releasePackService.getLocalActiveRelease();
    if (localActive) {
      this.globalData.activeRelease = localActive;
    }
    releasePackService.switchReleaseSafely({ dedupe: true })
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
      })
      .catch((error) => {
        console.warn("Release Pack 静默刷新失败，继续使用本地缓存", {
          code: error && (error.code || error.reasonCode),
        });
      });
  },

  loadPlatformData() {
    platformDataService.loadPrefetchData()
      .then((data) => {
        if (data) {
          this.globalData.platformPrefetchData = data;
        }
      })
      .catch((error) => {
        console.warn("平台预拉取数据读取失败，已降级", error);
      });

    platformDataService.loadPeriodicData()
      .then((data) => {
        if (data) {
          this.globalData.platformPeriodicData = data;
        }
      })
      .catch((error) => {
        console.warn("平台周期数据读取失败，已降级", error);
      });
  },

  loadAppConfigData(options) {
    return appConfigService.loadAppConfig(options)
      .then((config) => {
        this.globalData.appConfig = config;
        if (this.appConfigCallback) {
          this.appConfigCallback(config);
        }
        return config;
      })
      .catch((err) => {
        console.warn("公告配置加载失败，将使用本地缓存", err);
        return null;
      });
  },

  loadBootstrapData() {
    request.get(`/api/fosu/bootstrap?ts=${Date.now()}`, {}, { showLoading: false, silentError: true, timeout: 12000, retries: 1 })
      .then((res) => {
        if (res && res.success) {
          this.globalData.bootstrapData = res;
          wx.setStorageSync(BOOTSTRAP_CACHE_KEY, res);
          console.log("🚀 [Bootstrap] 引导数据加载成功", res);
          if (this.bootstrapCallback) {
            this.bootstrapCallback(res);
          }
        }
      })
      .catch((err) => {
        console.warn("⚠️ [Bootstrap] 接口网络请求失败，尝试从本地缓存恢复", err);
        const cached = wx.getStorageSync(BOOTSTRAP_CACHE_KEY);
        if (cached) {
          this.globalData.bootstrapData = cached;
          console.log("🚀 [Bootstrap] 读取本地离线缓存成功", cached);
          if (this.bootstrapCallback) {
            this.bootstrapCallback(cached);
          }
        } else {
          console.warn("Bootstrap 无本地缓存，页面将自行按需加载");
        }
      });
  }
});
