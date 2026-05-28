const { clearAppCache, getSettings, saveSettings } = require("../../utils/storage");
const { TOTAL_WEEKS } = require("../../utils/week");

function buildWeekOptions() {
  const options = [];
  for (let week = 1; week <= TOTAL_WEEKS; week += 1) {
    options.push(`第${week}周`);
  }
  return options;
}

Page({
  data: {
    settings: {},
    weekOptions: buildWeekOptions(),
  },

  onShow() {
    this.loadSettings();
  },

  loadSettings() {
    this.setData({
      settings: getSettings(),
    });
  },

  onWeekChange(event) {
    const currentWeek = Number(event.detail.value) + 1;
    saveSettings({
      currentWeek,
    });
    this.loadSettings();
  },

  onSwitchChange(event) {
    const key = event.currentTarget.dataset.key;
    saveSettings({
      [key]: event.detail.value,
    });
    this.loadSettings();
  },

  goSchool() {
    wx.switchTab({
      url: "/pages/school/school",
    });
  },

  goTimetable() {
    wx.navigateTo({
      url: "/pages/timetable/timetable",
    });
  },

  goLogin() {
    wx.navigateTo({
      url: "/pages/login/login",
    });
  },

  clearCache() {
    wx.showModal({
      title: "清除缓存",
      content: "将恢复默认班级、当前周和显示设置。",
      confirmText: "清除",
      confirmColor: "#c62828",
      success: (res) => {
        if (!res.confirm) {
          return;
        }
        const settings = clearAppCache();
        this.setData({ settings });
        wx.showToast({
          title: "已清除",
          icon: "success",
        });
      },
    });
  },

  showAbout() {
    wx.showModal({
      title: "关于佛大课表",
      content: "佛大课表是面向佛山大学的课程表小程序模板。第一阶段使用 Mock 数据，后续通过脱敏抓包接入强智教务系统。",
      showCancel: false,
      confirmText: "知道了",
    });
  },

  showPrivacy() {
    wx.showModal({
      title: "隐私说明",
      content: "第一版不会真实登录教务系统，也不会保存教务网密码。后续同步功能仅会在请求时临时使用密码，并且不会把密码写入本地缓存、云数据库或日志。",
      showCancel: false,
      confirmText: "知道了",
    });
  },
});
