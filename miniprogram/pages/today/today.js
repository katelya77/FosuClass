const { getTodayCoursesData } = require("../../utils/todayReminder");
const { getSettings } = require("../../utils/storage");

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
    emptyTitle: "今天没有课程，好好休息",
    emptyDesc: "这里会根据当前班级、教学周和星期自动筛选课程。"
  },

  onShow() {
    this.loadToday();
  },

  loadToday() {
    const data = getTodayCoursesData();
    const { hasSchedule, dateText, weekdayText, className, currentWeek, courses } = data;

    const settings = getSettings();
    const { getCourseDataSource } = require("../../utils/course");
    const dataSource = getCourseDataSource();

    let displayClassName = className;
    const { getCurrentScheduleTarget } = require("../../utils/storage");
    const target = getCurrentScheduleTarget();
    if (target) {
      displayClassName = target.type === "teacher"
        ? `${target.name} 老师`
        : (target.type === "classroom" ? `${target.name} 教室` : target.name);
    }

    if (!hasSchedule) {
      this.setData({
        dateText,
        weekdayText,
        className: displayClassName || "未选择当前课表",
        currentWeek,
        dataSourceText: "未绑定课表",
        courseCountText: "今日共 0 门课",
        courses: [],
        emptyTitle: "未绑定当前课表",
        emptyDesc: "请先前往「全校」页面查找班级，并在课表详情页点击「设为当前」进行绑定。"
      });
      return;
    }

    this.setData({
      dateText,
      weekdayText,
      className: displayClassName,
      currentWeek,
      dataSourceText: dataSource.text,
      courseCountText: `今日共 ${courses.length} 门课`,
      courses,
      emptyTitle: "今天没有课程，好好休息",
      emptyDesc: "这里会根据当前班级、教学周和星期自动筛选课程。"
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
