const { mockCourses } = require("../data/mockCourses");
const { importedCourses } = require("../data/importedCourses");
const { courseTimes } = require("../data/courseTimes");
const { colorForCourse } = require("./color");
const { isCourseInWeek } = require("./week");

const SOURCE_TEXT = {
  imported: "HAR 导入数据",
  mock: "Mock 数据",
};

function normalizeCourse(course) {
  const normalized = Object.assign({}, course);
  normalized.color = normalized.color || colorForCourse(normalized.courseName);
  normalized.startSection = Number(normalized.startSection);
  normalized.endSection = Number(normalized.endSection);
  normalized.weekday = Number(normalized.weekday);
  normalized.startWeek = Number(normalized.startWeek);
  normalized.endWeek = Number(normalized.endWeek);
  return normalized;
}

function getCourseDataset() {
  if (Array.isArray(importedCourses) && importedCourses.length) {
    return {
      courses: importedCourses,
      source: "imported",
      sourceText: SOURCE_TEXT.imported,
    };
  }
  return {
    courses: mockCourses,
    source: "mock",
    sourceText: SOURCE_TEXT.mock,
  };
}

function getCourseDataSource() {
  const dataset = getCourseDataset();
  return {
    source: dataset.source,
    text: dataset.sourceText,
  };
}

function getCoursesByClass(className) {
  const targetClassName = className || "25动物医学6";
  const dataset = getCourseDataset();
  const courses = dataset.courses
    .filter((course) => course.className === targetClassName)
    .map(normalizeCourse);
  if (!courses.length && dataset.source === "imported") {
    return dataset.courses.map(normalizeCourse);
  }
  return courses;
}

function getCoursesForWeek(courses, week, options) {
  const config = options || {};
  return (courses || [])
    .map(normalizeCourse)
    .filter((course) => {
      const active = isCourseInWeek(course, week);
      return config.hideInactiveCourses ? active : true;
    });
}

function getCoursesForDay(courses, weekday, week, options) {
  return getTodayCourses(courses, week, weekday, options);
}

function buildScheduleColumns(courses, weekdays, week, options) {
  const sectionHeight = (options && options.sectionHeight) || 96;
  const hideInactiveCourses = Boolean(options && options.hideInactiveCourses);
  return weekdays.map((day) => {
    const dayCourses = (courses || [])
      .map(normalizeCourse)
      .filter((course) => course.weekday === day.weekday)
      .map((course) => {
        const active = isCourseInWeek(course, week);
        const top = (course.startSection - 1) * sectionHeight + 6;
        const span = course.endSection - course.startSection + 1;
        const height = span * sectionHeight - 12;
        return Object.assign({}, course, {
          active,
          cardStyle: `top:${top}rpx;height:${height}rpx;background:${active ? course.color : "#eef2f7"};`,
        });
      })
      .filter((course) => (hideInactiveCourses ? course.active : true))
      .sort((a, b) => a.startSection - b.startSection);
    return Object.assign({}, day, {
      courses: dayCourses,
    });
  });
}

function getCourseDurationText(course) {
  if (!course) {
    return "";
  }
  return `第${course.startSection}-${course.endSection}节`;
}

function getSectionTime(section, times) {
  const target = Number(section);
  return (times || courseTimes).find((item) => Number(item.section) === target);
}

function getCourseTimeRange(course, times) {
  if (!course) {
    return "";
  }
  const start = getSectionTime(course.startSection, times);
  const end = getSectionTime(course.endSection, times);
  if (!start || !end) {
    return "";
  }
  return `${start.start}-${end.end}`;
}

function parseTimeOnDate(timeText, date) {
  const parts = String(timeText || "").split(":").map(Number);
  const target = new Date(date.getTime());
  target.setHours(parts[0] || 0, parts[1] || 0, 0, 0);
  return target;
}

function getCourseStatus(course, now) {
  const target = now || new Date();
  const start = getSectionTime(course && course.startSection);
  const end = getSectionTime(course && course.endSection);
  if (!start || !end) {
    return "upcoming";
  }
  const startDate = parseTimeOnDate(start.start, target);
  const endDate = parseTimeOnDate(end.end, target);
  if (target < startDate) {
    return "upcoming";
  }
  if (target > endDate) {
    return "finished";
  }
  return "ongoing";
}

function getTodayCourses(courses, currentWeek, todayWeekday, options) {
  const config = Object.assign({ hideInactiveCourses: true }, options || {});
  return getCoursesForWeek(courses, currentWeek, config)
    .filter((course) => course.weekday === todayWeekday)
    .sort((a, b) => {
      if (a.startSection !== b.startSection) {
        return a.startSection - b.startSection;
      }
      return a.endSection - b.endSection;
    });
}

module.exports = {
  buildScheduleColumns,
  getCourseDataSource,
  getCourseDurationText,
  getCourseStatus,
  getCourseTimeRange,
  getCoursesByClass,
  getCoursesForDay,
  getCoursesForWeek,
  getTodayCourses,
  normalizeCourse,
};
