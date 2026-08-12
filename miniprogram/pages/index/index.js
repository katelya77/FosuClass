const { courseTimes } = require("../../data/courseTimes");
const { buildScheduleColumns, getCourseDataSource, getCoursesByClass } = require("../../utils/course");
const { getSettings, saveSettings } = require("../../utils/storage");
const { getTodayCoursesData } = require("../../utils/todayReminder");
const appConfigService = require("../../services/appConfigService");
const customCourseService = require("../../services/customCourseService");
const currentScheduleService = require("../../services/currentScheduleService");
const teachingCalendarService = require("../../services/teachingCalendarService");
const BRAND = require("../../config/brand");
const {
  TOTAL_WEEKS,
  addLocalDays,
  clampWeek,
  formatDate,
  formatDateLabel,
  formatWeekRange,
  getCurrentTeachingWeek,
  getTodayTeachingInfo,
  getVisibleWeekdays,
  getWeekRangeByWeekNo,
} = require("../../utils/week");

const PAGE_PADDING_RPX = 32;
const TIME_AXIS_WIDTH = 76;
const WEEKEND_DAY_WIDTH = 142;

function getContentWidthRpx() {
  return 750 - PAGE_PADDING_RPX;
}

function resolveDisplayWeek(settings, todayInfo, termConfig) {
  if (settings.manualWeekOverride) {
    return clampWeek(settings.currentWeek, termConfig);
  }
  return todayInfo.weekNo;
}

function calendarChanged(left, right) {
  if (!left || !right) return Boolean(left || right);
  return left.term !== right.term ||
    left.releaseVersion !== right.releaseVersion ||
    JSON.stringify(left.termConfig || {}) !== JSON.stringify(right.termConfig || {}) ||
    JSON.stringify((left.weeks || []).map((week) => [week.weekNo, week.startDate, week.endDate, week.note || week.notes || ""])) !==
      JSON.stringify((right.weeks || []).map((week) => [week.weekNo, week.startDate, week.endDate, week.note || week.notes || ""]));
}

function buildPersonalXlsHeader(target) {
  const metadata = (target && target.metadata) || {};
  const title = target.title || target.name || (metadata.className
    ? `${metadata.className}课表`
    : (metadata.studentName ? `${metadata.studentName}的课表` : "个人课表"));
  const term = metadata.term || target.semester || "";
  const subtitle = target.subtitle || [metadata.studentName, term, "XLS导入"].filter(Boolean).join(" · ");
  return {
    title,
    subtitle,
    sourceText: target.sourceText || "100网 XLS 手动导入",
  };
}

function buildPersonalApaasHeader(target) {
  const metadata = (target && target.metadata) || {};
  const title = target.title || target.name || (metadata.studentName ? `${metadata.studentName}的个人课表` : "个人课表");
  const term = metadata.term || target.semester || "";
  const subtitle = target.subtitle || [metadata.className || "班级未确认", term, "学号导入"].filter(Boolean).join(" · ");
  return {
    title,
    subtitle,
    sourceText: target.sourceText || "学校课表系统",
  };
}

function decorateUnplacedCourses(courses) {
  return (Array.isArray(courses) ? courses : []).map((course, index) => ({
    id: course.id || course.arrangementId || `unplaced-${index}`,
    courseName: course.displayCourseName || course.courseName || "未命名课程",
    reason: course.reason || course.note || course.specialNote || "时间信息需要确认",
    teacherName: course.teacherName || "",
    roomName: course.roomName || course.classroom || "未注明",
    weekText: course.weekText || "周次待确认",
    sectionText: course.sectionText || "节次待确认",
  }));
}

Page({
  data: {
    brand: BRAND,
    logoPath: "/assets/logo/favicon.png",
    showLogo: true,
    appName: BRAND.appName,
    className: "未选择课表",
    scheduleSubtitle: "",
    semester: "2025-2026学年第二学期",
    dataSourceText: "课程数据 · 本地缓存",
    lastSyncText: "",
    syncActionText: "同步课表",
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
    unplacedCourses: [],
    unplacedCourseCount: 0,
    showUnplacedCourses: false,
    
    // 新增状态
    showInitModal: false,
    showTodayReminder: false,
    todayReminderData: null,
    hasBoundTarget: false,
    showDisclaimerPopup: false,
    showMoreMenu: false,
    appConfig: { notices: [], banners: [], news: [], appConfig: {} },
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
      this.refreshCurrentTargetSilently();
    }
  },

  refreshCurrentTargetSilently() {
    currentScheduleService.ensureCurrentScheduleFresh({
      silent: true,
      notify: true,
    }).then((result) => {
      if (result && result.status === "UPDATED") {
        this.loadSchedule();
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

  loadPageConfig() {
    return appConfigService.loadAppConfig()
      .then((config) => {
        const normalizedConfig = appConfigService.normalizeConfig
          ? appConfigService.normalizeConfig(config)
          : Object.assign({ notices: [], banners: [], news: [], appConfig: {} }, config || {});
        const homeNotice = appConfigService.getPrimaryNotice(normalizedConfig, "home", ["banner", "card"]) || null;
        const tickerNotice = appConfigService.getPrimaryNotice(normalizedConfig, "home", ["ticker"]) || null;
        const modalNotice = appConfigService.getPrimaryNotice(normalizedConfig, "home", ["modal"]) || null;
        const latestUpdatedAt = appConfigService.getLatestDataUpdatedAt(normalizedConfig);
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
          appConfig: normalizedConfig,
          dataVersionText,
          homeNotice,
          tickerNotice,
          modalNotice,
          showAppNoticeModal: Boolean(shouldShowModal),
        });
      })
      .catch((err) => {
        console.warn("首页公告配置加载失败", err);
        this.setData({
          appConfig: appConfigService.normalizeConfig
            ? appConfigService.normalizeConfig(this.data.appConfig)
            : Object.assign({ notices: [], banners: [], news: [], appConfig: {} }, this.data.appConfig || {}),
        });
      });
  },

  loadSchedule() {
    const calendar = teachingCalendarService.getImmediateActiveCalendar();
    this.renderScheduleWithCalendar(calendar);
    teachingCalendarService.loadActiveTeachingCalendar()
      .then((latest) => {
        if (calendarChanged(calendar, latest)) {
          this.renderScheduleWithCalendar(latest);
        }
      })
      .catch(() => {});
  },

  renderScheduleWithCalendar(calendar) {
    const settings = getSettings();
    const { getCurrentScheduleTarget } = require("../../utils/storage");
    const target = getCurrentScheduleTarget();
    const hasBoundTarget = !!target;
    const termConfig = calendar.termConfig || {};
    const calendarWeeks = calendar.weeks || [];
    
    const now = new Date();
    const todayInfo = getTodayTeachingInfo(now, calendarWeeks, termConfig);
    const currentWeek = resolveDisplayWeek(settings, todayInfo, termConfig);
    const weekInfo = getWeekRangeByWeekNo(currentWeek, calendarWeeks, termConfig);
    const showWeekend = settings.showWeekend || false;
    const weekendShowMode = settings.weekendShowMode || "overview";
    
    const baseWeekdays = getVisibleWeekdays(showWeekend, now);
    const weekdays = baseWeekdays.map((day, index) => {
      const date = addLocalDays(weekInfo.startDate, index);
      const dateInfo = getTodayTeachingInfo(date, calendarWeeks, termConfig);
      return Object.assign({}, day, {
        date: formatDate(date),
        dateLabel: formatDateLabel(date),
        isToday: currentWeek === todayInfo.rawWeekNo && day.weekday === todayInfo.physicalWeekday,
        isTeachingDay: dateInfo.isTeachingDay,
        scheduleWeek: dateInfo.weekNo,
        scheduleWeekday: dateInfo.weekday,
        teachingEventType: dateInfo.teachingEventType,
        teachingEventNote: dateInfo.teachingEventNote,
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
    const weekSwitcherLabel = weekRangeText ? `${weekRangeText} · 第${currentWeek}周` : `日期待同步 · 第${currentWeek}周`;

    let displayClassName = settings.className || "未选择课表";
    let scheduleSubtitle = "";
    let lastSyncText = "";
    let syncActionText = "同步课表";
    let sourceText = dataSource.text;
    if (target) {
      if (target.type === "personal-xls" || target.type === "personal-apaas") {
        const header = target.type === "personal-apaas"
          ? buildPersonalApaasHeader(target)
          : buildPersonalXlsHeader(target);
        displayClassName = header.title;
        scheduleSubtitle = header.subtitle;
        sourceText = header.sourceText;
        syncActionText = "更新导入";
      } else {
        displayClassName = target.type === "teacher"
          ? `${target.name} 老师`
          : (target.type === "classroom" ? `${target.name} 教室` : target.name);
      }
      lastSyncText = target.updateTime || "";
    }
    const unplacedCourses = decorateUnplacedCourses(target && target.unplacedCourses);

    this.setData({
      className: displayClassName,
      scheduleSubtitle,
      semester: settings.semester,
      dataSourceText: sourceText,
      lastSyncText,
      syncActionText,
      currentWeek,
      totalWeeks: termConfig.totalWeeks || TOTAL_WEEKS,
      weekRangeText,
      weekScopeText: showWeekend ? "周一至周日" : "周一至周五",
      todayText: `${todayInfo.dateLabel} ${todayInfo.weekdayLabel}`,
      weekSwitcherLabel,
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
      unplacedCourses,
      unplacedCourseCount: unplacedCourses.length,
    });
  },

  onWeekChange(event) {
    const type = event.detail.type;
    const calendar = teachingCalendarService.getImmediateActiveCalendar();
    const termConfig = calendar.termConfig || {};
    const nextWeek = type === "current"
      ? getCurrentTeachingWeek(new Date(), calendar.weeks || [], termConfig)
      : clampWeek(event.detail.week, termConfig);
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

  showUnplacedCourses() {
    if (!this.data.unplacedCourseCount) return;
    this.setData({ showUnplacedCourses: true });
  },

  closeUnplacedCourses() {
    this.setData({ showUnplacedCourses: false });
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

  goAiAssistant() {
    this.hideMoreMenu();
    wx.navigateTo({
      url: "/packageXiaofu/pages/ai-assistant/ai-assistant",
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

  async refreshData() {
    this.hideMoreMenu();
    const { getCurrentScheduleTarget } = require("../../utils/storage");
    const target = getCurrentScheduleTarget();
    if (!target) {
      wx.showToast({ title: "请先选择课表", icon: "none" });
      return;
    }
    wx.showLoading({ title: "正在刷新..." });
    const app = getApp();
    try {
      if (typeof app.checkReleasePackForeground === "function") {
        await app.checkReleasePackForeground();
      }
      const result = await currentScheduleService.ensureCurrentScheduleFresh({
        force: true,
        forceNetwork: true,
        forcePointer: true,
      });
      await Promise.all([
        app.loadBootstrapData({ force: true, silent: true }).catch(() => null),
        app.loadAppConfigData({ force: true, silent: true }).catch(() => null),
        teachingCalendarService.loadActiveTeachingCalendar({ forceNetwork: true }).catch(() => null),
      ]);
      await this.loadPageConfig();
      wx.hideLoading();
      this.loadSchedule();
      let title = "当前已是最新课表";
      if (result && result.status === "UPDATED") {
        title = "课表已更新";
      } else if (result && result.status === "PROTECTED_PERSONAL_XLS") {
        title = "个人课表请重新导入更新";
      } else if (result && result.status === "AMBIGUOUS") {
        title = "找到多个同名课表，请重新确认";
      } else if (result && result.success === false) {
        title = "网络暂不可用，已保留当前课表";
      }
      wx.showToast({ title, icon: result && result.status === "UPDATED" ? "success" : "none" });
    } catch (error) {
      wx.hideLoading();
      this.loadSchedule();
      wx.showToast({ title: "网络暂不可用，已保留当前课表", icon: "none" });
    }
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
