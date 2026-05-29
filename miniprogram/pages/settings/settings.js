const { clearAppCache, getSettings, saveSettings } = require("../../utils/storage");
const { mockCalendar } = require("../../data/mockCalendar");
const {
  TERM_START_DATE,
  TOTAL_WEEKS,
  clampWeek,
  getTodayTeachingInfo,
} = require("../../utils/week");
const request = require("../../utils/request");
const { courseTimesMeta } = require("../../data/courseTimes");

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
    versionDetailVisible: false,
    versionData: {
      appVersion: "1.0.0",
      sdkVersion: "",
      courseTimesVersion: "",
      courseTimesUpdatedAt: "",
      collegesCount: "-",
      majorsCount: "-",
      classScheduleCount: "-",
      teacherScheduleCount: "-",
      classroomScheduleCount: "-",
      courseScheduleCount: "-",
      syncTimeText: "-",
      dataSource: "-",
      storageMounted: "未知",
      storagePath: "未知",
    },
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

  showDataVersionDetail() {
    const sysInfo = wx.getSystemInfoSync();
    
    // 默认展示本地状态
    this.setData({
      versionDetailVisible: true,
      "versionData.sdkVersion": sysInfo.SDKVersion || "未知",
      "versionData.courseTimesVersion": courseTimesMeta.version,
      "versionData.courseTimesUpdatedAt": courseTimesMeta.updatedAt,
    });

    wx.showLoading({ title: "加载中..." });
    request.get("/api/fosu/bootstrap", { semester: this.data.settings.semester || "2025-2026-2" }, { showLoading: false })
      .then((res) => {
        wx.hideLoading();
        if (res && res.success) {
          const counts = res.counts || {};
          
          let syncTimeText = "-";
          if (res.updatedAt) {
            const date = new Date(res.updatedAt);
            if (!Number.isNaN(date.getTime())) {
              const now = new Date();
              const isToday = date.toDateString() === now.toDateString();
              const timeStr = date.toLocaleTimeString("zh-CN", { hour12: false, hour: "2-digit", minute: "2-digit" });
              if (isToday) {
                syncTimeText = `今天 ${timeStr}`;
              } else {
                const dateStr = date.toLocaleDateString("zh-CN").replace(/\//g, "-");
                syncTimeText = `${dateStr} ${timeStr}`;
              }
            }
          }

          let dataSource = "cache-first";
          if (res.dataSource) {
            if (res.dataSource === "fosu-realtime") {
              dataSource = "local-sync-client / realtime";
            } else if (res.dataSource === "cache") {
              dataSource = "local-sync-client / cache-first";
            } else {
              dataSource = res.dataSource;
            }
          }

          const details = res.metaDetails || {};
          const isMounted = res.ready ? "active (已挂载)" : "warning (未挂载)";
          const storagePath = (details.catalog && details.catalog.storagePath) || "/data/fosu-storage";

          this.setData({
            versionData: {
              appVersion: "1.0.0",
              sdkVersion: sysInfo.SDKVersion || "未知",
              courseTimesVersion: courseTimesMeta.version,
              courseTimesUpdatedAt: courseTimesMeta.updatedAt,
              collegesCount: counts.collegesCount || 0,
              majorsCount: counts.majorsCount || 0,
              classScheduleCount: counts.classSchedulesCount || counts.classesCount || 0,
              teacherScheduleCount: counts.teacherScheduleCount || 0,
              classroomScheduleCount: counts.classroomScheduleCount || 0,
              courseScheduleCount: counts.courseScheduleCount || 0,
              syncTimeText,
              dataSource,
              storageMounted: isMounted,
              storagePath,
            }
          });
        }
      })
      .catch((err) => {
        wx.hideLoading();
        console.error("fetch bootstrap in settings failed", err);
      });
  },

  hideDataVersionDetail() {
    this.setData({
      versionDetailVisible: false
    });
  },

  noop() {}
});
