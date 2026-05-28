const { courseTimes } = require("../../data/courseTimes");
const { mockCalendar } = require("../../data/mockCalendar");
const { buildScheduleColumns, getCourseDataSource, getCoursesByClass } = require("../../utils/course");
const { getSettings, saveSettings } = require("../../utils/storage");
const {
  TOTAL_WEEKS,
  clampWeek,
  formatDateLabel,
  formatWeekRange,
  getCurrentTeachingWeek,
  getTodayTeachingInfo,
  getVisibleWeekdays,
  getWeekRangeByWeekNo,
} = require("../../utils/week");

const SECTION_HEIGHT = 90;
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
    logoPath: "/assets/logo/favicon.png",
    showLogo: true,
    appName: "佛大课表",
    className: "25动物医学6",
    semester: "2025-2026学年第二学期",
    dataSourceText: "教务课表 · 本地缓存",
    lastSyncText: "",
    currentWeek: 12,
    totalWeeks: TOTAL_WEEKS,
    weekRangeText: "",
    weekScopeText: "周一至周五",
    todayText: "",
    weekSwitcherLabel: "",
    sections: courseTimes,
    sectionHeight: SECTION_HEIGHT,
    scheduleHeight: courseTimes.length * SECTION_HEIGHT,
    gridWidth: 718,
    dayTrackWidth: 642,
    dayColumnWidth: 128,
    weekdays: [],
    dayColumns: [],
    hideInactiveCourses: false,
    showWeekend: false,
    selectedCourse: null,
    detailVisible: false,
  },

  onLoad() {
    this.loadSchedule();
  },

  onShow() {
    this.loadSchedule();
  },

  loadSchedule() {
    const settings = getSettings();
    const now = new Date();
    const todayInfo = getTodayTeachingInfo(now, mockCalendar);
    const currentWeek = resolveDisplayWeek(settings, now);
    const weekInfo = getWeekRangeByWeekNo(currentWeek, mockCalendar);
    const baseWeekdays = getVisibleWeekdays(settings.showWeekend, now);
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
      sectionHeight: SECTION_HEIGHT,
      hideInactiveCourses: settings.hideInactiveCourses,
    });
    const contentWidth = getContentWidthRpx();
    const dayColumnWidth = settings.showWeekend
      ? WEEKEND_DAY_WIDTH
      : Math.floor((contentWidth - TIME_AXIS_WIDTH) / weekdays.length);
    const dayTrackWidth = dayColumnWidth * weekdays.length;
    const gridWidth = TIME_AXIS_WIDTH + dayTrackWidth;
    const weekRangeText = formatWeekRange(weekInfo.startDate, weekInfo.endDate);

    this.setData({
      className: settings.className,
      semester: settings.semester,
      dataSourceText: dataSource.text,
      currentWeek,
      weekRangeText,
      weekScopeText: settings.showWeekend ? "周一至周日" : "周一至周五",
      todayText: `${todayInfo.dateLabel} ${todayInfo.weekdayLabel}`,
      weekSwitcherLabel: `${weekRangeText} · 第${currentWeek}周`,
      gridWidth,
      dayTrackWidth,
      dayColumnWidth,
      weekdays,
      dayColumns,
      hideInactiveCourses: settings.hideInactiveCourses,
      showWeekend: settings.showWeekend,
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
      url: "/pages/login/login",
    });
  },

  goTimetable() {
    wx.navigateTo({
      url: "/pages/timetable/timetable",
    });
  },
});
