/**
 * 课表规范器：对解析出的 CourseItem 进行字段规范化和默认值补全。
 */

function toNumber(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : fallback;
}

function ensureWeeks(course) {
  if (Array.isArray(course.weeks) && course.weeks.length) {
    return course.weeks.map(Number).filter(Boolean);
  }
  const start = toNumber(course.startWeek, 1);
  const end = toNumber(course.endWeek, start);
  const weeks = [];
  for (let week = start; week <= end; week += 1) {
    weeks.push(week);
  }
  return weeks;
}

/**
 * 规范化单个课程项
 * @param {Object} course 课程项
 * @param {Object} context 上下文配置
 * @returns {Object} 规范化后的课程项
 */
function normalizeCourseItem(course, context) {
  const config = context || {};
  const normalized = Object.assign({}, course);
  
  normalized.id = normalized.id || `${normalized.sourceType || "course"}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  normalized.semester = normalized.semester || config.semester || "2025-2026学年第二学期";
  normalized.className = normalized.className || config.className || "";
  normalized.teacherName = normalized.teacherName || config.teacherName || "";
  normalized.classroom = normalized.classroom || config.classroom || "";
  normalized.courseName = normalized.courseName || "";
  normalized.weekday = toNumber(normalized.weekday, 1);
  normalized.startSection = toNumber(normalized.startSection, 1);
  normalized.endSection = toNumber(normalized.endSection, normalized.startSection);
  normalized.startWeek = toNumber(normalized.startWeek, 1);
  normalized.endWeek = toNumber(normalized.endWeek, normalized.startWeek);
  normalized.weeks = ensureWeeks(normalized);
  normalized.weekText = normalized.weekText || `${normalized.startWeek}-${normalized.endWeek}周`;
  normalized.weekType = normalized.weekType || "all";
  normalized.source = normalized.source || "school";
  normalized.sourceType = normalized.sourceType || config.sourceType || "class";
  normalized.audienceType = normalized.audienceType || config.audienceType || "student";
  normalized.rawText = normalized.rawText || "";
  normalized.rawHtml = normalized.rawHtml || "";
  
  return normalized;
}

/**
 * 规范化课程列表
 * @param {Array} courses 课程数组
 * @param {Object} context 上下文配置
 * @returns {Array} 规范化后的课程数组
 */
function normalizeCourseList(courses, context) {
  return (courses || [])
    .map((course) => normalizeCourseItem(course, context))
    .filter((course) => course.courseName);
}

/**
 * 按照某一键值对课程列表进行分组
 * @param {Array} courses 课程数组
 * @param {string} key 分组依据键名
 * @param {string} fallbackName 缺省组名
 * @returns {Object} 分组后的对象
 */
function groupCoursesBy(courses, key, fallbackName) {
  const groups = {};
  (courses || []).forEach((course) => {
    const groupName = course[key] || fallbackName || "未命名";
    if (!groups[groupName]) {
      groups[groupName] = [];
    }
    groups[groupName].push(course);
  });
  return groups;
}

module.exports = {
  groupCoursesBy,
  normalizeCourseItem,
  normalizeCourseList,
};
