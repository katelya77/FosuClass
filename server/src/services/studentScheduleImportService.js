const crypto = require("crypto");
const { maskStudentId, safeLog } = require("../utils/safeLogger");
const {
  createPreviewToken,
  deletePreview,
  getPreview,
  takePreview,
} = require("./studentScheduleImportSessionStore");
const {
  getRecentImportForSession,
  saveRecentImportForSession,
} = require("./studentScheduleRecentImportStore");
const { IMPORT_DECISION, toImportCourse } = require("./scheduleImportNormalizer");
const { parseSections, parseWeeks } = require("../utils/studentScheduleRowParser");

const ALLOWED_CONFIRM_MODES = new Set(["replace_fosu_source", "merge", "replace_all_personal"]);
const CHINA_TIME_OFFSET_MS = 8 * 60 * 60 * 1000;

function toText(value) {
  return String(value == null ? "" : value).trim();
}


function getOwnerKey(req) {
  const session = req && req.fosuSession || {};
  return session.openidHash || session.sessionIdHash || session.sessionId || "";
}

function assertPreviewOwner(record, req) {
  const ownerKey = getOwnerKey(req);
  if (!record || !ownerKey || record.ownerKey !== ownerKey) {
    const error = new Error("IMPORT_TOKEN_EXPIRED");
    error.code = "IMPORT_TOKEN_EXPIRED";
    throw error;
  }
}

function publicPreviewPayload(preview, tokenInfo) {
  const profile = Object.assign({}, preview.profile || {});
  profile.studentIdMasked = profile.studentIdMasked || maskStudentId(profile.studentId || "");
  return {
    success: true,
    importPreviewToken: tokenInfo.token,
    expiresIn: tokenInfo.expiresIn,
    profile,
    summary: preview.summary,
    previewGrid: preview.previewGrid,
    buckets: preview.buckets,
    groups: preview.groups,
    courseGroups: preview.courseGroups,
    allArrangements: preview.allArrangements,
    defaultSelectedArrangementIds: preview.defaultSelectedArrangementIds,
    uiHints: preview.uiHints,
    preview: preview.preview,
    pageRemarks: Array.isArray(preview.pageRemarks) ? preview.pageRemarks : [],
    timing: preview.timing,
  };
}


function buildPreviewRecord(context, preview) {
  return {
    ownerKey: context.ownerKey || "",
    taskId: context.taskId,
    studentId: context.credentials && context.credentials.studentId || "",
    profile: preview.profile || {},
    summary: preview.summary || {},
    preview: preview.preview,
    previewGrid: preview.previewGrid,
    buckets: preview.buckets,
    groups: preview.groups,
    courseGroups: preview.courseGroups,
    allArrangements: preview.allArrangements,
    defaultSelectedArrangementIds: preview.defaultSelectedArrangementIds,
    scheduledCourses: preview.scheduledCourses,
    unscheduledCourses: preview.unscheduledCourses,
    timing: preview.timing,
    pageRemarks: Array.isArray(preview.pageRemarks) ? preview.pageRemarks : [],
    source: context.source || "client-direct",
  };
}

function saveRecentImportFromPreview(context, record) {
  try {
    const selection = buildSelectedImportCourses(record, {}, new Date().toISOString());
    const schedule = buildConfirmedSchedule(record, "replace_fosu_source", [], selection);
    return saveRecentImportForSession(context && context.fosuSession, {
      record,
      schedule,
      selection,
      mode: "replace_fosu_source",
      importedCourseCount: selection.incomingCourses.length,
    });
  } catch (error) {
    safeLog("student-schedule-preview-recent-import-save-failed", {
      taskId: record && record.taskId,
      code: error.code || error.message,
    });
    return null;
  }
}


function courseDedupKey(course) {
  return [
    course && course.sourceStudentId || "",
    course && course.courseName || "",
    course && course.weekText || "",
    course && course.weekday || course && course.weekDay || "",
    course && course.sectionText || "",
    course && course.roomName || course && course.classroom || "",
    course && course.className || "",
    course && course.source || "",
  ].join("|");
}

function dedupeCourses(courses) {
  const seen = new Set();
  const result = [];
  (courses || []).forEach((course) => {
    const key = courseDedupKey(course);
    if (seen.has(key)) return;
    seen.add(key);
    result.push(course);
  });
  return result;
}

function applyImportMode(existingCourses, importedCourses, mode) {
  const importMode = ALLOWED_CONFIRM_MODES.has(mode) ? mode : "replace_fosu_source";
  const existing = Array.isArray(existingCourses) ? existingCourses : [];
  const incoming = dedupeCourses(importedCourses || []);
  if (importMode === "replace_all_personal") {
    return incoming;
  }
  if (importMode === "merge") {
    return dedupeCourses(existing.concat(incoming));
  }
  return existing
    .filter((course) => course && course.source !== "fosu_apaas" && course.source !== "client-direct" && course.source !== "campus-agent")
    .concat(incoming);
}

function selectionError(code) {
  const error = new Error(code);
  error.code = code;
  return error;
}

function getArrangementMap(record) {
  const map = new Map();
  (record && record.allArrangements || []).forEach((arrangement) => {
    if (arrangement && arrangement.arrangementId) {
      map.set(String(arrangement.arrangementId), arrangement);
    }
  });
  return map;
}

function sanitizeEditableText(value, maxLength = 80) {
  return toText(value)
    .replace(/[<>{}`$\\]/g, "")
    .replace(/[\u0000-\u001f]/g, "")
    .slice(0, maxLength);
}

function parseEditedSections(edited) {
  if (Array.isArray(edited.sections)) {
    return edited.sections.map(Number).filter((item) => Number.isInteger(item));
  }
  const start = Number(edited.startSection || 0);
  const end = Number(edited.endSection || start || 0);
  if (Number.isInteger(start) && Number.isInteger(end) && start > 0 && end >= start) {
    return Array.from({ length: end - start + 1 }, (_, index) => start + index);
  }
  return parseSections(edited.sectionText || "");
}

function parseEditedWeeks(edited) {
  if (Array.isArray(edited.weeks)) {
    return edited.weeks.map(Number).filter((item) => Number.isInteger(item));
  }
  return parseWeeks(edited.weekText || "");
}

function validateEditedArrangement(base, edited) {
  const weekday = Number(edited.weekday || edited.weekDay || 0);
  const sections = parseEditedSections(edited);
  const weeks = parseEditedWeeks(edited);
  if (!Number.isInteger(weekday) || weekday < 1 || weekday > 7) {
    throw selectionError("INVALID_EDITED_ARRANGEMENT");
  }
  if (!sections.length || sections.some((item) => item < 1 || item > 14)) {
    throw selectionError("INVALID_EDITED_ARRANGEMENT");
  }
  if (!weeks.length || weeks.some((item) => item < 1 || item > 60)) {
    throw selectionError("INVALID_EDITED_ARRANGEMENT");
  }
  const sortedSections = Array.from(new Set(sections)).sort((left, right) => left - right);
  const sortedWeeks = Array.from(new Set(weeks)).sort((left, right) => left - right);
  const roomName = sanitizeEditableText(edited.roomName || edited.classroom || base.roomName || "");
  const weekText = sanitizeEditableText(edited.weekText || sortedWeeks.join(","));
  const sectionText = sanitizeEditableText(edited.sectionText || `${sortedSections[0]}-${sortedSections[sortedSections.length - 1]}`);
  const arrangementId = `arr_edit_${crypto.createHash("sha256").update(JSON.stringify({
    base: base.arrangementId,
    weekday,
    sections: sortedSections,
    weeks: sortedWeeks,
    roomName,
  })).digest("hex").slice(0, 22)}`;
  return Object.assign({}, base, {
    arrangementId,
    baseArrangementId: base.arrangementId,
    weekday,
    sections: sortedSections,
    startSection: sortedSections[0],
    endSection: sortedSections[sortedSections.length - 1],
    weeks: sortedWeeks,
    weekText,
    sectionText,
    roomName,
    hasCompleteTime: true,
    importDecision: IMPORT_DECISION.AUTO_INCLUDE,
    reason: "已手动确认，加入导入",
    selectedByDefault: true,
  });
}

function buildSelectedImportCourses(record, body = {}, importedAt) {
  const arrangementMap = getArrangementMap(record);
  if (!arrangementMap.size) {
    return {
      incomingCourses: record.scheduledCourses || [],
      selectedArrangementIds: [],
      unplacedCourses: record.unscheduledCourses || [],
    };
  }

  const explicitSelection = Object.prototype.hasOwnProperty.call(body, "selectedArrangementIds");
  const selectedArrangementIds = explicitSelection
    ? (Array.isArray(body.selectedArrangementIds) ? body.selectedArrangementIds.map(toText).filter(Boolean) : [])
    : (record.defaultSelectedArrangementIds || []);
  const selectedSet = new Set(selectedArrangementIds);
  selectedSet.forEach((id) => {
    if (!arrangementMap.has(id)) {
      throw selectionError("INVALID_SELECTED_ARRANGEMENT");
    }
  });

  const editedByBaseId = new Map();
  const confirmedEditedArrangements = [];
  const editedArrangements = Array.isArray(body.editedArrangements) ? body.editedArrangements.slice(0, 100) : [];
  editedArrangements.forEach((edited) => {
    const baseId = toText(edited && (edited.baseArrangementId || edited.arrangementId));
    const base = arrangementMap.get(baseId);
    if (!base) throw selectionError("INVALID_EDITED_ARRANGEMENT");
    const validated = validateEditedArrangement(base, edited || {});
    editedByBaseId.set(baseId, validated);
    confirmedEditedArrangements.push(validated);
  });

  const incomingCourses = [];
  selectedSet.forEach((id) => {
    const arrangement = editedByBaseId.get(id) || arrangementMap.get(id);
    if (!arrangement || !arrangement.hasCompleteTime) {
      throw selectionError("INVALID_SELECTED_ARRANGEMENT");
    }
    incomingCourses.push(toImportCourse(arrangement, {
      studentId: record.studentId,
      semester: record.summary && record.summary.semester,
      importedAt,
      targetClassName: record.profile && (record.profile.targetClassName || record.profile.className),
      source: record.source || "",
    }));
  });

  const unplacedCourses = (record.allArrangements || [])
    .filter((arrangement) => !selectedSet.has(arrangement.arrangementId))
    .filter((arrangement) => !arrangement.hasCompleteTime || arrangement.importDecision !== IMPORT_DECISION.AUTO_INCLUDE)
    .map((arrangement) => Object.assign(toImportCourse(Object.assign({}, arrangement, {
      weekday: arrangement.weekday || null,
      sections: arrangement.sections || [],
      startSection: arrangement.startSection || null,
      endSection: arrangement.endSection || null,
    }), {
      studentId: record.studentId,
      semester: record.summary && record.summary.semester,
      importedAt,
      targetClassName: record.profile && (record.profile.targetClassName || record.profile.className),
      source: record.source || "",
    }), {
      isScheduled: false,
      reason: arrangement.reason || "",
    }));

  return {
    incomingCourses,
    selectedArrangementIds: Array.from(selectedSet),
    editedArrangements: confirmedEditedArrangements,
    unplacedCourses,
  };
}

function buildConfirmedSchedule(record, mode, existingCourses = [], selectedOptions = {}) {
  const importedAt = new Date().toISOString();
  const studentIdMasked = maskStudentId(record.studentId || "");
  const sourceCourses = selectedOptions.incomingCourses || record.scheduledCourses || [];
  const incomingCourses = sourceCourses.map((course) => Object.assign({}, course, {
    importedAt,
    source: course.source || record.source || "client-direct",
    sourceStudentId: studentIdMasked,
  }));
  const courses = applyImportMode(existingCourses, incomingCourses, mode);
  const unplacedCourses = (selectedOptions.unplacedCourses || record.unscheduledCourses || []).map((course) => Object.assign({}, course, {
    sourceStudentId: studentIdMasked,
  }));
  return {
    type: "personal-apaas",
    name: record.profile.studentName ? `${record.profile.studentName}的个人课表` : "个人课表",
    title: record.profile.studentName ? `${record.profile.studentName}的个人课表` : "个人课表",
    subtitle: [
      record.profile.className || "",
      record.summary.semester || "当前学期",
      "学号同步",
    ].filter(Boolean).join(" · "),
    classId: `personal-apaas-${crypto.createHash("sha256").update(record.studentId || "").digest("hex").slice(0, 16)}`,
    semester: record.summary.semester || "当前学期",
    term: record.summary.semester || "当前学期",
    courses,
    unplacedCourses,
    updateTime: formatImportTime(importedAt),
    importedAt,
    sourceText: "学校课表系统",
    source: record.source || "client-direct",
    sourceStudentId: studentIdMasked,
    metadata: {
      studentId: studentIdMasked,
      studentIdMasked,
      studentName: record.profile.studentName || "",
      className: record.profile.className || "",
      classNameConfidence: record.profile.classNameConfidence || "low",
      term: record.summary.semester || "",
      source: record.source || "client-direct",
      rawRowCount: record.summary.rawRowCount,
      scheduledCourseCount: incomingCourses.length,
      totalCourseCount: courses.length,
      unscheduledCourseCount: unplacedCourses.length,
      conflictCount: record.summary.conflictCount || 0,
    },
  };
}

function formatImportTime(value) {
  const date = value ? new Date(value) : new Date();
  if (Number.isNaN(date.getTime())) return "";
  const chinaDate = new Date(date.getTime() + CHINA_TIME_OFFSET_MS);
  const pad = (num) => String(num).padStart(2, "0");
  return `${chinaDate.getUTCFullYear()}-${pad(chinaDate.getUTCMonth() + 1)}-${pad(chinaDate.getUTCDate())} ${pad(chinaDate.getUTCHours())}:${pad(chinaDate.getUTCMinutes())}`;
}

function confirmStudentScheduleImport(req, body = {}) {
  const token = toText(body.importPreviewToken);
  const mode = toText(body.mode) || "replace_fosu_source";
  if (!ALLOWED_CONFIRM_MODES.has(mode)) {
    const error = new Error("INVALID_IMPORT_MODE");
    error.code = "INVALID_IMPORT_MODE";
    throw error;
  }
  const record = takePreview(token);
  assertPreviewOwner(record, req);
  const existingCourses = Array.isArray(body.existingCourses) ? body.existingCourses.slice(0, 500) : [];
  const selection = buildSelectedImportCourses(record, body, new Date().toISOString());
  const schedule = buildConfirmedSchedule(record, mode, existingCourses, selection);
  const importedCourseCount = selection.incomingCourses.length;
  const studentIdMasked = maskStudentId(record.studentId || record.profile && record.profile.studentId || "");
  const publicProfile = Object.assign({}, record.profile || {}, {
    studentId: studentIdMasked,
    studentIdMasked,
  });
  safeLog("student-schedule-confirm-success", {
    taskId: record.taskId,
    userKey: record.ownerKey ? `${record.ownerKey.slice(0, 8)}...` : "",
    studentId: maskStudentId(record.studentId),
    importedCourseCount,
    totalCourseCount: schedule.courses.length,
    unscheduledCourseCount: schedule.unplacedCourses.length,
  });
  let recentImport = null;
  try {
    recentImport = saveRecentImportForSession(req && req.fosuSession, {
      record,
      schedule,
      selection,
      mode,
      importedCourseCount,
    });
  } catch (error) {
    safeLog("student-schedule-recent-import-save-failed", {
      taskId: record.taskId,
      code: error.code || error.message,
    });
  }
  return {
    success: true,
    mode,
    importedCourseCount,
    selectedArrangementIds: selection.selectedArrangementIds,
    totalCourseCount: schedule.courses.length,
    unscheduledCourseCount: schedule.unplacedCourses.length,
    conflictCount: record.summary.conflictCount || 0,
    schedule,
    courses: schedule.courses,
    unplacedCourses: schedule.unplacedCourses,
    profile: publicProfile,
    summary: record.summary,
    recentImport,
  };
}

function normalizeRecentCourseName(value) {
  return toText(value)
    .replace(/\u3000/g, " ")
    .replace(/[（]/g, "(")
    .replace(/[）]/g, ")")
    .replace(/[【［]/g, "[")
    .replace(/[】］]/g, "]")
    .replace(/\s+/g, "")
    .toLowerCase();
}

function recentCourseGroupId(bucketKey, course = {}) {
  const name = normalizeRecentCourseName(course.normalizedCourseName || course.displayCourseName || course.courseName || "");
  const category = toText(course.category || "");
  return `group_recent_${crypto.createHash("sha256").update([bucketKey, name, category].join("|")).digest("hex").slice(0, 20)}`;
}

function isArrangementScopedRecentGroupId(groupId, arrangementId) {
  const value = toText(groupId);
  if (!value) return true;
  if (value === toText(arrangementId)) return true;
  return /^arr[_-]/i.test(value) || /^recent-/i.test(value);
}

function groupRecentArrangements(arrangements, bucketKey) {
  const map = new Map();
  (Array.isArray(arrangements) ? arrangements : []).forEach((arrangement) => {
    const normalizedName = normalizeRecentCourseName(arrangement.normalizedCourseName || arrangement.displayCourseName || arrangement.courseName || "");
    const key = normalizedName || recentCourseGroupId(bucketKey, arrangement);
    const fallbackGroupId = recentCourseGroupId(bucketKey, arrangement);
    const courseGroupId = isArrangementScopedRecentGroupId(arrangement.courseGroupId, arrangement.arrangementId)
      ? fallbackGroupId
      : arrangement.courseGroupId;
    if (!map.has(key)) {
      map.set(key, {
        courseGroupId,
        courseName: arrangement.courseName,
        displayCourseName: arrangement.displayCourseName || arrangement.courseName,
        normalizedCourseName: arrangement.normalizedCourseName || normalizedName,
        reason: arrangement.classScopeReason || arrangement.reason || "",
        arrangements: [],
        bucketKey,
      });
    }
    map.get(key).arrangements.push(Object.assign({}, arrangement, { courseGroupId }));
  });
  return Array.from(map.values());
}

function resolveCourseClassNameRaw(course = {}) {
  const classScope = course.classScope && typeof course.classScope === "object" ? course.classScope : {};
  const raw = toText(course.classNameRaw ||
    course.className ||
    course.classNameText ||
    course.teachingClass ||
    course.rawClassText ||
    classScope.raw ||
    "");
  if (raw) return raw;
  const classNames = course.classNames ||
    course.audienceClasses ||
    course.audienceClassNames ||
    classScope.classNames ||
    classScope.audienceClasses ||
    classScope.segments;
  if (!Array.isArray(classNames)) return toText(classNames);
  return classNames
    .map((item) => item && typeof item === "object" ? (item.className || item.raw || item.name || "") : item)
    .map(toText)
    .filter(Boolean)
    .join("、");
}

function parseRecentNumberRangeText(text, max) {
  const normalized = toText(text)
    .replace(/[－–—~～至到]/g, "-")
    .replace(/[，、；;]/g, ",");
  const result = [];
  normalized.split(",").forEach((part) => {
    const range = toText(part).match(/(\d+)\s*-\s*(\d+)/);
    if (range) {
      const start = Number(range[1]);
      const end = Number(range[2]);
      if (Number.isInteger(start) && Number.isInteger(end) && start > 0 && end >= start) {
        for (let current = start; current <= end && (!max || current <= max); current += 1) {
          result.push(current);
        }
      }
      return;
    }
    const matches = toText(part).match(/\d+/g) || [];
    matches.forEach((item) => {
      const value = Number(item);
      if (Number.isInteger(value) && value > 0 && (!max || value <= max)) {
        result.push(value);
      }
    });
  });
  return Array.from(new Set(result)).sort((left, right) => left - right);
}

function toRecentArrangement(course = {}, index = 0, bucketKey = "recommended", selectedByDefault = false) {
  const startSection = Number(course.startSection || 0) || null;
  const endSection = Number(course.endSection || startSection || 0) || startSection;
  const parsedSections = parseSections(course.sectionText || "");
  const fallbackSections = parsedSections.length ? parsedSections : parseRecentNumberRangeText(course.sectionText, 14);
  const sections = Array.isArray(course.sections) && course.sections.length
    ? course.sections.map((item) => Number(item)).filter(Boolean)
    : (startSection && endSection
      ? Array.from({ length: Math.max(1, endSection - startSection + 1) }, (_, offset) => startSection + offset)
      : fallbackSections);
  const parsedWeeks = parseWeeks(course.weekText || "");
  const fallbackWeeks = parsedWeeks.length ? parsedWeeks : parseRecentNumberRangeText(course.weekText, 60);
  const weeks = Array.isArray(course.weeks) && course.weeks.length
    ? course.weeks.map((item) => Number(item)).filter(Boolean)
    : fallbackWeeks;
  const arrangementId = toText(course.arrangementId || course.id || `recent-${bucketKey}-${index}`);
  const importDecision = course.importDecision || (selectedByDefault ? "auto_include" : "unscheduled");
  const fallbackGroupId = recentCourseGroupId(bucketKey, course);
  const classNameRaw = resolveCourseClassNameRaw(course);
  return {
    arrangementId,
    courseGroupId: isArrangementScopedRecentGroupId(course.courseGroupId, arrangementId)
      ? fallbackGroupId
      : course.courseGroupId,
    courseName: course.displayCourseName || course.courseName || "",
    displayCourseName: course.displayCourseName || course.courseName || "",
    normalizedCourseName: course.normalizedCourseName || course.displayCourseName || course.courseName || "",
    teacherName: course.teacherName || course.displayTeacherName || "",
    roomName: course.roomName || course.classroom || course.displayClassroom || "",
    weekday: Number(course.weekday || course.weekDay || 0) || null,
    sections,
    startSection: sections[0] || startSection,
    endSection: sections[sections.length - 1] || endSection,
    sectionText: course.sectionText || "",
    weeks,
    weekText: course.weekText || "",
    classNameRaw,
    className: classNameRaw || course.className || "",
    classNames: Array.isArray(course.classNames) ? course.classNames : [],
    audienceClasses: Array.isArray(course.audienceClasses) ? course.audienceClasses : [],
    classScope: course.classScope || null,
    importDecision,
    selectedByDefault,
    hasCompleteTime: Boolean((Number(course.weekday || course.weekDay || 0) || 0) && sections.length && weeks.length),
    classScopeStatus: course.classScopeStatus || "",
    classScopeReason: course.classScopeReason || course.reason || "",
    matchStatus: course.matchStatus || "",
    sourceHash: course.sourceHash || "",
  };
}

function buildFallbackRecentPreviewRecord(recent = {}) {
  const schedule = recent.schedule || {};
  const importedCourses = Array.isArray(recent.importedCourses)
    ? recent.importedCourses
    : (Array.isArray(schedule.courses) ? schedule.courses : []);
  const unplaced = Array.isArray(recent.unplaced) ? recent.unplaced : [];
  const pending = Array.isArray(recent.pending) ? recent.pending : [];
  const selectedArrangements = importedCourses.map((course, index) => toRecentArrangement(course, index, "recommended", true));
  const pendingArrangements = pending.map((course, index) => toRecentArrangement(course, index, "pending", false));
  const unplacedArrangements = unplaced.map((course, index) => toRecentArrangement(course, index, "unplaced", false));
  const allArrangements = selectedArrangements.concat(pendingArrangements, unplacedArrangements);
  const summary = recent.summary || {};
  return {
    studentId: recent.studentIdMasked || recent.studentId || "",
    profile: {
      studentId: recent.studentIdMasked || recent.studentId || "",
      studentIdMasked: recent.studentIdMasked || recent.studentId || "",
      studentName: recent.studentName || "",
      className: recent.className || "",
      classNameConfidence: "low",
    },
    summary: {
      semester: schedule.term || schedule.semester || "",
      recommendedArrangementCount: selectedArrangements.length,
      pendingArrangementCount: pendingArrangements.length,
      unplacedArrangementCount: unplacedArrangements.length,
      scheduledCourseCount: selectedArrangements.length,
      unscheduledCourseCount: unplacedArrangements.length,
      conflictCount: Number(summary.conflictCount || 0) || 0,
    },
    allArrangements,
    defaultSelectedArrangementIds: selectedArrangements.map((item) => item.arrangementId),
    buckets: {
      recommended: groupRecentArrangements(selectedArrangements, "recommended"),
      pending: groupRecentArrangements(pendingArrangements, "pending"),
      unplaced: groupRecentArrangements(unplacedArrangements, "unplaced"),
      suspected: [],
    },
    groups: {},
    uiHints: {},
  };
}

function buildRecentPreviewRecord(recent = {}) {
  const editable = recent.editablePreview || {};
  const allArrangements = Array.isArray(editable.allArrangements) ? editable.allArrangements : [];
  if (allArrangements.length) {
    return {
      studentId: recent.studentIdMasked || recent.studentId || "",
      profile: editable.profile || {
        studentId: recent.studentIdMasked || recent.studentId || "",
        studentIdMasked: recent.studentIdMasked || recent.studentId || "",
        studentName: recent.studentName || "",
        className: recent.className || "",
      },
      summary: editable.summary || recent.summary || {},
      previewGrid: editable.previewGrid || null,
      buckets: editable.buckets || editable.groups || {},
      groups: editable.groups || editable.buckets || {},
      courseGroups: editable.courseGroups || [],
      uiHints: editable.uiHints || {},
      allArrangements,
      defaultSelectedArrangementIds: Array.isArray(editable.selectedArrangementIds) && editable.selectedArrangementIds.length
        ? editable.selectedArrangementIds
        : (Array.isArray(editable.defaultSelectedArrangementIds) ? editable.defaultSelectedArrangementIds : []),
    };
  }
  return buildFallbackRecentPreviewRecord(recent);
}

function confirmRecentStudentScheduleImport(req, body = {}) {
  const recent = getRecentImportForSession(req && req.fosuSession);
  if (!recent) {
    const error = new Error("RECENT_IMPORT_NOT_FOUND");
    error.code = "RECENT_IMPORT_NOT_FOUND";
    throw error;
  }
  const record = buildRecentPreviewRecord(recent);
  if (!Array.isArray(record.allArrangements) || !record.allArrangements.length) {
    const error = new Error("RECENT_IMPORT_NOT_EDITABLE");
    error.code = "RECENT_IMPORT_NOT_EDITABLE";
    throw error;
  }
  const mode = toText(body.mode) || "replace_fosu_source";
  const existingCourses = Array.isArray(body.existingCourses) ? body.existingCourses.slice(0, 500) : [];
  const selection = buildSelectedImportCourses(record, body, new Date().toISOString());
  const schedule = buildConfirmedSchedule(record, mode, existingCourses, selection);
  const importedCourseCount = selection.incomingCourses.length;
  const recentImport = saveRecentImportForSession(req && req.fosuSession, {
    record,
    schedule,
    selection,
    mode,
    importedCourseCount,
  });
  return {
    success: true,
    fromRecentImport: true,
    mode,
    importedCourseCount,
    selectedArrangementIds: selection.selectedArrangementIds,
    totalCourseCount: schedule.courses.length,
    unscheduledCourseCount: schedule.unplacedCourses.length,
    conflictCount: record.summary && record.summary.conflictCount || 0,
    schedule,
    courses: schedule.courses,
    unplacedCourses: schedule.unplacedCourses,
    profile: record.profile,
    summary: record.summary,
    recentImport,
  };
}

function createStoredPreviewFromNormalized(req, preview, meta = {}) {
  const context = {
    ownerKey: getOwnerKey(req),
    taskId: crypto.randomBytes(8).toString("hex"),
    credentials: { studentId: "" },
    fosuSession: req && req.fosuSession || null,
    source: meta.source || "client-direct",
  };
  const previewRecord = buildPreviewRecord(context, preview);
  const tokenInfo = createPreviewToken(previewRecord);
  const recentImport = saveRecentImportFromPreview(context, previewRecord);
  return Object.assign(publicPreviewPayload(preview, tokenInfo), {
    recentImport,
    source: previewRecord.source,
  });
}

function cancelStudentScheduleImport(req, body = {}) {
  const token = toText(body.importPreviewToken);
  const record = getPreview(token);
  if (record) {
    assertPreviewOwner(record, req);
  }
  deletePreview(token);
  return { success: true, canceled: true };
}

module.exports = {
  ALLOWED_CONFIRM_MODES,
  applyImportMode,
  cancelStudentScheduleImport,
  confirmRecentStudentScheduleImport,
  confirmStudentScheduleImport,
  createStoredPreviewFromNormalized,
};
