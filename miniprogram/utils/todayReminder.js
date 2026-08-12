const {
  getCourseStatus,
  getCourseTimeRange,
  getCoursesByClass,
  mergeCanonicalCoursesForDisplay,
  normalizeCourse,
} = require("./course");
const { getSettings } = require("./storage");
const customCourseService = require("../services/customCourseService");
const teachingCalendarService = require("../services/teachingCalendarService");
const { clampWeek, getTodayTeachingInfo, getTodayWeekday } = require("./week");
const { getCourseWeekStatus } = require("./courseWeekRules");

function isCourseActiveInCurrentWeek(course, currentWeek) {
  return getCourseWeekStatus(course || {}, currentWeek).active === true;
}

function getCurrentBoundSchedule() {
  const settings = getSettings();
  const { getCurrentScheduleTarget } = require("./storage");
  const target = getCurrentScheduleTarget();
  const calendar = teachingCalendarService.getImmediateActiveCalendar();
  const termConfig = calendar.termConfig || {};

  const classId = settings.classId || target?.classId || "";
  const className = settings.className || target?.name || target?.className || "";
  const semester = target?.term || target?.semester || settings.semesterId || settings.semester || termConfig.term;
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
    source,
  };
}

function getNextCoursePreview(allCourses, currentWeek, todayWeekday, termConfig) {
  if (!allCourses || !allCourses.length) return null;
  const { courseTimes } = require("../data/courseTimes");
  const days = ["周一", "周二", "周三", "周四", "周五", "周六", "周日"];
  const totalWeeks = Number(termConfig && termConfig.totalWeeks || 19) || 19;

  for (let i = 1; i <= 7; i += 1) {
    const nextDay = ((todayWeekday + i - 1) % 7) + 1;
    const isNextWeek = todayWeekday + i > 7;
    const targetWeek = isNextWeek ? currentWeek + 1 : currentWeek;
    if (targetWeek > totalWeeks) continue;

    const activeCourses = allCourses.map(normalizeCourse).filter((course) => {
      return Number(course.weekday) === nextDay && isCourseActiveInCurrentWeek(course, targetWeek);
    });

    if (activeCourses.length) {
      activeCourses.sort((a, b) => Number(a.startSection) - Number(b.startSection));
      const first = activeCourses[0];
      const weekLabel = isNextWeek ? "下周" : "本周";
      const dayLabel = days[nextDay - 1];
      const startSection = Number(first.startSection);
      const startInfo = courseTimes.find((item) => Number(item.section) === startSection);
      const startTime = startInfo ? startInfo.start : "";
      const timeLabel = `${weekLabel}${dayLabel} ${startTime || `第${startSection}节`}`;
      return {
        courseName: first.courseName || first.displayCourseName || first.canonicalCourseName || "",
        timeLabel,
        classroom: first.classroom || first.displayClassroom || first.canonicalClassroom || "待定",
      };
    }
  }
  return null;
}

function decorateTodayCourses(courses, now) {
  const nextIndex = courses.findIndex((course) => getCourseStatus(course, now) === "upcoming");
  return courses.map((course, index) => {
    const status = getCourseStatus(course, now);
    const isNext = index === nextIndex;
    let statusText = "未开始";
    if (status === "ongoing") {
      statusText = "正在上课";
    } else if (isNext) {
      statusText = "下一节";
    } else if (status === "finished") {
      statusText = "已结束";
    }
    return Object.assign({}, course, {
      active: status !== "finished",
      sectionText: `第${course.startSection}-${course.endSection}节`,
      status,
      timeText: getCourseTimeRange(course),
      isNext,
      statusText,
    });
  });
}

function getTodayCoursesData() {
  const settings = getSettings();
  const now = new Date();
  const calendar = teachingCalendarService.getImmediateActiveCalendar();
  const termConfig = calendar.termConfig || {};
  const weeks = calendar.weeks || [];
  const todayInfo = getTodayTeachingInfo(now, weeks, termConfig);
  const weekday = todayInfo.weekday || getTodayWeekday(now);
  const currentWeek = settings.manualWeekOverride
    ? clampWeek(settings.currentWeek, termConfig)
    : todayInfo.weekNo;

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

  const { dedupeCourses } = require("./course");
  const baseCourses = schedule.courses.map((course) => normalizeCourse(Object.assign({}, course, {
    semester: course.semester || semester,
    classId: course.classId || classId,
    className: course.className || className,
  })));
  const customCourses = customCourseService.getEnabledCustomCourses().map((course) => {
    return normalizeCourse(Object.assign({}, course, {
      semester: course.semester || semester,
      classId: course.classId || classId,
      className: course.className || className,
    }));
  });
  const sourceCourses = dedupeCourses(baseCourses.concat(customCourses));

  const todayRawCourses = todayInfo.isTeachingDay === false ? [] : sourceCourses.filter((course) => {
    const inWeek = isCourseActiveInCurrentWeek(course, currentWeek);
    const isToday = Number(course.weekday) === Number(weekday);
    const matchesSemester = !course.semester || course.semester === semester;
    const classMatches = !className || !course.className || course.className === className;
    const startSectionValid = typeof course.startSection === "number" && !Number.isNaN(course.startSection);
    const endSectionValid = typeof course.endSection === "number" && !Number.isNaN(course.endSection);
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
    if (a.startSection !== b.startSection) return a.startSection - b.startSection;
    if (a.endSection !== b.endSection) return a.endSection - b.endSection;
    return (a.displayCourseName || a.canonicalCourseName || a.courseName || "").localeCompare(
      b.displayCourseName || b.canonicalCourseName || b.courseName || "",
      "zh"
    );
  });

  const finalCourses = decorateTodayCourses(displayCourses, now);
  let state = "none";
  if (finalCourses.length > 0) {
    const hasOngoing = finalCourses.some((course) => course.status === "ongoing");
    const hasUpcoming = finalCourses.some((course) => course.status === "upcoming");
    state = hasOngoing ? "ongoing" : (hasUpcoming ? "upcoming" : "finished");
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
    source,
    nextCoursePreview: finalCourses.length === 0
      ? getNextCoursePreview(sourceCourses, currentWeek, Number(weekday), termConfig)
      : null,
  };
}

module.exports = {
  isCourseActiveInCurrentWeek,
  getCurrentBoundSchedule,
  getTodayCoursesData,
};
