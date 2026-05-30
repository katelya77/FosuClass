const request = require("./utils/request");
const { BOOTSTRAP_CACHE_KEY } = require("./utils/storage");
const BRAND = require("./config/brand");

App({
  globalData: {
    appName: BRAND.appName,
    logoPath: "/assets/logo/favicon.png",
    env: "",
    bootstrapData: null,
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

    this.loadBootstrapData();
  },

  loadBootstrapData() {
    request.get("/api/fosu/bootstrap", {}, { showLoading: false, silentError: true })
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
