const { courseTimes } = require("../../data/courseTimes");
const { mockCalendar } = require("../../data/mockCalendar");
const { buildScheduleColumns, getCourseDataSource, getCoursesByClass } = require("../../utils/course");
const { getSettings, saveSettings } = require("../../utils/storage");
const { getTodayCoursesData } = require("../../utils/todayReminder");
const appConfigService = require("../../services/appConfigService");
const customCourseService = require("../../services/customCourseService");
const BRAND = require("../../config/brand");
const {
  TOTAL_WEEKS,
  clampWeek,
  formatDateLabel,
  formatWeekRange,
  getCurrentTeachingWeek,
  getTodayTeachingInfo,
  getVisibleWeekdays,
  getWeekRangeByWeekNo,
  mockCalendar: _mc, // 避开未用提示
} = require("../../utils/week");

const PAGE_PADDING_RPX = 32;
const TIME_AXIS_WIDTH = 76;
const WEEKEND_DAY_WIDTH = 142;

function parseDate(dateText) {
  const parts = String(dateText || "").split("-").map(Number);
  return new Date(parts[0], parts[1] - 1, parts[2]);
}

function addDays(dateText, offset) {
  const date = parseDate(dateText);
  date.setDate(date.getDate() + offset);
  return date;
}

function getContentWidthRpx() {
  return 750 - PAGE_PADDING_RPX;
}

function resolveDisplayWeek(settings, now) {
  if (settings.manualWeekOverride) {
    return clampWeek(settings.currentWeek);
  }
  return getCurrentTeachingWeek(now, mockCalendar);
}

Page({
  data: {
    brand: BRAND,
    logoPath: "/assets/logo/favicon.png",
    showLogo: true,
    appName: BRAND.appName,
    className: "未选择课表",
    semester: "2025-2026学年第二学期",
    dataSourceText: "课程数据 · 本地缓存",
    lastSyncText: "",
    currentWeek: 12,
    totalWeeks: TOTAL_WEEKS,
    weekRangeText: "",
    weekScopeText: "周一至周五",
    todayText: "",
    weekSwitcherLabel: "",
    sections: courseTimes,
    sectionHeight: 90,
    scheduleHeight: courseTimes.length * 90,
    gridWidth: 718,
    dayTrackWidth: 642,
    dayColumnWidth: 128,
    weekdays: [],
    dayColumns: [],
    hideInactiveCourses: false,
    showWeekend: false,
    selectedCourse: null,
    detailVisible: false,
    
    // 新增状态
    showInitModal: false,
    showTodayReminder: false,
    todayReminderData: null,
    hasBoundTarget: false,
    showDisclaimerPopup: false,
    showMoreMenu: false,
    appConfig: null,
    dataVersionText: "",
    homeNotice: null,
    tickerNotice: null,
    modalNotice: null,
    selectedNotice: null,
    showNoticeDetail: false,
    showAppNoticeModal: false,
  },

  onLoad(options) {
    if (options && options.shareScheduleId) {
      wx.navigateTo({
        url: `/pages/schedule-view/schedule-view?type=class&name=${encodeURIComponent(options.shareScheduleName || "")}&shareScheduleId=${options.shareScheduleId}`
      });
      return;
    }
    this.loadSchedule();
  },

  onShow() {
    const { isScheduleInitialized, getCurrentScheduleTarget } = require("../../utils/storage");
    const initialized = isScheduleInitialized();
    const target = getCurrentScheduleTarget();
    if (!initialized || !target) {
      this.setData({
        showInitModal: true,
        hasBoundTarget: false,
        className: "未选择课表",
      });
      this.loadSchedule();
      this.loadPageConfig();
    } else {
      this.setData({
        showInitModal: false,
        hasBoundTarget: true,
      });
      this.loadSchedule();
      this.loadPageConfig();
      this.checkTodayReminder();
    }
  },

  loadPageConfig() {
    appConfigService.loadAppConfig()
      .then((config) => {
        const homeNotice = appConfigService.getPrimaryNotice(config, "home", ["banner", "card"]);
        const tickerNotice = appConfigService.getPrimaryNotice(config, "home", ["ticker"]);
        const modalNotice = appConfigService.getPrimaryNotice(config, "home", ["modal"]);
        const latestUpdatedAt = appConfigService.getLatestDataUpdatedAt(config);
        const dataVersionText = latestUpdatedAt
          ? `数据更新于 ${appConfigService.formatConfigTime(latestUpdatedAt)}`
          : "";
        const app = getApp();
        const modalKey = modalNotice ? `${modalNotice.id}:${modalNotice.version}` : "";
        const shouldShowModal = modalNotice &&
          appConfigService.shouldShowNotice(modalNotice) &&
          !(app.globalData.shownModalNoticeIds || {})[modalKey];
        if (shouldShowModal) {
          app.globalData.shownModalNoticeIds = Object.assign({}, app.globalData.shownModalNoticeIds, {
            [modalKey]: true,
          });
        }
        this.setData({
          appConfig: config,
          dataVersionText,
          homeNotice,
          tickerNotice,
          modalNotice,
          showAppNoticeModal: Boolean(shouldShowModal),
        });
      })
      .catch((err) => {
        console.warn("首页公告配置加载失败", err);
      });
  },

  loadSchedule() {
    const settings = getSettings();
    const { getCurrentScheduleTarget } = require("../../utils/storage");
    const target = getCurrentScheduleTarget();
    const hasBoundTarget = !!target;
    
    const now = new Date();
    const todayInfo = getTodayTeachingInfo(now, mockCalendar);
    const currentWeek = resolveDisplayWeek(settings, now);
    const weekInfo = getWeekRangeByWeekNo(currentWeek, mockCalendar);
    const showWeekend = settings.showWeekend || false;
    const weekendShowMode = settings.weekendShowMode || "overview";
    
    const baseWeekdays = getVisibleWeekdays(showWeekend, now);
    const weekdays = baseWeekdays.map((day, index) => {
      const date = addDays(weekInfo.startDate, index);
      return Object.assign({}, day, {
        dateLabel: formatDateLabel(date),
        isToday: currentWeek === todayInfo.weekNo && day.weekday === todayInfo.weekday,
      });
    });
    
    const courses = getCoursesByClass(settings.className);
    const dataSource = getCourseDataSource();
    const dayColumns = buildScheduleColumns(courses, weekdays, currentWeek, {
      sectionHeight: 90,
      hideInactiveCourses: settings.hideInactiveCourses,
    });
    
    const contentWidth = getContentWidthRpx();
    let dayColumnWidth = 128;
    let scrollX = false;
    
    if (showWeekend) {
      if (weekendShowMode === "detail") {
        dayColumnWidth = WEEKEND_DAY_WIDTH; // 142
        scrollX = true;
      } else {
        // 七天概览模式，一屏显示周一至周日，无横滚
        dayColumnWidth = Math.floor((contentWidth - TIME_AXIS_WIDTH) / 7); // (750 - 32 - 76) / 7 = 91
        scrollX = false;
      }
    } else {
      // 五天详细，一屏无横滚
      dayColumnWidth = Math.floor((contentWidth - TIME_AXIS_WIDTH) / 5); // 128
      scrollX = false;
    }
    
    const dayTrackWidth = dayColumnWidth * weekdays.length;
    const gridWidth = TIME_AXIS_WIDTH + dayTrackWidth;
    const weekRangeText = formatWeekRange(weekInfo.startDate, weekInfo.endDate);

    let displayClassName = settings.className || "未选择课表";
    let lastSyncText = "";
    if (target) {
      displayClassName = target.type === "teacher"
        ? `${target.name} 老师`
        : (target.type === "classroom" ? `${target.name} 教室` : target.name);
      lastSyncText = target.updateTime || "";
    }

    this.setData({
      className: displayClassName,
      semester: settings.semester,
      dataSourceText: dataSource.text,
      lastSyncText,
      currentWeek,
      weekRangeText,
      weekScopeText: showWeekend ? "周一至周日" : "周一至周五",
      todayText: `${todayInfo.dateLabel} ${todayInfo.weekdayLabel}`,
      weekSwitcherLabel: `${weekRangeText} · 第${currentWeek}周`,
      gridWidth,
      dayTrackWidth,
      dayColumnWidth,
      weekdays,
      dayColumns,
      hideInactiveCourses: settings.hideInactiveCourses,
      showWeekend: showWeekend,
      weekendShowMode: weekendShowMode,
      scrollX: scrollX,
      hasBoundTarget,
    });
  },

  onWeekChange(event) {
    const type = event.detail.type;
    const nextWeek = type === "current" ? getCurrentTeachingWeek(new Date(), mockCalendar) : clampWeek(event.detail.week);
    saveSettings({
      currentWeek: nextWeek,
      manualWeekOverride: type !== "current",
    });
    this.loadSchedule();
  },

  onCourseTap(event) {
    this.setData({
      selectedCourse: event.detail.course,
      detailVisible: true,
    });
  },

  closeCourseDetail() {
    this.setData({
      detailVisible: false,
      selectedCourse: null,
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

  onLogoError() {
    this.setData({
      showLogo: false,
    });
  },

  goSchool() {
    wx.switchTab({
      url: "/pages/school/school",
    });
  },

  goLogin() {
    wx.navigateTo({
      url: "/pages/personal-sync/personal-sync"
    });
  },

  goTimetable() {
    wx.navigateTo({
      url: "/pages/timetable/timetable",
    });
  },

  goCustomCourses() {
    wx.navigateTo({
      url: "/pages/custom-courses/custom-courses",
    });
  },

  // 引导弹窗方法
  goToSelectClass() {
    this.setData({ showInitModal: false });
    wx.switchTab({
      url: "/pages/school/school"
    });
  },

  skipSelect() {
    const { clearCurrentScheduleTarget } = require("../../utils/storage");
    clearCurrentScheduleTarget();
    wx.setStorageSync("hasInitializedSchedule", true);
    this.setData({
      showInitModal: false,
      hasBoundTarget: false,
      className: "请选择课表"
    });
    this.loadSchedule();
  },

  goToSyncLogin() {
    wx.navigateTo({
      url: "/pages/personal-sync/personal-sync"
    });
  },

  // 今日课程自动弹窗提醒
  checkTodayReminder() {
    const settings = getSettings();
    if (settings.enableTodayStartupReminder === false) {
      return;
    }
    const app = getApp();
    if (app.globalData.hasShownTodayReminderThisSession) {
      return;
    }
    const now = new Date();
    const todayDateText = `${now.getFullYear()}-${now.getMonth() + 1}-${now.getDate()}`;
    const lastDate = wx.getStorageSync("lastTodayReminderDate");
    if (lastDate === todayDateText) {
      return;
    }

    const todayData = getTodayCoursesData();
    app.globalData.hasShownTodayReminderThisSession = true;
    wx.setStorageSync("lastTodayReminderDate", todayDateText);

    this.setData({
      showTodayReminder: true,
      todayReminderData: todayData
    });
  },

  showTodayReminderManual() {
    const todayData = getTodayCoursesData();
    this.setData({
      showTodayReminder: true,
      todayReminderData: todayData
    });
  },

  closeTodayReminder() {
    this.setData({
      showTodayReminder: false
    });
  },

  goToTodayPage() {
    this.closeTodayReminder();
    wx.switchTab({
      url: "/pages/today/today"
    });
  },

  // 更多菜单
  toggleMoreMenu() {
    this.setData({
      showMoreMenu: !this.data.showMoreMenu
    });
  },

  hideMoreMenu() {
    this.setData({
      showMoreMenu: false
    });
  },

  refreshData() {
    this.hideMoreMenu();
    wx.showLoading({ title: "正在刷新..." });
    const { clearDataCaches } = require("../../utils/storage");
    clearDataCaches();
    getApp().loadBootstrapData();
    getApp().loadAppConfigData({ force: true }).then(() => this.loadPageConfig());
    setTimeout(() => {
      wx.hideLoading();
      this.loadSchedule();
      wx.showToast({ title: "已更新成功", icon: "success" });
    }, 1000);
  },

  clearLocalCache() {
    this.hideMoreMenu();
    wx.showModal({
      title: "提示",
      content: "确定要清除所有缓存吗？",
      success: (res) => {
        if (res.confirm) {
          const { clearAppCache, clearCurrentScheduleTarget } = require("../../utils/storage");
          clearAppCache();
          clearCurrentScheduleTarget();
          this.onShow();
        }
      }
    });
  },

  showDisclaimer() {
    this.hideMoreMenu();
    this.setData({
      showDisclaimerPopup: true
    });
  },

  closeDisclaimer() {
    this.setData({
      showDisclaimerPopup: false
    });
  },

  showNotice(event) {
    const type = event.currentTarget.dataset.type;
    const notice = type === "ticker" ? this.data.tickerNotice : this.data.homeNotice;
    if (!notice) return;
    this.setData({
      selectedNotice: notice,
      showNoticeDetail: true,
    });
  },

  closeNoticeDetail() {
    this.setData({
      showNoticeDetail: false,
      selectedNotice: null,
    });
  },

  dismissHomeNotice() {
    const notice = this.data.homeNotice;
    if (notice) {
      appConfigService.dismissNotice(notice);
    }
    this.setData({
      homeNotice: null,
    });
  },

  closeAppNoticeModal() {
    const notice = this.data.modalNotice;
    if (notice && notice.closable !== false) {
      appConfigService.dismissNotice(notice);
    }
    this.setData({
      showAppNoticeModal: false,
    });
  },

  onShareAppMessage() {
    const className = this.data.className;
    const title = className && className !== "未选择课表" && className !== "请选择课表"
      ? `${className}的课程安排 · ${BRAND.appName}`
      : `${BRAND.appName}｜查看课程安排`;
    return {
      title: title,
      path: "/pages/index/index"
    };
  },

  noop() {},
});
