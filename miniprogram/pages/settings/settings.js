const { clearAppCache, getSettings, saveSettings } = require("../../utils/storage");
const { mockCalendar } = require("../../data/mockCalendar");
const {
  TERM_START_DATE,
  TOTAL_WEEKS,
  clampWeek,
  getTodayTeachingInfo,
} = require("../../utils/week");

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
    teachingInfo: {},
    termStartDate: TERM_START_DATE,
    weekOptions: buildWeekOptions(),
  },

  onShow() {
    this.loadSettings();
  },

  loadSettings() {
    const settings = getSettings();
    const teachingInfo = getTodayTeachingInfo(new Date(), mockCalendar);
    const effectiveWeek = settings.manualWeekOverride ? clampWeek(settings.currentWeek) : teachingInfo.weekNo;
    this.setData({
      settings: Object.assign({}, settings, {
        currentWeek: effectiveWeek,
      }),
      teachingInfo,
    });
  },

  onWeekChange(event) {
    const currentWeek = Number(event.detail.value) + 1;
    saveSettings({
      currentWeek,
      manualWeekOverride: true,
    });
    this.loadSettings();
  },

  restoreAutoWeek() {
    const teachingInfo = getTodayTeachingInfo(new Date(), mockCalendar);
    saveSettings({
      currentWeek: teachingInfo.weekNo,
      manualWeekOverride: false,
    });
    this.loadSettings();
    wx.showToast({
      title: "已恢复自动",
      icon: "success",
    });
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

  showDeveloperApi() {
    wx.showModal({
      title: "开发者接口接入",
      content:
        "下一步抓包接口：\n/xskb/xskb_list.do\n/kbcx/kbxx_xzb\n/kbcx/kbxx_teacher\n/kbcx/kbxx_classroom\n/kbcx/kbxx_kc\n/kscj/cjcx_query?Ves632DSdyV=NEW_XSD_XJCJ\n\n提交给 AI 前必须删除 Cookie、Token、JSESSIONID、密码等敏感信息。",
      showCancel: false,
      confirmText: "知道了",
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
        clearAppCache();
        this.loadSettings();
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
      content: "佛大课表是面向佛山大学的课程表小程序。当前支持本地缓存课表、全校课表入口和强智教务接口适配层。",
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
