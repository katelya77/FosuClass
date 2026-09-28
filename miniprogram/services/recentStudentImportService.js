const securitySessionService = require("./securitySessionService");
const { isFullStudentId, mergeDisplayStudentId, buildPersonalSyncSubtitle } = require("./personalSyncSurface");

const STORAGE_KEY = "FOSU_RECENT_STUDENT_IMPORT_CACHE";
const SCHEMA_VERSION = 2;
const STALE_AFTER_DAYS = 30;
const STALE_AFTER_MS = STALE_AFTER_DAYS * 24 * 60 * 60 * 1000;
const CHINA_TIME_OFFSET_MS = 8 * 60 * 60 * 1000;

function readStorage() {
  try {
    const stored = wx.getStorageSync(STORAGE_KEY);
    if (!stored || typeof stored !== "object" || Array.isArray(stored)) {
      return { schemaVersion: SCHEMA_VERSION, records: {} };
    }
    return {
      schemaVersion: SCHEMA_VERSION,
      records: stored.records && typeof stored.records === "object" ? stored.records : {},
    };
  } catch (error) {
    return { schemaVersion: SCHEMA_VERSION, records: {} };
  }
}

function writeStorage(value) {
  try {
    wx.setStorageSync(STORAGE_KEY, Object.assign({
      schemaVersion: SCHEMA_VERSION,
      records: {},
    }, value || {}, {
      updatedAt: new Date().toISOString(),
    }));
  } catch (error) {
    // Best-effort local fast path only.
  }
}

function formatImportTime(value) {
  const date = value ? new Date(value) : null;
  if (!date || Number.isNaN(date.getTime())) return "";
  const chinaDate = new Date(date.getTime() + CHINA_TIME_OFFSET_MS);
  const pad = (num) => String(num).padStart(2, "0");
  return `${chinaDate.getUTCFullYear()}-${pad(chinaDate.getUTCMonth() + 1)}-${pad(chinaDate.getUTCDate())} ${pad(chinaDate.getUTCHours())}:${pad(chinaDate.getUTCMinutes())}`;
}

function normalizeRecentImport(record) {
  const version = Number(record && record.schemaVersion || 0);
  if (!record || typeof record !== "object" || (version !== 1 && version !== SCHEMA_VERSION)) {
    return null;
  }
  const ownerKey = securitySessionService.getCurrentSessionOwnerKey();
  if (!ownerKey || record.ownerKey !== ownerKey) return null;
  const schedule = record.schedule || {};
  const courses = Array.isArray(record.importedCourses)
    ? record.importedCourses
    : (Array.isArray(schedule.courses) ? schedule.courses : []);
  const importedAtMs = Date.parse(record.importedAt || "");
  const isStale = Number.isFinite(importedAtMs) && Date.now() - importedAtMs > STALE_AFTER_MS;
  const localDisplayStudentId = mergeDisplayStudentId(
    record.localDisplayStudentId,
    isFullStudentId(record.studentId) ? record.studentId : ""
  );
  return Object.assign({}, record, {
    schemaVersion: SCHEMA_VERSION,
    localDisplayStudentId,
    pageRemarks: Array.isArray(record.pageRemarks) ? record.pageRemarks : [],
    importedAtText: formatImportTime(record.importedAt) || record.importedAtText || "",
    courseCount: courses.length,
    isStale,
    staleText: isStale ? `数据可能超过${STALE_AFTER_DAYS}天，建议重新同步。` : "",
  });
}

function readLocalRecentImport() {
  const ownerKey = securitySessionService.getCurrentSessionOwnerKey();
  if (!ownerKey) return null;
  const stored = readStorage();
  return normalizeRecentImport(stored.records[ownerKey]);
}

function writeLocalRecentImport(record) {
  const ownerKey = securitySessionService.getCurrentSessionOwnerKey() || record && record.ownerKey || "";
  if (!ownerKey || !record) return null;
  const stored = readStorage();
  const previous = stored.records[ownerKey] || {};
  const localDisplayStudentId = mergeDisplayStudentId(
    record.localDisplayStudentId || (isFullStudentId(record.studentId) ? record.studentId : ""),
    previous.localDisplayStudentId || (isFullStudentId(previous.studentId) ? previous.studentId : "")
  );
  const pageRemarks = Array.isArray(record.pageRemarks)
    ? record.pageRemarks
    : (Array.isArray(previous.pageRemarks) ? previous.pageRemarks : []);
  const next = Object.assign({}, record, {
    schemaVersion: SCHEMA_VERSION,
    ownerKey,
    localDisplayStudentId,
    pageRemarks,
    studentId: isFullStudentId(record.studentId)
      ? String(record.studentId).trim()
      : (isFullStudentId(previous.studentId) ? String(previous.studentId).trim() : (record.studentId || previous.studentId || "")),
  });
  stored.records[ownerKey] = next;
  writeStorage(stored);
  return normalizeRecentImport(next);
}

function toNumberList(values, max) {
  return (Array.isArray(values) ? values : [])
    .map((value) => Number(value))
    .filter((value) => Number.isFinite(value) && value > 0 && (!max || value <= max));
}

function parseNumberRangeText(text, max) {
  const normalized = String(text || "")
    .replace(/[－–—~～至到]/g, "-")
    .replace(/[，、；;]/g, ",");
  const result = [];
  normalized.split(",").forEach((part) => {
    const range = String(part || "").match(/(\d+)\s*-\s*(\d+)/);
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
    const matches = String(part || "").match(/\d+/g) || [];
    matches.forEach((item) => {
      const value = Number(item);
      if (Number.isInteger(value) && value > 0 && (!max || value <= max)) {
        result.push(value);
      }
    });
  });
  return Array.from(new Set(result)).sort((left, right) => left - right);
}

function resolveCourseClassNameRaw(course = {}) {
  const classScope = course.classScope && typeof course.classScope === "object" ? course.classScope : {};
  const raw = course.classNameRaw ||
    course.className ||
    course.classNameText ||
    course.teachingClass ||
    course.rawClassText ||
    classScope.raw ||
    "";
  if (raw) return raw;
  const classNames = course.classNames ||
    course.audienceClasses ||
    course.audienceClassNames ||
    classScope.classNames ||
    classScope.audienceClasses ||
    classScope.segments;
  if (!Array.isArray(classNames)) return String(classNames || "");
  return classNames
    .map((item) => item && typeof item === "object" ? (item.className || item.raw || item.name || "") : item)
    .filter(Boolean)
    .join("、");
}

function normalizeCourseName(value) {
  return String(value || "")
    .trim()
    .replace(/\u3000/g, " ")
    .replace(/[（]/g, "(")
    .replace(/[）]/g, ")")
    .replace(/[【［]/g, "[")
    .replace(/[】］]/g, "]")
    .replace(/\s+/g, "")
    .toLowerCase();
}

function stableHash(value) {
  const text = String(value || "");
  let hash = 2166136261;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}

function recentCourseGroupId(bucketKey, course = {}) {
  const name = normalizeCourseName(course.normalizedCourseName || course.displayCourseName || course.courseName || "");
  const category = String(course.category || "");
  return `group_recent_${stableHash([bucketKey, name, category].join("|"))}`;
}

function isArrangementScopedGroupId(groupId, arrangementId) {
  const value = String(groupId || "");
  if (!value) return true;
  if (value === String(arrangementId || "")) return true;
  return /^arr[_-]/i.test(value) || /^recent-/i.test(value);
}

function groupArrangements(arrangements, bucketKey) {
  const map = new Map();
  (Array.isArray(arrangements) ? arrangements : []).forEach((arrangement) => {
    const normalizedName = normalizeCourseName(arrangement.normalizedCourseName || arrangement.displayCourseName || arrangement.courseName || "");
    const key = normalizedName || recentCourseGroupId(bucketKey, arrangement);
    const fallbackGroupId = recentCourseGroupId(bucketKey, arrangement);
    const courseGroupId = isArrangementScopedGroupId(arrangement.courseGroupId, arrangement.arrangementId)
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

function toRecentArrangement(course = {}, index = 0, bucketKey = "recommended", selectedByDefault = false) {
  const startSection = Number(course.startSection || 0) || null;
  const endSection = Number(course.endSection || startSection || 0) || startSection;
  const sections = toNumberList(course.sections, 14);
  const textSections = parseNumberRangeText(course.sectionText, 14);
  const normalizedSections = sections.length
    ? sections
    : (startSection && endSection
      ? Array.from({ length: Math.max(1, endSection - startSection + 1) }, (_, offset) => startSection + offset)
      : textSections);
  const weeks = toNumberList(course.weeks, 60);
  const normalizedWeeks = weeks.length ? weeks : parseNumberRangeText(course.weekText, 60);
  const arrangementId = String(course.arrangementId || course.id || `recent-${bucketKey}-${index}`);
  const importDecision = course.importDecision || (selectedByDefault ? "auto_include" : "unscheduled");
  const fallbackGroupId = recentCourseGroupId(bucketKey, course);
  const classNameRaw = resolveCourseClassNameRaw(course);
  return {
    arrangementId,
    courseGroupId: isArrangementScopedGroupId(course.courseGroupId, arrangementId)
      ? fallbackGroupId
      : course.courseGroupId,
    courseName: course.displayCourseName || course.courseName || "",
    displayCourseName: course.displayCourseName || course.courseName || "",
    normalizedCourseName: course.normalizedCourseName || course.displayCourseName || course.courseName || "",
    teacherName: course.teacherName || course.displayTeacherName || "",
    roomName: course.roomName || course.classroom || course.displayClassroom || "",
    weekday: Number(course.weekday || course.weekDay || 0) || null,
    sections: normalizedSections,
    startSection: normalizedSections[0] || startSection,
    endSection: normalizedSections[normalizedSections.length - 1] || endSection,
    sectionText: course.sectionText || "",
    weeks: normalizedWeeks,
    weekText: course.weekText || "",
    classNameRaw,
    className: classNameRaw || course.className || "",
    classNames: Array.isArray(course.classNames) ? course.classNames : [],
    audienceClasses: Array.isArray(course.audienceClasses) ? course.audienceClasses : [],
    classScope: course.classScope || null,
    importDecision,
    selectedByDefault,
    hasCompleteTime: Boolean((Number(course.weekday || course.weekDay || 0) || 0) && normalizedSections.length && normalizedWeeks.length),
    classScopeStatus: course.classScopeStatus || "",
    classScopeReason: course.classScopeReason || course.reason || "",
    matchStatus: course.matchStatus || "",
  };
}

function buildFallbackPreview(recent) {
  const schedule = recent.schedule || {};
  const importedCourses = Array.isArray(recent.importedCourses)
    ? recent.importedCourses
    : (Array.isArray(schedule.courses) ? schedule.courses : []);
  const unplaced = Array.isArray(recent.unplaced) ? recent.unplaced : [];
  const pending = Array.isArray(recent.pending) ? recent.pending : [];
  const recommendedArrangements = importedCourses.map((course, index) => toRecentArrangement(course, index, "recommended", true));
  const pendingArrangements = pending.map((course, index) => toRecentArrangement(course, index, "pending", false));
  const unplacedArrangements = unplaced.map((course, index) => toRecentArrangement(course, index, "unplaced", false));
  const allArrangements = recommendedArrangements.concat(pendingArrangements, unplacedArrangements);
  const selectedArrangementIds = recommendedArrangements.map((item) => item.arrangementId);
  const summary = recent.summary || {};
  return {
    schemaVersion: SCHEMA_VERSION,
    source: "fosu_student_import",
    fromRecentCache: true,
    fallbackPreview: true,
    profile: {
      studentId: recent.studentIdMasked || recent.studentId || "",
      studentIdMasked: recent.studentIdMasked || recent.studentId || "",
      studentName: recent.studentName || "",
      className: recent.className || "",
      classNameConfidence: "low",
    },
    summary: {
      semester: schedule.term || schedule.semester || "",
      recommendedArrangementCount: recommendedArrangements.length,
      pendingArrangementCount: pendingArrangements.length,
      unplacedArrangementCount: unplacedArrangements.length,
      scheduledCourseCount: recommendedArrangements.length,
      unscheduledCourseCount: unplacedArrangements.length,
      conflictCount: Number(summary.conflictCount || 0) || 0,
    },
    buckets: {
      recommended: groupArrangements(recommendedArrangements, "recommended"),
      pending: groupArrangements(pendingArrangements, "pending"),
      unplaced: groupArrangements(unplacedArrangements, "unplaced"),
      suspected: [],
    },
    groups: {},
    uiHints: {},
    allArrangements,
    defaultSelectedArrangementIds: selectedArrangementIds,
    selectedArrangementIds,
    editedArrangements: [],
  };
}

function buildCachedPreview(record) {
  const recent = normalizeRecentImport(record);
  if (!recent) return null;
  const editable = recent.editablePreview || {};
  const allArrangements = Array.isArray(editable.allArrangements) ? editable.allArrangements : [];
  if (allArrangements.length) {
    return Object.assign({}, editable, {
      schemaVersion: editable.schemaVersion || SCHEMA_VERSION,
      source: "fosu_student_import",
      fromRecentCache: true,
      importPreviewToken: "",
      selectedArrangementIds: Array.isArray(editable.selectedArrangementIds)
        ? editable.selectedArrangementIds
        : (Array.isArray(recent.selectedArrangements) ? recent.selectedArrangements : []),
      editedArrangements: Array.isArray(editable.editedArrangements) ? editable.editedArrangements : [],
    });
  }
  return buildFallbackPreview(recent);
}

function buildScheduleTarget(record) {
  const recent = normalizeRecentImport(record);
  if (!recent) return null;
  const schedule = recent.schedule || {};
  const importedAt = recent.importedAt || schedule.importedAt || "";
  const updateTime = formatImportTime(importedAt) || recent.importedAtText || schedule.updateTime || "";
  const metadata = Object.assign({}, schedule.metadata || {}, {
    studentName: schedule.metadata && schedule.metadata.studentName || recent.studentName || "",
    className: schedule.metadata && schedule.metadata.className || recent.className || "",
    source: "fosu_student_import",
  });
  const title = schedule.title || schedule.name || (metadata.studentName ? `${metadata.studentName}的个人课表` : "个人课表");
  return Object.assign({}, schedule, {
    schemaVersion: schedule.schemaVersion || 2,
    type: "personal-apaas",
    source: "fosu_student_import",
    sourceText: schedule.sourceText || "学校课表系统",
    name: title,
    title,
    subtitle: buildPersonalSyncSubtitle(metadata.className, schedule.term || schedule.semester || metadata.term || ""),
    classId: schedule.classId || "personal-apaas-recent",
    semester: schedule.semester || schedule.term || metadata.term || "",
    term: schedule.term || schedule.semester || metadata.term || "",
    courses: Array.isArray(schedule.courses) ? schedule.courses : (Array.isArray(recent.importedCourses) ? recent.importedCourses : []),
    unplacedCourses: Array.isArray(schedule.unplacedCourses) ? schedule.unplacedCourses : [],
    importedAt,
    updateTime,
    metadata,
    recentImportSchemaVersion: recent.schemaVersion,
  });
}

module.exports = {
  SCHEMA_VERSION,
  STALE_AFTER_DAYS,
  STORAGE_KEY,
  buildScheduleTarget,
  buildCachedPreview,
  formatImportTime,
  normalizeRecentImport,
  readLocalRecentImport,
  writeLocalRecentImport,
};
