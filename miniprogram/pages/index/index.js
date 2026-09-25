const { courseTimes } = require("../../data/courseTimes");
const { buildScheduleColumns, getCourseDataSource, getCoursesByClass } = require("../../utils/course");
const { getSettings, saveSettings } = require("../../utils/storage");
const { resolveAdjacentWeek, resolveWeekSwipeDirection } = require("../../utils/weekSwipe");
const { getTodayCoursesData, shouldShowTodayStartupReminder } = require("../../utils/todayReminder");
const appConfigService = require("../../services/appConfigService");
const dailyKnowledgeCloudService = require("../../services/dailyKnowledgeCloudService");
const customCourseService = require("../../services/customCourseService");
const currentScheduleService = require("../../services/currentScheduleService");
const teachingCalendarService = require("../../services/teachingCalendarService");
const { buildWeekPickerOptions } = require("../../utils/weekPicker");
const courseOverrideService = require("../../services/courseOverrideService");
const BRAND = require("../../config/brand");
const {
  TOTAL_WEEKS,
  addLocalDays,
  clampWeek,
  formatDate,
  formatDateLabel,
  formatWeekRange,
  getCurrentTeachingWeek,
  getTeachingPeriodText,
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
  const className = String(metadata.className || "").trim();
  const reliableClass = className && !/班级未确认|班级待确认|未知班级/.test(className) ? className : "";
  const subtitle = [reliableClass, term, "学号同步"].filter(Boolean).join(" · ");
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
    semester: "",
    dataSourceText: "课程数据 · 本地缓存",
    lastSyncText: "",
    syncActionText: "同步课表",
    currentWeek: 12,
    teachingPeriodText: "教学周待同步",
    termPhase: "unknown",
    totalWeeks: TOTAL_WEEKS,
    weekRangeText: "",
    weekScopeText: "周一至周五",
    todayText: "",
    weekSwitcherLabel: "",
    weekPickerOpen: false,
    weekOptions: [],
    sections: courseTimes,
    sectionHeight: 90,
    scheduleHeight: courseTimes.length * 90,
    gridWidth: 718,
    dayTrackWidth: 642,
    dayColumnWidth: 128,
    weekdays: [],
    dayColumns: [],
    hideInactiveCourses: true,
    showWeekend: true,
    weekendShowMode: "overview",
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
    dailyKnowledge: null,
    tickerNotice: null,
    modalNotice: null,
    selectedNotice: null,
    showNoticeDetail: false,
    showAppNoticeModal: false,
  },

  onLoad(options) {
    this._weekSwipeState = null;
    this._suppressCourseTapUntil = 0;
    if (options && options.shareScheduleId) {
      wx.navigateTo({
        url: `/pages/schedule-view/schedule-view?type=class&name=${encodeURIComponent(options.shareScheduleName || "")}&shareScheduleId=${options.shareScheduleId}`
      });
      return;
    }
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
        const serverDailyKnowledge = normalizedConfig.dailyKnowledge || null;
        this.setData({
          appConfig: normalizedConfig,
          dataVersionText,
          homeNotice,
          dailyKnowledge: serverDailyKnowledge,
          tickerNotice,
          modalNotice,
          showAppNoticeModal: Boolean(shouldShowModal),
        });
        dailyKnowledgeCloudService.loadDailyKnowledge({ fallback: serverDailyKnowledge })
          .then((dailyKnowledge) => {
            if (dailyKnowledge) this.setData({ dailyKnowledge });
          })
          .catch(() => {});
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
      normalized: true,
      targetType: target && target.type || "class",
      targetId: target && (target.detailId || target.id || target.classId) || settings.classId || "",
      targetName: target && (target.name || target.className) || settings.className || "",
      semester: target && (target.term || target.semester) || termConfig.term || "",
      releaseVersion: target && (target.scheduleVersion || target.releaseVersion) || calendar.releaseVersion || "",
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
      semester: calendar.semesterText || termConfig.semesterText || termConfig.term || "",
      dataSourceText: sourceText,
      lastSyncText,
      syncActionText,
      currentWeek,
      teachingPeriodText: getTeachingPeriodText(todayInfo, currentWeek),
      termPhase: todayInfo.termPhase || "unknown",
      totalWeeks: termConfig.totalWeeks || TOTAL_WEEKS,
      weekRangeText,
      weekScopeText: showWeekend ? "周一至周日" : "周一至周五",
      todayText: `${todayInfo.dateLabel} ${todayInfo.weekdayLabel}`,
      weekSwitcherLabel,
      weekOptions: buildWeekPickerOptions(calendar),
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
    const detail = event && event.detail || {};
    const type = detail.type;
    if (type !== "prev" && type !== "next" && type !== "current" && type !== "select") return;
    const calendar = teachingCalendarService.getImmediateActiveCalendar();
    const termConfig = calendar.termConfig || {};
    const nextWeek = type === "current"
      ? getCurrentTeachingWeek(new Date(), calendar.weeks || [], termConfig)
      : clampWeek(detail.week, termConfig);
    if (type !== "current" && nextWeek === this.data.currentWeek) return;
    saveSettings({
      currentWeek: nextWeek,
      manualWeekOverride: type !== "current",
    });
    this.loadSchedule();
  },

  onWeekPickerModalChange(event) {
    this.setData({ weekPickerOpen: Boolean(event.detail && event.detail.visible) });
  },

  canHandleScheduleSwipe() {
    return !(this.data.showWeekend && this.data.weekendShowMode === "detail") &&
      !this.data.weekPickerOpen &&
      !this.data.detailVisible &&
      !this.data.showUnplacedCourses &&
      !this.data.showTodayReminder &&
      !this.data.showDisclaimerPopup &&
      !this.data.showMoreMenu &&
      !this.data.showNoticeDetail &&
      !this.data.showAppNoticeModal;
  },

  onScheduleTouchStart(event) {
    const touches = event && event.touches || [];
    if (!this.canHandleScheduleSwipe() || touches.length !== 1) {
      this._weekSwipeState = null;
      return;
    }
    const touch = touches[0];
    this._weekSwipeState = {
      start: { clientX: touch.clientX, clientY: touch.clientY },
      last: { clientX: touch.clientX, clientY: touch.clientY },
    };
  },

  onScheduleTouchMove(event) {
    const touches = event && event.touches || [];
    if (!this._weekSwipeState || touches.length !== 1) return;
    const touch = touches[0];
    this._weekSwipeState.last = { clientX: touch.clientX, clientY: touch.clientY };
  },

  onScheduleTouchEnd(event) {
    const swipeState = this._weekSwipeState;
    this._weekSwipeState = null;
    if (!swipeState || !this.canHandleScheduleSwipe()) return;
    const changedTouches = event && event.changedTouches || [];
    const end = changedTouches.length === 1 ? changedTouches[0] : swipeState.last;
    const direction = resolveWeekSwipeDirection(swipeState.start, end);
    if (!direction) return;

    // A committed horizontal gesture must not also open the course card that
    // happened to be under the finger when touchend fired.
    this._suppressCourseTapUntil = Date.now() + 240;
    const adjacent = resolveAdjacentWeek(this.data.currentWeek, this.data.totalWeeks, direction);
    if (!adjacent.changed) return;
    this.onWeekChange({
      detail: {
        type: direction,
        week: adjacent.week,
        source: "swipe",
      },
    });
  },

  onScheduleTouchCancel() {
    this._weekSwipeState = null;
  },

  onCourseTap(event) {
    if (Date.now() < Number(this._suppressCourseTapUntil || 0)) return;
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

  onEditExistingCourse(event) {
    try {
      courseOverrideService.saveEditDraft(event.detail.course || this.data.selectedCourse);
      this.closeCourseDetail();
      wx.navigateTo({ url: "/pages/custom-courses/custom-courses" });
    } catch (error) {
      wx.showToast({ title: "请从个性化页面选择课程", icon: "none" });
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
    const pad = (value) => String(value).padStart(2, "0");
    const todayDateText = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
    const lastDate = wx.getStorageSync("lastTodayReminderDate");
    if (lastDate === todayDateText) {
      return;
    }

    const todayData = getTodayCoursesData();
    if (!shouldShowTodayStartupReminder(todayData)) {
      return;
    }
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
