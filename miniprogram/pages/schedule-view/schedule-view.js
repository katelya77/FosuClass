const { courseTimes } = require("../../data/courseTimes");
const { mockCalendar } = require("../../data/mockCalendar");
const { buildScheduleColumns, normalizeCourse } = require("../../utils/course");
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
const WEEKEND_DAY_WIDTH = 142;
const TIME_AXIS_WIDTH = 76;

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
  return 750 - 32; // padding 左右各 16
}

function getTypeText(type) {
  switch (type) {
    case "class": return "班级课表";
    case "teacher": return "教师课表";
    case "classroom": return "教室课表";
    case "course": return "课程安排";
    default: return "课表";
  }
}

function safeDecodeURIComponent(value) {
  const text = String(value || "");
  try {
    return decodeURIComponent(text);
  } catch (error) {
    return text;
  }
}

function isTruthyParam(value) {
  return value === true || value === "1" || value === "true";
}

function getScheduleKindText(type, displayType, isAggregated) {
  if (type !== "class") {
    return getTypeText(type);
  }
  if (isAggregated || displayType === "major-schedule" || displayType === "major-shared-schedule") {
    return "专业聚合课表 · 暂未拆分行政班";
  }
  return "行政班级课表";
}

function getWeekdayText(weekday) {
  const map = ["", "周一", "周二", "周三", "周四", "周五", "周六", "周日"];
  return map[Number(weekday)] || "";
}

function getCourseOverview(courses) {
  return (courses || []).map(normalizeCourse).map((course, index) => Object.assign({}, course, {
    overviewKey: `${course.id || course.courseName || "course"}-${index}`,
    weekdayText: getWeekdayText(course.weekday),
    sectionText: `第${course.startSection}-${course.endSection}节`,
  }));
}

Page({
  data: {
    type: "class",
    typeText: "班级课表",
    name: "",
    title: "",
    semester: "2025-2026-2",
    displayType: "",
    isAggregated: false,
    scheduleKindText: "行政班级课表",
    isCurrentTarget: false,
    allCourses: [],
    overviewCourses: [],
    overviewExpanded: true,
    hasCurrentWeekCourses: false,
    currentWeekCourseCount: 0,
    scheduleMeta: null,
    
    currentWeek: 12,
    totalWeeks: TOTAL_WEEKS,
    weekRangeText: "",
    weekScopeText: "周一至周五",
    weekSwitcherLabel: "",
    sections: courseTimes,
    sectionHeight: SECTION_HEIGHT,
    scheduleHeight: courseTimes.length * SECTION_HEIGHT,
    gridWidth: 718,
    dayTrackWidth: 642,
    dayColumnWidth: 128,
    weekdays: [],
    dayColumns: [],
    showWeekend: false,
    detailVisible: false,
    selectedCourse: null,
  },

  onLoad(options) {
    const { type = "class", name = "", semester = "2025-2026-2", displayType = "", isAggregated = "" } = options;
    const decodedName = safeDecodeURIComponent(name);
    const decodedSemester = safeDecodeURIComponent(semester);
    const decodedDisplayType = safeDecodeURIComponent(displayType);
    const aggregated = isTruthyParam(isAggregated) || decodedDisplayType === "major-schedule" || decodedDisplayType === "major-shared-schedule";
    const title = decodedName;
    
    this.setData({
      type,
      typeText: getTypeText(type),
      name: decodedName,
      title,
      semester: decodedSemester,
      displayType: decodedDisplayType,
      isAggregated: aggregated,
      scheduleKindText: getScheduleKindText(type, decodedDisplayType, aggregated),
    });

    if (title) {
      wx.setNavigationBarTitle({
        title,
      });
    }

    // 检查是否已经是当前的绑定目标
    this.checkCurrentTargetStatus();

    // 通过 EventChannel 获取上一页传过来的课程数据
    const eventChannel = this.getOpenerEventChannel();
    if (eventChannel && typeof eventChannel.on === "function") {
      eventChannel.on("acceptDataFromOpenerPage", (data) => {
        if (data && Array.isArray(data.courses)) {
          const schedule = data.schedule || {};
          const nextDisplayType = schedule.displayType || this.data.displayType;
          const nextAggregated = Boolean(schedule.isAggregated || this.data.isAggregated || nextDisplayType === "major-schedule" || nextDisplayType === "major-shared-schedule");
          this.setData({
            allCourses: data.courses,
            displayType: nextDisplayType,
            isAggregated: nextAggregated,
            scheduleKindText: getScheduleKindText(this.data.type, nextDisplayType, nextAggregated),
            scheduleMeta: schedule,
          }, () => {
            this.initScheduleLayout();
          });
        }
      });
    } else {
      // 降级处理：如果没有 EventChannel (比如直接扫码进入等)，尝试在 Storage 中寻找是否有该缓存
      this.initScheduleLayout();
    }
  },

  checkCurrentTargetStatus() {
    const currentTarget = wx.getStorageSync("FOSU_CURRENT_SCHEDULE_TARGET");
    const isCurrent = currentTarget && 
                      currentTarget.type === this.data.type && 
                      currentTarget.name === this.data.name && 
                      currentTarget.semester === this.data.semester;
    this.setData({
      isCurrentTarget: Boolean(isCurrent),
    });
  },

  initScheduleLayout() {
    const settings = getSettings();
    const now = new Date();
    const currentWeek = settings.manualWeekOverride
      ? clampWeek(settings.currentWeek)
      : getCurrentTeachingWeek(now, mockCalendar);
      
    this.setData({
      currentWeek,
      showWeekend: settings.showWeekend,
    }, () => {
      this.renderSchedule();
    });
  },

  renderSchedule() {
    const settings = getSettings();
    const now = new Date();
    const todayInfo = getTodayTeachingInfo(now, mockCalendar);
    const currentWeek = this.data.currentWeek;
    const weekInfo = getWeekRangeByWeekNo(currentWeek, mockCalendar);
    const baseWeekdays = getVisibleWeekdays(this.data.showWeekend, now);
    
    const weekdays = baseWeekdays.map((day, index) => {
      const date = addDays(weekInfo.startDate, index);
      return Object.assign({}, day, {
        dateLabel: formatDateLabel(date),
        isToday: currentWeek === todayInfo.weekNo && day.weekday === todayInfo.weekday,
      });
    });

    const courses = this.data.allCourses.map(normalizeCourse);
    const dayColumns = buildScheduleColumns(courses, weekdays, currentWeek, {
      sectionHeight: SECTION_HEIGHT,
      hideInactiveCourses: settings.hideInactiveCourses,
    });
    const currentWeekCourseCount = dayColumns.reduce((total, day) => total + (day.courses || []).length, 0);

    const contentWidth = getContentWidthRpx();
    const dayColumnWidth = this.data.showWeekend
      ? WEEKEND_DAY_WIDTH
      : Math.floor((contentWidth - TIME_AXIS_WIDTH) / weekdays.length);
    const dayTrackWidth = dayColumnWidth * weekdays.length;
    const gridWidth = TIME_AXIS_WIDTH + dayTrackWidth;
    const weekRangeText = formatWeekRange(weekInfo.startDate, weekInfo.endDate);

    this.setData({
      weekRangeText,
      weekScopeText: this.data.showWeekend ? "周一至周日" : "周一至周五",
      weekSwitcherLabel: `${weekRangeText} · 第${currentWeek}周`,
      gridWidth,
      dayTrackWidth,
      dayColumnWidth,
      weekdays,
      dayColumns,
      overviewCourses: getCourseOverview(this.data.allCourses),
      hasCurrentWeekCourses: currentWeekCourseCount > 0,
      currentWeekCourseCount,
    });
  },

  onWeekChange(event) {
    const type = event.detail.type;
    const nextWeek = type === "current"
      ? getCurrentTeachingWeek(new Date(), mockCalendar)
      : clampWeek(event.detail.week);
    
    this.setData({
      currentWeek: nextWeek,
    }, () => {
      this.renderSchedule();
    });
  },

  toggleBindTarget() {
    if (this.data.isCurrentTarget) {
      wx.showToast({
        title: "已是当前首页课表",
        icon: "none",
      });
      return;
    }

    const nowStr = new Date().toLocaleTimeString("zh-CN", { hour12: false, hour: "2-digit", minute: "2-digit" });
    const meta = this.data.scheduleMeta || {};
    const target = {
      type: this.data.type,
      name: this.data.name,
      semester: this.data.semester,
      courses: this.data.allCourses,
      updateTime: nowStr,
      classId: meta.classId || "",
      className: meta.className || this.data.name || "",
      displayType: meta.displayType || this.data.displayType || "",
      isAggregated: this.data.isAggregated,
    };

    wx.setStorageSync("FOSU_CURRENT_SCHEDULE_TARGET", target);
    
    // 兼容原班级选项，设置页能自适应
    saveSettings({
      className: this.data.name,
      semester: this.data.semester,
      classId: meta.classId || "",
    });

    this.setData({
      isCurrentTarget: true,
    });

    wx.showToast({
      title: "绑定首页成功",
      icon: "success",
      duration: 1200,
    });

    setTimeout(() => {
      wx.switchTab({
        url: "/pages/index/index",
      });
    }, 1000);
  },

  onCourseTap(event) {
    this.setData({
      selectedCourse: event.detail.course,
      detailVisible: true,
    });
  },

  toggleOverview() {
    this.setData({
      overviewExpanded: !this.data.overviewExpanded,
    });
  },

  onOverviewCourseTap(event) {
    const index = Number(event.currentTarget.dataset.index);
    const course = this.data.overviewCourses[index];
    if (!course) return;
    this.setData({
      selectedCourse: course,
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
