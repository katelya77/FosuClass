const MAX_CONTEXT_COURSES = Math.max(1, Math.min(80, Number(process.env.AI_MAX_CONTEXT_COURSES || 80) || 80));
const REDACTED = "[已脱敏]";

const TEXT_REDACTION_PATTERNS = [
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

const SENSITIVE_KEY_PATTERN = /(password|passwd|pwd|studentId|student_id|studentName|cookie|jsessionid|ticket|authorization|token|secret|apiKey|api_key|base64|fileContent|rawFile|credential|openid|session)/i;
const PERSONAL_TARGET_TYPES = new Set(["personal", "personal-xls", "personal-login", "account", "student-login", "xls", "self", "mine", "local-personal"]);
const PUBLIC_TARGET_TYPES = new Set(["class", "teacher", "classroom", "course", "school", "public"]);
const DETECTION_PATTERNS = [
  /(?:password|passwd|pwd|密码|口令)\s*[:：=是为]?\s*(?!\[已脱敏\]|\[REDACTED\])[^\s，。；;,&]{2,}/i,
  /(?:authorization)\s*[:：=]\s*(?:bearer\s+)?(?!\[已脱敏\]|\[REDACTED\])[A-Za-z0-9._~+/=-]{8,}/i,
  /\bBearer\s+(?!\[已脱敏\]|\[REDACTED\])[A-Za-z0-9._~+/=-]{8,}/i,
  /(?:cookie|jsessionid|ticket|token|secret|api[-_\s]?key)\s*[:：=]\s*(?!\[已脱敏\]|\[REDACTED\])[^\s，。；;,&]{2,}/i,
  /(?:学号|studentId|student_id)\s*[:：=是为]?\s*(?!\[已脱敏\]|\[REDACTED\])\d{6,16}/i,
  /\b\d{17}[\dXx]\b/,
  /\b1[3-9]\d{9}\b/,
  /\b\d{10,14}\b/,
  /data:[a-z0-9.+/-]+;base64,[A-Za-z0-9+/=]{80,}/i,
  /\b[A-Za-z0-9+/]{160,}={0,2}\b/,
];

function redactSensitiveText(text) {
  if (text === null || text === undefined) return "";
  let output = String(text);
  TEXT_REDACTION_PATTERNS.forEach((rule) => {
    output = output.replace(rule.pattern, rule.replacement);
  });
  return output;
}

function hasSensitiveCredential(text) {
  const value = String(text || "");
  return redactSensitiveText(value) !== value;
}

function sanitizeString(value, maxLength) {
  const redacted = redactSensitiveText(value);
  const limit = Math.max(0, Number(maxLength || 200) || 200);
  return redacted.length > limit ? `${redacted.slice(0, limit)}...` : redacted;
}

function sanitizeCourse(course) {
  const source = course || {};
  const weeks = Array.isArray(source.weeks)
    ? source.weeks.slice(0, 40).map((item) => Number(item)).filter((item) => Number.isFinite(item))
    : [];
  return {
    courseName: sanitizeString(source.courseName || source.name || "", 80),
    teacherName: sanitizeString(source.teacherName || source.teacher || "", 60),
    classroom: sanitizeString(source.classroom || source.roomName || source.classroomName || "", 80),
    roomName: sanitizeString(source.roomName || source.classroom || source.classroomName || "", 80),
    weekday: Number(source.weekday || 0) || 0,
    startSection: Number(source.startSection || source.sectionStart || 0) || 0,
    endSection: Number(source.endSection || source.sectionEnd || source.startSection || 0) || 0,
    sections: Array.isArray(source.sections)
      ? source.sections.slice(0, 14).map((item) => Number(item)).filter((item) => Number.isFinite(item))
      : [],
    weeks,
    weekText: sanitizeString(source.weekText || "", 80),
    rawWeek: sanitizeString(source.rawWeek || source.rawWeeks || source.weeksText || "", 120),
    weekRange: Array.isArray(source.weekRange)
      ? source.weekRange.slice(0, 2).map((item) => Number(item)).filter((item) => Number.isFinite(item))
      : sanitizeString(source.weekRange || "", 120),
    startWeek: Number.isFinite(Number(source.startWeek)) ? Number(source.startWeek) : undefined,
    endWeek: Number.isFinite(Number(source.endWeek)) ? Number(source.endWeek) : undefined,
    weekType: sanitizeString(source.weekType || "", 20),
    oddEven: sanitizeString(source.oddEven || "", 20),
    isCustom: source.isCustom === true,
    source: sanitizeString(source.source || source.sourceType || "", 40),
    campus: sanitizeString(source.campus || "", 40),
  };
}

function allowPersonalContext() {
  return String(process.env.AI_ALLOW_PERSONAL_CONTEXT || "false").toLowerCase() === "true";
}

function normalizeTargetType(type) {
  return sanitizeString(type || "", 30).toLowerCase();
}

function looksPersonalTargetName(name, targetType) {
  const clean = sanitizeString(name || "", 80).trim();
  const type = normalizeTargetType(targetType);
  if (!clean || PUBLIC_TARGET_TYPES.has(type)) return false;
  if (/个人|本人|我的|本机|导入|xls/i.test(clean)) return true;
  if (/的课表$/.test(clean) && !/班|教室|课程|学院|专业/.test(clean)) return true;
  if (/^[\u4e00-\u9fa5·]{2,4}$/.test(clean) && !/班|楼|室/.test(clean)) return true;
  return false;
}

function redactedPersonalScheduleSummary() {
  return {
    enabled: false,
    targetType: "personal-redacted",
    targetName: "个人课表",
    courses: [],
  };
}

function sanitizeScheduleSummary(summary) {
  const source = summary || {};
  const targetType = normalizeTargetType(source.targetType || source.type || "");
  const rawTargetName = source.targetName || source.name || "";
  const personalName = looksPersonalTargetName(rawTargetName, targetType);
  if (!allowPersonalContext() && (PERSONAL_TARGET_TYPES.has(targetType) || personalName)) {
    return redactedPersonalScheduleSummary();
  }
  const courses = Array.isArray(source.courses)
    ? source.courses.slice(0, MAX_CONTEXT_COURSES).map(sanitizeCourse)
    : [];
  const targetName = personalName
    ? "个人课表"
    : sanitizeString(rawTargetName, 80);
  return {
    enabled: Boolean(source.enabled),
    targetType,
    targetName,
    term: sanitizeString(source.term || source.semester || "", 40),
    source: sanitizeString(source.source || source.sourceText || "", 60),
    importedAt: sanitizeString(source.importedAt || source.updateTime || "", 60),
    courseCount: Number.isFinite(Number(source.courseCount)) ? Number(source.courseCount) : courses.length,
    fingerprint: sanitizeString(source.fingerprint || source.scheduleFingerprint || "", 80),
    courses,
  };
}

function sanitizeLatestScheduleImport(value) {
  const source = value && typeof value === "object" && !Array.isArray(value) ? value : {};
  return {
    at: sanitizeString(source.at || "", 60),
    targetType: sanitizeString(source.targetType || "", 30),
    targetName: looksPersonalTargetName(source.targetName || "", source.targetType) ? "个人课表" : sanitizeString(source.targetName || "", 80),
    term: sanitizeString(source.term || "", 40),
    courseCount: Number.isFinite(Number(source.courseCount)) ? Number(source.courseCount) : 0,
    fingerprint: sanitizeString(source.fingerprint || "", 80),
    source: sanitizeString(source.source || "", 60),
  };
}

function sanitizePendingClarification(value) {
  const source = value && typeof value === "object" && !Array.isArray(value) ? value : {};
  const type = ["teacher", "classroom", "course", "class"].includes(source.type) ? source.type : "";
  if (source.intentName !== "search_school_index" || !type) return null;
  return {
    intentName: "search_school_index",
    type,
    missing: sanitizeString(source.missing || "", 40),
    createdAt: Number.isFinite(Number(source.createdAt)) ? Number(source.createdAt) : 0,
    expiresAt: Number.isFinite(Number(source.expiresAt)) ? Number(source.expiresAt) : 0,
  };
}

function sanitizeContextSlots(value) {
  const source = value && typeof value === "object" && !Array.isArray(value) ? value : {};
  return {
    lastIntent: sanitizeString(source.lastIntent || "", 80),
    lastTargetType: sanitizeString(source.lastTargetType || "", 30),
    lastTargetName: sanitizeString(source.lastTargetName || "", 80),
    lastWeek: Number.isFinite(Number(source.lastWeek)) ? Number(source.lastWeek) : 0,
    lastWeekday: Number.isFinite(Number(source.lastWeekday)) ? Number(source.lastWeekday) : 0,
    lastQueryResult: typeof source.lastQueryResult === "string" ? sanitizeString(source.lastQueryResult, 120) : "",
    lastSource: sanitizeString(source.lastSource || "", 60),
  };
}

function sanitizeUserPreferences(value) {
  const source = value && typeof value === "object" && !Array.isArray(value) ? value : {};
  const campus = ["仙溪校区", "江湾校区"].includes(source.campus) ? source.campus : "";
  const preferredName = sanitizeString(source.preferredName || "", 24).replace(/[，。！？,.!?]+$/g, "");
  const favoriteBuildings = Array.isArray(source.favoriteBuildings)
    ? source.favoriteBuildings.map((item) => sanitizeString(item, 40)).filter(Boolean).slice(0, 8)
    : [];
  const duration = Number(source.defaultEmptyRoomDurationSections);
  const reminderLead = Number(source.defaultReminderLeadMinutes);
  const answerDetail = ["brief", "normal", "detailed"].includes(source.answerDetail) ? source.answerDetail : "normal";
  return {
    conversationId: sanitizeString(source.conversationId || source.conversation && source.conversation.conversationId || "", 80),
    protocolVersion: sanitizeString(source.protocolVersion || "", 24),
    preferredName: /^[\u3400-\u9fffA-Za-z0-9·\-\s]{1,24}$/.test(preferredName) ? preferredName : "",
    campus,
    favoriteBuildings,
    defaultEmptyRoomDurationSections: Number.isFinite(duration) && duration > 0 ? Math.min(12, Math.max(1, Math.round(duration))) : 2,
    defaultReminderLeadMinutes: Number.isFinite(reminderLead) && reminderLead >= 5 && reminderLead <= 180
      ? Math.round(reminderLead)
      : 20,
    allowMinimalScheduleSummary: source.allowMinimalScheduleSummary === true,
    answerDetail,
    weatherAdviceEnabled: source.weatherAdviceEnabled !== false,
    localOnly: source.localOnly !== false,
  };
}

function sanitizeRecentMessages(value) {
  const list = Array.isArray(value) ? value : [];
  return list.slice(-8).map((item) => {
    const source = item && typeof item === "object" && !Array.isArray(item) ? item : {};
    return {
      role: source.role === "user" ? "user" : "assistant",
      content: redactSensitiveText(source.content || source.text || "").slice(0, 400),
    };
  }).filter((item) => item.content);
}

function sanitizeAgentContext(context) {
  const source = context && typeof context === "object" && !Array.isArray(context) ? context : {};
  const memoryMode = ["local_only", "session_state", "cloud_sync"].includes(source.memoryMode)
    ? source.memoryMode
    : "local_only";
  return {
    conversationId: sanitizeString(source.conversationId || source.conversation && source.conversation.conversationId || "", 80),
    protocolVersion: sanitizeString(source.protocolVersion || "", 24),
    memoryMode,
    cloudSyncEnabled: memoryMode === "cloud_sync" && source.cloudSyncEnabled === true,
    conversationSummary: redactSensitiveText(source.conversationSummary || "").slice(0, 400),
    recentMessages: sanitizeRecentMessages(source.recentMessages),
    term: sanitizeString(source.term || source.semester || "", 40),
    releaseVersion: sanitizeString(source.releaseVersion || source.version || "", 80),
    envVersion: sanitizeString(source.envVersion || source.miniprogramVersion || "", 24),
    miniprogramVersion: sanitizeString(source.miniprogramVersion || source.envVersion || "", 24),
    runtimeMode: sanitizeString(source.runtimeMode || "", 24),
    currentPage: sanitizeString(source.currentPage || "", 40),
    clientTime: sanitizeString(source.clientTime || "", 60),
    clientLocalTime: sanitizeString(source.clientLocalTime || "", 60),
    timezoneOffsetMinutes: Number.isFinite(Number(source.timezoneOffsetMinutes)) ? Number(source.timezoneOffsetMinutes) : undefined,
    clientTimestampMs: Number.isFinite(Number(source.clientTimestampMs)) ? Number(source.clientTimestampMs) : undefined,
    assistantRuntimeRequestedAt: sanitizeString(source.assistantRuntimeRequestedAt || "", 60),
    assistantRuntimeCacheBust: sanitizeString(source.assistantRuntimeCacheBust || "", 80),
    assistantRuntimeMaxAgeMs: Number.isFinite(Number(source.assistantRuntimeMaxAgeMs)) ? Number(source.assistantRuntimeMaxAgeMs) : undefined,
    timezone: sanitizeString(source.timezone || "Asia/Shanghai", 40),
    currentTeachingWeek: Number.isFinite(Number(source.currentTeachingWeek)) ? Number(source.currentTeachingWeek) : undefined,
    todayWeekday: Number.isFinite(Number(source.todayWeekday)) ? Number(source.todayWeekday) : undefined,
    todayDate: sanitizeString(source.todayDate || "", 40),
    termStartDate: sanitizeString(source.termStartDate || "", 40),
    totalWeeks: Number.isFinite(Number(source.totalWeeks)) ? Number(source.totalWeeks) : undefined,
    semesterText: sanitizeString(source.semesterText || "", 80),
    todayTeachingInfo: source.todayTeachingInfo && typeof source.todayTeachingInfo === "object" && !Array.isArray(source.todayTeachingInfo)
      ? {
        weekNo: Number.isFinite(Number(source.todayTeachingInfo.weekNo)) ? Number(source.todayTeachingInfo.weekNo) : undefined,
        weekday: Number.isFinite(Number(source.todayTeachingInfo.weekday)) ? Number(source.todayTeachingInfo.weekday) : undefined,
        date: sanitizeString(source.todayTeachingInfo.date || "", 40),
        termStartDate: sanitizeString(source.todayTeachingInfo.termStartDate || "", 40),
      }
      : undefined,
    currentScheduleSummary: sanitizeScheduleSummary(source.currentScheduleSummary),
    scheduleChangeBaseline: sanitizeScheduleSummary(source.scheduleChangeBaseline || source.previousScheduleSummary),
    latestScheduleImport: sanitizeLatestScheduleImport(source.latestScheduleImport),
    pendingClarification: sanitizePendingClarification(source.pendingClarification),
    contextSlots: sanitizeContextSlots(source.contextSlots || source.conversation && source.conversation.contextSlots),
    userPreferences: sanitizeUserPreferences(source.userPreferences),
  };
}

function sanitizeToolResult(value, depth = 0) {
  if (depth > 8) return "[已省略]";
  if (value === null || value === undefined) return value;
  if (typeof value === "string") return redactSensitiveText(value);
  if (typeof value !== "object") return value;
  if (Array.isArray(value)) {
    return value.slice(0, 100).map((item) => sanitizeToolResult(item, depth + 1));
  }
  const output = {};
  Object.keys(value).forEach((key) => {
    if (SENSITIVE_KEY_PATTERN.test(key)) {
      output[key] = REDACTED;
    } else {
      output[key] = sanitizeToolResult(value[key], depth + 1);
    }
  });
  return output;
}

function buildSafeLogPayload(payload = {}) {
  const message = String(payload.message || "");
  const context = sanitizeAgentContext(payload.context || {});
  const messagePreview = hasSensitiveCredential(message)
    ? "[含敏感信息，已脱敏]"
    : sanitizeString(message, 80);
  return {
    messageLength: message.length,
    messagePreview,
    intent: sanitizeString(payload.intent || "", 40),
    provider: sanitizeString(payload.provider || "", 40),
    currentPage: context.currentPage,
    term: context.term,
    releaseVersion: context.releaseVersion,
    usedScheduleContext: Boolean(context.currentScheduleSummary && context.currentScheduleSummary.enabled),
    toolCalls: Array.isArray(payload.toolCalls)
      ? payload.toolCalls.map((item) => ({
          name: sanitizeString(item && item.name || "", 60),
          status: sanitizeString(item && item.status || "", 20),
          summary: hasSensitiveCredential(item && item.summary || "")
            ? "[含敏感信息，已脱敏]"
            : sanitizeString(item && item.summary || "", 120),
        }))
      : [],
  };
}

module.exports = {
  REDACTED,
  buildSafeLogPayload,
  hasSensitiveCredential,
  redactSensitiveText,
  sanitizeAgentContext,
  sanitizeContextSlots,
  sanitizeToolResult,
};
