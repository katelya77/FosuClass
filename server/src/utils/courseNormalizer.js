const UNKNOWN_CLASSROOM_TEXT = "待补充";
const MULTI_VENUE_TEXT = "多个地点";
const MULTI_TEACHER_TEXT = "多个教师";
const NOTICE_TEACHER_TEXT = "见通知";
const PE_NOTICE_TEXT = "体育课地点以教师/实际选课通知为准";

const COURSE_KEYWORDS = [
  "化学", "生物化学", "动物学", "有机化学", "解剖", "英语", "数学", "物理",
  "体育", "思想", "政治", "就业", "实验", "工程", "设计", "管理", "法学",
  "医学", "药学", "计算机", "人工智能", "写作", "阅读", "心理", "创新创业",
  "生理", "病理", "微生物", "遗传", "育种", "营养", "饲料", "食品", "安全教育",
  "职业发展", "形势与政策", "军事理论", "劳动教育", "马克思", "近现代史",
  "毛泽东", "概论", "高等数学", "线性代数", "概率", "大学生", "导论",
  "原理", "基础", "技术", "训练", "实训", "实习", "课程", "专题", "通识",
  "音乐", "美术", "经济", "金融", "会计", "统计", "软件", "网络", "数据库",
];

const STRONG_VENUE_TERMS = [
  "体育馆", "运动场", "游泳池", "球场", "篮球场", "足球场", "网球场",
  "羽毛球馆", "乒乓球馆", "健身房", "舞蹈室", "龙舟码头", "仙溪湖",
  "操场", "报告厅", "语音室", "机房", "会议室", "实训室", "画室",
  "实验室", "在线课程", "网络教学平台",
];

const VENUE_TERMS = [
  "楼", "室", "馆", "场", "池", "码头", "校区", "中心", "平台", "厅",
  "教室", "实验室", "仙溪", "江湾", "河滨", "操场", "田径", "体育",
];

const EMPTY_LIKE_TEXTS = new Set([
  "", "待补充", "暂无", "无", "未知", "自行安排", "待定", "未安排",
  "多个地点", "多个教师", "见通知", "多个教师/见通知",
]);

function toText(value) {
  return String(value == null ? "" : value);
}

function toHalfWidth(value) {
  return toText(value)
    .replace(/\u3000/g, " ")
    .replace(/[\uff01-\uff5e]/g, (char) =>
      String.fromCharCode(char.charCodeAt(0) - 0xfee0)
    );
}

function cleanDisplayText(value) {
  return toHalfWidth(value)
    .replace(/[（]/g, "(")
    .replace(/[）]/g, ")")
    .replace(/[，]/g, ",")
    .replace(/[；]/g, ";")
    .replace(/[：]/g, ":")
    .replace(/[【]/g, "[")
    .replace(/[】]/g, "]")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeText(text) {
  return cleanDisplayText(text)
    .replace(/[第周节]/g, "")
    .replace(/[()\[\]{}<>《》「」『』"'`]/g, "")
    .replace(/[.,;:，。；：、/\\|_-]/g, "")
    .replace(/\s+/g, "")
    .trim();
}

function isEmptyLike(value) {
  return EMPTY_LIKE_TEXTS.has(cleanDisplayText(value));
}

function hasAnyKeyword(text, keywords) {
  const normalized = normalizeText(text);
  return keywords.some((keyword) => normalized.includes(normalizeText(keyword)));
}

function hasCourseKeyword(text) {
  return hasAnyKeyword(text, COURSE_KEYWORDS);
}

function hasVenueSignal(text) {
  return hasAnyKeyword(text, STRONG_VENUE_TERMS) || hasAnyKeyword(text, VENUE_TERMS);
}

function isClassroomCodeLike(text) {
  const compact = cleanDisplayText(text).replace(/\s+/g, "");
  return (
    /^[A-Za-z]\d{1,2}[-－—]?\d{2,4}[A-Za-z]?(?:\(.+?\))?$/.test(compact) ||
    /^[A-Za-z]\d{1,2}(?:号)?楼?\d{2,4}[A-Za-z]?(?:\(.+?\))?$/.test(compact) ||
    /^[A-Za-z]{1,3}[-－—]?\d{2,4}(?:教室|室|厅)?$/.test(compact)
  );
}

function isStrongVenueText(text) {
  const compact = normalizeText(text);
  if (!compact || isEmptyLike(compact)) {
    return false;
  }
  if (isClassroomCodeLike(text)) {
    return true;
  }
  const matched = STRONG_VENUE_TERMS.some((term) => compact.includes(normalizeText(term)));
  if (!matched) {
    return false;
  }
  if (hasCourseKeyword(text) && /(教育|课程|技术|概论|导论|训练|实训)$/.test(compact)) {
    return false;
  }
  return true;
}

function isCourseLike(text) {
  const display = cleanDisplayText(text);
  const compact = normalizeText(display);
  if (!compact || isEmptyLike(display)) {
    return false;
  }

  if (/^(?:大学)?体育[1-4]?$/.test(compact) || /^大学[\u4e00-\u9fa5A-Za-z]+[1-4]$/.test(compact)) {
    return true;
  }

  if (hasCourseKeyword(display)) {
    return true;
  }

  const chineseChars = compact.match(/[\u4e00-\u9fa5]/g) || [];
  const looksLikeLongCourseName =
    chineseChars.length >= 6 &&
    !hasVenueSignal(display) &&
    !/^[\u4e00-\u9fa5]{2,4}$/.test(compact);

  return looksLikeLongCourseName;
}

function isVenueLike(text) {
  const display = cleanDisplayText(text);
  const compact = normalizeText(display);
  if (!compact || isEmptyLike(display)) {
    return false;
  }

  if (isClassroomCodeLike(display) || isStrongVenueText(display)) {
    return true;
  }

  if (!hasAnyKeyword(display, VENUE_TERMS)) {
    return false;
  }

  if (isCourseLike(display)) {
    return false;
  }

  return true;
}

function splitPersonNameCandidates(text) {
  return cleanDisplayText(text)
    .split(/[\/,，;；、\s]+/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function isSinglePersonNameLike(text) {
  const compact = normalizeText(text);
  return (
    /^[\u4e00-\u9fa5]{2,4}$/.test(compact) &&
    !hasCourseKeyword(compact) &&
    !isVenueLike(compact)
  );
}

function isPersonNameLike(text) {
  const parts = splitPersonNameCandidates(text);
  if (!parts.length) {
    return false;
  }
  return parts.every(isSinglePersonNameLike);
}

function isPhysicalEducationLike(course) {
  const item = course || {};
  const values = [
    item.displayCourseName,
    item.canonicalCourseName,
    item.courseName,
    item.name,
    item.title,
    item.teacherName,
    item.teacher,
    item.rawText,
  ];
  if (values.some((value) => /大学体育|体育/.test(cleanDisplayText(value)))) {
    return true;
  }

  const rawCourseName = cleanDisplayText(item.courseName || item.name || item.title);
  const rawTeacherName = cleanDisplayText(item.teacherName || item.teacher);
  return isVenueLike(rawCourseName) && isCourseLike(rawTeacherName) && /体育/.test(rawTeacherName);
}

function firstText(values) {
  for (const value of values) {
    const text = cleanDisplayText(value);
    if (text) {
      return text;
    }
  }
  return "";
}

function splitRawTextCandidates(text) {
  const raw = cleanDisplayText(text);
  const candidates = raw
    .split(/[\n\r\t|;；,，、]+/)
    .map((item) => item.replace(/^(课程|课程名|名称|教师|老师|地点|教室)[:：]/, "").trim())
    .filter(Boolean);

  const peMatches = raw.match(/大学体育[1-4]?|体育[1-4]?/g);
  if (peMatches) {
    candidates.push.apply(candidates, peMatches);
  }

  return candidates;
}

function extractCourseNameCandidate(rawCourse, fields) {
  const item = rawCourse || {};
  const candidates = [];
  [fields.teacherName, item.rawText, item.title, item.name].forEach((value) => {
    splitRawTextCandidates(value).forEach((candidate) => candidates.push(candidate));
  });

  for (const candidate of candidates) {
    if (isCourseLike(candidate) && !isVenueLike(candidate)) {
      return cleanDisplayText(candidate);
    }
  }
  return "";
}

function normalizeCourseIdentity(rawCourse, context) {
  const source = rawCourse || {};
  const config = context || {};
  const originalCourseName = firstText([source.courseName, source.name, source.title]);
  const originalTeacherName = firstText([source.teacherName, source.teacher]);
  const originalClassroom = firstText([source.classroom]);
  const rawText = firstText([source.rawText, config.rawText]);

  let displayCourseName = originalCourseName;
  let displayClassroom = originalClassroom;
  let displayTeacherName = originalTeacherName;
  let courseIdentityType = "normal";
  let normalizationReason = "normal";
  let isTeacherFieldActuallyCourseName = false;

  const courseNameIsVenue = isVenueLike(originalCourseName);
  const teacherNameIsCourse = isCourseLike(originalTeacherName);
  const teacherNameIsPeCourse = teacherNameIsCourse && /大学体育|体育/.test(originalTeacherName);

  if (courseNameIsVenue && originalTeacherName && (teacherNameIsCourse || teacherNameIsPeCourse)) {
    displayCourseName = originalTeacherName;
    displayClassroom = originalCourseName;
    displayTeacherName = NOTICE_TEACHER_TEXT;
    courseIdentityType = "venue_as_course";
    normalizationReason = "courseName_is_venue_teacherName_is_course";
    isTeacherFieldActuallyCourseName = true;
  } else if (!originalCourseName && teacherNameIsCourse) {
    displayCourseName = originalTeacherName;
    displayTeacherName = "";
    courseIdentityType = "teacher_as_course";
    normalizationReason = "teacherName_used_as_courseName";
    isTeacherFieldActuallyCourseName = true;
  } else if (courseNameIsVenue && !originalClassroom) {
    const extractedCourseName = extractCourseNameCandidate(source, {
      teacherName: originalTeacherName,
      rawText,
    });
    if (extractedCourseName && normalizeText(extractedCourseName) !== normalizeText(originalCourseName)) {
      displayCourseName = extractedCourseName;
      displayClassroom = originalCourseName;
      if (normalizeText(originalTeacherName) === normalizeText(extractedCourseName)) {
        displayTeacherName = "";
        isTeacherFieldActuallyCourseName = true;
      }
      courseIdentityType = "venue_promoted_to_classroom";
      normalizationReason = "courseName_is_venue_extracted_courseName";
    }
  }

  if (!displayCourseName) {
    const extractedCourseName = extractCourseNameCandidate(source, {
      teacherName: originalTeacherName,
      rawText,
    });
    if (extractedCourseName) {
      displayCourseName = extractedCourseName;
      normalizationReason = normalizationReason === "normal"
        ? "rawText_used_as_courseName"
        : normalizationReason;
    }
  }

  if (!displayClassroom && courseNameIsVenue && displayCourseName !== originalCourseName) {
    displayClassroom = originalCourseName;
  }

  const result = Object.assign({}, source, {
    rawCourseName: source.rawCourseName || originalCourseName,
    rawTeacherName: source.rawTeacherName || originalTeacherName,
    rawClassroom: source.rawClassroom || originalClassroom,
    venueCandidates: uniqueTexts([].concat(
      Array.isArray(source.venueCandidates) ? source.venueCandidates : [],
      courseNameIsVenue ? originalCourseName : "",
      isVenueLike(originalClassroom) ? originalClassroom : ""
    )),
    displayCourseName: cleanDisplayText(displayCourseName),
    canonicalCourseName: cleanDisplayText(displayCourseName),
    displayClassroom: cleanDisplayText(displayClassroom),
    canonicalClassroom: cleanDisplayText(displayClassroom),
    displayTeacherName: cleanDisplayText(displayTeacherName),
    canonicalTeacherName: cleanDisplayText(displayTeacherName),
    courseIdentityType,
    normalizationReason,
    isVenueCandidate: courseNameIsVenue,
    isTeacherFieldActuallyCourseName,
    isPhysicalEducationLike: false,
  });

  result.isPhysicalEducationLike = isPhysicalEducationLike(result);
  if (result.isPhysicalEducationLike && result.courseIdentityType === "normal") {
    result.courseIdentityType = "physical_education";
  }

  return result;
}

function shouldKeepTeacherName(name) {
  const text = cleanDisplayText(name);
  return Boolean(text) &&
    !isEmptyLike(text) &&
    text !== NOTICE_TEACHER_TEXT &&
    text !== MULTI_TEACHER_TEXT &&
    text !== "多个教师/见通知" &&
    !isCourseLike(text);
}

function shouldKeepVenueName(name) {
  const text = cleanDisplayText(name);
  return Boolean(text) &&
    !isEmptyLike(text) &&
    text !== UNKNOWN_CLASSROOM_TEXT &&
    text !== MULTI_VENUE_TEXT;
}

function uniqueTexts(values) {
  const seen = {};
  const result = [];
  (values || []).forEach((value) => {
    const text = cleanDisplayText(value);
    const key = normalizeText(text);
    if (!text || !key || seen[key]) {
      return;
    }
    seen[key] = true;
    result.push(text);
  });
  return result;
}

function toRenderableCourse(course) {
  const normalized = normalizeCourseIdentity(course);
  const title = normalized.displayCourseName || normalized.canonicalCourseName || normalized.courseName || "";
  const classroom = normalized.displayClassroom || normalized.canonicalClassroom || normalized.classroom || "";
  const teacherName = normalized.displayTeacherName || normalized.canonicalTeacherName || normalized.teacherName || "";
  return Object.assign({}, normalized, {
    courseName: title,
    classroom,
    teacherName,
  });
}

function buildTodayDisplayGroupKey(course, context) {
  const config = context || {};
  const sem = course.semester || config.semester || "";
  const classKey = config.classId || course.classId || config.className || course.className || "";
  const currentWeek = config.currentWeek || "";
  const weekday = config.weekday || course.weekday || "";
  const canonicalCourseName = normalizeText(
    course.canonicalCourseName || course.displayCourseName || course.courseName || ""
  );
  return [
    sem,
    classKey,
    currentWeek,
    weekday,
    course.startSection || "",
    course.endSection || "",
    canonicalCourseName,
  ].join("_");
}

function mergeCanonicalCoursesForDisplay(courses, context) {
  const config = context || {};
  const normalizedCourses = (courses || []).map(toRenderableCourse);
  const strictSeen = {};
  const strictUniqueCourses = [];

  normalizedCourses.forEach((course) => {
    const strictKey = [
      course.semester || config.semester || "",
      course.classId || config.classId || course.className || config.className || "",
      config.currentWeek || "",
      config.weekday || course.weekday || "",
      course.startSection || "",
      course.endSection || "",
      normalizeText(course.canonicalCourseName || course.courseName || ""),
      normalizeText(course.canonicalClassroom || course.classroom || ""),
      normalizeText(course.canonicalTeacherName || course.teacherName || ""),
    ].join("_");
    if (!strictSeen[strictKey]) {
      strictSeen[strictKey] = true;
      strictUniqueCourses.push(course);
    }
  });

  const groups = {};
  const groupKeys = [];
  strictUniqueCourses.forEach((course) => {
    const groupKey = buildTodayDisplayGroupKey(course, config);
    if (!groups[groupKey]) {
      groups[groupKey] = [];
      groupKeys.push(groupKey);
    }
    groups[groupKey].push(course);
  });

  const displayCourses = [];
  const mergedGroups = [];

  groupKeys.forEach((key) => {
    const group = groups[key];
    if (group.length === 1) {
      displayCourses.push(toRenderableCourse(group[0]));
      return;
    }

    const base = toRenderableCourse(group[0]);
    const canonicalCourseName = base.canonicalCourseName || base.displayCourseName || base.courseName;
    const venues = uniqueTexts(group.reduce((items, item) => {
      if (Array.isArray(item.venueCandidates)) {
        items.push.apply(items, item.venueCandidates);
      }
      items.push(item.displayClassroom || item.canonicalClassroom || item.classroom);
      return items;
    }, []).filter(shouldKeepVenueName));
    const teachers = uniqueTexts(group
      .filter((item) => !item.isTeacherFieldActuallyCourseName)
      .map((item) => item.displayTeacherName || item.canonicalTeacherName || item.teacherName)
      .filter(shouldKeepTeacherName));
    const isPe = group.some((item) => item.isPhysicalEducationLike) || isPhysicalEducationLike(base);

    let displayClassroom = base.displayClassroom || base.classroom || "";
    if (venues.length > 1) {
      displayClassroom = MULTI_VENUE_TEXT;
    } else if (venues.length === 1) {
      displayClassroom = venues[0];
    } else {
      displayClassroom = isPe ? MULTI_VENUE_TEXT : "";
    }

    let displayTeacherName = base.displayTeacherName || base.teacherName || "";
    if (teachers.length > 1) {
      displayTeacherName = MULTI_TEACHER_TEXT;
    } else if (teachers.length === 1) {
      displayTeacherName = teachers[0];
    } else {
      displayTeacherName = NOTICE_TEACHER_TEXT;
    }

    const tag = venues.length > 1 || isPe ? "多地点" : "已合并";
    const merged = Object.assign({}, base, {
      id: key,
      courseName: canonicalCourseName,
      displayCourseName: canonicalCourseName,
      canonicalCourseName,
      classroom: displayClassroom,
      displayClassroom,
      canonicalClassroom: displayClassroom,
      teacherName: displayTeacherName,
      displayTeacherName,
      canonicalTeacherName: displayTeacherName,
      isMerged: true,
      mergedCount: group.length,
      mergedVenues: venues,
      mergedTeachers: teachers,
      mergedItems: group,
      tag,
      remark: isPe ? PE_NOTICE_TEXT : base.remark,
      isPhysicalEducationLike: isPe,
    });

    displayCourses.push(merged);
    mergedGroups.push({
      key,
      courseName: canonicalCourseName,
      count: group.length,
      venues,
      teachers,
      isPhysicalEducationLike: isPe,
      items: group.map((item) => ({
        courseName: item.courseName,
        rawCourseName: item.rawCourseName || item.courseName,
        canonicalCourseName: item.canonicalCourseName,
        classroom: item.classroom,
        teacherName: item.teacherName,
        normalizationReason: item.normalizationReason,
      })),
    });
  });

  return {
    courses: displayCourses,
    normalizedCourses,
    strictUniqueCourses,
    mergedGroups,
  };
}

module.exports = {
  MULTI_TEACHER_TEXT,
  MULTI_VENUE_TEXT,
  NOTICE_TEACHER_TEXT,
  PE_NOTICE_TEXT,
  buildTodayDisplayGroupKey,
  cleanDisplayText,
  isCourseLike,
  isPersonNameLike,
  isPhysicalEducationLike,
  isVenueLike,
  mergeCanonicalCoursesForDisplay,
  normalizeCourseIdentity,
  normalizeText,
  toRenderableCourse,
};
