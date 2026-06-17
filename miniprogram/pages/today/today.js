const { getTodayCoursesData } = require("../../utils/todayReminder");
const { getSettings } = require("../../utils/storage");
const appConfigService = require("../../services/appConfigService");
const currentScheduleService = require("../../services/currentScheduleService");
const customCourseService = require("../../services/customCourseService");
const BRAND = require("../../config/brand");

const AI_PENDING_TODAY_QUERY_KEY = "FOSU_AI_PENDING_TODAY_QUERY";

Page({
  data: {
    brand: BRAND,
    dateText: "",
    weekdayText: "",
    className: "未选择当前课表",
    currentWeek: 12,
    dataSourceText: "课程数据 · 本地缓存",
    courseCountText: "今日共 0 门课",
    courses: [],
    appConfig: { notices: [] },
    urgentNotice: null,
    dataVersionText: "",
    selectedCourse: null,
    detailVisible: false,
    emptyTitle: "今天没有课程，好好休息",
    emptyDesc: "这里会根据当前班级、教学周和星期自动筛选课程。"
  },

  onShow() {
    const pending = this.consumeAiPendingTodayQuery();
    this.loadToday();
    this.loadPageConfig();
    this.refreshCurrentTargetSilently();
    if (pending) {
      this.applyAiPendingTodayQuery(pending);
    }
  },

  refreshCurrentTargetSilently() {
    currentScheduleService.ensureCurrentScheduleFresh({
      silent: true,
      notify: true,
    }).then((result) => {
      if (result && result.status === "UPDATED") {
        this.loadToday();
        if (result.shouldNotify) {
          wx.showToast({
            title: "课表已更新至最新数据",
            icon: "none",
            duration: 1200,
          });
        }
      }
    }).catch(() => {});
  },

  consumeAiPendingTodayQuery() {
    let query = null;
    try {
      query = wx.getStorageSync(AI_PENDING_TODAY_QUERY_KEY);
      if (query) {
        wx.removeStorageSync(AI_PENDING_TODAY_QUERY_KEY);
      }
    } catch (error) {
      query = null;
    }
    if (!query || typeof query !== "object" || Array.isArray(query)) return null;
    return query;
  },

  applyAiPendingTodayQuery(query = {}) {
    const action = String(query.action || "focus").toLowerCase();
    if (action === "refresh") {
      this.loadToday();
      this.loadPageConfig();
    }
    wx.showToast({
      title: "已根据 AI 建议打开今日安排",
      icon: "none",
    });
  },

  loadPageConfig() {
    return appConfigService.loadAppConfig()
      .then((config) => {
        const normalizedConfig = Object.assign({
          notices: [],
          urgentNotice: null,
          banners: [],
          appConfig: {},
        }, config || {});
        if (!Array.isArray(normalizedConfig.notices)) normalizedConfig.notices = [];
        if (!Array.isArray(normalizedConfig.banners)) normalizedConfig.banners = [];
        if (normalizedConfig.urgentNotice === undefined) normalizedConfig.urgentNotice = null;
        const urgentNotice = appConfigService.getPageNotices(normalizedConfig, "today")
          .find((notice) => notice.priority === "urgent" && notice.displayMode !== "ticker") || null;
        const latestUpdatedAt = appConfigService.getLatestDataUpdatedAt(normalizedConfig);
        this.setData({
          appConfig: normalizedConfig,
          urgentNotice,
          dataVersionText: latestUpdatedAt ? `数据更新于 ${appConfigService.formatConfigTime(latestUpdatedAt)}` : "",
        });
      })
      .catch((err) => {
        console.warn("今日页公告配置加载失败", err);
        this.setData({
          appConfig: appConfigService.normalizeConfig
            ? appConfigService.normalizeConfig(this.data.appConfig)
            : Object.assign({ notices: [], banners: [], appConfig: {} }, this.data.appConfig || {}),
          urgentNotice: null,
        });
      });
  },

  loadToday() {
    const data = getTodayCoursesData();
    const { hasSchedule, dateText, weekdayText, className, currentWeek, courses } = data;

    const settings = getSettings();
    const { getCourseDataSource } = require("../../utils/course");
    const dataSource = getCourseDataSource();

    let displayClassName = className;
    const { getCurrentScheduleTarget } = require("../../utils/storage");
    const target = getCurrentScheduleTarget();
    if (target) {
      displayClassName = target.type === "teacher"
        ? `${target.name} 老师`
        : (target.type === "classroom" ? `${target.name} 教室` : target.name);
    }

    if (!hasSchedule) {
      this.setData({
        dateText,
        weekdayText,
        className: displayClassName || "未选择当前课表",
        currentWeek,
        dataSourceText: "未绑定课表",
        courseCountText: "今日共 0 门课",
        courses: [],
        emptyTitle: "未绑定当前课表",
        emptyDesc: "请先前往「全校」页面查找班级，并在课表详情页点击「设为当前」进行绑定。"
      });
      return;
    }

    this.setData({
      dateText,
      weekdayText,
      className: displayClassName,
      currentWeek,
      dataSourceText: dataSource.text,
      courseCountText: `今日共 ${courses.length} 门课`,
      courses,
      emptyTitle: "今天没有课程，好好休息",
      emptyDesc: "这里会根据当前班级、教学周和星期自动筛选课程。"
    });
  },


  onCourseTap(event) {
    this.setData({
      selectedCourse: event.detail.course,
      detailVisible: true,
    });
  },

  closeCourseDetail() {
    this.setData({
      selectedCourse: null,
      detailVisible: false,
    });
  },

  goEmptyRoom() {
    wx.navigateTo({
      url: "/pages/empty-room/empty-room",
    });
  },

  goAiAssistant() {
    wx.navigateTo({
      url: `/pages/ai-assistant/ai-assistant?q=${encodeURIComponent("问 AI 分析今天安排")}`,
    });
  },

  onCopyCourseToCustom(event) {
    try {
      customCourseService.saveCustomCourseDraft(event.detail.course || this.data.selectedCourse);
      this.closeCourseDetail();
      wx.navigateTo({
        url: "/pages/custom-courses/custom-courses",
      });
    } catch (error) {
      wx.showToast({
        title: "课程信息不完整",
        icon: "none",
      });
    }
  },
});
