const { courseTimes } = require("../../data/courseTimes");
const { buildScheduleColumns, normalizeCourse } = require("../../utils/course");
const { getSettings } = require("../../utils/storage");
const teachingCalendarService = require("../../services/teachingCalendarService");
const customCourseService = require("../../services/customCourseService");
const { resolveAdjacentWeek, resolveWeekSwipeDirection } = require("../../utils/weekSwipe");
const {
  TOTAL_WEEKS, addLocalDays, clampWeek, formatDate, formatDateLabel,
  formatWeekRange, getCurrentTeachingWeek, getTodayTeachingInfo,
  getVisibleWeekdays, getWeekRangeByWeekNo,
} = require("../../utils/week");

const DEFAULT_SECTION_HEIGHT = 84;
const FULLSCREEN_CHROME_HEIGHT_RPX = 314;

function getFittedSectionHeight(info, headerTop) {
  const windowInfo = typeof wx.getWindowInfo === "function" ? wx.getWindowInfo() : {};
  const width = Number(windowInfo.windowWidth || info.windowWidth);
  const height = Number(windowInfo.screenHeight || info.screenHeight || windowInfo.windowHeight || info.windowHeight);
  if (!width || !height) return DEFAULT_SECTION_HEIGHT;
  const safeArea = windowInfo.safeArea || info.safeArea;
  const bottomInset = safeArea && Number(safeArea.bottom)
    ? Math.max(18, height - Number(safeArea.bottom)) : 24;
  const availableRpx = (height - headerTop - bottomInset) * 750 / width - FULLSCREEN_CHROME_HEIGHT_RPX;
  return Math.max(54, Math.min(90, Math.floor(availableRpx / courseTimes.length)));
}

Page({
  data: {
    title: "周课表",
    headerTop: 24,
    currentWeek: 1,
    totalWeeks: TOTAL_WEEKS,
    weekRangeText: "",
    showBackToCurrentWeek: false,
    sections: courseTimes,
    sectionHeight: DEFAULT_SECTION_HEIGHT,
    scheduleHeight: courseTimes.length * DEFAULT_SECTION_HEIGHT,
    dayTrackWidth: 642,
    dayColumnWidth: 128,
    weekdays: [],
    dayColumns: [],
    scrollX: false,
    showWeekend: true,
    weekendShowMode: "overview",
    zoomed: false,
    selectedCourse: null,
    detailVisible: false,
  },

  onLoad() {
    const info = wx.getSystemInfoSync();
    const menu = typeof wx.getMenuButtonBoundingClientRect === "function"
      ? wx.getMenuButtonBoundingClientRect() : null;
    // 自定义导航栏与右上角胶囊处于同一行；只避开系统状态栏。
    const statusBarHeight = Number(info.statusBarHeight) || (menu && menu.top ? Math.max(0, menu.top - 8) : 24);
    const sectionHeight = getFittedSectionHeight(info, statusBarHeight);
    this.setData({
      headerTop: statusBarHeight,
      sectionHeight,
      scheduleHeight: courseTimes.length * sectionHeight,
    });
    const channel = this.getOpenerEventChannel();
    if (channel && typeof channel.on === "function") {
      channel.on("schedule", (payload) => {
        const source = payload || {};
        this._courses = Array.isArray(source.courses) ? source.courses.map(normalizeCourse) : [];
        this._target = source.target || {};
        this._calendar = teachingCalendarService.getImmediateActiveCalendar({ term: this._target.term || this._target.semester });
        const termConfig = this._calendar.termConfig || {};
        this.setData({
          title: source.title || "周课表",
          currentWeek: clampWeek(source.week || 1, termConfig),
          totalWeeks: termConfig.totalWeeks || TOTAL_WEEKS,
          showWeekend: source.showWeekend !== false,
          weekendShowMode: source.weekendShowMode || "overview",
        }, () => this.renderSchedule());
      });
    }
  },

  renderSchedule() {
    const calendar = this._calendar;
    if (!calendar) return;
    const termConfig = calendar.termConfig || {};
    const weeks = calendar.weeks || [];
    const now = new Date();
    const week = this.data.currentWeek;
    const weekInfo = getWeekRangeByWeekNo(week, weeks, termConfig);
    const today = getTodayTeachingInfo(now, weeks, termConfig);
    const weekdays = getVisibleWeekdays(this.data.showWeekend, now).map((day, index) => {
      const date = addLocalDays(weekInfo.startDate, index);
      const info = getTodayTeachingInfo(date, weeks, termConfig);
      return Object.assign({}, day, {
        date: formatDate(date), dateLabel: formatDateLabel(date),
        isToday: week === today.rawWeekNo && day.weekday === today.physicalWeekday,
        isTeachingDay: info.isTeachingDay, scheduleWeek: info.weekNo,
        scheduleWeekday: info.weekday, teachingEventType: info.teachingEventType,
        teachingEventNote: info.teachingEventNote,
      });
    });
    const settings = getSettings();
    const target = this._target || {};
    const dayColumns = buildScheduleColumns(this._courses || [], weekdays, week, {
      sectionHeight: this.data.sectionHeight,
      hideInactiveCourses: settings.hideInactiveCourses,
      normalized: true,
      targetType: target.type || "class",
      targetId: target.detailId || target.id || target.classId || "",
      targetName: target.name || target.className || "",
      semester: target.term || target.semester || termConfig.term || "",
      releaseVersion: target.scheduleVersion || target.releaseVersion || calendar.releaseVersion || "",
    });
    const scrollX = this.data.zoomed || this.data.showWeekend && this.data.weekendShowMode === "detail";
    const dayColumnWidth = this.data.zoomed ? 166 : scrollX ? 142 : Math.floor((750 - 76) / weekdays.length);
    this.setData({
      weekRangeText: formatWeekRange(weekInfo.startDate, weekInfo.endDate),
      showBackToCurrentWeek: week !== getCurrentTeachingWeek(now, weeks, termConfig),
      weekdays, dayColumns, scrollX, dayColumnWidth,
      dayTrackWidth: dayColumnWidth * weekdays.length,
    });
  },

  changeWeek(direction) {
    const next = resolveAdjacentWeek(this.data.currentWeek, this.data.totalWeeks, direction);
    if (next.changed) this.setData({ currentWeek: next.week }, () => {
      this.renderSchedule();
      this.notifyWeekChange();
    });
  },
  previousWeek() { this.changeWeek("prev"); },
  nextWeek() { this.changeWeek("next"); },
  toggleZoom() { this.setData({ zoomed: !this.data.zoomed }, () => this.renderSchedule()); },
  backToCurrentWeek() {
    const calendar = this._calendar;
    if (!calendar) return;
    const week = getCurrentTeachingWeek(new Date(), calendar.weeks || [], calendar.termConfig || {});
    this.setData({ currentWeek: week }, () => {
      this.renderSchedule();
      this.notifyWeekChange();
    });
  },
  notifyWeekChange() {
    const channel = this.getOpenerEventChannel();
    if (channel && typeof channel.emit === "function") channel.emit("weekChange", { week: this.data.currentWeek });
  },
  exitFullscreen() { wx.navigateBack(); },
  onScheduleTouchStart(event) {
    if (this.data.detailVisible || this.data.scrollX || !event.touches || event.touches.length !== 1) return;
    const touch = event.touches[0];
    this._touchStart = { clientX: touch.clientX, clientY: touch.clientY };
  },
  onScheduleTouchEnd(event) {
    const start = this._touchStart;
    this._touchStart = null;
    const touch = event.changedTouches && event.changedTouches[0];
    const direction = resolveWeekSwipeDirection(start, touch);
    if (direction) {
      this._suppressCourseTapUntil = Date.now() + 240;
      this.changeWeek(direction);
    }
  },
  onScheduleTouchCancel() { this._touchStart = null; },
  onCourseTap(event) {
    if (Date.now() < Number(this._suppressCourseTapUntil || 0)) return;
    this.setData({ selectedCourse: event.detail.course, detailVisible: true });
  },
  closeCourseDetail() { this.setData({ selectedCourse: null, detailVisible: false }); },
  onCopyCourseToCustom(event) {
    try {
      customCourseService.saveCustomCourseDraft(event.detail.course || this.data.selectedCourse);
      this.closeCourseDetail();
      wx.navigateTo({ url: "/pages/custom-courses/custom-courses" });
    } catch (error) {
      wx.showToast({ title: "课程信息不完整", icon: "none" });
    }
  },
});
