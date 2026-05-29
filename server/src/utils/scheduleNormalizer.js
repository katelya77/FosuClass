const { toRenderableCourse } = require("./courseNormalizer");

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
  "大学生职业发展",
  "形势与政策",
  "职业发展",
  "就业指导",
  "实验技术",
  "大学英语",
  "英语",
  "有机化学",
  "分析化学",
  "动物解剖学",
  "动物生物化学",
  "动物机能学",
  "动物学",
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

function dedupeStrings(values) {
  const seen = {};
  const result = [];
  (values || []).forEach((value) => {
    const text = String(value || "").trim();
    if (!text || seen[text]) {
      return;
    }
    seen[text] = true;
    result.push(text);
  });
  return result;
}

function normalizeClassName(name) {
  const compact = compactText(name)
    .replace(/^(班级|行政班级|行政班|上课班级|授课对象|教学班|上课对象)[:：]?/, "")
    .replace(/专业课表$/, "")
    .trim();
  if (/\d$/.test(compact)) {
    return `${compact}班`;
  }
  return compact;
}

function splitClassNameCandidates(value) {
  const raw = Array.isArray(value) ? value.join("、") : String(value || "");
  const normalized = raw
    .replace(/(?:上课班级|授课对象|行政班级|行政班|班级|教学班|上课对象)\s*[:：]/g, " ")
    .replace(/[；;,，、/／|]+/g, " ");
  const matches = [];
  const pattern = /(?:20\d{2}|\d{2})级?[\u4e00-\u9fa5A-Za-z]{2,40}\d{1,2}班?/g;
  let match = null;
  while ((match = pattern.exec(normalized)) !== null) {
    matches.push(normalizeClassName(match[0]));
  }
  return dedupeStrings(matches);
}

function getMajorAliases(majorName) {
  const clean = compactText(majorName)
    .replace(/[（(].*?[）)]/g, "")
    .replace(/专业|方向|微/g, "");
  const aliases = [clean];
  if (clean.includes("动物科学")) {
    aliases.push("动物科学", "动科");
  }
  if (clean.includes("动物医学")) {
    aliases.push("动物医学", "动医");
  }
  if (clean.includes("机械设计制造及其自动化")) {
    aliases.push("机械设计", "机械");
  }
  if (clean.includes("数学与应用数学")) {
    aliases.push("数学", "应用数学");
  }
  if (clean.length >= 2) {
    aliases.push(clean.slice(0, 2));
  }
  if (clean.length >= 4) {
    aliases.push(clean.slice(0, 4));
  }
  return dedupeStrings(aliases.filter((item) => item && item.length >= 2));
}

function hasClassNameShape(name, context = {}) {
  const compact = compactText(name);
  const hasGradeToken = /(?:^|[^\d])(?:20\d{2}|\d{2})级?/.test(compact) || /^(?:20\d{2}|\d{2})/.test(compact);
  const hasMajorText = /[\u4e00-\u9fa5A-Za-z]{2,}/.test(compact);
  const hasClassNo = /\d{1,2}班?$/.test(compact) || /[一二三四五六七八九十]{1,3}班$/.test(compact);
  const majorAliases = getMajorAliases(context.majorName);
  const hasMajorName = majorAliases.length ? majorAliases.some((alias) => compact.includes(alias)) : true;
  return hasGradeToken && hasMajorText && hasClassNo && hasMajorName;
}

function isLikelyClassName(name, context = {}) {
  const compact = compactText(normalizeClassName(name));
  if (!compact || UNRELIABLE_CLASS_NAMES.has(compact)) {
    return false;
  }

  if (/^(未命名|未知|暂无|无).*(班级|行政班|班)?$/.test(compact)) {
    return false;
  }

  const courseName = compactText(context.courseName);
  if (courseName && compact === courseName) {
    return false;
  }

  if (Array.isArray(context.courses)) {
    const cleanClassName = compact.replace(/^(20\d{2}|\d{2})级?/, "").replace(/\d+班$/, "").replace(/班$/, "");
    const isConfused = context.courses.some((course) => {
      if (!course || !course.courseName) return false;
      const cName = compactText(course.courseName);
      const cleanCName = cName.replace(/\d+$/, "");
      if (compact === cName) return true;
      if (cleanClassName && cleanCName) {
        if (cleanClassName === cleanCName) return true;
        if (cleanClassName.includes(cleanCName) || cleanCName.includes(cleanClassName)) {
          if (cleanClassName.length >= 2 && cleanCName.length >= 2) {
            return true;
          }
        }
      }
      return false;
    });
    if (isConfused) {
      return false;
    }
  }

  if (COURSE_NAME_KEYWORDS.some((keyword) => compact.includes(keyword))) {
    return false;
  }

  return hasClassNameShape(compact, context);
}

function isReliableClassName(name, options = {}) {
  return isLikelyClassName(name, options);
}

function getReliableClassNamesForCourse(course, context = {}) {
  const candidates = [];
  if (Array.isArray(course && course.classNames)) {
    candidates.push.apply(candidates, course.classNames);
  }
  [
    course && course.className,
    course && course.adminClass,
    course && course.teachingClass,
    course && course.audience,
    course && course.rawClassText,
  ].forEach((value) => {
    candidates.push.apply(candidates, splitClassNameCandidates(value));
  });

  return dedupeStrings(candidates.map(normalizeClassName)).filter((className) =>
    isLikelyClassName(className, {
      courseName: course && course.courseName,
      courses: context.courses,
      majorName: context.majorName,
    })
  );
}

function buildMajorScheduleName(context = {}) {
  const grade = context.grade || "";
  const majorName = context.majorName || "未知专业";
  return `${grade}级${majorName}专业课表`;
}

function buildMajorSharedScheduleName(context = {}) {
  const grade = context.grade || "";
  const majorName = context.majorName || "未知专业";
  return `${grade}级${majorName}专业共享课程`;
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
  const config = Object.assign({}, context, { courses });

  (courses || []).forEach((course) => {
    const reliableClassNames = getReliableClassNamesForCourse(course, config);
    if (reliableClassNames.length) {
      reliableClassNames.forEach((className) => {
        if (!classGroups.has(className)) {
          classGroups.set(className, []);
        }
        classGroups.get(className).push(withDisplayClassName(course, className));
      });
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

  const classEntries = Array.from(classGroups.entries())
    .sort(([left], [right]) => left.localeCompare(right, "zh-CN", { numeric: true }))
    .map(([className, groupedCourses]) => {
    const copiedUnresolved = unresolvedCourses.map((course) => withDisplayClassName(course, className, {
      sourceClassNameUnreliable: true,
      sharedByMajor: true,
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

  if (unresolvedCourses.length) {
    const sharedName = buildMajorSharedScheduleName(context);
    classEntries.push({
      semester: context.semester,
      className: sharedName,
      displayType: "major-shared-schedule",
      isAggregated: true,
      collegeCode: context.collegeCode,
      collegeName: context.collegeName || "",
      grade: context.grade,
      majorCode: context.majorCode,
      majorName: context.majorName,
      courses: unresolvedCourses.map((course) => withDisplayClassName(course, sharedName, {
        sourceClassNameUnreliable: true,
        sharedByMajor: true,
      })),
    });
  }

  return classEntries;
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
  normalized.classNames = Array.isArray(normalized.classNames) ? normalized.classNames : splitClassNameCandidates(normalized.className);
  normalized.audience = normalized.audience || "";
  normalized.teachingClass = normalized.teachingClass || "";
  normalized.adminClass = normalized.adminClass || "";
  normalized.rawClassText = normalized.rawClassText || "";
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
  
  return toRenderableCourse(normalized);
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
  buildMajorSharedScheduleName,
  groupCoursesBy,
  isLikelyClassName,
  isReliableClassName,
  normalizeCourseItem,
  normalizeCourseList,
};
