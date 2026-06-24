const crypto = require("crypto");
const { toRenderableCourse } = require("../utils/courseNormalizer");
const {
  inferStudentName,
  normalizeScheduleRows,
  parseSections,
  parseWeekday,
  parseWeeks,
} = require("../utils/fosuApaasScheduleParser");

const DEFAULT_PREVIEW_WEEK = 16;
const MAX_PREVIEW_WEEKS = 19;
const MAX_SECTION = 14;

const IMPORT_DECISION = {
  AUTO_INCLUDE: "auto_include",
  NEEDS_CONFIRM: "needs_confirm",
  SUSPECTED_NOT_MINE: "suspected_not_mine",
  UNSCHEDULED: "unscheduled",
  EXCLUDED_DUPLICATE: "excluded_duplicate",
};

const PREVIEW_BUCKET = {
  RECOMMENDED: "recommended",
  PENDING: "pending",
  UNPLACED: "unplaced",
  SUSPECTED: "suspected",
  DUPLICATE: "duplicate",
};

function toText(value) {
  return String(value == null ? "" : value).trim();
}

function stableHash(value, length = 24) {
  return crypto
    .createHash("sha256")
    .update(JSON.stringify(value || {}))
    .digest("hex")
    .slice(0, length);
}

function uniqSorted(values, max = 80) {
  return Array.from(new Set((values || [])
    .map((item) => Number(item))
    .filter((item) => Number.isInteger(item) && item > 0 && item <= max)))
    .sort((left, right) => left - right);
}

function normalizeText(value) {
  return toText(value)
    .replace(/\u3000/g, " ")
    .replace(/\s+/g, "");
}

function normalizeCourseName(value) {
  return normalizeText(value)
    .replace(/[（]/g, "(")
    .replace(/[）]/g, ")")
    .replace(/[【［]/g, "[")
    .replace(/[】］]/g, "]")
    .toLowerCase();
}

function normalizeRoomName(value) {
  return normalizeText(value)
    .replace(/[（）]/g, "")
    .toLowerCase();
}

function normalizeWeekText(value) {
  return normalizeText(value)
    .replace(/[，、；;]/g, ",")
    .replace(/[～~—–－]/g, "-")
    .replace(/至|到/g, "-");
}

function sectionKey(sections) {
  return uniqSorted(sections, MAX_SECTION).join(",");
}

function weekKey(weeks) {
  return uniqSorted(weeks, 80).join(",");
}

function rangesOverlap(left, right) {
  const set = new Set(left || []);
  return (right || []).some((item) => set.has(item));
}

function sameNumberArray(left, right) {
  const a = uniqSorted(left, 80);
  const b = uniqSorted(right, 80);
  if (a.length !== b.length) return false;
  return a.every((item, index) => item === b[index]);
}

function splitClassScopeSegments(raw) {
  const text = toText(raw)
    .replace(/[，、；;]/g, ",")
    .replace(/（/g, "(")
    .replace(/）/g, ")")
    .replace(/【|［/g, "[")
    .replace(/】|］/g, "]");
  const parts = [];
  let buffer = "";
  let squareDepth = 0;
  let roundDepth = 0;
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    if (char === "[") squareDepth += 1;
    if (char === "]") squareDepth = Math.max(0, squareDepth - 1);
    if (char === "(") roundDepth += 1;
    if (char === ")") roundDepth = Math.max(0, roundDepth - 1);
    if (char === "," && squareDepth === 0 && roundDepth === 0) {
      if (buffer.trim()) parts.push(buffer.trim());
      buffer = "";
      continue;
    }
    buffer += char;
  }
  if (buffer.trim()) parts.push(buffer.trim());
  return parts;
}

function normalizeClassPrefix(prefix) {
  let value = normalizeText(prefix)
    .replace(/班$/g, "")
    .replace(/鐝.*$/g, "")
    .replace(/级/g, "")
    .replace(/級/g, "");
  value = value.replace(/^20(\d{2})/, "$1");
  return value;
}

function parseNumberList(text) {
  const normalized = normalizeText(text)
    .replace(/[，、；;]/g, ",")
    .replace(/[～~—–－]/g, "-")
    .replace(/至|到/g, "-");
  const numbers = [];
  normalized.split(",").forEach((part) => {
    if (!part) return;
    if (part.includes("-")) {
      const [startRaw, endRaw] = part.split("-");
      const start = Number(startRaw);
      const end = Number(endRaw);
      if (Number.isInteger(start) && Number.isInteger(end) && start > 0 && end >= start && end <= 80) {
        for (let current = start; current <= end; current += 1) numbers.push(current);
      }
      return;
    }
    const single = Number(part);
    if (Number.isInteger(single) && single > 0 && single <= 80) numbers.push(single);
  });
  return uniqSorted(numbers, 80);
}

function displayClassName(prefix, number) {
  return `${prefix}${number}班`;
}

function parseClassSegment(segmentRaw) {
  const original = toText(segmentRaw);
  const text = normalizeText(original)
    .replace(/（/g, "(")
    .replace(/）/g, ")")
    .replace(/【|［/g, "[")
    .replace(/】|］/g, "]")
    .replace(/[～~—–－]/g, "-")
    .replace(/至|到/g, "-");
  if (!text) {
    return { raw: original, type: "empty", matchable: false, numbers: [] };
  }
  if (/临班|臨班|^临\d+|^臨\d+|线上|在线|慕课|网络|網絡|待定|未定/i.test(text)) {
    return { raw: original, type: "unknown", matchable: false, numbers: [], reason: "临时或线上班级" };
  }

  const withoutNote = text.replace(/\([^)]*$/, "");
  const bracket = withoutNote.match(/^(.+?)\[([0-9,\-]+)\](?:班|鐝.*)?$/);
  if (bracket) {
    const prefix = normalizeClassPrefix(bracket[1]);
    const numbers = parseNumberList(bracket[2]);
    if (prefix && numbers.length) {
      return {
        raw: original,
        type: "range",
        matchable: true,
        prefix,
        numbers,
        start: numbers[0],
        end: numbers[numbers.length - 1],
      };
    }
  }

  const dashRange = withoutNote.match(/^(.+?)(\d{1,2})-(\d{1,2})(?:班|鐝.*)?$/);
  if (dashRange) {
    const prefix = normalizeClassPrefix(dashRange[1]);
    const numbers = parseNumberList(`${dashRange[2]}-${dashRange[3]}`);
    if (prefix && numbers.length) {
      return {
        raw: original,
        type: "range",
        matchable: true,
        prefix,
        numbers,
        start: numbers[0],
        end: numbers[numbers.length - 1],
      };
    }
  }

  const exact = withoutNote.match(/^(.+?)(\d{1,2})(?:班|鐝.*)?$/);
  if (exact) {
    const prefix = normalizeClassPrefix(exact[1]);
    const number = Number(exact[2]);
    if (prefix && Number.isInteger(number) && number > 0 && number <= 80) {
      return {
        raw: original,
        type: "exact",
        matchable: true,
        prefix,
        number,
        numbers: [number],
        className: displayClassName(prefix, number),
      };
    }
  }

  return { raw: original, type: "unknown", matchable: false, numbers: [], reason: "无法识别班级范围" };
}

function parseClassScope(classNameRaw) {
  const raw = toText(classNameRaw);
  const segments = splitClassScopeSegments(raw).map(parseClassSegment);
  return {
    raw,
    status: segments.some((item) => item.matchable) ? "parsed" : "unknown",
    segments,
  };
}

function parseTargetClassName(targetClassName) {
  const scope = parseClassScope(targetClassName);
  const exact = (scope.segments || []).find((item) => item.matchable && item.numbers && item.numbers.length === 1);
  if (!exact) return null;
  return {
    prefix: exact.prefix,
    number: exact.numbers[0],
    className: displayClassName(exact.prefix, exact.numbers[0]),
  };
}

function isClassScopeMatch(classScope, targetClassName) {
  const target = parseTargetClassName(targetClassName);
  const scope = typeof classScope === "string" ? parseClassScope(classScope) : (classScope || parseClassScope(""));
  if (!target || !scope.raw || !Array.isArray(scope.segments) || !scope.segments.length) return "unknown";
  const matchable = scope.segments.filter((item) => item.matchable);
  if (!matchable.length) return "unknown";
  if (matchable.some((item) => item.prefix === target.prefix && (item.numbers || []).includes(target.number))) {
    return "match";
  }
  return "not_match";
}

function inferClassNameFromLocalCourses(localCourses) {
  const counts = new Map();
  (Array.isArray(localCourses) ? localCourses : []).forEach((course) => {
    const raw = toText(course && (course.className || course.classNameRaw || course.targetClassName || ""));
    const parsed = parseTargetClassName(raw);
    if (!parsed) return;
    counts.set(parsed.className, (counts.get(parsed.className) || 0) + 1);
  });
  const sorted = Array.from(counts.entries()).sort((left, right) => right[1] - left[1]);
  if (!sorted.length) return null;
  return {
    targetClassName: sorted[0][0],
    className: sorted[0][0],
    classNameConfidence: sorted[0][1] >= 2 ? "medium" : "low",
    source: "local_schedule",
  };
}

function inferTargetClassName(rows, existingSelectedClassName, localCourses) {
  const existing = parseTargetClassName(existingSelectedClassName);
  const counts = new Map();
  (rows || []).forEach((row) => {
    const scope = parseClassScope(row && (row.className || row.classNameRaw || row.rawClassText || ""));
    (scope.segments || []).forEach((segment) => {
      if (!segment.matchable || !segment.numbers || segment.numbers.length !== 1) return;
      const className = displayClassName(segment.prefix, segment.numbers[0]);
      counts.set(className, (counts.get(className) || 0) + 1);
    });
  });

  if (existing) {
    const existingCount = counts.get(existing.className) || 0;
    return {
      targetClassName: existing.className,
      className: existing.className,
      classNameConfidence: existingCount > 0 ? "high" : "medium",
      source: "selected_class",
    };
  }

  const sorted = Array.from(counts.entries()).sort((left, right) => right[1] - left[1]);
  if (!sorted.length) {
    return inferClassNameFromLocalCourses(localCourses) || {
      targetClassName: "",
      className: "",
      classNameConfidence: "low",
      source: "unknown",
    };
  }

  const [className, count] = sorted[0];
  const total = Math.max(1, (rows || []).length);
  const ratio = count / total;
  return {
    targetClassName: className,
    className,
    classNameConfidence: ratio >= 0.35 ? "high" : (ratio >= 0.15 ? "medium" : "low"),
    source: "raw_rows",
  };
}

function classifyRowByClassScope(row, targetClassName) {
  const classScope = parseClassScope(row && (row.className || row.classNameRaw || row.rawClassText || ""));
  return {
    classScope,
    matchStatus: isClassScopeMatch(classScope, targetClassName),
  };
}

function classifyCourseCategory(course) {
  const text = [
    course && course.courseName,
    course && course.specialNote,
    course && course.note,
    course && course.remark,
    course && course.roomName,
    course && course.classroom,
  ].map(toText).join(" ");
  if (/在线课程|线上|在线|慕课|MOOC|从草根到殿堂|高分子化学/i.test(text)) return "online";
  if (/大学生职业发展|就业指导|形势与政策|劳动教育|生产见习|实验室安全教育|职业发展/i.test(text)) return "irregular";
  if (/待定|未定|另行通知|自行安排/i.test(text)) return "pending";
  return "normal";
}

function buildLocalScheduleIndex(localCourses) {
  const courses = (Array.isArray(localCourses) ? localCourses : [])
    .filter((course) => course && course.courseName)
    .map((course) => {
      const weeks = uniqSorted(course.weeks && course.weeks.length
        ? course.weeks
        : parseWeeks(course.weekText || ""), 80);
      const sections = uniqSorted(course.sections && course.sections.length
        ? course.sections
        : parseSections(course.sectionText || ""), MAX_SECTION);
      return Object.assign({}, course, {
        normalizedCourseName: normalizeCourseName(course.courseName),
        weekday: Number(course.weekday || course.weekDay || course.dayOfWeek || 0) || 0,
        sections,
        weeks,
        roomName: course.roomName || course.classroom || "",
        normalizedRoomName: normalizeRoomName(course.roomName || course.classroom || ""),
      });
    });
  const byCourse = new Map();
  courses.forEach((course) => {
    const list = byCourse.get(course.normalizedCourseName) || [];
    list.push(course);
    byCourse.set(course.normalizedCourseName, list);
  });
  return { courses, byCourse };
}

function matchArrangementToLocal(arrangement, localIndex) {
  const candidates = localIndex && localIndex.byCourse
    ? (localIndex.byCourse.get(arrangement.normalizedCourseName) || [])
    : [];
  if (!candidates.length) return { matchStatus: "no_match", matchedCourse: null };

  const timeMatches = candidates.filter((course) =>
    Number(course.weekday) === Number(arrangement.weekday) &&
    sameNumberArray(course.sections, arrangement.sections)
  );
  const exact = timeMatches.find((course) => {
    const roomOk = !arrangement.roomName || !course.roomName ||
      normalizeRoomName(course.roomName) === normalizeRoomName(arrangement.roomName);
    const weeksOk = sameNumberArray(course.weeks, arrangement.weeks) || rangesOverlap(course.weeks, arrangement.weeks);
    return roomOk && weeksOk;
  });
  if (exact) return { matchStatus: "exact_match", matchedCourse: exact };
  if (timeMatches.length) return { matchStatus: "time_match", matchedCourse: timeMatches[0] };
  return { matchStatus: "course_match", matchedCourse: candidates[0] };
}

function isLocalMatched(status) {
  return status === "exact_match" || status === "time_match" || status === "course_match";
}

function isLocalTimeMatched(status) {
  return status === "exact_match" || status === "time_match";
}

function decisionForArrangement(arrangement) {
  if (!arrangement.hasCompleteTime) {
    return {
      importDecision: IMPORT_DECISION.UNSCHEDULED,
      confidence: "low",
      reason: "缺少周次、星期或节次，需手动确认",
    };
  }

  const classStatus = arrangement.classScopeStatus;
  const localStatus = arrangement.matchStatus;
  const localMatched = isLocalMatched(localStatus);
  const localTimeMatched = isLocalTimeMatched(localStatus);
  const special = arrangement.category !== "normal";

  if (classStatus === "not_match" && !localMatched) {
    return {
      importDecision: IMPORT_DECISION.SUSPECTED_NOT_MINE,
      confidence: "low",
      reason: "疑似不属于当前班级，默认不导入",
    };
  }

  if (special) {
    if (arrangement.category === "irregular" && (classStatus === "match" || localTimeMatched)) {
      return {
        importDecision: IMPORT_DECISION.AUTO_INCLUDE,
        confidence: localTimeMatched ? "high" : "medium",
        reason: "特殊安排课程，时间完整，已纳入推荐",
      };
    }
    return {
      importDecision: IMPORT_DECISION.NEEDS_CONFIRM,
      confidence: localTimeMatched ? "medium" : "low",
      reason: arrangement.category === "online"
        ? "线上或待定课程，已保留待确认"
        : "特殊安排课程，需手动确认",
    };
  }

  if (classStatus === "match" && localMatched) {
    return {
      importDecision: IMPORT_DECISION.AUTO_INCLUDE,
      confidence: "high",
      reason: localStatus === "exact_match"
        ? "与当前班级课表匹配，已加入推荐导入"
        : "班级范围匹配，已加入推荐导入",
    };
  }

  if (classStatus === "match" && !localMatched) {
    return {
      importDecision: IMPORT_DECISION.AUTO_INCLUDE,
      confidence: "medium",
      reason: "班级范围匹配，已加入推荐导入；未在当前班级课表中匹配到，请检查",
    };
  }

  if (classStatus === "unknown" && localTimeMatched) {
    return {
      importDecision: IMPORT_DECISION.AUTO_INCLUDE,
      confidence: "medium",
      reason: "与当前班级课表匹配，已加入推荐导入",
    };
  }

  if (classStatus === "not_match" && localMatched) {
    return {
      importDecision: IMPORT_DECISION.NEEDS_CONFIRM,
      confidence: "medium",
      reason: "上课班级字段异常，但与当前班级课表匹配，请确认",
    };
  }

  return {
    importDecision: IMPORT_DECISION.NEEDS_CONFIRM,
    confidence: "low",
    reason: "班级范围或时间信息需确认",
  };
}

function combineClassScopeStatus(current, next) {
  const values = [current, next].filter(Boolean);
  if (values.includes("match")) return "match";
  if (values.includes("unknown")) return "unknown";
  return values[0] || "unknown";
}

function mergeTextList(left, right) {
  return Array.from(new Set([].concat(left || [], right || []).map(toText).filter(Boolean))).join("，");
}

function timePatternKey(arrangement) {
  if (!arrangement || !arrangement.hasCompleteTime) return "";
  return [
    arrangement.weekday || "",
    sectionKey(arrangement.sections || []),
  ].join("|");
}

function analyzeCourseGroup(group) {
  const arrangements = Array.isArray(group && group.arrangements) ? group.arrangements : [];
  const complete = arrangements.filter((item) => item.hasCompleteTime);
  const coveredWeeks = uniqSorted(complete.flatMap((item) => item.weeks || []), 80);
  const patternCounts = new Map();
  complete.forEach((arrangement) => {
    const key = timePatternKey(arrangement);
    if (!key) return;
    patternCounts.set(key, (patternCounts.get(key) || 0) + 1);
  });
  const maxPatternCount = Array.from(patternCounts.values()).reduce((max, count) => Math.max(max, count), 0);
  const hasStableTimePattern = complete.length <= 1 || maxPatternCount >= 2 || maxPatternCount >= Math.ceil(complete.length / 2);
  const classScopeMatchCount = complete.filter((item) => item.classScopeStatus === "match").length;
  const localMatchCount = complete.filter((item) => isLocalMatched(item.matchStatus)).length;
  const conflictArrangementCount = arrangements.filter((item) => item.conflict).length;
  return {
    coveredWeeks,
    coverageCount: coveredWeeks.length,
    arrangementCount: arrangements.length,
    completeArrangementCount: complete.length,
    hasStableTimePattern,
    hasClassScopeMatch: classScopeMatchCount > 0,
    hasLocalTimeMatch: localMatchCount > 0,
    hasDispersedWeeks: complete.length > 1 && new Set(complete.map((item) => weekKey(item.weeks || []))).size > 1,
    conflictArrangementCount,
    hasOnlySmallConflict: conflictArrangementCount > 0 &&
      conflictArrangementCount <= Math.max(2, Math.ceil(Math.max(1, arrangements.length) * 0.25)),
  };
}

function shouldPromoteFormalGroup(group, analysis) {
  const category = group && group.category || "normal";
  if (!analysis || !analysis.completeArrangementCount) return false;
  if (!analysis.hasClassScopeMatch && !analysis.hasLocalTimeMatch) return false;
  if (category === "online" || category === "pending") return false;
  if (category === "irregular") return true;
  if (analysis.coverageCount >= 4) return true;
  return analysis.completeArrangementCount > 1 && analysis.hasStableTimePattern;
}

function shouldPromoteArrangementInFormalGroup(arrangement) {
  if (!arrangement || !arrangement.hasCompleteTime) return false;
  if (arrangement.importDecision === IMPORT_DECISION.AUTO_INCLUDE) return false;
  if (arrangement.importDecision === IMPORT_DECISION.UNSCHEDULED) return false;
  if (arrangement.classScopeStatus === "not_match") return false;
  if (arrangement.importDecision === IMPORT_DECISION.SUSPECTED_NOT_MINE && !isLocalMatched(arrangement.matchStatus)) {
    return false;
  }
  if (arrangement.category === "online" || arrangement.category === "pending") return false;
  return arrangement.classScopeStatus === "match" || isLocalTimeMatched(arrangement.matchStatus);
}

function applyCourseGroupRecommendation(group) {
  group.analysis = analyzeCourseGroup(group);
  if (!shouldPromoteFormalGroup(group, group.analysis)) return;
  const dispersedReason = group.analysis.hasDispersedWeeks
    ? "分散周次课程，已整理为正式课程"
    : "正式课程组，时间完整，已纳入推荐";
  group.arrangements.forEach((arrangement) => {
    if (
      arrangement.hasCompleteTime &&
      arrangement.importDecision === IMPORT_DECISION.AUTO_INCLUDE &&
      arrangement.category !== "online" &&
      arrangement.category !== "pending"
    ) {
      arrangement.reason = dispersedReason;
      arrangement.selectedByDefault = true;
      return;
    }
    if (!shouldPromoteArrangementInFormalGroup(arrangement)) return;
    arrangement.importDecision = IMPORT_DECISION.AUTO_INCLUDE;
    arrangement.confidence = arrangement.confidence === "high" ? "high" : "medium";
    arrangement.reason = dispersedReason;
    arrangement.selectedByDefault = true;
  });
  group.reason = dispersedReason;
}

function applyCourseGroupConflictAnalysis(group) {
  group.analysis = analyzeCourseGroup(group);
  if (!group.analysis.hasOnlySmallConflict) return;
  group.arrangements.forEach((arrangement) => {
    if (!arrangement.conflict || arrangement.importDecision !== IMPORT_DECISION.AUTO_INCLUDE) return;
    arrangement.reason = arrangement.reason || "存在时间重叠，建议检查";
  });
}

function publicArrangement(arrangement) {
  return {
    arrangementId: arrangement.arrangementId,
    courseGroupId: arrangement.courseGroupId,
    courseName: arrangement.courseName,
    displayCourseName: arrangement.displayCourseName,
    normalizedCourseName: arrangement.normalizedCourseName,
    weekday: arrangement.weekday,
    sections: arrangement.sections,
    startSection: arrangement.startSection,
    endSection: arrangement.endSection,
    weeks: arrangement.weeks,
    weekText: arrangement.weekText,
    sectionText: arrangement.sectionText,
    roomName: arrangement.roomName,
    campus: arrangement.campus,
    teacherName: arrangement.teacherName,
    classNameRaw: arrangement.classNameRaw,
    classScope: arrangement.classScope,
    classScopeStatus: arrangement.classScopeStatus,
    specialNote: arrangement.specialNote,
    sourceHash: arrangement.sourceHash,
    matchStatus: arrangement.matchStatus,
    importDecision: arrangement.importDecision,
    confidence: arrangement.confidence,
    reason: arrangement.reason,
    category: arrangement.category,
    hasCompleteTime: arrangement.hasCompleteTime,
    selectedByDefault: arrangement.selectedByDefault,
    conflict: Boolean(arrangement.conflict),
  };
}

function toImportCourse(arrangement, context = {}) {
  const importedAt = context.importedAt || new Date().toISOString();
  const roomName = arrangement.roomName || (arrangement.category === "online" ? "线上/待定" : "未注明");
  const base = {
    id: `fosu_apaas_${arrangement.arrangementId}`,
    courseName: arrangement.displayCourseName || arrangement.courseName,
    displayCourseName: arrangement.displayCourseName || arrangement.courseName,
    weekText: arrangement.weekText,
    weekday: arrangement.weekday,
    weekDay: arrangement.weekday,
    weekdayText: arrangement.weekday ? `星期${"一二三四五六日"[arrangement.weekday - 1]}` : "",
    sectionText: arrangement.sectionText,
    sections: arrangement.sections,
    startSection: arrangement.startSection,
    endSection: arrangement.endSection,
    weeks: arrangement.weeks,
    startWeek: arrangement.weeks[0] || null,
    endWeek: arrangement.weeks[arrangement.weeks.length - 1] || null,
    roomName,
    classroom: roomName,
    teacherName: arrangement.teacherName || "",
    className: arrangement.classNameRaw || context.targetClassName || "",
    campus: arrangement.campus || "",
    specialNote: arrangement.specialNote || "",
    note: arrangement.specialNote || "",
    remark: arrangement.specialNote || "",
    semester: context.semester || "",
    term: context.semester || "",
    source: "fosu_apaas",
    sourceType: "personal",
    sourceStudentId: context.studentId || "",
    sourceHash: arrangement.sourceHash,
    importDecision: arrangement.importDecision,
    matchStatus: arrangement.matchStatus,
    classScopeStatus: arrangement.classScopeStatus,
    courseGroupId: arrangement.courseGroupId,
    arrangementId: arrangement.arrangementId,
    importedAt,
  };
  return toRenderableCourse(base);
}

function isSameCourseArrangement(left, right) {
  if (!left || !right) return false;
  if (left.courseGroupId && right.courseGroupId && left.courseGroupId === right.courseGroupId) return true;
  const leftName = normalizeCourseName(left.normalizedCourseName || left.displayCourseName || left.courseName || "");
  const rightName = normalizeCourseName(right.normalizedCourseName || right.displayCourseName || right.courseName || "");
  return Boolean(leftName && rightName && leftName === rightName);
}

function isArrangementConflict(left, right) {
  if (!left || !right || !left.hasCompleteTime || !right.hasCompleteTime) return false;
  if (Number(left.weekday) !== Number(right.weekday)) return false;
  if (!rangesOverlap(left.sections, right.sections)) return false;
  if (!rangesOverlap(left.weeks, right.weeks)) return false;
  if (isSameCourseArrangement(left, right)) return false;
  return true;
}

function countConflicts(arrangements) {
  let count = 0;
  const list = (arrangements || []).filter((item) => item.hasCompleteTime);
  list.forEach((item) => { item.conflict = false; });
  for (let leftIndex = 0; leftIndex < list.length; leftIndex += 1) {
    for (let rightIndex = leftIndex + 1; rightIndex < list.length; rightIndex += 1) {
      const left = list[leftIndex];
      const right = list[rightIndex];
      if (!isArrangementConflict(left, right)) continue;
      count += 1;
      left.conflict = true;
      right.conflict = true;
    }
  }
  return count;
}

function buildPreviewGrid(arrangements, week = DEFAULT_PREVIEW_WEEK) {
  const targetWeek = Math.min(MAX_PREVIEW_WEEKS, Math.max(1, Number(week || DEFAULT_PREVIEW_WEEK) || DEFAULT_PREVIEW_WEEK));
  const complete = (arrangements || [])
    .filter((item) => item.hasCompleteTime);
  const hasWeekendCourses = complete.some((item) => Number(item.weekday) === 6 || Number(item.weekday) === 7);
  const visible = complete
    .filter((item) => item.hasCompleteTime && item.weeks && item.weeks.includes(targetWeek))
    .filter((item) => item.importDecision !== IMPORT_DECISION.UNSCHEDULED)
    .filter((item) => Number(item.weekday) >= 1 && Number(item.weekday) <= 5)
    .map((item) => publicArrangement(item));

  visible.forEach((item) => { item.conflict = false; });
  countConflicts(visible);

  const days = Array.from({ length: 5 }, (_, index) => ({
    weekday: index + 1,
    label: `周${"一二三四五六日"[index]}`,
  }));
  const sections = Array.from({ length: MAX_SECTION }, (_, index) => ({
    section: index + 1,
    label: `${index + 1}`,
  }));

  const cells = visible.map((item) => ({
    id: item.arrangementId,
    arrangementId: item.arrangementId,
    courseGroupId: item.courseGroupId,
    courseName: item.displayCourseName || item.courseName,
    displayCourseName: item.displayCourseName || item.courseName,
    weekday: item.weekday,
    sections: item.sections,
    startSection: item.startSection,
    endSection: item.endSection,
    weekText: item.weekText,
    roomName: item.roomName,
    teacherName: item.teacherName,
    classNameRaw: item.classNameRaw,
    matchStatus: item.matchStatus,
    importDecision: item.importDecision,
    reason: item.reason,
    conflict: Boolean(item.conflict),
    selectedByDefault: item.selectedByDefault,
  }));

  return { week: targetWeek, hasWeekendCourses, days, sections, cells };
}

function compactPreviewCourse(arrangement) {
  return {
    id: arrangement.arrangementId,
    arrangementId: arrangement.arrangementId,
    courseName: arrangement.displayCourseName || arrangement.courseName,
    weekText: arrangement.weekText,
    weekday: arrangement.weekday,
    weekdayText: arrangement.weekday ? `星期${"一二三四五六日"[arrangement.weekday - 1]}` : "",
    sectionText: arrangement.sectionText,
    roomName: arrangement.roomName,
    className: arrangement.classNameRaw,
    campus: arrangement.campus,
    specialNote: arrangement.specialNote,
    reason: arrangement.reason,
    importDecision: arrangement.importDecision,
    matchStatus: arrangement.matchStatus,
  };
}

function legacyGroupBucketForDecision(decision) {
  if (decision === IMPORT_DECISION.AUTO_INCLUDE) return "autoInclude";
  if (decision === IMPORT_DECISION.SUSPECTED_NOT_MINE) return "suspectedNotMine";
  if (decision === IMPORT_DECISION.UNSCHEDULED) return "unscheduled";
  return "needsConfirm";
}

function previewBucketForDecision(decision) {
  if (decision === IMPORT_DECISION.AUTO_INCLUDE) return PREVIEW_BUCKET.RECOMMENDED;
  if (decision === IMPORT_DECISION.SUSPECTED_NOT_MINE) return PREVIEW_BUCKET.SUSPECTED;
  if (decision === IMPORT_DECISION.UNSCHEDULED) return PREVIEW_BUCKET.UNPLACED;
  if (decision === IMPORT_DECISION.EXCLUDED_DUPLICATE) return PREVIEW_BUCKET.DUPLICATE;
  return PREVIEW_BUCKET.PENDING;
}

function createEmptyPreviewBuckets() {
  return {
    recommended: [],
    pending: [],
    unplaced: [],
    suspected: [],
    duplicate: [],
  };
}

function createLegacyGroupsFromBuckets(buckets) {
  return {
    autoInclude: buckets.recommended || [],
    needsConfirm: buckets.pending || [],
    suspectedNotMine: buckets.suspected || [],
    unscheduled: buckets.unplaced || [],
  };
}

function summarizeGroup(group) {
  const arrangements = (group.arrangements || []).map(publicArrangement);
  return {
    courseGroupId: group.courseGroupId,
    normalizedCourseName: group.normalizedCourseName,
    displayCourseName: group.displayCourseName,
    category: group.category,
    confidence: group.confidence,
    importDecision: group.importDecision,
    reason: group.reason,
    analysis: group.analysis || analyzeCourseGroup(group),
    arrangements,
  };
}

function summarizeGroupForBucket(group, bucketKey, arrangements) {
  const bucketGroup = Object.assign({}, group, {
    arrangements,
    importDecision: arrangements[0] && arrangements[0].importDecision || group.importDecision,
  });
  const first = arrangements.find((item) => item.reason) || arrangements[0] || {};
  bucketGroup.reason = first.reason || group.reason || "";
  bucketGroup.confidence = first.confidence || group.confidence || "low";
  bucketGroup.viewBucketKey = bucketKey;
  bucketGroup.analysis = analyzeCourseGroup(bucketGroup);
  return summarizeGroup(bucketGroup);
}

function addGroupToPreviewBuckets(group, buckets) {
  const byBucket = {};
  (group.arrangements || []).forEach((arrangement) => {
    const bucketKey = previewBucketForDecision(arrangement.importDecision);
    if (!byBucket[bucketKey]) byBucket[bucketKey] = [];
    byBucket[bucketKey].push(arrangement);
  });
  Object.keys(byBucket).forEach((bucketKey) => {
    if (!buckets[bucketKey]) return;
    buckets[bucketKey].push(summarizeGroupForBucket(group, bucketKey, byBucket[bucketKey]));
  });
}

function buildScheduleImportPreview(rawRows, options = {}) {
  const timing = options.timing || {};
  const normalizeStartedAt = Date.now();
  const studentId = toText(options.studentId);
  const semester = toText(options.semester || options.term || "当前学期");
  const importedAt = options.importedAt || new Date().toISOString();
  const normalized = normalizeScheduleRows(rawRows, { studentId, semester, importedAt });
  const rows = normalized.rows || [];
  const targetInference = inferTargetClassName(
    rows,
    options.existingSelectedClassName || options.targetClassName || "",
    options.localCourses || []
  );
  const targetClassName = targetInference.targetClassName || "";
  const localIndex = buildLocalScheduleIndex(options.localCourses || []);
  const groupMap = new Map();
  const arrangementMergeMap = new Map();
  const exactDedupKeys = new Set();
  let duplicateMergedCount = 0;

  rows.forEach((course, index) => {
    const courseName = toText(course.courseName);
    if (!courseName) return;
    const normalizedCourseName = normalizeCourseName(courseName);
    const displayCourseName = courseName;
    const classNameRaw = toText(course.className);
    const weeks = uniqSorted(course.weeks && course.weeks.length ? course.weeks : parseWeeks(course.weekText), 80);
    const weekday = Number(course.weekday || course.weekDay || parseWeekday(course.weekdayText) || 0) || 0;
    const sections = uniqSorted(course.sections && course.sections.length ? course.sections : parseSections(course.sectionText), MAX_SECTION);
    const hasCompleteTime = Boolean(weeks.length && weekday && sections.length);
    const sourceHash = course.sourceHash || stableHash({
      courseName,
      weekText: course.weekText,
      weekday,
      sectionText: course.sectionText,
      roomName: course.roomName || course.classroom,
      classNameRaw,
      index,
    });
    const classInfo = classifyRowByClassScope({ className: classNameRaw }, targetClassName);
    const courseGroupId = `group_${stableHash({ normalizedCourseName, targetClassName, semester }, 20)}`;
    const exactKey = [
      normalizedCourseName,
      weekday,
      normalizeText(course.sectionText || sectionKey(sections)),
      normalizeWeekText(course.weekText || weekKey(weeks)),
      normalizeRoomName(course.roomName || course.classroom || ""),
      normalizeText(classNameRaw),
    ].join("|");
    const mergeKey = [
      normalizedCourseName,
      weekday,
      sectionKey(sections),
      weekKey(weeks),
      normalizeRoomName(course.roomName || course.classroom || ""),
    ].join("|");

    if (exactDedupKeys.has(exactKey)) {
      duplicateMergedCount += 1;
      return;
    }
    exactDedupKeys.add(exactKey);

    const existingArrangement = arrangementMergeMap.get(mergeKey);
    if (existingArrangement) {
      duplicateMergedCount += 1;
      existingArrangement.classNameRaw = mergeTextList(existingArrangement.classNameRaw, classNameRaw);
      existingArrangement.classScopeStatus = combineClassScopeStatus(existingArrangement.classScopeStatus, classInfo.matchStatus);
      existingArrangement.sourceHash = mergeTextList(existingArrangement.sourceHash, sourceHash);
      existingArrangement.classScope = parseClassScope(existingArrangement.classNameRaw);
      const decision = decisionForArrangement(existingArrangement);
      Object.assign(existingArrangement, decision, { selectedByDefault: decision.importDecision === IMPORT_DECISION.AUTO_INCLUDE });
      return;
    }

    const arrangementId = `arr_${stableHash({
      normalizedCourseName,
      weekday,
      sections,
      weeks,
      roomName: course.roomName || course.classroom || "",
      classNameRaw,
      sourceHash,
    }, 22)}`;
    const arrangement = {
      arrangementId,
      courseGroupId,
      courseName,
      displayCourseName,
      normalizedCourseName,
      weekday,
      sections,
      startSection: sections[0] || null,
      endSection: sections[sections.length - 1] || null,
      weeks,
      weekText: toText(course.weekText),
      sectionText: toText(course.sectionText) || (sections.length ? `${sections[0]}-${sections[sections.length - 1]}` : ""),
      roomName: toText(course.roomName || course.classroom || ""),
      campus: toText(course.campus),
      teacherName: toText(course.teacherName),
      classNameRaw,
      classScope: classInfo.classScope,
      classScopeStatus: classInfo.matchStatus,
      specialNote: toText(course.specialNote || course.note || course.remark),
      sourceHash,
      rawIndex: course.originalIndex == null ? index : course.originalIndex,
      category: classifyCourseCategory(course),
      hasCompleteTime,
    };

    const localMatch = hasCompleteTime ? matchArrangementToLocal(arrangement, localIndex) : { matchStatus: "no_match", matchedCourse: null };
    arrangement.matchStatus = localMatch.matchStatus;
    arrangement.matchedLocalCourseId = localMatch.matchedCourse && (localMatch.matchedCourse.id || localMatch.matchedCourse.uniqueKey) || "";
    if (!arrangement.teacherName && localMatch.matchedCourse && localMatch.matchedCourse.teacherName) {
      arrangement.teacherName = toText(localMatch.matchedCourse.teacherName);
    }
    Object.assign(arrangement, decisionForArrangement(arrangement));
    arrangement.selectedByDefault = arrangement.importDecision === IMPORT_DECISION.AUTO_INCLUDE;

    arrangementMergeMap.set(mergeKey, arrangement);
    if (!groupMap.has(courseGroupId)) {
      groupMap.set(courseGroupId, {
        courseGroupId,
        normalizedCourseName,
        displayCourseName,
        category: arrangement.category,
        arrangements: [],
      });
    }
    groupMap.get(courseGroupId).arrangements.push(arrangement);
  });

  const groups = Array.from(groupMap.values()).map((group) => {
    group.arrangements.sort((left, right) => {
      if ((left.weekday || 99) !== (right.weekday || 99)) return (left.weekday || 99) - (right.weekday || 99);
      if ((left.startSection || 99) !== (right.startSection || 99)) return (left.startSection || 99) - (right.startSection || 99);
      return String(left.weekText || "").localeCompare(String(right.weekText || ""));
    });
    applyCourseGroupRecommendation(group);
    const decisions = group.arrangements.map((item) => item.importDecision);
    if (decisions.some((item) => item === IMPORT_DECISION.AUTO_INCLUDE)) group.importDecision = IMPORT_DECISION.AUTO_INCLUDE;
    else if (decisions.every((item) => item === IMPORT_DECISION.SUSPECTED_NOT_MINE)) group.importDecision = IMPORT_DECISION.SUSPECTED_NOT_MINE;
    else if (decisions.every((item) => item === IMPORT_DECISION.UNSCHEDULED)) group.importDecision = IMPORT_DECISION.UNSCHEDULED;
    else group.importDecision = IMPORT_DECISION.NEEDS_CONFIRM;
    const firstDecision = group.arrangements.find((item) => item.importDecision === group.importDecision) || group.arrangements[0] || {};
    group.reason = firstDecision.reason || "";
    group.confidence = firstDecision.confidence || "low";
    return group;
  }).sort((left, right) => left.displayCourseName.localeCompare(right.displayCourseName, "zh-Hans-CN"));

  const allArrangements = groups.flatMap((group) => group.arrangements);
  const autoArrangements = allArrangements.filter((item) => item.importDecision === IMPORT_DECISION.AUTO_INCLUDE);
  const conflictCount = countConflicts(autoArrangements);
  groups.forEach(applyCourseGroupConflictAnalysis);
  const currentPreviewWeek = Math.min(MAX_PREVIEW_WEEKS, Math.max(1, Number(options.currentPreviewWeek || DEFAULT_PREVIEW_WEEK) || DEFAULT_PREVIEW_WEEK));
  const buckets = createEmptyPreviewBuckets();
  groups.forEach((group) => {
    addGroupToPreviewBuckets(group, buckets);
  });
  const groupedPayload = createLegacyGroupsFromBuckets(buckets);

  const scheduledCourses = autoArrangements.map((arrangement) => toImportCourse(arrangement, {
    studentId,
    semester,
    importedAt,
    targetClassName,
  }));
  const unscheduledCourses = allArrangements
    .filter((item) => item.importDecision === IMPORT_DECISION.UNSCHEDULED || item.importDecision === IMPORT_DECISION.NEEDS_CONFIRM)
    .map((arrangement) => Object.assign(toImportCourse(Object.assign({}, arrangement, {
      weekday: arrangement.weekday || null,
      sections: arrangement.sections || [],
      startSection: arrangement.startSection || null,
      endSection: arrangement.endSection || null,
    }), { studentId, semester, importedAt, targetClassName }), {
      reason: arrangement.reason,
      isScheduled: false,
    }));

  timing.normalizeMs = timing.normalizeMs || (Date.now() - normalizeStartedAt);

  return {
    profile: {
      studentId,
      studentName: inferStudentName(rows),
      className: targetClassName,
      targetClassName,
      classNameConfidence: targetInference.classNameConfidence,
      classNameSource: targetInference.source,
    },
    summary: {
      rawRowCount: Array.isArray(rawRows) ? rawRows.length : 0,
      scheduledCourseCount: scheduledCourses.length,
      unscheduledCourseCount: unscheduledCourses.length,
      autoIncludeCount: groupedPayload.autoInclude.length,
      arrangementAutoIncludeCount: autoArrangements.length,
      recommendedCount: buckets.recommended.length,
      recommendedArrangementCount: autoArrangements.length,
      needsConfirmCount: allArrangements.filter((item) => item.importDecision === IMPORT_DECISION.NEEDS_CONFIRM).length,
      pendingCount: buckets.pending.length,
      pendingArrangementCount: allArrangements.filter((item) => item.importDecision === IMPORT_DECISION.NEEDS_CONFIRM).length,
      suspectedNotMineCount: allArrangements.filter((item) => item.importDecision === IMPORT_DECISION.SUSPECTED_NOT_MINE).length,
      suspectedCount: buckets.suspected.length,
      suspectedArrangementCount: allArrangements.filter((item) => item.importDecision === IMPORT_DECISION.SUSPECTED_NOT_MINE).length,
      unscheduledCount: allArrangements.filter((item) => item.importDecision === IMPORT_DECISION.UNSCHEDULED).length,
      unplacedCount: buckets.unplaced.length,
      unplacedArrangementCount: allArrangements.filter((item) => item.importDecision === IMPORT_DECISION.UNSCHEDULED).length,
      duplicateMergedCount,
      duplicateCount: duplicateMergedCount,
      conflictCount,
      currentPreviewWeek,
      semester,
    },
    previewGrid: buildPreviewGrid(allArrangements, currentPreviewWeek),
    buckets,
    groups: groupedPayload,
    uiHints: {
      defaultConfirmText: "确认导入推荐课程",
      warningText: "部分课程需要确认，导入后也可以继续编辑。",
      classNameWarningText: targetInference.classNameConfidence === "low"
        ? "班级未能完全确认，已避免推荐明显非本班课程。"
        : "",
    },
    preview: {
      scheduled: autoArrangements.slice(0, 12).map(compactPreviewCourse),
      unscheduled: allArrangements
        .filter((item) => item.importDecision !== IMPORT_DECISION.AUTO_INCLUDE)
        .slice(0, 12)
        .map(compactPreviewCourse),
    },
    courseGroups: groups,
    allArrangements,
    defaultSelectedArrangementIds: autoArrangements.map((item) => item.arrangementId),
    scheduledCourses,
    unscheduledCourses,
    timing,
  };
}

module.exports = {
  IMPORT_DECISION,
  PREVIEW_BUCKET,
  buildLocalScheduleIndex,
  buildPreviewGrid,
  buildScheduleImportPreview,
  classifyRowByClassScope,
  inferTargetClassName,
  isClassScopeMatch,
  matchArrangementToLocal,
  normalizeCourseName,
  parseClassScope,
  toImportCourse,
};
