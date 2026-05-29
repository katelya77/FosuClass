const {
  getCourseDataSource,
  getCourseStatus,
  getCourseTimeRange,
  getCoursesByClass,
  getTodayCourses,
  groupElectiveLikeCourses,
  mergeCanonicalCoursesForDisplay,
  normalizeCourse,
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
      timeText: getCourseTimeRange(course),
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

function normalizeCourseName(courseName) {
  if (!courseName) return "";
  return courseName.replace(/[\(\（].*?[\)\）]/g, "").trim();
}

function getCurrentBoundSchedule() {
  const settings = getSettings();
  const target = wx.getStorageSync("FOSU_CURRENT_SCHEDULE_TARGET");
  const currentSchedule = wx.getStorageSync("CURRENT_SCHEDULE") || wx.getStorageSync("SELECTED_SCHEDULE");
  
  let classId = settings.classId || target?.classId || currentSchedule?.classId || "";
  let className = settings.className || target?.name || target?.className || currentSchedule?.className || currentSchedule?.name || "";
  
  let semester = target?.semester || currentSchedule?.semester || settings.semester || "2025-2026-2";
  let schedule = null;
  let source = "";

  if (target && Array.isArray(target.courses) && target.courses.length > 0) {
    schedule = target;
    source = "FOSU_CURRENT_SCHEDULE_TARGET";
  } else if (currentSchedule && Array.isArray(currentSchedule.courses) && currentSchedule.courses.length > 0) {
    schedule = currentSchedule;
    source = "CURRENT_SCHEDULE_OR_SELECTED_SCHEDULE";
  }

  const { getCoursesByClass } = require("../../utils/course");
  if (!schedule && className) {
    const courses = getCoursesByClass(className);
    if (courses && courses.length) {
      schedule = {
        classId,
        className,
        semester,
        courses,
      };
      source = "fallback_by_classname";
    }
  }

  return {
    classId: classId || "",
    className: className || "",
    semester,
    schedule,
    source
  };
}

function isCourseActiveInCurrentWeek(course, currentWeek) {
  if (!course) return false;
  
  const current = Number(currentWeek);
  
  if (Array.isArray(course.weeks) && course.weeks.length > 0) {
    return course.weeks.map(Number).includes(current);
  }

  const possibleFields = [
    course.weekText,
    course.rawWeek,
    course.weekRange,
    typeof course.weeks === 'string' ? course.weeks : ''
  ];

  const weekStr = possibleFields.find(f => f && typeof f === 'string' && f.trim() !== '');

  if (!weekStr) {
    if (typeof course.startWeek === 'number' && typeof course.endWeek === 'number') {
      const start = course.startWeek;
      const end = course.endWeek;
      if (current >= start && current <= end) {
        if (course.weekType === 'odd' && current % 2 === 0) return false;
        if (course.weekType === 'even' && current % 2 !== 0) return false;
        return true;
      }
      return false;
    }
    course.isUncertainWeek = true;
    console.warn("[周次过滤] 课程无有效周次字段，标记为 uncertain:", course.courseName, course);
    return false;
  }

  try {
    const normalizedStr = weekStr.replace(/\s+/g, "");
    
    let isOddOnly = normalizedStr.includes("单");
    let isEvenOnly = normalizedStr.includes("双");
    
    const cleanStr = normalizedStr.replace(/[周单双]/g, "");
    const parts = cleanStr.split(/[,，]/);
    let matched = false;

    for (const part of parts) {
      if (!part) continue;
      if (part.includes("-")) {
        const range = part.split("-").map(Number);
        if (range.length === 2 && !isNaN(range[0]) && !isNaN(range[1])) {
          const start = range[0];
          const end = range[1];
          if (current >= start && current <= end) {
            matched = true;
            break;
          }
        }
      } else {
        const single = Number(part);
        if (!isNaN(single) && single === current) {
          matched = true;
          break;
        }
      }
    }

    if (matched) {
      if (isOddOnly && current % 2 === 0) return false;
      if (isEvenOnly && current % 2 !== 0) return false;
      return true;
    }
    
    return false;
  } catch (error) {
    course.isUncertainWeek = true;
    console.error("[周次过滤] 周次解析错误，标记为 uncertain:", weekStr, course.courseName, error);
    return false;
  }
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
    emptyTitle: "今天没有课程，好好休息",
    emptyDesc: "这里会根据当前班级、教学周和星期自动筛选课程。"
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

    const boundInfo = getCurrentBoundSchedule();
    const { classId, className, semester, schedule, source } = boundInfo;

    if (!schedule || !Array.isArray(schedule.courses) || schedule.courses.length === 0) {
      this.setData({
        dateText: todayInfo.fullDateLabel,
        weekdayText: todayInfo.weekdayLabel,
        className: className || "未选择当前课表",
        currentWeek,
        dataSourceText: "未绑定课表",
        courseCountText: "今日共 0 门课",
        courses: [],
        emptyTitle: "未绑定当前课表",
        emptyDesc: "请先前往「全校」页面查找班级，并在课表详情页点击「设为当前」进行绑定。"
      });

      const envVersion = wx.getSystemInfoSync().platform === 'devtools' || (wx.getAccountInfoSync && wx.getAccountInfoSync().miniProgram.envVersion === 'develop');
      if (envVersion) {
        console.log("========== [开发环境今日页面调试日志] ==========");
        console.log("- 未找到绑定课表，请前往绑定");
        console.log("===============================================");
      }
      return;
    }

    const rawTodayCount = schedule.courses.length;
    const sourceCourses = schedule.courses.map((course) => normalizeCourse(Object.assign({}, course, {
      semester: course.semester || semester,
      classId: course.classId || classId,
      className: course.className || className,
    })));

    let filteredOutCount = 0;
    const todayRawCourses = sourceCourses.filter(course => {
      const inWeek = isCourseActiveInCurrentWeek(course, currentWeek);
      const isToday = Number(course.weekday) === Number(weekday);
      const matchesSemester = !course.semester || course.semester === semester;
      
      let classMatches = true;
      if (className && course.className) {
        if (course.className !== className) {
          classMatches = false;
        }
      }

      const startSectionValid = typeof course.startSection === 'number' && !isNaN(course.startSection);
      const endSectionValid = typeof course.endSection === 'number' && !isNaN(course.endSection);
      const sectionValid = startSectionValid && endSectionValid && course.startSection <= course.endSection;

      const keep = inWeek && isToday && matchesSemester && classMatches && sectionValid;
      if (!keep) {
        filteredOutCount++;
      }
      return keep;
    });

    const mergeResult = mergeCanonicalCoursesForDisplay(todayRawCourses, {
      semester,
      classId,
      className,
      currentWeek,
      weekday,
    });
    const displayCourses = mergeResult.courses;
    const normalizedTodayCourses = mergeResult.normalizedCourses;
    const mergedGroups = mergeResult.mergedGroups;
    const venueCourseNameCount = normalizedTodayCourses.filter((course) => course.isVenueCandidate).length;
    const peMergedGroupCount = mergedGroups.filter((group) => group.isPhysicalEducationLike).length;

    displayCourses.sort((a, b) => {
      if (a.startSection !== b.startSection) {
        return a.startSection - b.startSection;
      }
      if (a.endSection !== b.endSection) {
        return a.endSection - b.endSection;
      }
      return (a.displayCourseName || a.canonicalCourseName || a.courseName || "").localeCompare(
        b.displayCourseName || b.canonicalCourseName || b.courseName || "",
        "zh"
      );
    });

    const courses = decorateTodayCourses(displayCourses, now);
    const dataSource = getCourseDataSource();

    let displayClassName = className;
    const target = wx.getStorageSync("FOSU_CURRENT_SCHEDULE_TARGET");
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
      emptyTitle: "今天没有课程，好好休息",
      emptyDesc: "这里会根据当前班级、教学周和星期自动筛选课程。"
    });

    const envVersion = wx.getSystemInfoSync().platform === 'devtools' || (wx.getAccountInfoSync && wx.getAccountInfoSync().miniProgram.envVersion === 'develop');
    if (envVersion) {
      const sampleNormalizedCourses = normalizedTodayCourses.slice(0, 10).map((course) => ({
        rawCourseName: course.rawCourseName || course.courseName,
        rawTeacherName: course.rawTeacherName || course.teacherName,
        courseName: course.courseName,
        canonicalCourseName: course.canonicalCourseName,
        classroom: course.classroom,
        canonicalClassroom: course.canonicalClassroom,
        teacherName: course.teacherName,
        normalizationReason: course.normalizationReason,
        isVenueCandidate: course.isVenueCandidate,
        isPhysicalEducationLike: course.isPhysicalEducationLike,
      }));
      const venueCorrections = normalizedTodayCourses.filter((course) =>
        course.isVenueCandidate &&
        course.rawCourseName &&
        course.canonicalCourseName &&
        course.rawCourseName !== course.canonicalCourseName
      );

      console.log("[Today Normalize Debug]", {
        boundClassName: className,
        classId,
        rawTodayCount,
        normalizedTodayCount: normalizedTodayCourses.length,
        displayTodayCount: courses.length,
        venueCourseNameCount,
        peMergedGroupCount,
        filteredOutCount,
        sampleNormalizedCourses,
        mergedGroups,
      });
      venueCorrections.forEach((course) => {
        console.warn(
          `[Today Normalize Debug] courseName=${course.rawCourseName}, teacherName=${course.rawTeacherName || ""} -> canonicalCourseName=${course.canonicalCourseName}, classroom=${course.canonicalClassroom || course.classroom || ""}`
        );
      });
    }
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
