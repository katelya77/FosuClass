const { courseTimes } = require("../../data/courseTimes");
const { buildScheduleColumns, getCourseDataSource, getCoursesByClass } = require("../../utils/course");
const { getSettings, saveSettings } = require("../../utils/storage");
const {
  TOTAL_WEEKS,
  clampWeek,
  getCurrentTeachingWeek,
  getVisibleWeekdays,
  getWeekDateRange,
} = require("../../utils/week");

const SECTION_HEIGHT = 90;

Page({
  data: {
    logoPath: "/assets/logo/favicon.png",
    showLogo: true,
    appName: "佛大课表",
    className: "25动物医学6",
    semester: "2025-2026学年第二学期",
    dataSourceText: "Mock 数据",
    currentWeek: 12,
    totalWeeks: TOTAL_WEEKS,
    weekDateText: "",
    sections: courseTimes,
    sectionHeight: SECTION_HEIGHT,
    scheduleHeight: courseTimes.length * SECTION_HEIGHT,
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
    const currentWeek = clampWeek(settings.currentWeek || getCurrentTeachingWeek());
    const weekdays = getVisibleWeekdays(settings.showWeekend);
    const courses = getCoursesByClass(settings.className);
    const dataSource = getCourseDataSource();
    const dayColumns = buildScheduleColumns(courses, weekdays, currentWeek, {
      sectionHeight: SECTION_HEIGHT,
      hideInactiveCourses: settings.hideInactiveCourses,
    });
    const weekRange = getWeekDateRange(currentWeek);

    this.setData({
      className: settings.className,
      semester: settings.semester,
      dataSourceText: dataSource.text,
      currentWeek,
      weekDateText: weekRange.shortText,
      weekdays,
      dayColumns,
      hideInactiveCourses: settings.hideInactiveCourses,
      showWeekend: settings.showWeekend,
    });
  },

  onWeekChange(event) {
    const type = event.detail.type;
    const nextWeek = type === "current" ? getCurrentTeachingWeek() : clampWeek(event.detail.week);
    saveSettings({
      currentWeek: nextWeek,
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
