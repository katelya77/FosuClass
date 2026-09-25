const crypto = require("crypto");
const path = require("path");
const { readJsonFile, writeJsonAtomic } = require("../utils/jsonFileStore");

const STORE_SCHEMA_VERSION = 1;
const RECENT_IMPORT_SCHEMA_VERSION = 1;
const SOURCE = "fosu_student_import";
const STALE_AFTER_DAYS = 30;
const STALE_AFTER_MS = STALE_AFTER_DAYS * 24 * 60 * 60 * 1000;
const CHINA_TIME_OFFSET_MS = 8 * 60 * 60 * 1000;
const SENSITIVE_KEY_PATTERN = /(password|passwd|pwd|cookie|ticket|token|authorization|privatekey|publickey|encrypted|rawhtml|html|headers)/i;

let storeFileOverride = "";

function getStoreFilePath() {
  return storeFileOverride ||
    process.env.FOSU_RECENT_IMPORT_STORE_FILE ||
    path.join(__dirname, "../../storage/fosu-apaas-recent-imports.json");
}

function hashText(value) {
  return crypto.createHash("sha256").update(String(value || "")).digest("hex");
}

function toText(value) {
  return String(value == null ? "" : value).trim();
}

function getOwnerKeyFromSession(session = {}) {
  if (session.openidHash) return `openid:${session.openidHash}`;
  if (session.userIdHash) return `user:${session.userIdHash}`;
  if (session.userId) return `user:${hashText(session.userId)}`;
  if (session.sessionIdHash) return `session:${session.sessionIdHash}`;
  if (session.sessionId) return `session:${hashText(session.sessionId)}`;
  return "";
}

function readStore() {
  const store = readJsonFile(getStoreFilePath(), null);
  if (!store || typeof store !== "object" || Array.isArray(store)) {
    return { schemaVersion: STORE_SCHEMA_VERSION, records: {} };
  }
  return {
    schemaVersion: STORE_SCHEMA_VERSION,
    records: store.records && typeof store.records === "object" ? store.records : {},
  };
}

function writeStore(store) {
  writeJsonAtomic(getStoreFilePath(), {
    schemaVersion: STORE_SCHEMA_VERSION,
    records: store && store.records || {},
    updatedAt: new Date().toISOString(),
  });
}

function sanitizeForRecentImport(value, depth = 0) {
  if (depth > 12) return null;
  if (value == null) return value;
  if (Array.isArray(value)) {
    return value.slice(0, 1000).map((item) => sanitizeForRecentImport(item, depth + 1));
  }
  if (typeof value === "object") {
    const result = {};
    Object.keys(value).forEach((key) => {
      if (SENSITIVE_KEY_PATTERN.test(key)) return;
      result[key] = sanitizeForRecentImport(value[key], depth + 1);
    });
    return result;
  }
  if (typeof value === "string") {
    return value
      .replace(/JSESSIONID=[^;\s]+/ig, "JSESSIONID=[REDACTED]")
      .replace(/(password|passwd|pwd|cookie|ticket|token|authorization)\s*[:=]\s*[^,\s;&]+/ig, "$1=[REDACTED]");
  }
  return value;
}

function numberList(values, max) {
  return (Array.isArray(values) ? values : [])
    .map((value) => Number(value))
    .filter((value) => Number.isFinite(value) && value > 0 && (!max || value <= max));
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

function briefCourse(course = {}) {
  const classNameRaw = resolveCourseClassNameRaw(course);
  return sanitizeForRecentImport({
    id: course.id || course.arrangementId || "",
    arrangementId: course.arrangementId || course.id || "",
    courseGroupId: course.courseGroupId || "",
    courseName: course.displayCourseName || course.courseName || "",
    displayCourseName: course.displayCourseName || course.courseName || "",
    normalizedCourseName: course.normalizedCourseName || "",
    teacherName: course.teacherName || course.displayTeacherName || "",
    roomName: course.roomName || course.classroom || course.displayClassroom || "",
    weekday: course.weekday || course.weekDay || null,
    weekDay: course.weekDay || course.weekday || null,
    sections: numberList(course.sections, 14),
    startSection: course.startSection || null,
    endSection: course.endSection || null,
    sectionText: course.sectionText || "",
    weeks: numberList(course.weeks, 60),
    weekText: course.weekText || "",
    className: classNameRaw || course.className || "",
    classNameRaw,
    classNames: Array.isArray(course.classNames) ? course.classNames : [],
    audienceClasses: Array.isArray(course.audienceClasses) ? course.audienceClasses : [],
    classScope: course.classScope || null,
    classScopeStatus: course.classScopeStatus || "",
    classScopeReason: course.classScopeReason || "",
    matchStatus: course.matchStatus || "",
    reason: course.reason || course.note || "",
    importDecision: course.importDecision || "",
    category: course.category || "",
    hasCompleteTime: Boolean(course.hasCompleteTime),
    selectedByDefault: Boolean(course.selectedByDefault),
    sourceHash: course.sourceHash || "",
  });
}

function pendingBriefFromPreview(record = {}, selectedSet) {
  const selected = selectedSet || new Set();
  return (record.allArrangements || [])
    .filter((arrangement) => {
      const decision = String(arrangement.importDecision || "");
      if (decision === "auto_include") return false;
      return !selected.has(arrangement.arrangementId) ||
        decision === "needs_confirm" ||
        decision === "suspected_not_mine" ||
        decision === "unscheduled";
    })
    .slice(0, 80)
    .map(briefCourse);
}

function formatDisplayTime(value) {
  const date = value ? new Date(value) : new Date();
  if (Number.isNaN(date.getTime())) return "";
  const chinaDate = new Date(date.getTime() + CHINA_TIME_OFFSET_MS);
  const pad = (num) => String(num).padStart(2, "0");
  return `${chinaDate.getUTCFullYear()}-${pad(chinaDate.getUTCMonth() + 1)}-${pad(chinaDate.getUTCDate())} ${pad(chinaDate.getUTCHours())}:${pad(chinaDate.getUTCMinutes())}`;
}

function buildSummary(record = {}, schedule = {}, selection = {}, importedCourseCount = 0) {
  const summary = record.summary || {};
  const pendingCount = Number(summary.pendingArrangementCount || summary.needsConfirmCount || 0) +
    Number(summary.unplacedArrangementCount || summary.unscheduledCount || 0);
  return {
    recommendedCount: Number(summary.recommendedArrangementCount || summary.arrangementAutoIncludeCount || importedCourseCount || 0) || 0,
    pendingCount: pendingCount || Number(schedule.unplacedCourses && schedule.unplacedCourses.length || 0) || 0,
    conflictCount: Number(summary.conflictCount || 0) || 0,
    importedCourseCount: Number(importedCourseCount || schedule.courses && schedule.courses.length || 0) || 0,
    unplacedCount: Number(schedule.unplacedCourses && schedule.unplacedCourses.length || selection.unplacedCourses && selection.unplacedCourses.length || 0) || 0,
  };
}

function buildPublicProfile(record = {}, metadata = {}) {
  const profile = record.profile || {};
  const studentIdMasked = metadata.studentIdMasked || metadata.studentId || profile.studentIdMasked || "";
  return sanitizeForRecentImport(Object.assign({}, profile, {
    studentId: studentIdMasked,
    studentIdMasked,
    studentName: metadata.studentName || profile.studentName || "",
    className: metadata.className || profile.className || "",
  }));
}

function buildEditablePreview(record = {}, metadata = {}, selection = {}) {
  const selectedArrangementIds = Array.isArray(selection.selectedArrangementIds)
    ? selection.selectedArrangementIds
    : [];
  return sanitizeForRecentImport({
    schemaVersion: RECENT_IMPORT_SCHEMA_VERSION,
    source: SOURCE,
    profile: buildPublicProfile(record, metadata),
    summary: record.summary || {},
    previewGrid: record.previewGrid || null,
    buckets: record.buckets || record.groups || {},
    groups: record.groups || record.buckets || {},
    courseGroups: Array.isArray(record.courseGroups) ? record.courseGroups.slice(0, 300) : [],
    uiHints: record.uiHints || {},
    allArrangements: Array.isArray(record.allArrangements) ? record.allArrangements.slice(0, 600) : [],
    defaultSelectedArrangementIds: Array.isArray(record.defaultSelectedArrangementIds)
      ? record.defaultSelectedArrangementIds
      : [],
    selectedArrangementIds,
    editedArrangements: Array.isArray(selection.editedArrangements)
      ? selection.editedArrangements
      : [],
    pageRemarks: Array.isArray(record.pageRemarks) ? record.pageRemarks.slice(0, 20) : [],
  });
}

function buildRecentImportRecord({ ownerKey, record = {}, schedule = {}, selection = {}, mode = "", importedCourseCount = 0 } = {}) {
  const importedAt = schedule.importedAt || new Date().toISOString();
  const selectedArrangementIds = Array.isArray(selection.selectedArrangementIds) ? selection.selectedArrangementIds : [];
  const selectedSet = new Set(selectedArrangementIds);
  const profile = record.profile || {};
  const metadata = schedule.metadata || {};
  const summary = buildSummary(record, schedule, selection, importedCourseCount);
  const cleanSchedule = sanitizeForRecentImport(Object.assign({}, schedule, {
    updateTime: schedule.updateTime || formatDisplayTime(importedAt),
    importedAt,
  }));

  return sanitizeForRecentImport({
    schemaVersion: RECENT_IMPORT_SCHEMA_VERSION,
    ownerKey,
    source: SOURCE,
    mode,
    studentId: metadata.studentIdMasked || metadata.studentId || profile.studentIdMasked || "",
    studentIdMasked: metadata.studentIdMasked || metadata.studentId || profile.studentIdMasked || "",
    studentName: metadata.studentName || profile.studentName || "",
    className: metadata.className || profile.className || "",
    pageRemarks: Array.isArray(record.pageRemarks) ? record.pageRemarks.slice(0, 20) : [],
    importedAt,
    importedAtText: formatDisplayTime(importedAt),
    importedCourses: Array.isArray(cleanSchedule.courses) ? cleanSchedule.courses : [],
    selectedArrangements: selectedArrangementIds,
    selectedArrangementCount: selectedArrangementIds.length,
    unplaced: (cleanSchedule.unplacedCourses || selection.unplacedCourses || []).slice(0, 80).map(briefCourse),
    pending: pendingBriefFromPreview(record, selectedSet),
    summary,
    editablePreview: buildEditablePreview(record, metadata, selection),
    schedule: cleanSchedule,
    updatedAt: new Date().toISOString(),
  });
}

function decorateRecentImport(record) {
  if (!record || typeof record !== "object") return null;
  const importedAtMs = Date.parse(record.importedAt || "");
  const isStale = Number.isFinite(importedAtMs) && Date.now() - importedAtMs > STALE_AFTER_MS;
  const schedule = record.schedule || {};
  const importedCourses = Array.isArray(record.importedCourses) ? record.importedCourses : (Array.isArray(schedule.courses) ? schedule.courses : []);
  return Object.assign({}, record, {
    schemaVersion: RECENT_IMPORT_SCHEMA_VERSION,
    importedAtText: formatDisplayTime(record.importedAt) || record.importedAtText || "",
    courseCount: importedCourses.length,
    isStale,
    staleText: isStale ? `数据可能超过${STALE_AFTER_DAYS}天，建议重新同步。` : "",
  });
}

function saveRecentImportForSession(session, payload = {}) {
  const ownerKey = getOwnerKeyFromSession(session);
  if (!ownerKey) return null;
  const recent = buildRecentImportRecord(Object.assign({}, payload, { ownerKey }));
  const store = readStore();
  store.records[ownerKey] = recent;
  writeStore(store);
  return decorateRecentImport(recent);
}

function getRecentImportForSession(session) {
  const ownerKey = getOwnerKeyFromSession(session);
  if (!ownerKey) return null;
  const store = readStore();
  const record = store.records[ownerKey] || null;
  if (!record || record.ownerKey !== ownerKey || Number(record.schemaVersion || 0) !== RECENT_IMPORT_SCHEMA_VERSION) {
    return null;
  }
  return decorateRecentImport(sanitizeForRecentImport(record));
}

function __setStoreFileForTest(filePath) {
  storeFileOverride = filePath || "";
}

function __resetForTest() {
  writeStore({ records: {} });
}

module.exports = {
  RECENT_IMPORT_SCHEMA_VERSION,
  SOURCE,
  STALE_AFTER_DAYS,
  buildRecentImportRecord,
  decorateRecentImport,
  getOwnerKeyFromSession,
  getRecentImportForSession,
  saveRecentImportForSession,
  sanitizeForRecentImport,
  __resetForTest,
  __setStoreFileForTest,
};
