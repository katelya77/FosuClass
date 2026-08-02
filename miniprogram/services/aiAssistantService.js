const request = require("../utils/request");
const { getCurrentScheduleTarget } = require("../utils/storage");
const releasePackService = require("./releasePackService");
const { DEFAULT_TERM } = releasePackService;
const aiTransportRouter = require("./aiTransportRouter");
const conversationStore = require("./conversationStore");
const xiaofuAgentRouter = require("./xiaofuAgentRouter");
const ragAnswerBuilder = require("./ragAnswerBuilder");
const scheduleAssistantService = require("./scheduleAssistantService");
const teachingCalendarService = require("./teachingCalendarService");
const weatherProvider = require("./weatherProvider");
const contextManager = require("./xiaofuContextManager");
const scheduleChangeTracker = require("./scheduleChangeTracker");
const agentCapabilityCompat = require("../shared/agentCapabilityCompat.generated");
const { courseTimes } = require("../data/courseTimes");
const {
  getTodayTeachingInfo,
  getTodayWeekday,
} = require("../utils/week");
const { getMiniProgramEnvVersion } = require("../utils/platform");

const HISTORY_KEY = "FOSU_AI_ASSISTANT_HISTORY";
const ALLOW_PERSONAL_CONTEXT_KEY = "FOSU_AI_ALLOW_PERSONAL_CONTEXT";
const LAST_IMPORT_CONTEXT_KEY = "FOSU_AI_LAST_IMPORT_CONTEXT";
const PENDING_CLARIFICATION_KEY = "FOSU_AI_PENDING_CLARIFICATION";
const USER_PREFERENCES_KEY = "FOSU_AI_USER_PREFERENCES";
const AUTO_MEMORY_ENABLED_KEY = "xiaofu_auto_memory_enabled";
const MAX_HISTORY = 20;
const MAX_CONTEXT_COURSES = 80;
const REDACTED = "[已脱敏]";
const PERSONAL_SYNC_URL = "/pages/personal-sync/personal-sync";
const PERSONAL_SYNC_XLS_URL = "/pages/personal-sync/personal-sync?tab=xls";

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

function safeText(value, maxLength) {
  const text = String(value == null ? "" : value).trim();
  if (!text) return "";
  return redactSensitiveText(text).slice(0, maxLength || 200);
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

function isAutoMemoryEnabled() {
  const stored = readStorage(AUTO_MEMORY_ENABLED_KEY, "1");
  return stored !== false && stored !== 0 && stored !== "0" && stored !== "false";
}

function normalizeUserPreferences(value) {
  const source = value && typeof value === "object" && !Array.isArray(value) ? value : {};
  const campus = ["仙溪校区", "江湾校区"].indexOf(source.campus) >= 0 ? source.campus : "";
  const preferredName = String(source.preferredName || "").trim().replace(/[，。！？,.!?]+$/g, "").slice(0, 24);
  const favoriteBuildings = Array.isArray(source.favoriteBuildings)
    ? source.favoriteBuildings
        .map((item) => redactSensitiveText(item).trim().slice(0, 40))
        .filter(Boolean)
        .slice(0, 8)
    : [];
  const duration = Number(source.defaultEmptyRoomDurationSections);
  const reminderLead = Number(source.defaultReminderLeadMinutes);
  const answerDetail = ["brief", "normal", "detailed"].indexOf(source.answerDetail) >= 0
    ? source.answerDetail
    : "normal";
  return {
    preferredName: /^[\u3400-\u9fffA-Za-z0-9·\-\s]{1,24}$/.test(preferredName) ? preferredName : "",
    campus,
    favoriteBuildings,
    defaultEmptyRoomDurationSections: Number.isFinite(duration) && duration > 0 ? Math.min(12, Math.max(1, Math.round(duration))) : 2,
    defaultReminderLeadMinutes: Number.isFinite(reminderLead) && reminderLead >= 5 && reminderLead <= 180
      ? Math.round(reminderLead)
      : 20,
    allowMinimalScheduleSummary: source.allowMinimalScheduleSummary === true || isPersonalContextAllowed(),
    answerDetail,
    weatherAdviceEnabled: source.weatherAdviceEnabled !== false,
    localOnly: true,
  };
}

function getUserPreferences() {
  return normalizeUserPreferences(readStorage(USER_PREFERENCES_KEY, {}));
}

function saveUserPreferences(value) {
  const preferences = normalizeUserPreferences(value);
  writeStorage(USER_PREFERENCES_KEY, preferences);
  if (preferences.allowMinimalScheduleSummary !== isPersonalContextAllowed()) {
    setPersonalContextAllowed(preferences.allowMinimalScheduleSummary);
  }
  return preferences;
}

function clearUserPreferences() {
  try {
    wx.removeStorageSync(USER_PREFERENCES_KEY);
  } catch (error) {
    // best effort
  }
  return getUserPreferences();
}

const MEMORY_PREF_KEYS = [
  "preferredName",
  "campus",
  "preferredBuilding",
  "defaultReminderLeadMinutes",
  "answerDetailLevel",
  "college",
  "major",
  "grade",
];

function getUserPreferenceItems() {
  const raw = readStorage(USER_PREFERENCES_KEY, {});
  const source = raw && typeof raw === "object" && !Array.isArray(raw) ? raw : {};
  return MEMORY_PREF_KEYS.filter((key) => (
    Object.prototype.hasOwnProperty.call(source, key)
    && source[key] !== ""
    && source[key] !== null
    && source[key] !== undefined
  )).map((key) => ({ key, value: source[key], scope: "local", editable: true }));
}

function setUserPreference(key, value) {
  if (MEMORY_PREF_KEYS.indexOf(key) < 0) return getUserPreferenceItems();
  const raw = readStorage(USER_PREFERENCES_KEY, {});
  const next = raw && typeof raw === "object" && !Array.isArray(raw)
    ? Object.assign({}, raw)
    : {};
  next[key] = value;
  writeStorage(USER_PREFERENCES_KEY, next);
  return getUserPreferenceItems();
}

function deleteUserPreference(key) {
  if (MEMORY_PREF_KEYS.indexOf(key) < 0) return getUserPreferenceItems();
  const raw = readStorage(USER_PREFERENCES_KEY, {});
  const next = raw && typeof raw === "object" && !Array.isArray(raw)
    ? Object.assign({}, raw)
    : {};
  delete next[key];
  writeStorage(USER_PREFERENCES_KEY, next);
  return getUserPreferenceItems();
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
  const appConfig = (app.globalData && app.globalData.appConfig) || {};
  const scheduleSummary = sanitizeLocalScheduleForAI(target);
  const scheduleChangeState = scheduleChangeTracker.capture(scheduleSummary);
  const latestImport = getLatestScheduleImport();
  const manifestTermConfig = manifest.termConfig && typeof manifest.termConfig === "object" ? manifest.termConfig : null;
  const appTermConfig = appConfig.termConfig && typeof appConfig.termConfig === "object" ? appConfig.termConfig : null;
  const preferredTermConfig = manifestTermConfig || appTermConfig || null;
  const term = extra.term ||
    scheduleSummary.term ||
    target && (target.semester || target.term) ||
    preferredTermConfig && preferredTermConfig.term ||
    activeRelease.term ||
    manifest.term ||
    DEFAULT_TERM;
  const calendar = teachingCalendarService.getImmediateActiveCalendar({
    term,
    releaseVersion: activeRelease.releaseVersion || manifest.releaseVersion || "",
  });
  const calendarConfig = calendar.termConfig || {};
  const calendarMatchesTerm = !term || calendar.term === term || calendarConfig.term === term;
  const termConfig = preferredTermConfig && (preferredTermConfig.term || term) === term
    ? Object.assign({}, preferredTermConfig, {
      term: preferredTermConfig.term || term,
      releaseVersion: preferredTermConfig.releaseVersion || activeRelease.releaseVersion || manifest.releaseVersion || "",
    })
    : calendarConfig;
  const calendarWeeks = calendarMatchesTerm ? (calendar.weeks || []) : [];
  const todayTeachingInfo = getTodayTeachingInfo(now, calendarWeeks, termConfig);
  const userPreferences = getUserPreferences();
  const extraConversation = extra.conversation && typeof extra.conversation === "object" && !Array.isArray(extra.conversation)
    ? extra.conversation
    : {};
  const conversationId = extra.conversationId || extra.activeConversationId || extraConversation.conversationId || "";
  const recentSource = Array.isArray(extra.recentMessages)
    ? extra.recentMessages
    : getAiHistory(conversationId);
  const recentMessages = recentSource.slice(-8).map((item) => {
    const source = item && typeof item === "object" ? item : {};
    let content = redactSensitiveText(source.content || source.text || "").slice(0, 400);
    content = content.replace(
      /((?:password|passwd|pwd|密码|cookie|authorization|token|secret|api[-_\s]?key|学号)\s*[:=：]?\s*)[^\s，。；;,&]+/gi,
      "$1[已脱敏]"
    );
    return {
      role: source.role === "user" ? "user" : "assistant",
      content,
    };
  }).filter((item) => item.content);
  const contextSlots = contextManager.normalizeContextSlots(
    extra.contextSlots ||
    extra.conversationContextSlots ||
    extraConversation.contextSlots ||
    {}
  );

  return {
    term,
    selectedTerm: term,
    activeTerm: appConfig.currentSemester || activeRelease.term || manifest.term || termConfig.term || term,
    availableTerms: Array.isArray(appConfig.availableTerms)
      ? appConfig.availableTerms.slice(0, 8).map((item) => ({
          term: item.term,
          status: item.status,
          dataAvailable: item.dataAvailable,
          releaseVersion: item.releaseVersion,
        }))
      : [],
    selectedTermDataAvailable: Array.isArray(appConfig.availableTerms)
      ? Boolean((appConfig.availableTerms.find((item) => item.term === term) || {}).dataAvailable)
      : true,
    semesterText: termConfig.semesterText || "",
    termStartDate: termConfig.termStartDate || "",
    totalWeeks: termConfig.totalWeeks || 19,
    termPhase: todayTeachingInfo.termPhase || "unknown",
    isInTerm: todayTeachingInfo.isInTerm !== false,
    currentTeachingWeek: extra.currentTeachingWeek || todayTeachingInfo.weekNo,
    todayWeekday: todayTeachingInfo.weekday || getTodayWeekday(now),
    todayDate: todayTeachingInfo.date,
    todayTeachingInfo: {
      weekNo: todayTeachingInfo.weekNo,
      rawWeekNo: todayTeachingInfo.rawWeekNo,
      termPhase: todayTeachingInfo.termPhase || "unknown",
      isInTerm: todayTeachingInfo.isInTerm !== false,
      weekday: todayTeachingInfo.weekday,
      date: todayTeachingInfo.date,
      termStartDate: termConfig.termStartDate || "",
    },
    releaseVersion: extra.releaseVersion || (target && target.releaseVersion) || activeRelease.releaseVersion || manifest.releaseVersion || "",
    currentPage: extra.currentPage || getCurrentRoute(),
    envVersion: extra.envVersion || getMiniProgramEnvVersion(),
    clientTime: now.toISOString(),
    clientLocalTime: formatLocalIsoWithOffset(now),
    timezoneOffsetMinutes: now.getTimezoneOffset(),
    clientTimestampMs: now.getTime(),
    assistantRuntimeRequestedAt: now.toISOString(),
    assistantRuntimeCacheBust: `${now.getTime()}-${Math.floor(Math.random() * 100000)}`,
    assistantRuntimeMaxAgeMs: 5000,
    timezone: "Asia/Shanghai",
    currentScheduleSummary: scheduleSummary,
    scheduleChangeBaseline: scheduleChangeState.pending ? scheduleChangeState.baseline : null,
    scheduleChangePending: scheduleChangeState.pending === true,
    scheduleChangeDetectedAt: scheduleChangeState.detectedAt || "",
    latestScheduleImport: latestImport,
    pendingClarification: getPendingClarification(),
    userPreferences,
    recentMessages,
    conversationSummary: redactSensitiveText(extra.conversationSummary || extraConversation.conversationSummary || "").slice(0, 400),
    conversation: {
      conversationId,
      contextSlots,
    },
    contextSlots,
    memoryMode: extra.memoryMode || readStorage("FOSU_AI_MEMORY_MODE", "local_only") || "local_only",
    autoMemoryEnabled: typeof extra.autoMemoryEnabled === "boolean"
      ? extra.autoMemoryEnabled
      : isAutoMemoryEnabled(),
    cloudSyncEnabled: extra.cloudSyncEnabled === true
      || (extra.memoryMode || readStorage("FOSU_AI_MEMORY_MODE", "local_only")) === "cloud_sync",
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
    taskSteps: Array.isArray(source.taskSteps) ? source.taskSteps.slice(0, 8) : [],
    evidence: source.evidence && typeof source.evidence === "object" && !Array.isArray(source.evidence) ? source.evidence : null,
    safety: source.safety || null,
    metrics: source.metrics && typeof source.metrics === "object" && !Array.isArray(source.metrics) ? source.metrics : null,
    timeText: source.timeText || "",
  };
}

function getAiHistory(conversationId) {
  const store = conversationStore.getStore();
  const id = conversationId || store.activeConversationId;
  const conversation = store.conversations.find((item) => item.conversationId === id) ||
    store.conversations[0] ||
    null;
  if (conversation) {
    return (conversation.messages || []).slice(-MAX_HISTORY).map(normalizeHistoryItem);
  }
  const list = readStorage(HISTORY_KEY, []);
  return Array.isArray(list) ? list.slice(-MAX_HISTORY).map(normalizeHistoryItem) : [];
}

function saveAiHistory(messages, conversationId, contextSlots) {
  const next = Array.isArray(messages)
    ? messages.slice(-MAX_HISTORY).map(normalizeHistoryItem)
    : [];
  conversationStore.saveConversationMessages(conversationId || conversationStore.getActiveConversation().conversationId, next, contextSlots);
  return next;
}

function clearAiHistory(conversationId) {
  try {
    wx.removeStorageSync(PENDING_CLARIFICATION_KEY);
  } catch (error) {
    // best effort
  }
  conversationStore.clearConversation(conversationId || conversationStore.getActiveConversation().conversationId);
  return [];
}

function getRememberedPersonalization() {
  return {
    personalContextAllowed: isPersonalContextAllowed(),
    latestScheduleImport: getLatestScheduleImport(),
    pendingClarification: getPendingClarification(),
    userPreferences: getUserPreferences(),
    localOnly: true,
  };
}

function pausePersonalization() {
  setPersonalContextAllowed(false);
  return getRememberedPersonalization();
}

function clearPersonalization() {
  try {
    wx.removeStorageSync(ALLOW_PERSONAL_CONTEXT_KEY);
    wx.removeStorageSync(LAST_IMPORT_CONTEXT_KEY);
    wx.removeStorageSync(PENDING_CLARIFICATION_KEY);
    wx.removeStorageSync(USER_PREFERENCES_KEY);
  } catch (error) {
    // best effort
  }
  return getRememberedPersonalization();
}

function formatStatusTime(value) {
  if (!value) return "";
  if (typeof value === "number" && Number.isFinite(value)) {
    return formatLocalIsoWithOffset(new Date(value));
  }
  const parsed = Date.parse(value);
  if (Number.isFinite(parsed)) return formatLocalIsoWithOffset(new Date(parsed));
  return redactSensitiveText(value).slice(0, 80);
}

function getRuntimeReleaseStatus(clientContext = {}) {
  let app = {};
  try {
    app = getApp() || {};
  } catch (error) {
    app = {};
  }
  const globalData = app.globalData || {};
  const activeRelease = globalData.activeRelease || {};
  const manifest = activeRelease.manifest || {};
  const appConfig = globalData.appConfig || {};
  const term = clientContext.term ||
    clientContext.selectedTerm ||
    appConfig.currentSemester ||
    activeRelease.term ||
    manifest.term ||
    DEFAULT_TERM ||
    "";
  const localActive = releasePackService.getLocalActiveRelease(term) || {};
  const localManifest = localActive.manifest || {};
  const releaseVersion = clientContext.releaseVersion ||
    activeRelease.releaseVersion ||
    manifest.releaseVersion ||
    localActive.releaseVersion ||
    localManifest.releaseVersion ||
    "";
  const termConfig = manifest.termConfig || localManifest.termConfig || appConfig.termConfig || {};
  const updatedAt = manifest.updatedAt ||
    activeRelease.updatedAt ||
    localActive.updatedAt ||
    localManifest.updatedAt ||
    "";
  const savedAt = localActive.savedAt || 0;
  return {
    term,
    activeTerm: clientContext.activeTerm || appConfig.currentSemester || activeRelease.term || manifest.term || term,
    semesterText: clientContext.semesterText || termConfig.semesterText || "",
    releaseVersion,
    updatedAt,
    cachedAt: savedAt ? formatStatusTime(savedAt) : "",
    cacheEpoch: manifest.cacheEpoch || activeRelease.cacheEpoch || localActive.cacheEpoch || "",
    source: "本地全校课表索引（Release Pack）",
    selectedTermDataAvailable: clientContext.selectedTermDataAvailable !== false,
    currentTeachingWeek: clientContext.currentTeachingWeek || "",
    checkedAt: new Date().toISOString(),
  };
}

function buildScheduleStatusResponse(message, clientContext = {}, route = {}) {
  const status = getRuntimeReleaseStatus(clientContext);
  const hasRelease = Boolean(status.releaseVersion);
  const updatedText = status.updatedAt
    ? formatStatusTime(status.updatedAt)
    : "当前系统未记录精确更新时间";
  const cacheText = status.cachedAt || "当前系统未记录本机缓存时间";
  const teachingWeekText = status.currentTeachingWeek ? `第${status.currentTeachingWeek}教学周` : "当前系统未记录教学周";
  const reliability = hasRelease && status.selectedTermDataAvailable
    ? "可用于全校课表查询；具体上课安排仍以学校教务系统和任课教师通知为准。"
    : "当前未确认完整课表发布版本，暂不能判断为最新数据。";
  const answer = [
    "已根据关键词匹配到课表数据状态查询。",
    `当前学期：${status.term || "未记录"}${status.semesterText ? `（${status.semesterText}）` : ""}。`,
    `当前教学周：${teachingWeekText}。`,
    `数据来源：${status.source}。`,
    `发布版本：${status.releaseVersion || "当前系统未记录发布版本"}。`,
    `更新时间：${updatedText}；本次检查：${formatStatusTime(status.checkedAt)}。`,
    reliability,
  ].join("\n");
  return {
    answer,
    cards: [
      {
        type: "schedule_status",
        title: "课表数据状态",
        subtitle: status.term || "当前学期未记录",
        badges: ["全校课表", hasRelease ? "已加载发布包" : "版本待确认"].concat(status.currentTeachingWeek ? [`第${status.currentTeachingWeek}周`] : []),
        items: [
          { title: "数据来源", subtitle: status.source, value: "" },
          { title: "当前学期", subtitle: status.semesterText || status.term || "未记录", value: "" },
          { title: "当前教学周", subtitle: teachingWeekText, value: "" },
          { title: "发布版本", subtitle: status.releaseVersion || "当前系统未记录发布版本", value: "" },
          { title: "更新时间", subtitle: updatedText, value: "" },
          { title: "本机缓存", subtitle: cacheText, value: "" },
          { title: "可靠性", subtitle: reliability, value: "" },
        ],
        actions: [
          { label: "查看全校课表", type: "navigate", url: "/pages/school/school" },
        ],
      },
    ],
    suggestions: ["查班级本周课表", "现在用的是哪个学期数据", "可以查询什么"],
    toolCalls: [{ name: "diagnose_data_status", status: "success" }],
    evidence: {
      verified: hasRelease,
      term: status.term,
      releaseVersion: status.releaseVersion,
      checkedAt: status.checkedAt,
      source: "local-release-pack-status",
    },
    safety: {
      provider: "status-handler",
      resolvedProvider: "status-handler",
      externalProviderUsed: false,
      mode: "tool-grounded",
      clearPendingClarification: true,
    },
    metrics: {
      intentName: "schedule_status",
      latencyMs: 0,
      externalProviderUsed: false,
      resultCount: hasRelease ? 1 : 0,
      routeConfidence: route.confidence || 0,
    },
  };
}

function buildHelpResponse(message, clientContext = {}, route = {}) {
  const value = String(message || "").replace(/\s+/g, "");
  const isImportHelp = /导入.*个人课表|个人课表.*导入|导入课表|xls/i.test(value);
  const isDataSourceHelp = /数据来源|来源说明|知识来源|课表来源/.test(value);
  const isFloatHelp = /小佛助手浮窗|小佛浮窗|浮窗/.test(value);
  const card = isFloatHelp
    ? {
        type: "help",
        title: "小佛助手浮窗",
        subtitle: "可点击、拖拽、隐藏或关闭",
        badges: ["使用帮助", "浮窗"],
        items: [
          { title: "打开方式", subtitle: "单击浮窗会打开校园服务管家；拖动后会吸附到左右边缘", value: "" },
          { title: "关闭与开启", subtitle: "页面右上角更多操作里可以开启或关闭浮窗", value: "" },
          { title: "长按菜单", subtitle: "可打开小佛校园助手、隐藏本页或关闭浮窗", value: "" },
        ],
        actions: [
          { label: "关闭浮窗", type: "toggleFloat", payload: { enabled: false } },
        ],
      }
    : isImportHelp
    ? {
        type: "import_guide",
        title: "导入个人课表",
        subtitle: "用于回答今日、明日、本周和下一节课",
        badges: ["使用帮助", "个人课表"],
        items: [
          { title: "适用问题", subtitle: "今天有什么课、明天有什么课、本周课表、下一节课在哪里", value: "" },
          { title: "主入口", subtitle: "先打开个人课表同步，再按页面提示选择合适方式", value: "" },
          { title: "XLS 文件导入", subtitle: "明确需要表格/文件导入时再进入 XLS 页签", value: "" },
          { title: "安全提醒", subtitle: "请勿输入学号、密码、验证码等敏感信息", value: "" },
        ],
        actions: [
          { label: "打开个人课表同步", type: "navigate", url: PERSONAL_SYNC_URL },
          { label: "查看 XLS 文件导入", type: "navigate", url: PERSONAL_SYNC_XLS_URL },
          { label: "继续问今天课程", type: "ask", payload: { message: "今天有什么课" } },
        ],
      }
    : isDataSourceHelp
      ? {
          type: "help",
          title: "数据来源说明",
          subtitle: "课表状态读运行时字段，校园信息读本地知识库",
          badges: ["使用帮助", "数据边界"],
          items: [
            { title: "全校课表", subtitle: "优先读取项目内 Release Pack、学期、版本、缓存和更新时间字段", value: "" },
            { title: "校园信息", subtitle: "只返回知识库收录的佛山大学公开信息和本地入口说明", value: "" },
            { title: "缺少来源时", subtitle: "会说明知识库暂未收录可靠信息，不编造电话、地址、制度或入口", value: "" },
          ],
          actions: [
            { label: "查看全校课表", type: "navigate", url: "/pages/school/school" },
            { label: "继续追问", type: "ask", payload: { message: "教务系统在哪里" } },
          ],
        }
    : {
        type: "help",
        title: "可以查询什么",
        subtitle: "校园事项、全校课表、天气提醒和常用入口",
        badges: ["使用说明", "当前查询"],
        items: [
          { title: "查全校课表", subtitle: "可以查班级、教师、教室或课程安排", value: "" },
          { title: "查校园事项", subtitle: "例如：佛大有哪些校区、教务系统在哪里进", value: "" },
          { title: "看数据状态", subtitle: "例如：课表数据是否最新、现在用的是哪个学期数据", value: "" },
          { title: "连续查询", subtitle: "查到一个对象后，可以继续输入“那周三呢”“换成另一个班级”。", value: "" },
        ],
        actions: [
          { label: "打开全校课表", type: "navigate", url: "/pages/school/school" },
          { label: "更多任务", type: "openSheet", payload: { sheet: "task" } },
        ],
      };
  const generalHelpAnswer = pickResponseVariant([
    "可以查询校园事项、全校课表、个人课表、天气提醒和常用入口。涉及课表时，请尽量说清楚班级、老师、教室或课程。",
    "我是小佛，常见能力包括：查班级/教师/教室课表、找空教室、看教学周与校历、问校区天气，以及引导导入个人课表。",
    "你可以问我“今天有什么课”“C7 附近空教室”“现在第几周”，也可以问“佛大有哪些校区”。查课表时带上对象关键词会更准。",
  ], value);
  return {
    answer: isFloatHelp
      ? "小佛助手浮窗已可通过更多操作开启或关闭。单击会打开校园服务管家，拖拽会吸附到左右边缘，长按可以打开菜单。"
      : isImportHelp
      ? "已根据关键词匹配到导入个人课表说明。导入后，可查询“今天有什么课”“明天有什么课”“下一节课在哪里”这类个人安排。"
      : (isDataSourceHelp
        ? "已根据关键词匹配到数据来源说明。课表状态会读取项目内真实字段，校园信息只使用已收录来源；缺少可靠来源时不会编造。"
        : generalHelpAnswer),
    cards: [
      card,
    ],
    suggestions: isFloatHelp
      ? ["关闭小佛助手浮窗", "打开小佛校园助手", "可以查询什么"]
      : isImportHelp
      ? ["今天有什么课", "查班级本周课表", "课表数据更新到什么时候"]
      : (isDataSourceHelp
        ? ["课表数据更新到什么时候", "教务系统在哪里", "佛大有哪些校区"]
        : pickResponseVariant([
          ["查班级本周课表", "教务系统在哪里", "课表数据是否最新"],
          ["现在有空教室吗", "今天有什么课", "怎么导入个人课表"],
        ], value)),
    toolCalls: [{ name: "clarify_missing_slot", status: "success" }],
    evidence: {
      verified: false,
      checkedAt: new Date().toISOString(),
      source: "local-xiaofu-help",
    },
    safety: {
      provider: "help-handler",
      resolvedProvider: "help-handler",
      externalProviderUsed: false,
      mode: "tool-grounded",
      clearPendingClarification: true,
    },
    metrics: {
      intentName: "help",
      latencyMs: 0,
      externalProviderUsed: false,
      resultCount: 1,
      routeConfidence: route.confidence || 0,
    },
  };
}

function buildAppNavigationResponse(message, clientContext = {}, route = {}) {
  const target = route.entities || {};
  const actions = target.url
    ? [
        { label: `打开${target.label}`, type: "navigate", url: target.url },
      ]
    : [];
  return {
    answer: `已根据关键词匹配到${target.label || "相关功能"}入口。入口放在这条结果里，当前查询记录仍会保留。`,
    cards: [
      {
        type: "navigation",
        title: target.label || "应用入口",
        subtitle: "从当前查询打开",
        badges: ["应用入口"],
        items: [
          { title: "入口", subtitle: target.label || "", value: "" },
        ],
        actions,
      },
    ],
    suggestions: ["可以查询什么", "课表数据是否最新"],
    toolCalls: [{ name: "clarify_missing_slot", status: "success" }],
    evidence: {
      verified: false,
      checkedAt: new Date().toISOString(),
      source: "local-app-navigation",
    },
    safety: {
      provider: "navigation-handler",
      resolvedProvider: "navigation-handler",
      externalProviderUsed: false,
      mode: "tool-grounded",
      clearPendingClarification: true,
    },
    metrics: {
      intentName: "app_navigation",
      latencyMs: 0,
      externalProviderUsed: false,
      resultCount: target.url ? 1 : 0,
      routeConfidence: route.confidence || 0,
    },
  };
}

function buildPersonalScheduleClarificationResponse(message, clientContext = {}, route = {}) {
  return {
    answer: "已匹配到个人课表安排查询。当前查询里还没有可用的个人课表，也没有明确的班级、老师或教室；可以先导入个人课表，或补充要查的对象。",
    cards: [
      {
        type: "personal_schedule",
        title: "需要个人课表或查询对象",
        subtitle: "今日、明日、本周安排需要有明确来源",
        badges: ["个人课表", "需要补充"],
        items: [
          { title: "导入个人课表", subtitle: "用于回答今天、明天、本周和下一节课", value: "" },
          { title: "指定班级", subtitle: "用于查询某个班级的全校课表", value: "" },
          { title: "指定教师或教室", subtitle: "用于查询教师课表或教室占用", value: "" },
        ],
        actions: [
          { label: "打开个人课表同步", type: "navigate", url: PERSONAL_SYNC_URL },
          { label: "查看 XLS 文件导入", type: "navigate", url: PERSONAL_SYNC_XLS_URL },
        ],
      },
    ],
    suggestions: ["如何导入个人课表", "查班级本周课表", "查教室明天是否有课"],
    toolCalls: [{ name: "clarify_missing_slot", status: "clarify" }],
    evidence: {
      verified: false,
      checkedAt: new Date().toISOString(),
      source: "local-personal-schedule-gate",
    },
    safety: {
      provider: "personal-schedule-gate",
      resolvedProvider: "personal-schedule-gate",
      externalProviderUsed: false,
      mode: "tool-grounded",
      clearPendingClarification: true,
    },
    metrics: {
      intentName: "personal_schedule",
      latencyMs: 0,
      externalProviderUsed: false,
      resultCount: 0,
      routeConfidence: route.confidence || 0,
    },
  };
}

// 离线/降级链路的状态披露：只允许如实说明“正在处理本机结果”，
// 不得按本地阶段伪造“正在查询课表/已生成卡片/已核验课表数据”等运行事件文案。
function reportLocalDegradedStatus(callbacks) {
  if (callbacks && typeof callbacks.onStatus === "function") {
    callbacks.onStatus({ type: "status", text: "正在处理本机结果" });
  }
}

function displayWeatherValue(value, fallback) {
  const text = String(value == null ? "" : value).trim();
  if (!text || text === "--" || text === "NaN" || text === "null" || text === "undefined") return fallback || "暂无该项数据";
  return text;
}

function weatherValueWithUnit(value, unit, fallback) {
  const text = displayWeatherValue(value, fallback);
  const suffix = unit || "";
  if (text === "暂无该项数据" || !suffix) return text;
  if (suffix === "℃" && /(?:℃|°)$/.test(text)) return text;
  if (suffix === "%" && /%$/.test(text)) return text;
  if (suffix === "km/h" && /(?:km\/h|公里\/小时)$/i.test(text)) return text;
  if (suffix === "mm" && /(?:mm|毫米)$/i.test(text)) return text;
  return `${text}${suffix}`;
}

function formatWeatherTime(value) {
  if (!value) return formatStatusTime(new Date().toISOString());
  return formatStatusTime(value);
}

function weatherTargetLabel(source, route) {
  const direct = safeText(source && source.targetLabel || "", 12);
  if (direct) return direct;
  const hint = safeText(source && source.dateHint || route && route.entities && route.entities.dateHint || "today", 24);
  if (hint === "day_after_tomorrow") return "后天";
  if (hint === "tomorrow") return "明天";
  return "今天";
}

function minutesFromTime(value) {
  const match = String(value || "").match(/^(\d{1,2}):(\d{2})/);
  if (!match) return null;
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (!Number.isFinite(hour) || !Number.isFinite(minute)) return null;
  return hour * 60 + minute;
}

function getSectionStartMinutes(section) {
  const target = Number(section || 0);
  if (!target) return null;
  const item = (courseTimes || []).find((entry) => Number(entry.section) === target);
  return item ? minutesFromTime(item.start) : null;
}

function getCurrentLocalMinutes(clientContext = {}) {
  const value = clientContext.clientLocalTime || clientContext.clientTime || "";
  const match = String(value || "").match(/T(\d{2}):(\d{2})/);
  if (match) return Number(match[1]) * 60 + Number(match[2]);
  const now = new Date();
  return now.getHours() * 60 + now.getMinutes();
}

function courseMatchesTeachingWeek(course, weekNo) {
  const week = Number(weekNo || 0);
  if (!week) return true;
  if (Array.isArray(course.weeks) && course.weeks.length) {
    return course.weeks.map((item) => Number(item)).indexOf(week) >= 0;
  }
  const startWeek = Number(course.startWeek || 0);
  const endWeek = Number(course.endWeek || 0);
  if (startWeek && endWeek) return week >= startWeek && week <= endWeek;
  return true;
}

function findNextCourseForWeather(clientContext = {}) {
  const summary = clientContext.currentScheduleSummary || {};
  if (!summary.enabled || !Array.isArray(summary.courses) || !summary.courses.length) return null;
  const weekday = Number(clientContext.todayWeekday || 0);
  const teachingWeek = Number(clientContext.currentTeachingWeek || 0);
  const nowMinutes = getCurrentLocalMinutes(clientContext);
  const candidates = summary.courses
    .filter((course) => Number(course.weekday || 0) === weekday)
    .filter((course) => courseMatchesTeachingWeek(course, teachingWeek))
    .map((course) => {
      const startSection = Number(course.startSection || course.sectionStart || 0) || 0;
      return Object.assign({}, course, {
        _startMinutes: getSectionStartMinutes(startSection),
      });
    })
    .filter((course) => Number.isFinite(Number(course._startMinutes)))
    .sort((left, right) => Number(left._startMinutes) - Number(right._startMinutes));
  for (let index = 0; index < candidates.length; index += 1) {
    if (Number(candidates[index]._startMinutes) + 5 >= nowMinutes) return candidates[index];
  }
  return candidates[0] || null;
}

function formatMinutesOfDay(value) {
  const total = (Number(value || 0) + 24 * 60) % (24 * 60);
  return `${String(Math.floor(total / 60)).padStart(2, "0")}:${String(total % 60).padStart(2, "0")}`;
}

function buildProactiveWorkspace(clientContext = {}) {
  const summary = clientContext.currentScheduleSummary || {};
  const actions = [];
  if (!summary.enabled || !Array.isArray(summary.courses) || !summary.courses.length) {
    return {
      insight: {
        kind: "import",
        eyebrow: "课表未连接",
        title: "导入个人课表后，小佛才能给出下一节课和提醒建议",
        detail: "只读取受控课程摘要，不需要把学号、密码或原始文件交给模型。",
        actionLabel: "导入课表",
        actionUrl: PERSONAL_SYNC_URL,
        actionMessage: "",
      },
      actions: [
        { id: "import", label: "导入课表", url: PERSONAL_SYNC_URL },
        { id: "school", label: "查全校课表", message: "查询全校课表" },
      ],
    };
  }

  if (clientContext.scheduleChangePending === true && clientContext.scheduleChangeBaseline) {
    return {
      insight: {
        kind: "schedule_change",
        eyebrow: "课表有新版本",
        title: "检测到个人课表摘要发生变化",
        detail: "可核对课程时间、教室、教师和周次；确认后再决定是否重新导入。",
        actionLabel: "查看变化",
        actionMessage: "检测我的课表有没有变化",
        actionUrl: "",
      },
      actions: [
        { id: "changes", label: "查看变化", message: "检测我的课表有没有变化" },
        { id: "conflicts", label: "检查冲突", message: "检查我本周有没有时间冲突或连续赶课" },
        { id: "import", label: "重新导入", url: PERSONAL_SYNC_URL },
      ],
    };
  }

  const weekday = Number(clientContext.todayWeekday || 0);
  const teachingWeek = Number(clientContext.currentTeachingWeek || 0);
  const nowMinutes = getCurrentLocalMinutes(clientContext);
  const dayCourses = summary.courses
    .filter((course) => Number(course.weekday || 0) === weekday)
    .filter((course) => courseMatchesTeachingWeek(course, teachingWeek))
    .map((course) => Object.assign({}, course, {
      _startMinutes: getSectionStartMinutes(course.startSection || course.sectionStart),
      _endMinutes: (() => {
        const endSection = Number(course.endSection || course.startSection || 0);
        const entry = (courseTimes || []).find((item) => Number(item.section) === endSection);
        return entry ? minutesFromTime(entry.end) : null;
      })(),
    }))
    .filter((course) => Number.isFinite(Number(course._startMinutes)))
    .sort((left, right) => Number(left._startMinutes) - Number(right._startMinutes));
  const next = dayCourses.find((course) => Number(course._endMinutes || course._startMinutes) >= nowMinutes
    && Number(course._startMinutes) >= nowMinutes - 5) || null;

  actions.push({ id: "next", label: "下一节课", message: "我下一节课在哪，什么时候该出发？" });
  actions.push({ id: "reminder", label: "配置提醒", message: "", actionType: "manageReminders", payload: { sheet: "reminders", openCreate: true } });
  actions.push({ id: "room", label: "找空教室", message: "现在帮我找附近空教室" });

  if (next) {
    const courseName = safeText(next.courseName || next.name || "下一节课", 60);
    const classroom = safeText(next.classroom || next.roomName || "", 60);
    const startTime = formatMinutesOfDay(next._startMinutes);
    const departureTime = formatMinutesOfDay(next._startMinutes - 20);
    return {
      insight: {
        kind: "next_course",
        eyebrow: "下一节课",
        title: `${courseName} · ${startTime}${classroom ? ` · ${classroom}` : ""}`,
        detail: classroom
          ? `建议 ${departureTime} 左右出发（按 20 分钟通用缓冲，非精确路线时长）。`
          : "教室信息缺失，建议先核对或重新导入课表。",
        actionLabel: "查看行动建议",
        actionMessage: "我下一节课在哪，什么时候该出发？",
        actionUrl: "",
      },
      actions: actions.slice(0, 3),
    };
  }

  const hadToday = dayCourses.length > 0;
  return {
    insight: {
      kind: hadToday ? "day_finished" : "free_day",
      eyebrow: hadToday ? "今日课程已结束" : "今天暂无课程",
      title: hadToday ? "可以安排复习或找一段连续自习时间" : "今天可以按空闲节次规划自习",
      detail: "空教室结果会从当前 Release Pack 查询，不会凭空推荐教室。",
      actionLabel: "规划自习",
      actionMessage: "帮我规划今天下午的上课和自习安排",
      actionUrl: "",
    },
    actions: actions.slice(0, 3),
  };
}

function buildWeatherAdvice(weather, route, nextCourse) {
  const sourceAdvice = safeText(weather && weather.advice || "", 160);
  const probability = Number(weather && weather.rainProbabilityMax24h);
  const precipitation = Number(weather && weather.precipitationMm);
  const rainLike = /雨|雷|降水/.test(String(weather && weather.weatherText || "")) ||
    (Number.isFinite(probability) && probability >= 55) ||
    (Number.isFinite(precipitation) && precipitation >= 0.8);
  let advice = sourceAdvice || (rainLike ? "有降雨风险，建议带伞并预留通行时间。" : "降雨影响不明显，按正常出行准备即可。");
  if (route && route.entities && route.entities.needsPersonalSchedule) {
    if (nextCourse) {
      const courseName = safeText(nextCourse.courseName || nextCourse.name || "下一节课", 60);
      const roomName = safeText(nextCourse.classroom || nextCourse.roomName || "", 60);
      advice = `${courseName}${roomName ? `（${roomName}）` : ""}前：${advice}`;
    } else {
      advice = `${advice} 当前没有可用的个人课表摘要，导入个人课表后可以结合下一节课时间和地点提醒。`;
    }
  }
  return safeText(advice, 180);
}

function normalizeWeatherForCard(weather, route, nextCourse) {
  const source = weather && typeof weather === "object" && !Array.isArray(weather) ? weather : {};
  const success = source.success !== false;
  const campus = safeText(source.campus || route && route.entities && route.entities.campus || "仙溪校区", 40);
  const targetLabel = weatherTargetLabel(source, route);
  const sourceText = source.provider === "open-meteo"
    ? (targetLabel === "今天" ? "Open-Meteo 实时天气" : "Open-Meteo 天气预报")
    : (safeText(source.provider || source.source || "", 60) || "天气数据源");
  const unavailableText = "当前天气数据源暂不可用";
  const weatherText = success ? (safeText(source.weatherText || source.summary, 40) || "天气待确认") : unavailableText;
  const updatedLabel = success
    ? formatWeatherTime(source.updatedAt || new Date().toISOString())
    : formatWeatherTime(new Date().toISOString());
  const advice = success
    ? buildWeatherAdvice(source, route, nextCourse)
    : "当前天气数据源未配置或暂不可用，不能用学校官网概况代替天气。请稍后重试或在服务端配置稳定天气数据源。";
  return {
    success,
    campus,
    provider: source.provider || "",
    sourceId: source.sourceId || source.provider || "weather-provider",
    sourceText,
    targetLabel,
    targetDate: safeText(source.targetDate || "", 16),
    dateHint: safeText(source.dateHint || route && route.entities && route.entities.dateHint || "today", 24),
    updatedAt: source.updatedAt || "",
    updatedLabel,
    weatherText,
    temperatureC: success ? displayWeatherValue(source.temperatureC) : "暂无该项数据",
    apparentTemperatureC: success ? displayWeatherValue(source.apparentTemperatureC || source.temperatureC) : "暂无该项数据",
    highC: success ? displayWeatherValue(source.highC || source.temperatureC) : "暂无该项数据",
    lowC: success ? displayWeatherValue(source.lowC || source.temperatureC) : "暂无该项数据",
    humidity: success ? displayWeatherValue(source.humidity) : "暂无该项数据",
    windSpeedKmh: success ? displayWeatherValue(source.windSpeedKmh) : "暂无该项数据",
    precipitationMm: success ? displayWeatherValue(source.precipitationMm) : "暂无该项数据",
    rainProbabilityMax24h: success ? displayWeatherValue(source.rainProbabilityMax24h) : "暂无该项数据",
    temperatureText: success ? weatherValueWithUnit(source.temperatureC, "℃") : "暂无该项数据",
    apparentTemperatureText: success ? weatherValueWithUnit(source.apparentTemperatureC || source.temperatureC, "℃") : "暂无该项数据",
    highText: success ? weatherValueWithUnit(source.highC || source.temperatureC, "℃") : "暂无该项数据",
    lowText: success ? weatherValueWithUnit(source.lowC || source.temperatureC, "℃") : "暂无该项数据",
    humidityText: success ? weatherValueWithUnit(source.humidity, "%") : "暂无该项数据",
    windSpeedText: success ? weatherValueWithUnit(source.windSpeedKmh, "km/h") : "暂无该项数据",
    precipitationText: success ? weatherValueWithUnit(source.precipitationMm, "mm") : "暂无该项数据",
    rainProbabilityText: success ? weatherValueWithUnit(source.rainProbabilityMax24h, "%") : "暂无该项数据",
    cached: source.cached === true,
    stale: source.stale === true,
    advice,
    next6Hours: Array.isArray(source.next6Hours) ? source.next6Hours.slice(0, 6) : [],
  };
}

function buildWeatherAnswerText(weatherPayload, route, nextCourse) {
  if (!weatherPayload.success) {
    return `已根据关键词匹配到${weatherPayload.campus}天气查询。${weatherPayload.advice}`;
  }
  const rainText = weatherPayload.rainProbabilityText === "暂无该项数据"
    ? "暂未返回降雨概率"
    : `${weatherPayload.targetLabel || "今天"}最高降雨概率约 ${weatherPayload.rainProbabilityText}`;
  const nextCourseText = route && route.entities && route.entities.needsPersonalSchedule
    ? (nextCourse
      ? `我也参考了你本机个人课表里的下一节课：${safeText(nextCourse.courseName || nextCourse.name || "下一节课", 60)}${safeText(nextCourse.classroom || nextCourse.roomName || "", 60) ? `，地点 ${safeText(nextCourse.classroom || nextCourse.roomName || "", 60)}` : ""}。`
      : "你问到下一节课，我先按校区天气判断；导入个人课表后可以结合下一节课时间和地点提醒。")
    : "";
  return [
    `已根据关键词匹配到${weatherPayload.campus}天气查询。${weatherPayload.targetLabel || "今天"}${weatherPayload.weatherText}，温度 ${weatherPayload.temperatureText}，${rainText}。`,
    nextCourseText,
    weatherPayload.advice,
  ].filter(Boolean).join("\n");
}

function buildWeatherCard(weatherPayload) {
  return {
    type: "weather_card",
    variant: weatherPayload.success ? "" : "error",
    title: `${weatherPayload.campus}天气`,
    subtitle: weatherPayload.success ? weatherPayload.weatherText : "天气数据暂不可用",
    badges: ["校区天气", weatherPayload.success ? "天气数据" : "数据暂不可用"].concat(weatherPayload.cached ? ["最近数据"] : []),
    weather: weatherPayload,
    items: [
      { title: "地点", subtitle: weatherPayload.campus, value: "" },
      { title: `${weatherPayload.targetLabel || "今天"}天气`, subtitle: weatherPayload.weatherText, value: weatherPayload.temperatureText === "暂无该项数据" ? "" : weatherPayload.temperatureText },
      { title: "降雨提醒", subtitle: weatherPayload.rainProbabilityText === "暂无该项数据" ? "暂无该项数据：数据源未返回降雨概率" : `${weatherPayload.targetLabel || "今天"}最高降雨概率约 ${weatherPayload.rainProbabilityText}`, value: "" },
      { title: "风力/湿度", subtitle: `风速 ${weatherPayload.windSpeedText} · 湿度 ${weatherPayload.humidityText}`, value: "" },
      { title: "更新时间", subtitle: weatherPayload.updatedLabel, value: "" },
      { title: "数据来源", subtitle: weatherPayload.sourceText, value: "" },
      { title: "建议", subtitle: weatherPayload.advice, value: "" },
    ],
    actions: weatherPayload.success
      ? [
          { label: "重新获取天气", type: "retry", payload: {} },
          { label: "继续问带伞", type: "ask", payload: { message: "今天要不要带伞" } },
          { label: "明天适合跑步吗", type: "ask", payload: { message: "明天适合跑步吗" } },
        ]
      : [
          { label: "重新获取天气", type: "retry", payload: {} },
        ],
    updatedAt: weatherPayload.updatedAt,
    sourceUrl: weatherPayload.sourceId,
  };
}

async function buildWeatherResponse(message, clientContext = {}, route = {}, callbacks = {}) {
  const entities = route.entities || {};
  const nextCourse = entities.needsPersonalSchedule ? findNextCourseForWeather(clientContext) : null;
  const weather = await weatherProvider.getCampusWeather({
    campus: entities.campus || entities.location || "",
    message,
    dateHint: entities.dateHint || "",
    topic: entities.topic || "",
  });
  const weatherPayload = normalizeWeatherForCard(weather, route, nextCourse);
  return {
    answer: buildWeatherAnswerText(weatherPayload, route, nextCourse),
    cards: [buildWeatherCard(weatherPayload)],
    suggestions: ["今天要不要带伞", "仙溪校区今天会下雨吗", "明天适合跑步吗"],
    toolCalls: [
      { name: entities.needsPersonalSchedule ? "get_course_weather_advice" : "get_campus_weather", status: weatherPayload.success ? "success" : "not_found" },
    ],
    evidence: {
      verified: weatherPayload.success,
      checkedAt: new Date().toISOString(),
      source: weatherPayload.sourceId,
    },
    safety: {
      provider: "weather-provider",
      resolvedProvider: weatherPayload.provider || "weather-provider",
      externalProviderUsed: weatherPayload.success,
      mode: "tool-grounded",
      clearPendingClarification: true,
    },
    metrics: {
      intentName: "weather",
      latencyMs: 0,
      externalProviderUsed: weatherPayload.success,
      resultCount: weatherPayload.success ? 1 : 0,
      routeConfidence: route.confidence || 0,
    },
  };
}

function pickResponseVariant(variants, seedText) {
  const items = (Array.isArray(variants) ? variants : []).filter((item) => String(item || "").trim());
  if (!items.length) return "";
  if (items.length === 1) return items[0];
  const text = String(seedText || "");
  const hourBucket = Math.floor(Date.now() / (15 * 60 * 1000));
  let hash = hourBucket * 131;
  for (let i = 0; i < text.length; i += 1) {
    hash = (hash * 31 + text.charCodeAt(i)) >>> 0;
  }
  return items[hash % items.length];
}

function isAiEnhancedClientEnv(envVersion) {
  const env = String(envVersion || "").trim().toLowerCase();
  return env === "develop" || env === "trial" || env === "devtools";
}

function hasUsableAgentAnswer(response) {
  const answer = String(response && response.answer || "").trim();
  return answer.length >= 8;
}

function isStructuredLocalHelp(message) {
  const value = String(message || "").replace(/\s+/g, "");
  return /导入.*个人课表|个人课表.*导入|导入课表|xls|excel|小佛助手浮窗|小佛浮窗|浮窗|数据来源|来源说明|知识来源/i.test(value);
}

function buildSmalltalkResponse(message, clientContext = {}, route = {}) {
  const compact = String(message || "").replace(/\s+/g, "");
  let answer = "";
  if (/^谢谢|^感谢|^辛苦了/.test(compact)) {
    answer = pickResponseVariant([
      "不客气，有课表、空教室或校园问题随时再问我。",
      "没事，我继续帮你查课表、天气和校园事项就好。",
      "举手之劳。接下来想查班级课表、空教室，还是教学周？",
    ], compact);
  } else if (/普通话|随便聊|随便问/.test(compact)) {
    answer = pickResponseVariant([
      "可以，我们就用普通话聊。需要查校园事项时，直接说清楚问题；需要查课表时，再告诉我班级、老师、教室或课程。",
      "普通话完全没问题。想查课表、空教室、天气或校园入口，直接说就行。",
      "好的，我们用普通话交流。你可以问校区、课表、空教室，也可以先让我介绍一下能力。",
    ], compact);
  } else if (xiaofuAgentRouter.isIdentityOrPersonaQuery(message)) {
    answer = pickResponseVariant([
      "我是小佛，佛课小表里的校园助手。擅长查课表、空教室、教学周、天气和校园入口，也可以帮你理解怎么导入个人课表。",
      "叫我小佛就好。我是佛课小表的校园服务助手，能帮你查全校课表、找自习教室、看天气和校区信息；具体课程事实会以工具数据为准。",
      "我是小佛助手，不是万能聊天机器人。校园课表、空教室、教学周和常用入口我比较熟，你也可以直接问“今天有什么课”。",
    ], compact);
  } else if (/^(你好|您好|嗨|哈喽|在吗|早上好|中午好|晚上好|hello|hi)/i.test(compact)) {
    answer = pickResponseVariant([
      "你好，我是小佛。想查课表、空教室、天气，还是先了解一下我能做什么？",
      "嗨，我在。直接说班级、老师、教室，或问今天有没有课就行。",
      "你好呀。我可以帮你查佛大课表和校园事项，也可以回答使用问题。",
      "在的。课表、空教室、教学周、天气和导入个人课表，都可以问我。",
    ], compact);
  } else {
    answer = pickResponseVariant([
      "我先按校园助手来理解你的问题。如果是课表，请尽量带上班级、老师、教室或课程名；如果是闲聊，也可以继续说。",
      "可以继续问。常见的有：查班级课表、找空教室、看教学周、问校区天气，或问怎么导入个人课表。",
      "收到。若你在找课表信息，补充对象关键词会更准；若只是想了解功能，直接问“你能做什么”也可以。",
    ], compact);
  }
  return {
    answer,
    cards: [],
    suggestions: pickResponseVariant([
      ["佛大有哪些校区", "查班级本周课表", "课表数据是否最新"],
      ["今天有什么课", "现在有空教室吗", "你能做什么"],
      ["仙溪校区今天会下雨吗", "怎么导入个人课表", "现在第几教学周"],
    ], compact).slice(0, 2),
    toolCalls: [],
    // Product UX: greetings/smalltalk are plain conversation — no Evidence chrome
    presentationMode: "plain",
    evidence: null,
    safety: {
      provider: "smalltalk-handler",
      resolvedProvider: "smalltalk-handler",
      externalProviderUsed: false,
      mode: "conversational",
      clearPendingClarification: true,
    },
    metrics: {
      intentName: "smalltalk",
      canonicalIntent: "conversational_help",
      latencyMs: 0,
      externalProviderUsed: false,
      resultCount: 0,
      routeConfidence: route.confidence || 0,
    },
  };
}

const OFFLINE_SKILL_BY_INTENT = Object.freeze({
  get_today_courses: "today_schedule",
  get_tomorrow_courses: "tomorrow_schedule",
  get_next_course: "next_course",
  next_course_location: "next_course_location",
  get_week_schedule: "week_schedule",
  search_school_index: "search_school_schedule",
  search_empty_rooms: "find_empty_room",
  search_continuous_empty_rooms: "find_continuous_empty_room",
  recommend_meeting_time: "recommend_meeting_time",
  campus_multi_step_advice: "campus_multi_step_advice",
  diagnose_data_status: "schedule_data_diagnosis",
  get_teaching_week: "schedule_data_diagnosis",
  explain_personal_import: "personal_schedule_import_help",
  get_campus_weather: "campus_weather",
  get_course_weather_advice: "course_weather_advice",
  search_campus_place: "campus_place_navigation",
  get_campus_route: "campus_place_navigation",
  get_classroom_location: "campus_place_navigation",
  rag_search: "knowledge_search",
  project_qa: "knowledge_search",
  conversational_help: "knowledge_search",
  clarify_missing_slot: "knowledge_search",
});

function createClientRunId(prefix) {
  return `${prefix || "client"}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

function createAgentRequestMetadata(resolvedContext = {}, options = {}) {
  const conversationId = safeText(
    options.conversationId ||
    resolvedContext.conversation && resolvedContext.conversation.conversationId ||
    conversationStore.getActiveConversation().conversationId,
    96
  );
  return {
    protocolVersion: "agent.v2",
    requestId: safeText(options.requestId, 96) || createClientRunId("req"),
    conversationId,
  };
}

function resolveOfflineCanonicalIntent(message, route = {}, response = {}) {
  const compact = String(message || "").replace(/[，。！？；：、\s]+/g, "");
  const localIntentName = response.metrics && response.metrics.intentName || "";
  if (localIntentName === "navigation" || localIntentName === "navigation_followup") {
    return "search_campus_place";
  }
  if (localIntentName === "school_knowledge") return "rag_search";
  if (route.intent === xiaofuAgentRouter.INTENTS.SCHEDULE_STATUS) {
    return /教学周|第几周|周次/.test(compact) ? "get_teaching_week" : "diagnose_data_status";
  }
  if (route.intent === xiaofuAgentRouter.INTENTS.HELP && /导入|同步|XLS|Excel/i.test(compact)) {
    return "explain_personal_import";
  }
  if (route.intent === xiaofuAgentRouter.INTENTS.WEATHER) {
    return route.entities && route.entities.needsPersonalSchedule
      ? "get_course_weather_advice"
      : "get_campus_weather";
  }
  if (route.intent === xiaofuAgentRouter.INTENTS.PERSONAL_SCHEDULE) {
    if (/明天|明日/.test(compact)) return "get_tomorrow_courses";
    if (/下一节|下节/.test(compact)) return "get_next_course";
    if (/本周|这周|一周|周课表/.test(compact)) return "get_week_schedule";
    return "get_today_courses";
  }
  if (route.intent === xiaofuAgentRouter.INTENTS.NAVIGATION) return "search_campus_place";
  return agentCapabilityCompat.toCanonicalIntent(route.canonicalIntent || route.intent);
}

// 离线/降级应答的证据标注：本机结果从未经过服务端核验，
// 保留 term/week/checkedAt/sources 等事实字段，但绝不声称 verified/complete。
function normalizeOfflineEvidence(evidence) {
  const source = evidence && typeof evidence === "object" && !Array.isArray(evidence) ? evidence : null;
  if (!source) return null;
  return Object.assign({}, source, { verified: false, complete: false });
}

function canonicalizeFallbackCards(cards, canonicalIntent) {
  const legacyTypeMap = {
    personal_schedule: "schedule",
    schedule_result: "schedule",
    schedule_status: "diagnosis",
    weather_card: "weather",
    import_guide: "guide",
    help: "guide",
    school_knowledge: "guide",
    navigation: "generic",
    clarification: "generic",
  };
  const requiredTypeByIntent = {
    get_today_courses: "schedule",
    get_tomorrow_courses: "schedule",
    get_next_course: "schedule",
    get_week_schedule: "schedule",
    next_course_location: "schedule",
    diagnose_data_status: "diagnosis",
    get_teaching_week: "generic",
    get_term_calendar: "generic",
    explain_personal_import: "guide",
    get_campus_weather: "weather",
    get_course_weather_advice: "weather",
    search_campus_place: "generic",
    get_campus_route: "generic",
    get_classroom_location: "generic",
    rag_search: "guide",
    project_qa: "guide",
    conversational_help: "guide",
    clarify_missing_slot: "generic",
  };
  return (Array.isArray(cards) ? cards : []).map((card) => {
    const source = card && typeof card === "object" && !Array.isArray(card) ? card : {};
    const type = requiredTypeByIntent[canonicalIntent] || legacyTypeMap[source.type] || source.type || "generic";
    return Object.assign({}, source, { type });
  });
}

function isPlainOfflineIntent(canonicalIntent, source) {
  const intentName = String(
    (source && source.metrics && source.metrics.intentName)
    || (source && source.presentationMode)
    || canonicalIntent
    || ""
  );
  return /smalltalk|conversational|project_qa|chitchat|greeting|plain/i.test(intentName)
    || source && source.presentationMode === "plain";
}

function standardizeClientFallback(response, message, route, reason, metadata) {
  const source = response && typeof response === "object" ? response : {};
  const canonicalIntent = resolveOfflineCanonicalIntent(message, route, source);
  const fallbackReason = safeText(reason || "CLIENT_OFFLINE_FALLBACK", 120);
  const plain = isPlainOfflineIntent(canonicalIntent, source);
  const meta = metadata || {};
  const localCards = plain ? [] : canonicalizeFallbackCards(source.cards, canonicalIntent).map((card) => {
    const badges = Array.isArray(card.badges) ? card.badges.filter(Boolean) : [];
    return Object.assign({}, card, {
      badges: ["本机结果"].concat(badges.filter((badge) => badge !== "本机结果")).slice(0, 3),
    });
  });
  return Object.assign({}, source, {
    protocolVersion: "agent.v2",
    requestId: meta.requestId,
    conversationId: meta.conversationId,
    // 离线应答没有真实 Run：不得伪造 runId，也不得伪造 run 步骤列表。
    runId: "",
    status: source.success === false ? "failed" : "degraded",
    success: source.success !== false,
    fallback: true,
    fallbackLayer: "client",
    fallbackReason,
    resultOrigin: "local_device",
    resultLabel: "本机结果",
    recoveryAction: {
      label: "联网后重新执行",
      type: "retry",
      payload: { message: safeText(message, 600) },
    },
    // Product UX: plain offline greetings must not show task Evidence chrome
    presentationMode: plain ? "plain" : (source.presentationMode || ""),
    evidence: plain ? null : normalizeOfflineEvidence(source.evidence),
    externalProviderUsed: false,
    intent: canonicalIntent,
    confidence: Number(route && route.confidence || 0),
    slots: Object.assign({}, route && route.entities || {}),
    skill: {
      id: OFFLINE_SKILL_BY_INTENT[canonicalIntent] || "knowledge_search",
      version: "1.0.0",
    },
    plan: [],
    steps: [],
    observations: [],
    cards: localCards,
    suggestions: Array.isArray(source.suggestions) ? source.suggestions.slice(0, 2) : [],
    toolCalls: plain ? [] : (Array.isArray(source.toolCalls) ? source.toolCalls : []),
    safety: Object.assign({}, source.safety || {}, {
      externalProviderUsed: false,
      fallbackReason,
    }),
    metrics: Object.assign({}, source.metrics || {}, {
      canonicalIntent,
      intentName: (source.metrics && source.metrics.intentName) || (plain ? "smalltalk" : canonicalIntent),
      externalProviderUsed: false,
      fallback: true,
      fallbackLayer: "client",
    }),
    errors: source.errors && Array.isArray(source.errors)
      ? source.errors
      : [{ code: fallbackReason }],
    serverTime: "",
  });
}

function buildCachedPersonalScheduleResponse(message, clientContext = {}, route = {}) {
  const summary = clientContext.currentScheduleSummary || {};
  const courses = Array.isArray(summary.courses) ? summary.courses : [];
  if (!summary.enabled || !courses.length) {
    return buildPersonalScheduleClarificationResponse(message, clientContext, route);
  }
  const canonicalIntent = resolveOfflineCanonicalIntent(message, route);
  const currentWeek = Number(clientContext.currentTeachingWeek || 0);
  const todayWeekday = Number(clientContext.todayWeekday || 0);
  let targetWeekday = todayWeekday;
  let targetWeek = currentWeek;
  if (canonicalIntent === "get_tomorrow_courses") {
    targetWeekday = todayWeekday >= 7 ? 1 : todayWeekday + 1;
    if (todayWeekday >= 7 && targetWeek) targetWeek += 1;
  }
  let matched = courses.filter((course) => courseMatchesTeachingWeek(course, targetWeek));
  if (canonicalIntent === "get_today_courses" || canonicalIntent === "get_tomorrow_courses") {
    matched = matched.filter((course) => Number(course.weekday || 0) === targetWeekday);
  } else if (canonicalIntent === "get_next_course") {
    const next = findNextCourseForWeather(clientContext);
    matched = next ? [next] : [];
  }
  matched = matched.slice().sort((left, right) => {
    const weekdayDiff = Number(left.weekday || 0) - Number(right.weekday || 0);
    return weekdayDiff || Number(left.startSection || 0) - Number(right.startSection || 0);
  });
  const label = canonicalIntent === "get_tomorrow_courses"
    ? "明天"
    : (canonicalIntent === "get_week_schedule" ? "本周" : (canonicalIntent === "get_next_course" ? "下一节" : "今天"));
  const items = matched.slice(0, 12).map((course) => ({
    title: safeText(course.courseName || "课程", 80),
    subtitle: [
      Number(course.weekday || 0) ? `周${"一二三四五六日"[Number(course.weekday || 0) - 1] || course.weekday}` : "",
      course.startSection ? `第${course.startSection}-${course.endSection || course.startSection}节` : "",
      safeText(course.classroom || course.roomName, 60),
      safeText(course.teacherName, 40),
    ].filter(Boolean).join(" · "),
    value: "",
  }));
  return {
    success: true,
    answer: matched.length
      ? `已从本机缓存的个人课表中找到${label} ${matched.length} 条课程安排。`
      : `本机缓存的个人课表中没有找到${label}的课程安排。`,
    cards: [{
      type: "personal_schedule",
      title: `${label}个人课表`,
      subtitle: "离线读取本机已缓存课表",
      badges: ["离线降级", "本机缓存"],
      items,
      actions: [],
    }],
    suggestions: ["查看本周课表", "下一节课在哪里", "打开个人课表同步"],
    toolCalls: [{ name: canonicalIntent, status: "success", summary: "读取本机脱敏课表缓存" }],
    evidence: {
      // 本机缓存未经过服务端核验：如实标注，不绕过证据标签降级守卫。
      verified: false,
      complete: false,
      term: clientContext.term || clientContext.selectedTerm || summary.term || "",
      currentWeek: targetWeek || "",
      releaseVersion: clientContext.releaseVersion || "",
      checkedAt: new Date().toISOString(),
      sources: [summary.source || "local-personal-schedule-cache"],
    },
    safety: {
      provider: "local-personal-schedule-cache",
      resolvedProvider: "local-personal-schedule-cache",
      externalProviderUsed: false,
      mode: "offline-fallback",
    },
    metrics: {
      intentName: "personal_schedule",
      canonicalIntent,
      latencyMs: 0,
      externalProviderUsed: false,
      resultCount: matched.length,
      routeConfidence: route.confidence || 0,
    },
  };
}

function oracleAgentChat(message, context, metadata = {}) {
  return request.post("/api/ai/agent/chat", {
    message: redactSensitiveText(message).slice(0, 2000),
    context: context || buildClientContext(),
    protocolVersion: metadata.protocolVersion || "agent.v2",
    requestId: metadata.requestId || "",
    conversationId: metadata.conversationId || "",
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

async function callServerAgent(message, resolvedContext, options = {}) {
  const metadata = options.agentRequest || createAgentRequestMetadata(resolvedContext, options);
  return aiTransportRouter.chat({
    message,
    context: resolvedContext,
    protocolVersion: metadata.protocolVersion,
    requestId: metadata.requestId,
    conversationId: metadata.conversationId,
    oracleChat: oracleAgentChat,
    redactSensitiveText,
    options,
  });
}


// 提醒语义已收回服务端：客户端不再本地解析提醒分钟数、不改写本机偏好、
// 不伪造偏好更新或提醒管理的工具结果。
// 提醒类消息一律走服务端链；离线时按普通降级应答处理（见 offlineChat 兜底）。

async function offlineChat(message, context, options = {}) {
  const resolvedContext = context || buildClientContext();
  const localContext = Object.assign({}, resolvedContext, {
    contextSlots: resolvedContext.contextSlots ||
      resolvedContext.conversation && resolvedContext.conversation.contextSlots ||
      {},
  });
  const callbacks = options && options.callbacks || {};
  const route = xiaofuAgentRouter.routeMessage(message, localContext);
  reportLocalDegradedStatus(callbacks);

  if (route.intent === xiaofuAgentRouter.INTENTS.SCHEDULE_STATUS) {
    return buildScheduleStatusResponse(message, localContext, route);
  }

  if (route.intent === xiaofuAgentRouter.INTENTS.HELP) {
    return buildHelpResponse(message, localContext, route);
  }

  if (route.intent === xiaofuAgentRouter.INTENTS.WEATHER) {
    return buildWeatherResponse(message, localContext, route, callbacks);
  }

  if (route.intent === xiaofuAgentRouter.INTENTS.PERSONAL_SCHEDULE) {
    if (route.shouldUsePersonalScheduleTool) {
      return buildCachedPersonalScheduleResponse(message, localContext, route);
    }
    return buildPersonalScheduleClarificationResponse(message, localContext, route);
  }

  if (route.intent === xiaofuAgentRouter.INTENTS.APP_NAVIGATION) {
    const navigationResponse = ragAnswerBuilder.tryBuildContextNavigationAnswer(message, localContext);
    if (navigationResponse) return navigationResponse;
    return buildAppNavigationResponse(message, localContext, route);
  }

  if (route.intent === xiaofuAgentRouter.INTENTS.SCHEDULE_QUERY) {
    if (route.shouldUsePersonalScheduleTool) {
      return buildCachedPersonalScheduleResponse(message, localContext, route);
    }
    const scheduleResponse = await scheduleAssistantService.tryHandleScheduleQuery(message, localContext);
    if (scheduleResponse) return scheduleResponse;
  }

  if (route.intent === xiaofuAgentRouter.INTENTS.SCHOOL_KNOWLEDGE) {
    const navigationResponse = ragAnswerBuilder.tryBuildContextNavigationAnswer(message, localContext);
    if (navigationResponse) return navigationResponse;
    const knowledgeResponse = ragAnswerBuilder.tryBuildKnowledgeAnswer(message, localContext);
    if (knowledgeResponse) return knowledgeResponse;
    return buildSmalltalkResponse(message, localContext, route);
  }

  if (route.intent === xiaofuAgentRouter.INTENTS.NAVIGATION) {
    const navigationResponse = ragAnswerBuilder.tryBuildKnowledgeAnswer(message, localContext, {
      preferredEntryType: "navigation",
      intentName: "navigation",
    });
    if (navigationResponse) return navigationResponse;
  }

  return buildSmalltalkResponse(message, localContext, route);
}

function isOfflineNetworkRequiredTask(message) {
  const text = String(message || "").trim();
  if (!text) return false;
  return /(总结|分析|改写|翻译).*(论文|文件|链接|网页|附件)|(?:发送|发).*(邮件|短信|消息)|(?:生成|写).*(代码|长文|报告|申请书)/i.test(text);
}

function getLocalCapabilityStatus(context = {}) {
  const summary = context.currentScheduleSummary || {};
  const courses = Array.isArray(summary.courses) ? summary.courses : [];
  const capabilities = [];
  if (summary.enabled === true && courses.length) capabilities.push("personal_schedule");
  if (safeText(context.releaseVersion || context.release && context.release.releaseVersion, 96)) {
    capabilities.push("cached_release_pack");
  }
  if (Number(context.currentTeachingWeek || 0) > 0) capabilities.push("cached_teaching_week");
  const canExecute = capabilities.length > 0;
  return {
    canExecute,
    capabilities,
    statusText: canExecute ? "网络异常 · 本地可用" : "离线 · 仅可查看已缓存页面",
    detailText: canExecute
      ? "可继续使用本机课表、已缓存 Release Pack 与确定性校园入口；联网任务可稍后重试。"
      : "未检测到可执行的本机数据工具；仍可打开页面查看已有缓存，联网任务不会被伪装成成功。",
  };
}

function buildOfflineNetworkRequiredResponse(message) {
  return {
    success: false,
    status: "failed",
    answer: "这个任务需要联网并由服务端安全执行；当前只能使用本机已缓存的校园能力。网络恢复后可一键重新执行原问题。",
    cards: [{
      type: "generic",
      variant: "error",
      title: "此任务需要联网",
      subtitle: "未生成内容，也没有伪装成服务端任务。",
      badges: ["未执行"],
      items: [],
      actions: [],
    }],
    suggestions: ["打开全校课表", "打开空教室"],
    toolCalls: [],
    evidence: null,
    externalProviderUsed: false,
    errors: [{ code: "LOCAL_TASK_REQUIRES_NETWORK" }],
    safety: {
      provider: "local-device",
      resolvedProvider: "local-device",
      externalProviderUsed: false,
      mode: "offline-fallback",
    },
    metrics: {
      intentName: "offline_network_required",
      canonicalIntent: "conversational_help",
      latencyMs: 0,
      externalProviderUsed: false,
      resultCount: 0,
    },
  };
}

function isCompatibleAgentResponse(response) {
  return Boolean(
    response &&
    typeof response === "object" &&
    agentCapabilityCompat.PROTOCOL_VERSIONS.indexOf(response.protocolVersion) >= 0
  );
}

function isClientFallbackTransportError(error) {
  const code = String(error && (error.code || error.reasonCode || error.legacyCode) || "").toUpperCase();
  if ([
    "NETWORK",
    "NETWORK_UNAVAILABLE",
    "NETWORK_OFFLINE",
    "DNS_FAILED",
    "TLS_FAILED",
    "WECHAT_DOMAIN_NOT_ALLOWED",
    "WECHAT_NETWORK_REQUEST_FAILED",
    "CONNECT_TIMEOUT",
    "TIMEOUT",
    "REQUEST_TIMEOUT",
    "HTTP_5XX",
    "SERVICE_UNAVAILABLE",
    "ECONNRESET",
    "ECONNREFUSED",
    // Run 契约破坏（应答缺 runId 等服务端失败类）：与旧 agentRunClient 同码，
    // 走离线降级而不是把异常直接抛给页面。
    "RUN_CREATE_FAILED",
    "AGENT_SDK_RUN_ID_MISSING",
  ].indexOf(code) >= 0) return true;
  if (code) return false;
  if (typeof wx === "undefined" || typeof wx.request !== "function") return true;
  const message = String(error && (error.message || error.errMsg) || "").toLowerCase();
  return /network|timeout|timed out|unavailable|offline|网络|超时|服务不可用/.test(message);
}

function resolveServerFallbackReason(response) {
  const firstError = response && Array.isArray(response.errors) ? response.errors[0] : null;
  return safeText(
    response && response.fallbackReason ||
    firstError && (firstError.code || firstError.message) ||
    "SERVER_FALLBACK_ALLOWED",
    120
  );
}

function normalizeOnlineAgentResponse(response) {
  const source = response || {};
  const rawIntent = typeof source.intent === "string"
    ? source.intent
    : source.intent && source.intent.name || source.metrics && (source.metrics.canonicalIntent || source.metrics.intentName);
  const canonicalIntent = agentCapabilityCompat.toCanonicalIntent(rawIntent);
  const externalProviderUsed = source.externalProviderUsed === true ||
    source.safety && source.safety.externalProviderUsed === true ||
    source.metrics && source.metrics.externalProviderUsed === true;
  return Object.assign({}, source, {
    externalProviderUsed,
    metrics: Object.assign({}, source.metrics || {}, {
      canonicalIntent,
      externalProviderUsed,
    }),
  });
}

async function buildClientFallback(message, resolvedContext, options, metadata, reason) {
  const localContext = Object.assign({}, resolvedContext, {
    contextSlots: resolvedContext.contextSlots ||
      resolvedContext.conversation && resolvedContext.conversation.contextSlots ||
      {},
  });
  const route = xiaofuAgentRouter.routeMessage(message, localContext);
  let response;
  try {
    response = isOfflineNetworkRequiredTask(message)
      ? buildOfflineNetworkRequiredResponse(message)
      : await offlineChat(message, resolvedContext, Object.assign({}, options, {
        offlineReason: reason,
      }));
  } catch (offlineError) {
    response = buildSmalltalkResponse(message, localContext, route);
    response.answer = "当前服务端和本地数据工具暂时不可用。你仍可打开课表、个人课表同步、校园地图或空教室页面查看已缓存内容。";
    response.suggestions = ["打开全校课表", "打开个人课表同步", "打开校园地图"];
  }
  return standardizeClientFallback(response, message, route, reason, metadata);
}

function buildClientFallbackForTest(message, context, reason) {
  const resolvedContext = context || buildClientContext();
  const metadata = createAgentRequestMetadata(resolvedContext, {});
  return buildClientFallback(message, resolvedContext, {}, metadata, reason || "NETWORK_UNAVAILABLE");
}

async function chat(message, context, options = {}) {
  const resolvedContext = context || buildClientContext();
  const metadata = createAgentRequestMetadata(resolvedContext, options);
  let serverResponse;
  try {
    serverResponse = await callServerAgent(message, resolvedContext, Object.assign({}, options, {
      agentRequest: metadata,
    }));
  } catch (error) {
    // Only transport/network/5xx fall into offline tools; client/server 4xx must surface.
    if (!isClientFallbackTransportError(error)) throw error;
    const reason = safeText(error && (error.code || error.reasonCode || error.legacyCode), 120) || "NETWORK_UNAVAILABLE";
    // 提醒等写语义不在离线路径本地处理；统一走纯降级缓存应答。
    return buildClientFallback(message, resolvedContext, options, metadata, reason);
  }

  // Client credential blocking is itself the terminal safe response and never
  // crossed the server boundary.
  if (serverResponse && serverResponse.fallbackLayer === "client") {
    return normalizeOnlineAgentResponse(serverResponse);
  }

  if (!isCompatibleAgentResponse(serverResponse)) {
    return buildClientFallback(message, resolvedContext, options, metadata, "PROTOCOL_INCOMPATIBLE");
  }

  if (serverResponse.fallbackAllowed === true) {
    return buildClientFallback(
      message,
      resolvedContext,
      options,
      metadata,
      resolveServerFallbackReason(serverResponse)
    );
  }

  return normalizeOnlineAgentResponse(serverResponse);
}

module.exports = {
  ALLOW_PERSONAL_CONTEXT_KEY,
  AUTO_MEMORY_ENABLED_KEY,
  HISTORY_KEY,
  LAST_IMPORT_CONTEXT_KEY,
  PENDING_CLARIFICATION_KEY,
  USER_PREFERENCES_KEY,
  buildClientContext,
  buildClientFallbackForTest,
  buildProactiveWorkspace,
  buildSmalltalkResponse,
  standardizeClientFallback,
  chat,
  clearPendingClarification,
  clearAiHistory,
  clearPersonalization,
  clearUserPreferences,
  deleteUserPreference,
  setUserPreference,
  formatLocalIsoWithOffset,
  getAiHistory,
  getLocalCapabilityStatus,
  getLatestScheduleImport,
  getPendingClarification,
  getRememberedPersonalization,
  getUserPreferences,
  getUserPreferenceItems,
  hasUsableAgentAnswer,
  isAiEnhancedClientEnv,
  isAutoMemoryEnabled,
  isPersonalContextAllowed,
  isStructuredLocalHelp,
  offlineChat,
  pausePersonalization,
  pickResponseVariant,
  redactSensitiveText,
  rememberLatestScheduleImport,
  saveUserPreferences,
  sanitizeCourse,
  sanitizeLocalScheduleForAI,
  setPendingClarification,
  setPersonalContextAllowed,
  saveAiHistory,
};
