const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const termRegistryService = require("./termRegistryService");
const { SmallJsonCache, ensureDir, readJsonFile, statJsonFile, writeJsonAtomic } = require("../utils/jsonFileStore");

const STORAGE_DIR = path.resolve(process.env.FOSU_STORAGE_DIR || path.join(__dirname, "../../storage"));
const TERMS_DIR = path.join(STORAGE_DIR, "terms");
const PUBLIC_RELEASES_DIR = path.join(STORAGE_DIR, "public", "releases");
const RELEASES_DIR = path.join(STORAGE_DIR, "releases");
const TYPE_TEXT = Object.freeze({
  opening: "开学教学周",
  teaching: "正常教学周",
  holiday: "节假日/调休周",
  adjustment: "调整教学周",
  midterm: "期中教学检查",
  closing: "结课周",
  review: "复习周",
  exam: "考试周",
  flexible: "机动周",
  pending: "教学安排待维护",
});
const ALLOWED_TYPES = new Set(Object.keys(TYPE_TEXT));

const cache = new SmallJsonCache({ maxEntries: 80 });

function nowIso() {
  return new Date().toISOString();
}

function pad(number) {
  return String(number).padStart(2, "0");
}

function parseDate(value) {
  const parts = String(value || "").split("-").map(Number);
  if (parts.length < 3 || parts.some((part) => !Number.isFinite(part))) return null;
  return new Date(parts[0], parts[1] - 1, parts[2]);
}

function formatDate(date) {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function getTermCalendarPath(term) {
  return path.join(termRegistryService.getSafeTermDir(term), "teaching-calendar.json");
}

function normalizeWeek(week, termConfig, fallbackTitle) {
  const weekNo = Number(week && (week.weekNo || week.week));
  if (!Number.isInteger(weekNo) || weekNo < 1 || weekNo > Number(termConfig.totalWeeks || 30)) return null;
  const type = ALLOWED_TYPES.has(week.type) ? week.type : "teaching";
  const typeText = String(week.typeText || TYPE_TEXT[type] || fallbackTitle || "正常教学周").trim();
  return {
    weekNo,
    startDate: String(week.startDate || "").trim(),
    endDate: String(week.endDate || "").trim(),
    type,
    typeText,
    title: String(week.title || fallbackTitle || typeText || "正常教学周").trim(),
    note: String(week.note || week.notes || "").trim(),
  };
}

function generateWeeks(termConfig, options = {}) {
  const totalWeeks = Number(termConfig.totalWeeks || 20) || 20;
  const start = parseDate(termConfig.termStartDate);
  const weeks = [];
  for (let weekNo = 1; weekNo <= totalWeeks; weekNo += 1) {
    let startDate = "";
    let endDate = "";
    if (start) {
      const weekStart = new Date(start.getTime());
      weekStart.setDate(start.getDate() + (weekNo - 1) * 7);
      const weekEnd = new Date(weekStart.getTime());
      weekEnd.setDate(weekStart.getDate() + 6);
      startDate = formatDate(weekStart);
      endDate = formatDate(weekEnd);
    }
    weeks.push({
      weekNo,
      startDate,
      endDate,
      type: options.type || "pending",
      typeText: TYPE_TEXT[options.type || "pending"] || "教学安排待维护",
      title: options.title || "教学安排待维护",
      note: "",
    });
  }
  return weeks;
}

function normalizeCalendar(raw, termRecord) {
  const source = raw && typeof raw === "object" ? raw : {};
  const term = String(source.term || termRecord && termRecord.term || "").trim();
  if (!term) return null;
  const record = termRecord || termRegistryService.getTerm(term) || {};
  const termConfig = {
    term,
    semesterText: source.semesterText || record.semesterText || "",
    termStartDate: source.termStartDate || record.termStartDate || "",
    totalWeeks: source.totalWeeks || record.totalWeeks || 20,
    weekStart: source.weekStart || record.weekStart || "monday",
  };
  const defaultWeekTitle = source.defaultWeekTitle || "正常教学周";
  const explicitWeeks = Array.isArray(source.weeks) ? source.weeks : [];
  const generated = generateWeeks(termConfig, { type: record.status === "planned" ? "pending" : "teaching", title: record.status === "planned" ? "教学安排待维护" : defaultWeekTitle });
  const byWeek = new Map(generated.map((item) => [item.weekNo, item]));
  explicitWeeks.forEach((item) => {
    const normalized = normalizeWeek(item, termConfig, defaultWeekTitle);
    if (normalized) byWeek.set(normalized.weekNo, Object.assign({}, byWeek.get(normalized.weekNo), normalized));
  });
  const weeks = Array.from(byWeek.values()).sort((left, right) => left.weekNo - right.weekNo);
  return {
    success: true,
    schemaVersion: 1,
    term,
    semesterText: termConfig.semesterText,
    termStartDate: termConfig.termStartDate,
    totalWeeks: termConfig.totalWeeks,
    weekStart: termConfig.weekStart,
    source: source.source || "admin-maintained",
    updatedAt: source.updatedAt || nowIso(),
    defaultWeekTitle,
    termConfig,
    weeks,
    count: weeks.length,
  };
}

function readTermCalendar(term) {
  const record = termRegistryService.getTerm(term);
  if (!record) return null;
  const filePath = getTermCalendarPath(record.term);
  const parsed = cache.read(filePath, null);
  if (parsed) return normalizeCalendar(parsed, record);
  if (record.status === "planned") {
    return normalizeCalendar({ term: record.term, source: "generated-planned" }, record);
  }
  return normalizeCalendar({ term: record.term, source: "generated-date-range", defaultWeekTitle: "正常教学周" }, record);
}

function writeTermCalendar(term, calendar) {
  const record = termRegistryService.getTerm(term);
  if (!record) {
    const error = new Error("TERM_NOT_FOUND");
    error.code = "TERM_NOT_FOUND";
    throw error;
  }
  const normalized = normalizeCalendar(Object.assign({}, calendar, { term: record.term }), record);
  writeJsonAtomic(getTermCalendarPath(record.term), normalized);
  cache.invalidate(getTermCalendarPath(record.term));
  return normalized;
}

function getReleaseCalendarPath(releaseVersion, publicFile = false, options = {}) {
  if (options.releaseDir && !publicFile) return path.join(options.releaseDir, "calendar.json");
  if (options.publicReleaseDir && publicFile) return path.join(options.publicReleaseDir, "calendar.json");
  return path.join(publicFile ? PUBLIC_RELEASES_DIR : RELEASES_DIR, releaseVersion, "calendar.json");
}

function writeReleaseCalendar(manifest, options = {}) {
  const term = manifest && (manifest.term || manifest.semester);
  const releaseVersion = manifest && (manifest.releaseVersion || manifest.version);
  if (!term || !releaseVersion) {
    const error = new Error("CALENDAR_RELEASE_CONTEXT_MISSING");
    error.code = "CALENDAR_RELEASE_CONTEXT_MISSING";
    throw error;
  }
  const calendar = options.calendar || readTermCalendar(term);
  if (!calendar || calendar.term !== term) {
    const error = new Error("CALENDAR_TERM_MISMATCH");
    error.code = "CALENDAR_TERM_MISMATCH";
    throw error;
  }
  const releaseCalendar = Object.assign({}, calendar, {
    releaseVersion,
    manifestTerm: term,
  });
  [getReleaseCalendarPath(releaseVersion, false, options), getReleaseCalendarPath(releaseVersion, true, options)].forEach((target) => {
    ensureDir(path.dirname(target));
    writeJsonAtomic(target, releaseCalendar);
    cache.invalidate(target);
  });
  return releaseCalendar;
}

function getCalendarHash(calendar) {
  return crypto.createHash("sha256").update(JSON.stringify(calendar || {}, null, 2)).digest("hex");
}

function readReleaseCalendar(releaseVersion) {
  const publicPath = getReleaseCalendarPath(releaseVersion, true);
  const localPath = getReleaseCalendarPath(releaseVersion, false);
  return cache.read(publicPath, null) || cache.read(localPath, null);
}

function clearCache() {
  cache.clear();
}

module.exports = {
  ALLOWED_TYPES,
  TYPE_TEXT,
  clearCache,
  generateWeeks,
  getCalendarHash,
  getReleaseCalendarPath,
  getTermCalendarPath,
  normalizeCalendar,
  readReleaseCalendar,
  readTermCalendar,
  statJsonFile,
  writeReleaseCalendar,
  writeTermCalendar,
};
