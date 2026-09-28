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

Page({
  data: {
    title: "周课表",
    headerTop: 64,
    currentWeek: 1,
    totalWeeks: TOTAL_WEEKS,
    weekRangeText: "",
    showBackToCurrentWeek: false,
    sections: courseTimes,
    sectionHeight: 90,
    scheduleHeight: courseTimes.length * 90,
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
    this.setData({ headerTop: menu && menu.bottom ? menu.bottom + 4 : (info.statusBarHeight || 24) + 40 });
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
      sectionHeight: 90,
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
