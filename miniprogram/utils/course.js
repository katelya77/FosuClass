const { mockCourses } = require("../data/mockCourses");
const { colorForCourse } = require("./color");
const { isCourseInWeek } = require("./week");

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

function getCoursesByClass(className) {
  const targetClassName = className || "25动物医学6";
  return mockCourses
    .filter((course) => course.className === targetClassName)
    .map(normalizeCourse);
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
  return getCoursesForWeek(courses, week, options)
    .filter((course) => course.weekday === weekday)
    .sort((a, b) => a.startSection - b.startSection);
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
          cardStyle: `top:${top}rpx;height:${height}rpx;background:${active ? course.color : "#e3e7ef"};`,
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

module.exports = {
  buildScheduleColumns,
  getCourseDurationText,
  getCoursesByClass,
  getCoursesForDay,
  getCoursesForWeek,
  normalizeCourse,
};
