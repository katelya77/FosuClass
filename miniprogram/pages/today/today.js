const { getCoursesByClass, getCoursesForDay } = require("../../utils/course");
const { getSettings } = require("../../utils/storage");
const { getCurrentTeachingWeek, getTodayWeekday, getWeekdayLabel } = require("../../utils/week");

function formatChineseDate(date) {
  return `${date.getFullYear()}年${date.getMonth() + 1}月${date.getDate()}日`;
}

Page({
  data: {
    dateText: "",
    weekdayText: "",
    className: "25动物医学6",
    currentWeek: 12,
    courses: [],
    selectedCourse: null,
    detailVisible: false,
  },

  onShow() {
    this.loadToday();
  },

  loadToday() {
    const settings = getSettings();
    const today = new Date();
    const weekday = getTodayWeekday(today);
    const currentWeek = settings.currentWeek || getCurrentTeachingWeek(today);
    const courses = getCoursesForDay(getCoursesByClass(settings.className), weekday, currentWeek, {
      hideInactiveCourses: true,
    }).map((course) => Object.assign({}, course, { active: true }));

    this.setData({
      dateText: formatChineseDate(today),
      weekdayText: getWeekdayLabel(weekday),
      className: settings.className,
      currentWeek,
      courses,
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
});
