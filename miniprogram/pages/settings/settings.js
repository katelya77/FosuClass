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
  
  goContribute() {
    wx.navigateTo({
      url: "/pages/contribute/contribute",
    });
  },

  showDeveloperApi() {
    wx.showModal({
      title: "开发者接口调试",
      content:
        "强智接口路径：\n/xskb/xskb_list.do\n/kbcx/kbxx_xzb\n/kbcx/kbxx_teacher\n/kbcx/kbxx_classroom\n/kbcx/kbxx_kc\n\n提交给 AI 调试前请确认已脱敏 Cookie、Token 等数据。",
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
        wx.removeStorageSync("FOSU_CURRENT_SCHEDULE_TARGET"); // 清空实时选择的课表绑定
        this.loadSettings();
        wx.showToast({
          title: "已清除",
          icon: "success",
        });
      },
    });
  },

  showAbout() {
    // 连续点击 5 次关于，触发开发者模式彩蛋
    this.clickCount = (this.clickCount || 0) + 1;
    if (this.clickCount >= 5) {
      this.clickCount = 0;
      this.showDeveloperApi();
      return;
    }
    wx.showModal({
      title: "关于佛大课表",
      content: "佛大课表是面向佛山大学的课程表小程序。当前已接入学校强智教务系统，支持全校行政班级、教师、教室、课程实时获取及展示。",
      showCancel: false,
      confirmText: "知道了",
    });
  },

  showPrivacy() {
    wx.showModal({
      title: "隐私说明",
      content: "佛大课表严格保护您的隐私，小程序绝不会在前端保存您的教务系统密码。云函数会在每次向教务网查询数据时，仅使用服务端预设的环境变量服务账号模拟登录，不会记录您的个人密码，也不会在任何地方记录 Cookie 等敏感登录态。",
      showCancel: false,
      confirmText: "知道了",
    });
  },
});
