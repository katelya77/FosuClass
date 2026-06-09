const request = require("../utils/request");
const { getCurrentScheduleTarget } = require("../utils/storage");
const { mockCalendar } = require("../data/mockCalendar");
const {
  getCurrentTeachingWeek,
  getRuntimeTermConfig,
  getTodayTeachingInfo,
  getTodayWeekday,
} = require("../utils/week");

const HISTORY_KEY = "FOSU_AI_ASSISTANT_HISTORY";
const ALLOW_PERSONAL_CONTEXT_KEY = "FOSU_AI_ALLOW_PERSONAL_CONTEXT";
const LAST_IMPORT_CONTEXT_KEY = "FOSU_AI_LAST_IMPORT_CONTEXT";
const PENDING_CLARIFICATION_KEY = "FOSU_AI_PENDING_CLARIFICATION";
const MAX_HISTORY = 20;
const MAX_CONTEXT_COURSES = 80;
const REDACTED = "[已脱敏]";

const SENSITIVE_PATTERNS = [
  { pattern: /((?:password|passwd|pwd|密码|口令)\s*[:：=是为]?\s*)[^\s，。；;,&]+/gi, replacement: `$1${REDACTED}` },
  { pattern: /((?:authorization)\s*[:：=]\s*(?:bearer\s+)?)[A-Za-z0-9._~+/=-]{8,}/gi, replacement: `$1${REDACTED}` },
  { pattern: /\b(Bearer\s+)[A-Za-z0-9._~+/=-]{8,}/gi, replacement: `$1${REDACTED}` },
  { pattern: /((?:cookie|jsessionid|ticket|token|secret|api[-_\s]?key)\s*[:：=]?\s*)[^\s，。；;,&]+/gi, replacement: `$1${REDACTED}` },
  { pattern: /((?:学号|studentId|student_id)\s*[:：=是为]?\s*)\d{6,16}/gi, replacement: `$1${REDACTED}` },
  { pattern: /\b\d{17}[\dXx]\b/g, replacement: REDACTED },
  { pattern: /\b1[3-9]\d{9}\b/g, replacement: REDACTED },
  { pattern: /\b\d{10,14}\b/g, replacement: REDACTED },
  { pattern: /data:[a-z0-9.+/-]+;base64,[A-Za-z0-9+/=]{80,}/gi, replacement: REDACTED },
  { pattern: /\b[A-Za-z0-9+/]{160,}={0,2}\b/g, replacement: REDACTED },
];

function redactSensitiveText(text) {
  let output = String(text == null ? "" : text);
  SENSITIVE_PATTERNS.forEach((rule) => {
    output = output.replace(rule.pattern, rule.replacement);
  });
  return output;
}

function readStorage(key, fallback) {
  try {
    const value = wx.getStorageSync(key);
    return value === "" || value === undefined ? fallback : value;
  } catch (error) {
    return fallback;
  }
}

function writeStorage(key, value) {
  try {
    wx.setStorageSync(key, value);
    return true;
  } catch (error) {
    return false;
  }
}

function getCurrentRoute() {
  try {
    const pages = getCurrentPages();
    const current = pages && pages[pages.length - 1];
    return current && current.route || "";
  } catch (error) {
    return "";
  }
}

function stableHash(text) {
  let hash = 2166136261;
  const value = String(text || "");
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}

function normalizeWeekday(course) {
  return Number(course.weekday || course.weekDay || 0) || 0;
}

function sanitizeNumberArray(value, limit) {
  if (!Array.isArray(value)) return [];
  return value.slice(0, limit).map((item) => Number(item)).filter((item) => Number.isFinite(item));
}

function sanitizeWeekRange(value) {
  if (Array.isArray(value)) {
    return sanitizeNumberArray(value, 2);
  }
  if (value && typeof value === "object") {
    const output = {};
    ["start", "end", "from", "to", "startWeek", "endWeek"].forEach((key) => {
      if (Number.isFinite(Number(value[key]))) {
        output[key] = Number(value[key]);
      }
    });
    ["type", "weekType", "parity", "oddEven"].forEach((key) => {
      if (value[key] != null && value[key] !== "") {
        output[key] = redactSensitiveText(value[key]).slice(0, 20);
      }
    });
    return output;
  }
  return redactSensitiveText(value || "").slice(0, 120);
}

function sanitizeCourse(course) {
  const source = course || {};
  const classroom = source.classroom || source.roomName || source.classroomName || "";
  const startSection = Number(source.startSection || source.sectionStart || 0) || 0;
  const endSection = Number(source.endSection || source.sectionEnd || startSection || 0) || 0;
  const weekText = source.weekText || source.weeksText || source.rawWeek || source.rawWeeks || "";
  const rawWeek = source.rawWeek || source.rawWeeks || source.weeksText || source.weekText || "";
  const parity = source.weekParity || source.parity || source.oddEven || source.weekType || "";
  return {
    courseName: redactSensitiveText(source.courseName || source.name || "").slice(0, 80),
    teacherName: redactSensitiveText(source.teacherName || source.teacher || "").slice(0, 60),
    classroom: redactSensitiveText(classroom).slice(0, 80),
    roomName: redactSensitiveText(source.roomName || classroom).slice(0, 80),
    weekday: normalizeWeekday(source),
    startSection,
    endSection,
    sections: sanitizeNumberArray(source.sections, 14),
    weeks: Array.isArray(source.weeks)
      ? sanitizeNumberArray(source.weeks, 40)
      : (typeof source.weeks === "string" ? redactSensitiveText(source.weeks).slice(0, 120) : []),
    weekText: redactSensitiveText(weekText).slice(0, 80),
    weeksText: redactSensitiveText(source.weeksText || weekText).slice(0, 120),
    rawWeek: redactSensitiveText(rawWeek).slice(0, 120),
    rawWeeks: redactSensitiveText(source.rawWeeks || rawWeek).slice(0, 120),
    weekRange: sanitizeWeekRange(source.weekRange),
    startWeek: Number.isFinite(Number(source.startWeek)) ? Number(source.startWeek) : undefined,
    endWeek: Number.isFinite(Number(source.endWeek)) ? Number(source.endWeek) : undefined,
    weekType: redactSensitiveText(source.weekType || "").slice(0, 20),
    oddEven: redactSensitiveText(source.oddEven || parity).slice(0, 20),
    weekParity: redactSensitiveText(source.weekParity || parity).slice(0, 20),
    parity: redactSensitiveText(source.parity || parity).slice(0, 20),
    isCustom: source.isCustom === true,
    source: redactSensitiveText(source.source || source.sourceType || "").slice(0, 40),
    campus: redactSensitiveText(source.campus || "").slice(0, 40),
  };
}

function isXlsPersonalType(type) {
  return ["personal-xls", "xls", "file", "local-personal"].indexOf(String(type || "").toLowerCase()) >= 0;
}

function isDeprecatedCredentialType(type) {
  return ["personal-login", "account", "student-login"].indexOf(String(type || "").toLowerCase()) >= 0;
}

function isPersonalContextAllowed() {
  return readStorage(ALLOW_PERSONAL_CONTEXT_KEY, false) === true;
}

function setPersonalContextAllowed(allowed) {
  writeStorage(ALLOW_PERSONAL_CONTEXT_KEY, allowed === true);
  return allowed === true;
}

function formatLocalIsoWithOffset(date) {
  const target = date instanceof Date && !Number.isNaN(date.getTime()) ? date : new Date();
  const pad = (value) => String(value).padStart(2, "0");
  const offsetMinutes = -target.getTimezoneOffset();
  const sign = offsetMinutes >= 0 ? "+" : "-";
  const absOffset = Math.abs(offsetMinutes);
  return [
    `${target.getFullYear()}-${pad(target.getMonth() + 1)}-${pad(target.getDate())}`,
    "T",
    `${pad(target.getHours())}:${pad(target.getMinutes())}:${pad(target.getSeconds())}`,
    `${sign}${pad(Math.floor(absOffset / 60))}:${pad(absOffset % 60)}`,
  ].join("");
}

function buildScheduleFingerprint(target, courses) {
  const base = {
    type: target && target.type,
    term: target && (target.semester || target.term),
    importedAt: target && target.importedAt,
    courseCount: Array.isArray(courses) ? courses.length : 0,
    sample: Array.isArray(courses)
      ? courses.slice(0, 20).map((course) => [
          course.courseName,
          course.teacherName,
          course.classroom || course.roomName,
          normalizeWeekday(course),
          course.startSection,
          course.endSection,
          course.weekText,
        ].join("|"))
      : [],
  };
  return stableHash(JSON.stringify(base));
}

function redactedPersonalSummary(reason) {
  return {
    enabled: false,
    targetType: reason || "personal-redacted",
    targetName: "个人课表",
    courses: [],
    courseCount: 0,
  };
}

function sanitizeLocalScheduleForAI(target) {
  const source = target || getCurrentScheduleTarget() || {};
  const rawType = String(source.type || "").toLowerCase();
  const courses = Array.isArray(source.courses) ? source.courses : [];

  if (isDeprecatedCredentialType(rawType)) {
    return redactedPersonalSummary("personal-xls-required");
  }

  if (isXlsPersonalType(rawType) && !isPersonalContextAllowed()) {
    return redactedPersonalSummary("personal-redacted");
  }

  const sanitizedCourses = courses.slice(0, MAX_CONTEXT_COURSES).map(sanitizeCourse);
  const personal = isXlsPersonalType(rawType) || rawType === "personal";
  const term = source.semester || source.term || source.metadata && source.metadata.term || "";
  const importedAt = source.importedAt || source.updateTime || "";
  const fingerprint = buildScheduleFingerprint(source, courses);
  return {
    enabled: Boolean(source && rawType && sanitizedCourses.length),
    targetType: rawType,
    targetName: personal ? "个人课表" : redactSensitiveText(source.name || source.title || source.className || "").slice(0, 80),
    term,
    source: personal ? "xls-import" : redactSensitiveText(source.sourceText || source.source || "").slice(0, 60),
    importedAt,
    courseCount: courses.length,
    fingerprint,
    courses: sanitizedCourses,
  };
}

function rememberLatestScheduleImport(target) {
  const summary = sanitizeLocalScheduleForAI(target);
  const value = {
    at: new Date().toISOString(),
    targetType: summary.targetType,
    targetName: summary.targetName,
    term: summary.term || "",
    courseCount: summary.courseCount || 0,
    fingerprint: summary.fingerprint || "",
    source: summary.source || "xls-import",
  };
  writeStorage(LAST_IMPORT_CONTEXT_KEY, value);
  return value;
}

function getLatestScheduleImport() {
  const value = readStorage(LAST_IMPORT_CONTEXT_KEY, null);
  return value && typeof value === "object" && !Array.isArray(value) ? value : null;
}

function normalizePendingClarification(value) {
  const source = value && typeof value === "object" && !Array.isArray(value) ? value : {};
  const type = ["teacher", "classroom", "course", "class"].indexOf(source.type) >= 0 ? source.type : "";
  if (source.intentName !== "search_school_index" || !type) return null;
  const expiresAt = Number(source.expiresAt || 0);
  if (!Number.isFinite(expiresAt) || expiresAt <= Date.now()) return null;
  return {
    intentName: "search_school_index",
    type,
    missing: redactSensitiveText(source.missing || "").slice(0, 40),
    createdAt: Number(source.createdAt || Date.now()) || Date.now(),
    expiresAt,
  };
}

function getPendingClarification() {
  const pending = normalizePendingClarification(readStorage(PENDING_CLARIFICATION_KEY, null));
  if (!pending) {
    try {
      wx.removeStorageSync(PENDING_CLARIFICATION_KEY);
    } catch (error) {
      // best effort
    }
  }
  return pending;
}

function setPendingClarification(value) {
  const pending = normalizePendingClarification(value);
  if (!pending) return clearPendingClarification();
  writeStorage(PENDING_CLARIFICATION_KEY, pending);
  return pending;
}

function clearPendingClarification() {
  try {
    wx.removeStorageSync(PENDING_CLARIFICATION_KEY);
  } catch (error) {
    // best effort
  }
  return null;
}

function buildClientContext(extra = {}) {
  const now = new Date();
  const target = getCurrentScheduleTarget();
  const app = getApp();
  const activeRelease = (app.globalData && app.globalData.activeRelease) || {};
  const manifest = activeRelease.manifest || {};
  const termConfig = getRuntimeTermConfig();
  const todayTeachingInfo = getTodayTeachingInfo(now, mockCalendar, termConfig);
  const scheduleSummary = sanitizeLocalScheduleForAI(target);
  const latestImport = getLatestScheduleImport();
  const term = extra.term ||
    scheduleSummary.term ||
    target && (target.semester || target.term) ||
    termConfig.term ||
    activeRelease.term ||
    manifest.term ||
    "2025-2026-2";

  return {
    term,
    semesterText: termConfig.semesterText || "",
    termStartDate: termConfig.termStartDate || "",
    totalWeeks: termConfig.totalWeeks || 20,
    currentTeachingWeek: extra.currentTeachingWeek || todayTeachingInfo.weekNo || getCurrentTeachingWeek(now, mockCalendar, termConfig),
    todayWeekday: getTodayWeekday(now),
    todayDate: todayTeachingInfo.date,
    todayTeachingInfo: {
      weekNo: todayTeachingInfo.weekNo,
      weekday: todayTeachingInfo.weekday,
      date: todayTeachingInfo.date,
      termStartDate: termConfig.termStartDate || "",
    },
    releaseVersion: extra.releaseVersion || (target && target.releaseVersion) || activeRelease.releaseVersion || manifest.releaseVersion || "",
    currentPage: extra.currentPage || getCurrentRoute(),
    clientTime: now.toISOString(),
    clientLocalTime: formatLocalIsoWithOffset(now),
    timezoneOffsetMinutes: now.getTimezoneOffset(),
    clientTimestampMs: now.getTime(),
    timezone: "Asia/Shanghai",
    currentScheduleSummary: scheduleSummary,
    latestScheduleImport: latestImport,
    pendingClarification: getPendingClarification(),
  };
}

function normalizeHistoryItem(item) {
  const source = item || {};
  return {
    id: source.id || `h-${Date.now()}`,
    role: source.role === "user" ? "user" : "assistant",
    content: redactSensitiveText(source.content || "").slice(0, 1200),
    cards: Array.isArray(source.cards) ? source.cards : [],
    suggestions: Array.isArray(source.suggestions) ? source.suggestions.slice(0, 6) : [],
    toolCalls: Array.isArray(source.toolCalls) ? source.toolCalls.slice(0, 8) : [],
    safety: source.safety || null,
    metrics: source.metrics && typeof source.metrics === "object" && !Array.isArray(source.metrics) ? source.metrics : null,
    timeText: source.timeText || "",
  };
}

function getAiHistory() {
  const list = readStorage(HISTORY_KEY, []);
  return Array.isArray(list) ? list.slice(-MAX_HISTORY).map(normalizeHistoryItem) : [];
}

function saveAiHistory(messages) {
  const next = Array.isArray(messages)
    ? messages.slice(-MAX_HISTORY).map(normalizeHistoryItem)
    : [];
  writeStorage(HISTORY_KEY, next);
  return next;
}

function clearAiHistory() {
  try {
    wx.removeStorageSync(HISTORY_KEY);
    wx.removeStorageSync(PENDING_CLARIFICATION_KEY);
  } catch (error) {
    // best effort
  }
  return [];
}

function chat(message, context) {
  return request.post("/api/ai/agent/chat", {
    message: redactSensitiveText(message).slice(0, 2000),
    context: context || buildClientContext(),
  }, {
    showLoading: false,
    silentError: true,
    timeout: 28000,
    retries: 2,
    retryBaseDelayMs: 420,
    retryMaxDelayMs: 1800,
    dedupe: false,
  });
}

module.exports = {
  ALLOW_PERSONAL_CONTEXT_KEY,
  HISTORY_KEY,
  LAST_IMPORT_CONTEXT_KEY,
  PENDING_CLARIFICATION_KEY,
  buildClientContext,
  chat,
  clearPendingClarification,
  clearAiHistory,
  formatLocalIsoWithOffset,
  getAiHistory,
  getLatestScheduleImport,
  getPendingClarification,
  isPersonalContextAllowed,
  redactSensitiveText,
  rememberLatestScheduleImport,
  sanitizeCourse,
  sanitizeLocalScheduleForAI,
  setPendingClarification,
  setPersonalContextAllowed,
  saveAiHistory,
};
