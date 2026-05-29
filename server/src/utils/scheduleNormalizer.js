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

function compactText(value) {
  return String(value || "")
    .trim()
    .replace(/\s+/g, "")
    .replace(/[【】\[\]（）()《》<>]/g, "");
}

const UNRELIABLE_CLASS_NAMES = new Set([
  "未命名",
  "未命名班级",
  "未知",
  "未知班级",
  "暂无",
  "暂无班级",
  "无班级",
]);

const COURSE_NAME_KEYWORDS = [
  "大学体育",
  "形势与政策",
  "职业发展",
  "就业指导",
  "实验技术",
  "大学英语",
  "英语",
  "有机化学",
  "军事理论",
  "创新创业",
  "劳动教育",
  "心理健康",
  "思想道德",
  "马克思主义",
  "近现代史",
  "毛泽东思想",
  "高等数学",
  "线性代数",
  "概率论",
];

function hasClassNameShape(name) {
  const compact = compactText(name);
  const hasGradeToken = /(?:^|[^\d])(?:20\d{2}|\d{2})级?/.test(compact);
  const hasMajorText = /[\u4e00-\u9fa5A-Za-z]{2,}/.test(compact);
  const hasClassNo = /\d{1,2}班?$/.test(compact) || /[一二三四五六七八九十]{1,3}班$/.test(compact);
  return hasGradeToken && hasMajorText && hasClassNo;
}

function isReliableClassName(name, options = {}) {
  const compact = compactText(name);
  if (!compact || UNRELIABLE_CLASS_NAMES.has(compact)) {
    return false;
  }

  if (/^(未命名|未知|暂无|无).*(班级|行政班|班)?$/.test(compact)) {
    return false;
  }

  const courseName = compactText(options.courseName);
  if (courseName && compact === courseName) {
    return false;
  }

  if (Array.isArray(options.courses)) {
    const equalsAnyCourseName = options.courses.some((course) => compactText(course && course.courseName) === compact);
    if (equalsAnyCourseName) {
      return false;
    }
  }

  if (COURSE_NAME_KEYWORDS.some((keyword) => compact.includes(keyword))) {
    return false;
  }

  return hasClassNameShape(compact);
}

function buildMajorScheduleName(context = {}) {
  const grade = context.grade || "";
  const majorName = context.majorName || "未知专业";
  return `${grade}级${majorName}专业课表`;
}

function withDisplayClassName(course, className, extra = {}) {
  return Object.assign({}, course, extra, {
    originalClassName: course && course.className ? course.className : "",
    className,
  });
}

function buildClassScheduleEntries(courses, context = {}) {
  const classGroups = new Map();
  const unresolvedCourses = [];

  (courses || []).forEach((course) => {
    const className = String((course && course.className) || "").trim();
    if (isReliableClassName(className, { courseName: course && course.courseName })) {
      if (!classGroups.has(className)) {
        classGroups.set(className, []);
      }
      classGroups.get(className).push(withDisplayClassName(course, className));
    } else {
      unresolvedCourses.push(course);
    }
  });

  if (classGroups.size === 0) {
    if (!courses || courses.length === 0) {
      return [];
    }
    const aggregateName = buildMajorScheduleName(context);
    return [{
      semester: context.semester,
      className: aggregateName,
      displayType: "major-schedule",
      isAggregated: true,
      collegeCode: context.collegeCode,
      collegeName: context.collegeName || "",
      grade: context.grade,
      majorCode: context.majorCode,
      majorName: context.majorName,
      courses: courses.map((course) => withDisplayClassName(course, aggregateName, {
        sourceClassNameUnreliable: true,
      })),
    }];
  }

  return Array.from(classGroups.entries()).map(([className, groupedCourses]) => {
    const copiedUnresolved = unresolvedCourses.map((course) => withDisplayClassName(course, className, {
      sourceClassNameUnreliable: true,
    }));
    return {
      semester: context.semester,
      className,
      displayType: "class-schedule",
      isAggregated: false,
      collegeCode: context.collegeCode,
      collegeName: context.collegeName || "",
      grade: context.grade,
      majorCode: context.majorCode,
      majorName: context.majorName,
      courses: groupedCourses.concat(copiedUnresolved),
    };
  });
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
  buildClassScheduleEntries,
  buildMajorScheduleName,
  groupCoursesBy,
  isReliableClassName,
  normalizeCourseItem,
  normalizeCourseList,
};
