const request = require("./utils/request");
const { BOOTSTRAP_CACHE_KEY } = require("./utils/storage");
const appConfigService = require("./services/appConfigService");
const platformDataService = require("./services/platformDataService");
const BRAND = require("./config/brand");

App({
  globalData: {
    appName: BRAND.appName,
    logoPath: "/assets/logo/favicon.png",
    env: "",
    bootstrapData: null,
    appConfig: null,
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

    this.loadPlatformData();
    this.loadBootstrapData();
    this.loadAppConfigData();
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
    request.get(`/api/fosu/bootstrap?ts=${Date.now()}`, {}, { showLoading: false, silentError: true })
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
          wx.showModal({
            title: "网络异常",
            content: "首次打开应用需要联网加载学校信息，请检查网络设置。",
            showCancel: false,
            confirmText: "重试",
            success: (modalRes) => {
              if (modalRes.confirm) {
                this.loadBootstrapData();
              }
            }
          });
        }
      });
  }
});
