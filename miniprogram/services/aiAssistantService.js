const request = require("../utils/request");
const { getCurrentScheduleTarget } = require("../utils/storage");

const HISTORY_KEY = "FOSU_AI_ASSISTANT_HISTORY";
const ALLOW_PERSONAL_CONTEXT_KEY = "FOSU_AI_ALLOW_PERSONAL_CONTEXT";
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

function sanitizeCourse(course) {
  const source = course || {};
  const classroom = source.classroom || source.roomName || source.classroomName || "";
  return {
    courseName: redactSensitiveText(source.courseName || source.name || "").slice(0, 80),
    teacherName: redactSensitiveText(source.teacherName || source.teacher || "").slice(0, 60),
    classroom: redactSensitiveText(classroom).slice(0, 80),
    roomName: redactSensitiveText(source.roomName || classroom).slice(0, 80),
    weekday: Number(source.weekday || 0) || 0,
    startSection: Number(source.startSection || source.sectionStart || 0) || 0,
    endSection: Number(source.endSection || source.sectionEnd || source.startSection || 0) || 0,
    sections: Array.isArray(source.sections)
      ? source.sections.slice(0, 14).map((item) => Number(item)).filter((item) => Number.isFinite(item))
      : [],
    weeks: Array.isArray(source.weeks)
      ? source.weeks.slice(0, 40).map((item) => Number(item)).filter((item) => Number.isFinite(item))
      : [],
    weekText: redactSensitiveText(source.weekText || "").slice(0, 80),
    campus: redactSensitiveText(source.campus || "").slice(0, 40),
  };
}

function isPersonalScheduleType(type) {
  return ["personal", "personal-xls", "personal-login", "account", "xls", "file"].indexOf(String(type || "").toLowerCase()) >= 0;
}

function isPersonalContextAllowed() {
  return readStorage(ALLOW_PERSONAL_CONTEXT_KEY, false) === true;
}

function formatLocalIsoWithOffset(date) {
  const target = date instanceof Date && !Number.isNaN(date.getTime()) ? date : new Date();
  const pad = (value) => String(value).padStart(2, "0");
  const offsetMinutes = -target.getTimezoneOffset();
  const sign = offsetMinutes >= 0 ? "+" : "-";
  const absOffset = Math.abs(offsetMinutes);
  const offsetHour = Math.floor(absOffset / 60);
  const offsetMinute = absOffset % 60;
  return [
    `${target.getFullYear()}-${pad(target.getMonth() + 1)}-${pad(target.getDate())}`,
    "T",
    `${pad(target.getHours())}:${pad(target.getMinutes())}:${pad(target.getSeconds())}`,
    `${sign}${pad(offsetHour)}:${pad(offsetMinute)}`,
  ].join("");
}

function setPersonalContextAllowed(allowed) {
  writeStorage(ALLOW_PERSONAL_CONTEXT_KEY, allowed === true);
  return allowed === true;
}

function sanitizeLocalScheduleForAI(target) {
  const source = target || getCurrentScheduleTarget() || {};
  const targetType = redactSensitiveText(source.type || "").slice(0, 30);
  if (isPersonalScheduleType(targetType) && !isPersonalContextAllowed()) {
    return {
      enabled: false,
      targetType: "personal-redacted",
      targetName: "个人课表",
      courses: [],
    };
  }
  const courses = Array.isArray(source.courses)
    ? source.courses.slice(0, MAX_CONTEXT_COURSES).map(sanitizeCourse)
    : [];
  return {
    enabled: Boolean(source && source.type && courses.length),
    targetType,
    targetName: isPersonalScheduleType(targetType) ? "个人课表" : redactSensitiveText(source.name || source.title || source.className || "").slice(0, 80),
    courses,
  };
}

function buildClientContext(extra = {}) {
  const now = new Date();
  const target = getCurrentScheduleTarget();
  const app = getApp();
  const activeRelease = (app.globalData && app.globalData.activeRelease) || {};
  const manifest = activeRelease.manifest || {};
  const term = extra.term ||
    (target && (target.semester || target.term)) ||
    activeRelease.term ||
    manifest.term ||
    "2025-2026-2";
  return {
    term,
    releaseVersion: extra.releaseVersion || (target && target.releaseVersion) || activeRelease.releaseVersion || manifest.releaseVersion || "",
    currentPage: extra.currentPage || getCurrentRoute(),
    clientTime: now.toISOString(),
    clientLocalTime: formatLocalIsoWithOffset(now),
    timezoneOffsetMinutes: now.getTimezoneOffset(),
    clientTimestampMs: now.getTime(),
    timezone: "Asia/Shanghai",
    currentScheduleSummary: sanitizeLocalScheduleForAI(target),
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
  return Array.isArray(list) ? list.slice(0, MAX_HISTORY).map(normalizeHistoryItem) : [];
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
  } catch (error) {
    // ignore
  }
  return [];
}

function chat(message, context) {
  return request.post("/api/ai/agent/chat", {
    message: String(message || "").slice(0, 2000),
    context: context || buildClientContext(),
  }, {
    showLoading: false,
    silentError: true,
    timeout: 22000,
    retries: 1,
    dedupe: false,
  });
}

module.exports = {
  ALLOW_PERSONAL_CONTEXT_KEY,
  HISTORY_KEY,
  buildClientContext,
  chat,
  clearAiHistory,
  formatLocalIsoWithOffset,
  getAiHistory,
  isPersonalContextAllowed,
  redactSensitiveText,
  sanitizeLocalScheduleForAI,
  setPersonalContextAllowed,
  saveAiHistory,
};
