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
const { courseTimes } = require("../data/courseTimes");
const {
  getTodayTeachingInfo,
  getTodayWeekday,
} = require("../utils/week");

const HISTORY_KEY = "FOSU_AI_ASSISTANT_HISTORY";
const ALLOW_PERSONAL_CONTEXT_KEY = "FOSU_AI_ALLOW_PERSONAL_CONTEXT";
const LAST_IMPORT_CONTEXT_KEY = "FOSU_AI_LAST_IMPORT_CONTEXT";
const PENDING_CLARIFICATION_KEY = "FOSU_AI_PENDING_CLARIFICATION";
const USER_PREFERENCES_KEY = "FOSU_AI_USER_PREFERENCES";
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

function normalizeUserPreferences(value) {
  const source = value && typeof value === "object" && !Array.isArray(value) ? value : {};
  const campus = ["仙溪校区", "江湾校区"].indexOf(source.campus) >= 0 ? source.campus : "";
  const favoriteBuildings = Array.isArray(source.favoriteBuildings)
    ? source.favoriteBuildings
        .map((item) => redactSensitiveText(item).trim().slice(0, 40))
        .filter(Boolean)
        .slice(0, 8)
    : [];
  const duration = Number(source.defaultEmptyRoomDurationSections);
  const answerDetail = ["brief", "normal", "detailed"].indexOf(source.answerDetail) >= 0
    ? source.answerDetail
    : "normal";
  return {
    campus,
    favoriteBuildings,
    defaultEmptyRoomDurationSections: Number.isFinite(duration) && duration > 0 ? Math.min(12, Math.max(1, Math.round(duration))) : 2,
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

function getMiniProgramEnvVersion() {
  try {
    if (wx && typeof wx.getAccountInfoSync === "function") {
      const accountInfo = wx.getAccountInfoSync() || {};
      return accountInfo.miniProgram && accountInfo.miniProgram.envVersion || "";
    }
  } catch (error) {
    // DevTools mocks may not expose account info.
  }
  return "";
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
    timezone: "Asia/Shanghai",
    currentScheduleSummary: scheduleSummary,
    latestScheduleImport: latestImport,
    pendingClarification: getPendingClarification(),
    userPreferences,
    conversation: {
      conversationId,
      contextSlots,
    },
    contextSlots,
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
    "我理解你是在问课表数据状态，不是在查某个班级、老师、教室或课程。",
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
          { label: "复制状态", type: "copy", payload: { text: answer } },
        ],
      },
    ],
    suggestions: ["查班级本周课表", "现在用的是哪个学期数据", "小佛能做什么"],
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
  const isFloatHelp = /小佛AI浮窗|小佛浮窗|浮窗/.test(value);
  const card = isFloatHelp
    ? {
        type: "help",
        title: "小佛AI浮窗",
        subtitle: "可点击、拖拽、隐藏或关闭",
        badges: ["使用帮助", "浮窗"],
        items: [
          { title: "打开方式", subtitle: "单击浮窗会打开 AI校园管家；拖动后会吸附到左右边缘", value: "" },
          { title: "关闭与开启", subtitle: "AI 管家右上角更多操作里可以开启或关闭浮窗", value: "" },
          { title: "长按菜单", subtitle: "可打开小佛AI、隐藏本页或关闭浮窗", value: "" },
        ],
        actions: [
          { label: "复制说明", type: "copy", payload: { text: "小佛AI浮窗可单击打开、拖拽吸附、长按打开菜单；可在 AI 管家更多操作中开启或关闭。" } },
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
          { title: "导入方式", subtitle: "从个人课表导入入口了解 XLS 导入方式", value: "" },
          { title: "安全提醒", subtitle: "不要在聊天框输入学号、密码或登录凭证", value: "" },
        ],
        actions: [
          { label: "打开导入入口", type: "navigate", url: "/pages/personal-sync/personal-sync?tab=xls" },
          { label: "复制导入说明", type: "copy", payload: { text: "打开个人课表导入入口，按页面提示使用 XLS 导入。不要在聊天框输入学号、密码或登录凭证。" } },
        ],
      }
    : isDataSourceHelp
      ? {
          type: "help",
          title: "数据来源说明",
          subtitle: "课表状态读运行时字段，校园知识读本地知识库",
          badges: ["使用帮助", "数据边界"],
          items: [
            { title: "全校课表", subtitle: "优先读取项目内 Release Pack、学期、版本、缓存和更新时间字段", value: "" },
            { title: "校园知识", subtitle: "只回答知识库收录的佛山大学公开信息和本地入口说明", value: "" },
            { title: "缺少来源时", subtitle: "会说明知识库暂未收录可靠信息，不编造电话、地址、制度或入口", value: "" },
          ],
          actions: [
            { label: "复制说明", type: "copy", payload: { text: "课表状态读取项目内真实字段；校园知识只回答已收录来源。缺少可靠来源时不会编造电话、地址、制度或入口。" } },
          ],
        }
    : {
        type: "help",
        title: "小佛可以帮你",
        subtitle: "校园知识、全校课表、数据状态和使用指引",
        badges: ["使用说明", "当前对话内回答"],
        items: [
          { title: "查全校课表", subtitle: "可以查班级、教师、教室或课程安排", value: "" },
          { title: "问校园事项", subtitle: "例如：佛大有哪些校区、教务系统在哪里进", value: "" },
          { title: "看数据状态", subtitle: "例如：课表数据是否最新、现在用的是哪个学期数据", value: "" },
          { title: "上下文追问", subtitle: "查到一个对象后，可以继续问“那周三呢”“换成另一个班级”。", value: "" },
        ],
        actions: [
          { label: "打开全校课表", type: "navigate", url: "/pages/school/school" },
          { label: "复制说明", type: "copy", payload: { text: "小佛AI可以查全校课表、说明课表数据状态、回答已收录校园知识、提供常用入口、导入个人课表帮助，以及天气出行提醒。" } },
        ],
      };
  return {
    answer: isFloatHelp
      ? "小佛AI浮窗已可通过更多操作开启或关闭。单击会打开 AI校园管家，拖拽会吸附到左右边缘，长按可以打开菜单。"
      : isImportHelp
      ? "我理解你想了解如何导入个人课表。导入后，小佛才能回答“今天有什么课”“明天有什么课”“下一节课在哪里”这类个人安排问题。"
      : (isDataSourceHelp
        ? "我理解你是在问数据来源说明。课表状态会读取项目内真实字段，校园知识只使用已收录来源；缺少可靠来源时不会编造。"
        : "我理解你是在问小佛能做什么。你可以问校园事项，也可以查全校课表；涉及课表时，请尽量说清楚班级、老师、教室或课程。"),
    cards: [
      card,
    ],
    suggestions: isFloatHelp
      ? ["关闭小佛AI浮窗", "打开小佛AI", "小佛能做什么"]
      : isImportHelp
      ? ["今天有什么课", "查班级本周课表", "课表数据更新到什么时候"]
      : (isDataSourceHelp
        ? ["课表数据更新到什么时候", "教务系统在哪里", "佛大有哪些校区"]
        : ["查班级本周课表", "教务系统在哪里", "课表数据是否最新"]),
    toolCalls: [{ name: "clarify_missing_slot", status: "success" }],
    evidence: {
      verified: true,
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
        { label: "复制入口", type: "copy", payload: { text: target.url } },
      ]
    : [];
  return {
    answer: `我理解你想打开${target.label || "相关功能"}。入口放在这条回复里，当前回答仍保留在对话中。`,
    cards: [
      {
        type: "navigation",
        title: target.label || "应用入口",
        subtitle: "从当前对话打开",
        badges: ["应用入口"],
        items: [
          { title: "入口", subtitle: target.label || "", value: "" },
        ],
        actions,
      },
    ],
    suggestions: ["小佛能做什么", "课表数据是否最新"],
    toolCalls: [{ name: "clarify_missing_slot", status: "success" }],
    evidence: {
      verified: true,
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
    answer: "我理解你是在问个人课表安排。当前对话里还没有可用的个人课表，也没有明确的班级、老师或教室；你可以先导入个人课表，或告诉我要查哪个对象。",
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
          { label: "导入个人课表", type: "navigate", url: "/pages/personal-sync/personal-sync?tab=xls" },
          { label: "复制导入说明", type: "copy", payload: { text: "打开个人课表导入入口，按页面提示使用 XLS 导入。导入后可问今天、明天、本周和下一节课。" } },
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

function reportPipelineStatus(callbacks, text, type) {
  if (callbacks && typeof callbacks.onStatus === "function" && text) {
    callbacks.onStatus({ type: type || "status", text });
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
    return `我理解你是在问${weatherPayload.campus}天气。${weatherPayload.advice}`;
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
    `我理解你是在问${weatherPayload.campus}天气。${weatherPayload.targetLabel || "今天"}${weatherPayload.weatherText}，温度 ${weatherPayload.temperatureText}，${rainText}。`,
    nextCourseText,
    weatherPayload.advice,
  ].filter(Boolean).join("\n");
}

function buildWeatherCard(weatherPayload) {
  const adviceText = `${weatherPayload.campus}${weatherPayload.targetLabel || "今天"}天气：${weatherPayload.weatherText}，温度 ${weatherPayload.temperatureText}，降雨 ${weatherPayload.rainProbabilityText}。${weatherPayload.advice}`;
  return {
    type: "weather_card",
    variant: weatherPayload.success ? "" : "error",
    title: `${weatherPayload.campus}天气`,
    subtitle: weatherPayload.success ? weatherPayload.weatherText : "天气数据暂不可用",
    badges: ["天气", weatherPayload.success ? "实时信息" : "数据暂不可用"].concat(weatherPayload.cached ? ["最近数据"] : []),
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
          { label: "复制天气建议", type: "copy", payload: { text: adviceText } },
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
  reportPipelineStatus(callbacks, "正在查询天气…", "weather");
  const nextCourse = entities.needsPersonalSchedule ? findNextCourseForWeather(clientContext) : null;
  if (entities.needsPersonalSchedule) {
    reportPipelineStatus(callbacks, "正在查询课表数据…", "schedule");
  }
  const weather = await weatherProvider.getCampusWeather({
    campus: entities.campus || entities.location || "",
    message,
    dateHint: entities.dateHint || "",
    topic: entities.topic || "",
  });
  reportPipelineStatus(callbacks, "正在整理结果…", "compose");
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

function buildSmalltalkResponse(message, clientContext = {}, route = {}) {
  const compact = String(message || "").replace(/\s+/g, "");
  const answer = /^谢谢|^感谢/.test(compact)
    ? "不客气。我会把普通聊天和校园工具分开处理，不会把这类话当成课表对象。"
    : "可以，我们就用普通话聊。需要查校园事项时，直接说清楚问题；需要查课表时，再告诉我班级、老师、教室或课程。";
  return {
    answer,
    cards: [],
    suggestions: ["佛大有哪些校区", "查班级本周课表", "课表数据是否最新"],
    toolCalls: [],
    evidence: {
      verified: false,
      checkedAt: new Date().toISOString(),
      source: "local-smalltalk",
    },
    safety: {
      provider: "smalltalk-handler",
      resolvedProvider: "smalltalk-handler",
      externalProviderUsed: false,
      mode: "tool-grounded",
      clearPendingClarification: true,
    },
    metrics: {
      intentName: "smalltalk",
      latencyMs: 0,
      externalProviderUsed: false,
      resultCount: 0,
      routeConfidence: route.confidence || 0,
    },
  };
}

function oracleAgentChat(message, context) {
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

async function chat(message, context, options = {}) {
  const resolvedContext = context || buildClientContext();
  const localContext = Object.assign({}, resolvedContext, {
    contextSlots: resolvedContext.contextSlots ||
      resolvedContext.conversation && resolvedContext.conversation.contextSlots ||
      {},
  });
  const callbacks = options && options.callbacks || {};
  const route = xiaofuAgentRouter.routeMessage(message, localContext);
  reportPipelineStatus(callbacks, "正在理解你的问题…", "understand");

  if (route.intent === xiaofuAgentRouter.INTENTS.SCHEDULE_STATUS) {
    reportPipelineStatus(callbacks, "正在查询课表数据…", "schedule");
    reportPipelineStatus(callbacks, "正在整理结果…", "compose");
    return buildScheduleStatusResponse(message, localContext, route);
  }

  if (route.intent === xiaofuAgentRouter.INTENTS.HELP) {
    reportPipelineStatus(callbacks, "正在查找使用说明…", "help");
    reportPipelineStatus(callbacks, "正在整理结果…", "compose");
    return buildHelpResponse(message, localContext, route);
  }

  if (route.intent === xiaofuAgentRouter.INTENTS.WEATHER) {
    return buildWeatherResponse(message, localContext, route, callbacks);
  }

  if (route.intent === xiaofuAgentRouter.INTENTS.PERSONAL_SCHEDULE) {
    reportPipelineStatus(callbacks, "正在查询课表数据…", "schedule");
    if (route.shouldUsePersonalScheduleTool) {
      return aiTransportRouter.chat({
        message,
        context: resolvedContext,
        history: getAiHistory(resolvedContext.conversation && resolvedContext.conversation.conversationId),
        oracleChat: oracleAgentChat,
        redactSensitiveText,
        options,
      });
    }
    reportPipelineStatus(callbacks, "正在整理结果…", "compose");
    return buildPersonalScheduleClarificationResponse(message, localContext, route);
  }

  if (route.intent === xiaofuAgentRouter.INTENTS.APP_NAVIGATION) {
    reportPipelineStatus(callbacks, "正在查找入口…", "navigation");
    const navigationResponse = ragAnswerBuilder.tryBuildContextNavigationAnswer(message, localContext);
    if (navigationResponse) return navigationResponse;
    reportPipelineStatus(callbacks, "正在整理结果…", "compose");
    return buildAppNavigationResponse(message, localContext, route);
  }

  if (route.intent === xiaofuAgentRouter.INTENTS.SCHEDULE_QUERY) {
    reportPipelineStatus(callbacks, "正在查询课表数据…", "schedule");
    if (route.shouldUsePersonalScheduleTool) {
      return aiTransportRouter.chat({
        message,
        context: resolvedContext,
        history: getAiHistory(resolvedContext.conversation && resolvedContext.conversation.conversationId),
        oracleChat: oracleAgentChat,
        redactSensitiveText,
        options,
      });
    }
    const scheduleResponse = await scheduleAssistantService.tryHandleScheduleQuery(message, localContext);
    if (scheduleResponse) return scheduleResponse;
  }

  if (route.intent === xiaofuAgentRouter.INTENTS.SCHOOL_KNOWLEDGE) {
    reportPipelineStatus(callbacks, "正在检索校园知识…", "knowledge");
    const navigationResponse = ragAnswerBuilder.tryBuildContextNavigationAnswer(message, localContext);
    if (navigationResponse) return navigationResponse;
    const knowledgeResponse = ragAnswerBuilder.tryBuildKnowledgeAnswer(message, localContext);
    if (knowledgeResponse) return knowledgeResponse;
  }

  if (route.intent === xiaofuAgentRouter.INTENTS.NAVIGATION) {
    reportPipelineStatus(callbacks, "正在查找入口…", "navigation");
    const navigationResponse = ragAnswerBuilder.tryBuildKnowledgeAnswer(message, localContext, {
      preferredEntryType: "navigation",
      intentName: "navigation",
    });
    if (navigationResponse) return navigationResponse;
  }

  if (route.intent === xiaofuAgentRouter.INTENTS.SMALLTALK) {
    reportPipelineStatus(callbacks, "正在整理结果…", "compose");
    return buildSmalltalkResponse(message, localContext, route);
  }

  return aiTransportRouter.chat({
    message,
    context: resolvedContext,
    history: getAiHistory(resolvedContext.conversation && resolvedContext.conversation.conversationId),
    oracleChat: oracleAgentChat,
    redactSensitiveText,
    options,
  });
}

module.exports = {
  ALLOW_PERSONAL_CONTEXT_KEY,
  HISTORY_KEY,
  LAST_IMPORT_CONTEXT_KEY,
  PENDING_CLARIFICATION_KEY,
  USER_PREFERENCES_KEY,
  buildClientContext,
  chat,
  clearPendingClarification,
  clearAiHistory,
  clearPersonalization,
  clearUserPreferences,
  formatLocalIsoWithOffset,
  getAiHistory,
  getLatestScheduleImport,
  getPendingClarification,
  getRememberedPersonalization,
  getUserPreferences,
  isPersonalContextAllowed,
  pausePersonalization,
  redactSensitiveText,
  rememberLatestScheduleImport,
  saveUserPreferences,
  sanitizeCourse,
  sanitizeLocalScheduleForAI,
  setPendingClarification,
  setPersonalContextAllowed,
  saveAiHistory,
};
