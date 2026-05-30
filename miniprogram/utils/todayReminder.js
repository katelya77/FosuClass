const {
  getCourseStatus,
  getCourseTimeRange,
  getCoursesByClass,
  mergeCanonicalCoursesForDisplay,
  normalizeCourse,
} = require("./course");
const { mockCalendar } = require("../data/mockCalendar");
const { getSettings } = require("./storage");
const { clampWeek, getCurrentTeachingWeek, getTodayTeachingInfo, getTodayWeekday } = require("./week");

/**
 * 校验课程是否在当前周上课
 */
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
    return false;
  }
}

/**
 * 获取当前的绑定课表，逻辑与 today 页一致
 */
function getCurrentBoundSchedule() {
  const settings = getSettings();
  const { getCurrentScheduleTarget } = require("./storage");
  const target = getCurrentScheduleTarget();
  
  let classId = settings.classId || target?.classId || "";
  let className = settings.className || target?.name || target?.className || "";
  
  let semester = target?.semester || settings.semester || "2025-2026-2";
  let schedule = null;
  let source = "";

  if (target && Array.isArray(target.courses) && target.courses.length > 0) {
    schedule = target;
    source = "FOSU_CURRENT_SCHEDULE_TARGET";
  }

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

/**
 * 预测接下来的第一节课
 */
function getNextCoursePreview(allCourses, currentWeek, todayWeekday) {
  if (!allCourses || !allCourses.length) return null;
  const { courseTimes } = require("../data/courseTimes");
  const days = ["周一", "周二", "周三", "周四", "周五", "周六", "周日"];
  
  // 循环未来 7 天
  for (let i = 1; i <= 7; i++) {
    const nextDay = ((todayWeekday + i - 1) % 7) + 1;
    const isNextWeek = (todayWeekday + i) > 7;
    const targetWeek = isNextWeek ? currentWeek + 1 : currentWeek;
    if (targetWeek > 20) continue; // 超过最长周数
    
    const activeCourses = allCourses.map(normalizeCourse).filter(c => {
      return Number(c.weekday) === nextDay && isCourseActiveInCurrentWeek(c, targetWeek);
    });
    
    if (activeCourses.length) {
      // 按照节次排序，选出最早的课
      activeCourses.sort((a, b) => Number(a.startSection) - Number(b.startSection));
      const first = activeCourses[0];
      const weekLabel = isNextWeek ? "下周" : "本周";
      const dayLabel = days[nextDay - 1];
      const startSection = Number(first.startSection);
      const startInfo = courseTimes.find(t => Number(t.section) === startSection);
      const startTime = startInfo ? startInfo.start : "";
      const timeLabel = `${weekLabel}${dayLabel} ${startTime || ('第' + startSection + '节')}`;
      return {
        courseName: first.courseName || first.displayCourseName || first.canonicalCourseName || "",
        timeLabel,
        classroom: first.classroom || first.displayClassroom || first.canonicalClassroom || "待定",
      };
    }
  }
  return null;
}

/**
 * 获取今日课程的最终展示数据模型（同时供页面和弹窗使用，确保一致性）
 */
function getTodayCoursesData() {
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
    return {
      hasSchedule: false,
      dateText: todayInfo.fullDateLabel,
      weekdayText: todayInfo.weekdayLabel,
      className: className || "",
      currentWeek,
      courses: [],
      totalCount: 0,
      state: "none",
    };
  }

  const sourceCourses = schedule.courses.map((course) => normalizeCourse(Object.assign({}, course, {
    semester: course.semester || semester,
    classId: course.classId || classId,
    className: course.className || className,
  })));

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

    return inWeek && isToday && matchesSemester && classMatches && sectionValid;
  });

  const mergeResult = mergeCanonicalCoursesForDisplay(todayRawCourses, {
    semester,
    classId,
    className,
    currentWeek,
    weekday,
  });
  const displayCourses = mergeResult.courses;

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

  // 添加状态和文本修饰
  const decorated = displayCourses.map((course) => {
    const status = getCourseStatus(course, now);
    return Object.assign({}, course, {
      active: status !== "finished",
      sectionText: `第${course.startSection}-${course.endSection}节`,
      status,
      timeText: getCourseTimeRange(course),
    });
  });

  const nextIndex = decorated.findIndex((course) => course.status === "upcoming");
  const finalCourses = decorated.map((course, index) => {
    const isNext = index === nextIndex;
    let statusText = "未开始";
    if (course.status === "ongoing") {
      statusText = "正在上课";
    } else if (isNext) {
      statusText = "下一节";
    } else if (course.status === "finished") {
      statusText = "已结束";
    }
    return Object.assign({}, course, {
      isNext,
      statusText,
      status: course.status,
    });
  });

  // 计算今日总体状态
  let state = "none";
  if (finalCourses.length > 0) {
    const hasOngoing = finalCourses.some(c => c.status === "ongoing");
    const hasUpcoming = finalCourses.some(c => c.status === "upcoming");
    if (hasOngoing) {
      state = "ongoing";
    } else if (hasUpcoming) {
      state = "upcoming";
    } else {
      state = "finished";
    }
  }

  let nextCoursePreview = null;
  if (finalCourses.length === 0) {
    nextCoursePreview = getNextCoursePreview(sourceCourses, currentWeek, Number(weekday));
  }

  return {
    hasSchedule: true,
    dateText: todayInfo.fullDateLabel,
    weekdayText: todayInfo.weekdayLabel,
    className: className || "",
    currentWeek,
    courses: finalCourses,
    totalCount: finalCourses.length,
    state,
    nextCoursePreview,
  };
}

module.exports = {
  isCourseActiveInCurrentWeek,
  getCurrentBoundSchedule,
  getTodayCoursesData,
};
