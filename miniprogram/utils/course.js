const { mockCourses } = require("../data/mockCourses");
const { importedCourses } = require("../data/importedCourses");
const { courseTimes, courseTimesMeta } = require("../data/courseTimes");
const { colorForCourse } = require("./color");
const { isCourseInWeek } = require("./week");
const {
  mergeCanonicalCoursesForDisplay,
  normalizeCourseIdentity,
  toRenderableCourse,
} = require("./courseNormalizer");



const SOURCE_TEXT = {
  imported: "教务课表 · 本地缓存",
  mock: "演示数据 · 本地缓存",
};

function normalizeCourse(course) {
  const normalized = toRenderableCourse(Object.assign({}, course));
  normalized.color = normalized.color || colorForCourse(normalized.canonicalCourseName || normalized.courseName);
  normalized.startSection = Number(normalized.startSection);
  normalized.endSection = Number(normalized.endSection);
  normalized.weekday = Number(normalized.weekday);
  normalized.startWeek = Number(normalized.startWeek);
  normalized.endWeek = Number(normalized.endWeek);
  normalized.audienceType = normalized.audienceType || "student";
  normalized.sourceType = normalized.sourceType || (normalized.source === "har" ? "personal" : "class");
  return normalized;
}

function getCourseDataset() {
  try {
    const { getCurrentScheduleTarget } = require("./storage");
    const target = getCurrentScheduleTarget();
    if (target && Array.isArray(target.courses) && target.courses.length) {
      return {
        courses: target.courses,
        source: "realtime",
        sourceText: `教务数据 · 更新于 ${target.updateTime || ""}`,
      };
    }
  } catch (error) {
    // 忽略异常，继续降级
  }

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
  const dataset = getCourseDataset();
  if (dataset.source === "realtime") {
    // 实时教务数据绑定，无需按班级名二次过滤
    return dataset.courses.map(normalizeCourse);
  }
  
  if (!className) {
    return []; // 如果未绑定或未传入 className，不默认显示任何课表数据
  }
  
  const targetClassName = className;
  const courses = dataset.courses
    .filter((course) => course.className === targetClassName)
    .map(normalizeCourse);
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

function normalizeCourseKey(course) {
  if (!course) return "";
  const normalized = normalizeCourseIdentity(course);
  return [
    normalized.canonicalCourseName || normalized.displayCourseName || course.courseName || "",
    course.weekday || "",
    course.startSection || "",
    course.endSection || "",
    course.startWeek || "",
    course.endWeek || "",
    normalized.canonicalTeacherName || course.teacherName || "",
    normalized.canonicalClassroom || course.classroom || "",
  ].join("_");
}

function dedupeCourses(courses) {
  const seen = new Set();
  return (courses || []).filter((course) => {
    const key = normalizeCourseKey(course);
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
}

function groupElectiveLikeCourses(courses) {
  const deduped = dedupeCourses((courses || []).map(normalizeCourse));
  const groups = {};
  const groupKeys = [];
  for (const c of deduped) {
    const key = [
      c.courseName || "",
      c.weekday || "",
      c.startSection || "",
      c.endSection || "",
      c.startWeek || "",
      c.endWeek || "",
    ].join("_");
    
    if (!groups[key]) {
      groups[key] = [];
      groupKeys.push(key);
    }
    groups[key].push(c);
  }
  
  const result = [];
  for (const key of groupKeys) {
    const items = groups[key];
    if (items.length === 1) {
      result.push(items[0]);
    } else {
      const base = Object.assign({}, items[0]);
      base.isGrouped = true;
      base.groupedCount = items.length;
      base.groupedItems = items;
      base.displayTeacherText = "多个教师";
      base.displayClassroomText = "多个地点";
      base.groupLabel = "多个教学班可选";
      
      base.teacherName = "多个教师";
      base.classroom = "多个地点";
      
      result.push(base);
    }
  }
  return result;
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
  normalizeCourseKey,
  dedupeCourses,
  groupElectiveLikeCourses,
  mergeCanonicalCoursesForDisplay,
  normalizeCourseIdentity,
  courseTimesMeta,
};
