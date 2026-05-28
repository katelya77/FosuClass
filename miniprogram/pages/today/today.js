const { courseTimes } = require("../../data/courseTimes");
const {
  getCourseDataSource,
  getCourseStatus,
  getCourseTimeRange,
  getCoursesByClass,
  getTodayCourses,
} = require("../../utils/course");
const { getSettings } = require("../../utils/storage");
const { getCurrentTeachingWeek, getTodayWeekday, getWeekdayLabel } = require("../../utils/week");

function formatChineseDate(date) {
  return `${date.getFullYear()}年${date.getMonth() + 1}月${date.getDate()}日`;
}

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
    dataSourceText: "Mock 数据",
    courseCountText: "今日共 0 节课 / 0 门课",
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
    const weekday = getTodayWeekday(now);
    const currentWeek = settings.currentWeek || getCurrentTeachingWeek(now);
    const sourceCourses = getCoursesByClass(settings.className);
    const courses = decorateTodayCourses(getTodayCourses(sourceCourses, currentWeek, weekday), now);
    const sectionCount = courses.reduce((total, course) => {
      return total + Math.max(1, course.endSection - course.startSection + 1);
    }, 0);
    const dataSource = getCourseDataSource();

    this.setData({
      dateText: formatChineseDate(now),
      weekdayText: getWeekdayLabel(weekday),
      className: settings.className,
      currentWeek,
      dataSourceText: dataSource.text,
      courseCountText: `今日共 ${sectionCount} 节课 / ${courses.length} 门课`,
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
