const { courseTimes } = require("../../data/courseTimes");
const {
  getCourseDataSource,
  getCourseStatus,
  getCourseTimeRange,
  getCoursesByClass,
  getTodayCourses,
} = require("../../utils/course");
const { mockCalendar } = require("../../data/mockCalendar");
const { getSettings } = require("../../utils/storage");
const { clampWeek, getCurrentTeachingWeek, getTodayTeachingInfo, getTodayWeekday } = require("../../utils/week");

function getStatusText(status, isNext) {
  if (status === "ongoing") {
    return "正在上课";
  }
  if (isNext) {
    return "下一节";
  }
  if (status === "finished") {
    return "已结束";
  }
  return "未开始";
}

function decorateTodayCourses(courses, now) {
  const decorated = courses.map((course) => {
    const status = getCourseStatus(course, now);
    return Object.assign({}, course, {
      active: status !== "finished",
      sectionText: `第${course.startSection}-${course.endSection}节`,
      status,
      timeText: getCourseTimeRange(course, courseTimes),
    });
  });
  const nextIndex = decorated.findIndex((course) => course.status === "upcoming");
  return decorated.map((course, index) => {
    const isNext = index === nextIndex;
    return Object.assign({}, course, {
      isNext,
      statusText: getStatusText(course.status, isNext),
    });
  });
}

Page({
  data: {
    dateText: "",
    weekdayText: "",
    className: "25动物医学6",
    currentWeek: 12,
    dataSourceText: "教务课表 · 本地缓存",
    courseCountText: "今日共 0 门课",
    courses: [],
    selectedCourse: null,
    detailVisible: false,
  },

  onShow() {
    this.loadToday();
  },

  loadToday() {
    const settings = getSettings();
    const now = new Date();
    const todayInfo = getTodayTeachingInfo(now, mockCalendar);
    const weekday = getTodayWeekday(now);
    const currentWeek = settings.manualWeekOverride
      ? clampWeek(settings.currentWeek)
      : getCurrentTeachingWeek(now, mockCalendar);
    const sourceCourses = getCoursesByClass(settings.className);
    const courses = decorateTodayCourses(getTodayCourses(sourceCourses, currentWeek, weekday), now);
    const dataSource = getCourseDataSource();

    const target = wx.getStorageSync("FOSU_CURRENT_SCHEDULE_TARGET");
    let displayClassName = settings.className;
    if (target) {
      displayClassName = target.type === "teacher"
        ? `${target.name} 老师`
        : (target.type === "classroom" ? `${target.name} 教室` : target.name);
    }

    this.setData({
      dateText: todayInfo.fullDateLabel,
      weekdayText: todayInfo.weekdayLabel,
      className: displayClassName,
      currentWeek,
      dataSourceText: dataSource.text,
      courseCountText: `今日共 ${courses.length} 门课`,
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
