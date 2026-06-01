const BRAND = require("../../config/brand");
const {
  BOOTSTRAP_CACHE_KEY,
  CURRENT_SCHEDULE_TARGET_KEY,
  clearAppCache,
  clearDataCaches,
  clearLocalSelection,
  getSettings,
  saveSettings,
} = require("../../utils/storage");
const { mockCalendar } = require("../../data/mockCalendar");
const {
  TERM_START_DATE,
  TOTAL_WEEKS,
  clampWeek,
  getTodayTeachingInfo,
} = require("../../utils/week");
const request = require("../../utils/request");
const appConfigService = require("../../services/appConfigService");
const { courseTimesMeta } = require("../../data/courseTimes");
const { contactConfig } = require("../../config/contact");

const APP_VERSION = "1.0.0";
const FEEDBACK_TYPES = ["课表错误", "数据过期", "页面问题", "功能建议", "其他"];

function buildWeekOptions() {
  const options = [];
  for (let week = 1; week <= TOTAL_WEEKS; week += 1) {
    options.push(`第${week}周`);
  }
  return options;
}

function formatFullDateTime(value) {
  if (!value) {
    return "-";
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return String(value);
  }
  const pad = (num) => String(num).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}

function getSelectedSchedule() {
  const target = wx.getStorageSync(CURRENT_SCHEDULE_TARGET_KEY) || null;
  const filter = wx.getStorageSync("FOSU_SCHOOL_FILTER_CACHE") || null;
  return {
    target,
    filter,
  };
}

function buildSelectedScheduleText(selected) {
  const target = selected && selected.target;
  if (target && target.name) {
    if (target.type === "personal-xls") {
      const metadata = target.metadata || {};
      return [metadata.className, metadata.studentName, metadata.term]
        .filter(Boolean)
        .join(" · ") || target.title || target.name;
    }
    return target.type === "teacher"
      ? `${target.name} 老师`
      : (target.type === "classroom" ? `${target.name} 教室` : target.name);
  }
  const filter = selected && selected.filter;
  if (filter && (filter.className || filter.majorName || filter.collegeName)) {
    return [filter.collegeName, filter.grade, filter.majorName, filter.className]
      .filter(Boolean)
      .join(" / ");
  }
  return "未绑定课表";
}

function buildSelectedScheduleMeta(selected) {
  const target = selected && selected.target;
  if (!target) {
    return {
      sourceText: "",
      importText: "",
    };
  }
  if (target.type === "personal-xls") {
    return {
      sourceText: "来源：100网 XLS 手动导入",
      importText: target.importedAt ? `导入时间：${formatFullDateTime(target.importedAt)}` : "",
    };
  }
  return {
    sourceText: target.type ? `来源：${target.type}` : "",
    importText: target.updateTime ? `更新时间：${target.updateTime}` : "",
  };
}

function summarizeSelectedSchedule(selected) {
  const target = selected && selected.target ? selected.target : null;
  const filter = selected && selected.filter ? selected.filter : null;
  return {
    target: target ? {
      type: target.type || "",
      name: target.name || "",
      classId: target.classId || "",
      className: target.className || "",
      semester: target.semester || "",
      displayType: target.displayType || "",
      isAggregated: Boolean(target.isAggregated),
      courseCount: Array.isArray(target.courses) ? target.courses.length : 0,
      updateTime: target.updateTime || "",
    } : null,
    filter: filter ? {
      semesterValue: filter.semesterValue || "",
      collegeCode: filter.collegeCode || "",
      collegeName: filter.collegeName || "",
      grade: filter.grade || "",
      majorCode: filter.majorCode || "",
      majorName: filter.majorName || "",
      classId: filter.classId || "",
      className: filter.className || "",
      classType: filter.classType || "",
      catalogVersion: filter.catalogVersion || "",
    } : null,
  };
}

Page({
  data: {
    brand: BRAND,
    settings: {},
    teachingInfo: {},
    termStartDate: TERM_START_DATE,
    weekOptions: buildWeekOptions(),
    feedbackTypes: FEEDBACK_TYPES,
    feedbackVisible: false,
    feedbackSubmitting: false,
    feedbackForm: {
      typeIndex: 0,
      contact: "",
      content: "",
    },
    contactConfig,
    selectedScheduleText: "未绑定课表",
    selectedScheduleSourceText: "",
    selectedScheduleImportText: "",
    appConfig: { dataVersion: {}, notices: [], news: [] },
    appConfigUpdatedText: "",
    noticeHistoryVisible: false,
    newsVisible: false,
    noticeHistory: [],
    newsList: [],
    versionDetailVisible: false,
    versionData: {
      appVersion: APP_VERSION,
      sdkVersion: "",
      courseTimesVersion: "",
      courseTimesUpdatedAt: "",
      snapshotVersion: "-",
      semester: "-",
      catalogUpdatedAt: "-",
      majorsUpdatedAt: "-",
      classSchedulesUpdatedAt: "-",
      collegesCount: "-",
      majorsCount: "-",
      classScheduleCount: "-",
      teacherScheduleCount: "-",
      classroomScheduleCount: "-",
      courseScheduleCount: "-",
      syncTimeText: "-",
      dataSource: "-",
      selectedScheduleText: "未绑定课表",
      disclaimer: BRAND.disclaimer,
    },
  },

  onShow() {
    if (wx.showShareMenu) {
      wx.showShareMenu({
        withShareTicket: true,
        menus: ["shareAppMessage", "shareTimeline"],
      });
    }
    this.loadSettings();
    this.loadAppConfig();
  },

  loadAppConfig() {
    appConfigService.loadAppConfig()
      .then((config) => {
        const latestUpdatedAt = appConfigService.getLatestDataUpdatedAt(config);
        this.setData({
          appConfig: config,
          appConfigUpdatedText: latestUpdatedAt ? appConfigService.formatConfigTime(latestUpdatedAt) : "",
          noticeHistory: config.notices || [],
          newsList: config.news || [],
        });
      })
      .catch((err) => {
        console.warn("设置页公告配置加载失败", err);
      });
  },

  loadSettings() {
    const settings = getSettings();
    const teachingInfo = getTodayTeachingInfo(new Date(), mockCalendar);
    const effectiveWeek = settings.manualWeekOverride ? clampWeek(settings.currentWeek) : teachingInfo.weekNo;
    const selectedSchedule = getSelectedSchedule();
    const selectedMeta = buildSelectedScheduleMeta(selectedSchedule);
    this.setData({
      settings: Object.assign({}, settings, {
        currentWeek: effectiveWeek,
      }),
      teachingInfo,
      selectedScheduleText: buildSelectedScheduleText(selectedSchedule),
      selectedScheduleSourceText: selectedMeta.sourceText,
      selectedScheduleImportText: selectedMeta.importText,
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

  goImportXls() {
    wx.navigateTo({
      url: "/pages/personal-sync/personal-sync?tab=xls",
    });
  },

  goLogin() {
    wx.navigateTo({
      url: "/pages/personal-sync/personal-sync?tab=account",
    });
  },

  goCustomCourses() {
    wx.navigateTo({
      url: "/pages/custom-courses/custom-courses",
    });
  },
  
  goContribute() {
    wx.navigateTo({
      url: "/pages/contribute/contribute",
    });
  },

  showFeedback() {
    this.setData({
      feedbackVisible: true,
    });
  },

  hideFeedback() {
    if (this.data.feedbackSubmitting) {
      return;
    }
    this.setData({
      feedbackVisible: false,
    });
  },

  onFeedbackTypeChange(event) {
    this.setData({
      "feedbackForm.typeIndex": Number(event.detail.value),
    });
  },

  onFeedbackContactInput(event) {
    this.setData({
      "feedbackForm.contact": event.detail.value,
    });
  },

  onFeedbackContentInput(event) {
    this.setData({
      "feedbackForm.content": event.detail.value,
    });
  },

  buildFeedbackPayload() {
    const selectedSchedule = getSelectedSchedule();
    const selectedScheduleSummary = summarizeSelectedSchedule(selectedSchedule);
    const sysInfo = wx.getSystemInfoSync();
    const bootstrap = getApp().globalData.bootstrapData || wx.getStorageSync(BOOTSTRAP_CACHE_KEY) || {};
    const settings = this.data.settings || getSettings();
    return {
      type: FEEDBACK_TYPES[this.data.feedbackForm.typeIndex] || "其他",
      contact: this.data.feedbackForm.contact,
      content: this.data.feedbackForm.content,
      page: "pages/settings/settings",
      selectedSchedule: selectedScheduleSummary,
      selectedClass: selectedScheduleSummary.target || selectedScheduleSummary.filter || null,
      semester: bootstrap.semester || settings.semesterId || settings.semester,
      appVersion: APP_VERSION,
      dataVersion: bootstrap.version || bootstrap.versions?.snapshot || bootstrap.updatedAt || "",
      platform: `${sysInfo.platform || "unknown"} / ${sysInfo.system || ""} / SDK ${sysInfo.SDKVersion || ""}`,
    };
  },

  submitFeedback() {
    const content = String(this.data.feedbackForm.content || "").trim();
    if (!content) {
      wx.showToast({
        title: "请填写反馈内容",
        icon: "none",
      });
      return;
    }

    this.setData({ feedbackSubmitting: true });
    request.post("/api/feedback", this.buildFeedbackPayload(), { loadingTitle: "正在提交..." })
      .then(() => {
        this.setData({
          feedbackSubmitting: false,
          feedbackVisible: false,
          feedbackForm: {
            typeIndex: 0,
            contact: "",
            content: "",
          },
        });
        wx.showToast({
          title: "已收到反馈",
          icon: "success",
        });
      })
      .catch((err) => {
        this.setData({ feedbackSubmitting: false });
        console.error("submit feedback failed", err);
      });
  },

  showContactFallback() {
    const lines = [
      contactConfig.wechatHint,
      `备用邮箱：${contactConfig.email}`,
      "反馈课表错误时建议附带：班级、周次、课程名、截图",
    ];
    wx.showModal({
      title: "联系开发者",
      content: lines.join("\n"),
      showCancel: false,
      confirmText: "知道了",
    });
  },

  refreshBootstrapData() {
    wx.showLoading({ title: "正在刷新..." });
    clearDataCaches();
    request.get("/api/fosu/bootstrap", {}, { showLoading: false, silentError: true })
      .then((res) => {
        wx.hideLoading();
        if (res && res.success) {
          getApp().globalData.bootstrapData = res;
          wx.setStorageSync(BOOTSTRAP_CACHE_KEY, res);
          getApp().loadAppConfigData({ force: true }).then(() => this.loadAppConfig());
          this.showDataVersionDetail();
          wx.showToast({
            title: "已更新到最新数据",
            icon: "success",
          });
        } else {
          wx.showToast({
            title: "刷新失败",
            icon: "none",
          });
        }
      })
      .catch((err) => {
        wx.hideLoading();
        wx.showToast({
          title: "刷新失败",
          icon: "none",
        });
        console.error("refresh bootstrap failed", err);
      });
  },

  clearLocalSelectionOnly() {
    wx.showModal({
      title: "清除本地选择",
      content: "将清空当前课表选择和全校页筛选记录，下次进入时重新选择。",
      confirmText: "清除",
      confirmColor: "#c62828",
      success: (res) => {
        if (!res.confirm) {
          return;
        }
        clearLocalSelection();
        this.loadSettings();
        wx.showToast({
          title: "已清除",
          icon: "success",
        });
      },
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
      content: "将恢复默认班级、当前周 and 显示设置。",
      confirmText: "清除",
      confirmColor: "#c62828",
      success: (res) => {
        if (!res.confirm) {
          return;
        }
        clearAppCache();
        clearLocalSelection();
        this.loadSettings();
        wx.showToast({
          title: "已清除",
          icon: "success",
        });
      },
    });
  },

  onWeekendModeChange(event) {
    const mode = Number(event.detail.value) === 1 ? "detail" : "overview";
    saveSettings({
      weekendShowMode: mode,
    });
    this.loadSettings();
    wx.showToast({
      title: "模式已更改",
      icon: "success",
    });
  },

  resetToNewUser() {
    wx.showModal({
      title: "重置为新用户状态",
      content: "确定要重置当前所有的课表状态，回到首次打开小程序的引导界面吗？",
      confirmColor: "#c62828",
      success: (res) => {
        if (res.confirm) {
          const { clearCurrentScheduleTarget, clearLocalSelection } = require("../../utils/storage");
          clearCurrentScheduleTarget();
          clearLocalSelection();
          wx.removeStorageSync("lastTodayReminderDate");
          this.loadSettings();
          wx.showToast({
            title: "已重置状态",
            icon: "success"
          });
          setTimeout(() => {
            wx.switchTab({
              url: "/pages/index/index"
            });
          }, 800);
        }
      }
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
      title: "关于" + BRAND.appName,
      content: BRAND.appName + "是个人开发的课程时间管理工具，主要用于查看课程安排、今日课程提醒和作息时间。本工具非学校官方服务，课程数据由开发者整理维护及用户反馈修正，仅供学习生活参考，具体安排请以任课教师通知及正式通知为准。\n\n联系邮箱：" + BRAND.contactEmail,
      showCancel: false,
      confirmText: "知道了",
    });
  },

  showPrivacy() {
    wx.showModal({
      title: "隐私说明",
      content: BRAND.appName + "严格保护您的隐私，小程序绝不会在前端保存您的教务密码。数据查询由服务器向公共数据源获取，不会记录您的个人密码，也不会在任何地方记录 Cookie 等敏感登录态。",
      showCancel: false,
      confirmText: "知道了",
    });
  },

  showDataVersionDetail() {
    const sysInfo = wx.getSystemInfoSync();
    
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
          const metaDetails = res.metaDetails || {};
          const selectedSchedule = getSelectedSchedule();
          const selectedScheduleText = buildSelectedScheduleText(selectedSchedule);
          const syncTimeText = formatFullDateTime(res.updatedAt);

          let dataSource = res.dataSource || "cache-first";
          if (dataSource === "snapshot") {
            dataSource = "全校数据快照 (snapshot)";
          } else if (dataSource === "fosu-realtime") {
            dataSource = "后台服务直连实时 (realtime)";
          } else if (dataSource === "cache") {
            dataSource = "服务端本地缓存 (cache)";
          }

          this.setData({
            versionData: {
              appVersion: APP_VERSION,
              sdkVersion: sysInfo.SDKVersion || "未知",
              courseTimesVersion: courseTimesMeta.version,
              courseTimesUpdatedAt: courseTimesMeta.updatedAt,
              
              snapshotVersion: res.version || "legacy",
              semester: res.semester || "-",
              catalogUpdatedAt: formatFullDateTime(metaDetails.catalogUpdatedAt),
              majorsUpdatedAt: formatFullDateTime(metaDetails.majorsUpdatedAt),
              classSchedulesUpdatedAt: formatFullDateTime(metaDetails.classSchedulesUpdatedAt),
              collegesCount: counts.collegeCount || counts.collegesCount || "-",
              majorsCount: counts.majorCount || counts.majorsCount || "-",
              classScheduleCount: counts.classScheduleCount || counts.classSchedulesCount || counts.classesCount || "-",
              teacherScheduleCount: counts.teacherScheduleCount || "-",
              classroomScheduleCount: counts.classroomScheduleCount || "-",
              courseScheduleCount: counts.courseScheduleCount || "-",
              
              syncTimeText,
              dataSource,
              selectedScheduleText,
              disclaimer: metaDetails.disclaimer || BRAND.disclaimer,
            }
          });
        }
      })
      .catch((err) => {
        wx.hideLoading();
        console.error("fetch bootstrap in settings failed", err);
      });
  },

  showNoticeHistory() {
    this.setData({
      noticeHistoryVisible: true,
    });
  },

  hideNoticeHistory() {
    this.setData({
      noticeHistoryVisible: false,
    });
  },

  showNewsList() {
    this.setData({
      newsVisible: true,
    });
  },

  hideNewsList() {
    this.setData({
      newsVisible: false,
    });
  },

  hideDataVersionDetail() {
    this.setData({
      versionDetailVisible: false
    });
  },

  onShareAppMessage() {
    return {
      title: BRAND.appName + "｜查看课程安排",
      path: "/pages/index/index",
    };
  },

  onShareTimeline() {
    return {
      title: BRAND.appName + "｜查看课程安排",
      query: "",
    };
  },

  noop() {}
});
