const request = require("../utils/request");
const { getCurrentScheduleTarget } = require("../utils/storage");

const HISTORY_KEY = "FOSU_AI_ASSISTANT_HISTORY";
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

function sanitizeLocalScheduleForAI(target) {
  const source = target || getCurrentScheduleTarget() || {};
  const courses = Array.isArray(source.courses)
    ? source.courses.slice(0, MAX_CONTEXT_COURSES).map(sanitizeCourse)
    : [];
  return {
    enabled: Boolean(source && source.type && courses.length),
    targetType: redactSensitiveText(source.type || "").slice(0, 30),
    targetName: redactSensitiveText(source.name || source.title || source.className || "").slice(0, 80),
    courses,
  };
}

function buildClientContext(extra = {}) {
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
    clientTime: new Date().toISOString(),
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
  HISTORY_KEY,
  buildClientContext,
  chat,
  clearAiHistory,
  getAiHistory,
  redactSensitiveText,
  sanitizeLocalScheduleForAI,
  saveAiHistory,
};
