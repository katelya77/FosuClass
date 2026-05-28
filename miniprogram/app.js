App({
  globalData: {
    appName: "佛大课表",
    logoPath: "/assets/logo/favicon.png",
    env: "",
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
  },
});
