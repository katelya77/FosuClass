const securitySessionService = require("./securitySessionService");

const STORAGE_KEY = "FOSU_RECENT_STUDENT_IMPORT_CACHE";
const SCHEMA_VERSION = 1;
const STALE_AFTER_DAYS = 30;
const STALE_AFTER_MS = STALE_AFTER_DAYS * 24 * 60 * 60 * 1000;

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
  const pad = (num) => String(num).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function normalizeRecentImport(record) {
  if (!record || typeof record !== "object" || Number(record.schemaVersion || 0) !== SCHEMA_VERSION) {
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
  return Object.assign({}, record, {
    importedAtText: record.importedAtText || formatImportTime(record.importedAt),
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
  const next = Object.assign({}, record, {
    schemaVersion: SCHEMA_VERSION,
    ownerKey,
  });
  const stored = readStorage();
  stored.records[ownerKey] = next;
  writeStorage(stored);
  return normalizeRecentImport(next);
}

function buildScheduleTarget(record) {
  const recent = normalizeRecentImport(record);
  if (!recent) return null;
  const schedule = recent.schedule || {};
  const importedAt = recent.importedAt || schedule.importedAt || "";
  const updateTime = recent.importedAtText || formatImportTime(importedAt) || schedule.updateTime || "";
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
    subtitle: schedule.subtitle || [metadata.className || "班级未确认", schedule.term || schedule.semester || metadata.term || "", "学号导入"].filter(Boolean).join(" · "),
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
  formatImportTime,
  normalizeRecentImport,
  readLocalRecentImport,
  writeLocalRecentImport,
};
