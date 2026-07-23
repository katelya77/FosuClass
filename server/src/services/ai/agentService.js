const crypto = require("crypto");
const providerFactory = require("./providerFactory");
const generatedPayloadContract = require("./generatedPayloadContract");
const mockProvider = require("./providers/mockProvider");
const projectKnowledgeService = require("./projectKnowledgeService");
const safetyGuard = require("./safetyGuard");
const toolRegistry = require("./toolRegistry");
const agentProtocol = require("./agentProtocol");
const runtimeModeService = require("./runtimeModeService");
const providerChainService = require("./providerChainService");
const providerConfigService = require("./providerConfigService");
const knowledgeBaseService = require("./knowledgeBaseService");
const capabilityManifestService = require("./capabilityManifestService");
const { defaultKernel: agentKernel } = require("./agentKernel");
const agentTraceRecorder = require("./agentTraceRecorder");
const { defaultMemoryService } = require("./conversation/conversationMemoryService");
const { defaultUserPreferenceService } = require("./conversation/userPreferenceService");
const { resolvePersonalMemoryTurn } = require("./conversation/personalMemoryInterpreter");
const { defaultMemoryController } = require("./memory/memoryController");
const {
  evaluateProactive,
  factsFromToolCalls,
  factsFromContext,
  TRIGGER_EVENTS: PROACTIVE_TRIGGER_EVENTS,
} = require("./proactiveEngine");
const agentRunEventService = require("./agentRunEventService");
const { loadingTextForEvent } = require("./runEventCatalog");
const responseComposer = require("./responseComposer");
const { getPlannerPolicy, isGeneralAssistantEnabled } = require("./planner/plannerPolicy");
const plannerModelAdapter = require("./planner/plannerModelAdapter");
const { assemble: assembleContext } = require("./context/contextAssembler");
const { defaultCourseReminderService } = require("./reminders/courseReminderService");

function nowIso() {
  return new Date().toISOString();
}

function reminderIdempotencyKey(principal, operation, payload, reminderId) {
  const courseTemplates = Array.isArray(payload && payload.courseTemplates)
    ? payload.courseTemplates.map((course) => ({
      name: course.courseName || "",
      weekday: Number(course.weekday || 0),
      startSection: Number(course.startSection || 0),
      weeks: Array.isArray(course.weeks) ? course.weeks : [],
    }))
    : [];
  const digest = crypto.createHash("sha256").update(JSON.stringify({
    principal: principal && principal.principalKey || "",
    operation,
    reminderId: reminderId || "",
    scope: payload && payload.scope || "",
    leadMinutes: payload && payload.leadMinutes || 0,
    targetDate: payload && payload.targetDate || "",
    scheduleFingerprint: payload && payload.scheduleFingerprint || "",
    courseTemplates,
  })).digest("hex").slice(0, 40);
  return `course-reminder:${operation}:${digest}`;
}

/**
 * Confirmation capabilities are attached only after response/provider composition.
 * They never enter tool observations, model context, conversation memory, or trace logs.
 */
function attachReminderConfirmation(response, execution, principal) {
  if (!response || !execution || !principal || principal.authenticated !== true) return response;
  const calls = Array.isArray(execution.toolCalls) ? execution.toolCalls : [];
  const createCall = calls.find((item) => item && item.name === "create_course_reminder");
  const deleteCall = calls.find((item) => item && item.name === "delete_course_reminder");
  let operation = "";
  let payload = null;
  let reminderId = "";
  if (createCall && createCall.result && createCall.result.success === true && createCall.result.requiresConfirmation === true) {
    operation = "create";
    payload = createCall.result;
  } else if (deleteCall && deleteCall.result && deleteCall.result.requiresConfirmation === true
    && Array.isArray(deleteCall.result.matches) && deleteCall.result.matches.length === 1) {
    operation = "delete";
    payload = {};
    reminderId = String(deleteCall.result.matches[0].id || "");
  }
  if (!operation || operation === "delete" && !reminderId) return response;

  try {
    const idempotencyKey = reminderIdempotencyKey(principal, operation, payload, reminderId);
    const confirmation = defaultCourseReminderService.createConfirmation({
      principal,
      operation,
      reminderId,
      payload,
      idempotencyKey,
    });
    const attachToCards = (cards) => {
      (Array.isArray(cards) ? cards : []).forEach((card) => {
        (Array.isArray(card && card.actions) ? card.actions : []).forEach((action) => {
          if (!action || action.type !== "confirmReminder") return;
          // Keep lead/scope for one-tap client configure path; proof remains as secondary fallback.
          action.payload = Object.assign({}, action.payload || {}, {
            operation,
            reminderId,
            idempotencyKey,
            confirmationProof: confirmation.token,
            confirmationExpiresAt: confirmation.expiresAt,
            leadMinutes: Number((payload && payload.leadMinutes) || (action.payload && action.payload.leadMinutes) || 20) || 20,
            scope: String((payload && payload.scope) || (action.payload && action.payload.scope) || "all_courses").slice(0, 32),
          });
        });
      });
    };
    attachToCards(response.cards);
    if (response.presentation && response.presentation.cards !== response.cards) {
      attachToCards(response.presentation.cards);
    }
  } catch (error) {
    (Array.isArray(response.cards) ? response.cards : []).forEach((card) => {
      (Array.isArray(card && card.actions) ? card.actions : []).forEach((action) => {
        if (action && action.type === "confirmReminder") {
          action.type = "noop";
          action.toast = error && error.code === "REMINDER_SECRET_UNAVAILABLE"
            ? "提醒服务尚未配置，请稍后再试"
            : "暂时无法确认提醒";
          action.payload = {};
        }
      });
    });
  }
  return response;
}

function emitChatEvent(input, event = {}) {
  if (typeof input.onEvent !== "function") return;
  try {
    input.onEvent(Object.assign({
      at: nowIso(),
      label: event.label || loadingTextForEvent(event, event.runtimeMode || input.runtimeMode || "public"),
    }, event));
  } catch (error) {
    // events are best-effort
  }
}

function recordEarlyTrace(payload = {}) {
  return agentTraceRecorder.record({
    runId: payload.runId,
    requestId: payload.requestId,
    conversationId: payload.conversationId,
    runtimeMode: payload.runtimeMode || "public",
    intent: payload.intent || "conversational_help",
    selectedSkill: payload.selectedSkill || "",
    stepCount: 0,
    toolCalls: payload.toolCalls || [],
    steps: [],
    totalDurationMs: Math.max(0, Date.now() - (payload.startTime || Date.now())),
    providerUsed: false,
    fallbackLayer: payload.fallbackLayer || "server",
    fallbackReason: payload.fallbackReason || "",
    evidenceComplete: payload.evidenceComplete === true,
    errorCode: payload.errorCode || "",
  });
}

function buildMinimalProviderContext(context = {}) {
  const summary = context.currentScheduleSummary || {};
  return safetyGuard.sanitizeAgentContext({
    term: context.term,
    releaseVersion: context.releaseVersion,
    envVersion: context.envVersion,
    miniprogramVersion: context.miniprogramVersion,
    currentPage: context.currentPage,
    clientTime: context.clientTime,
    clientLocalTime: context.clientLocalTime,
    timezoneOffsetMinutes: context.timezoneOffsetMinutes,
    clientTimestampMs: context.clientTimestampMs,
    timezone: context.timezone,
    currentTeachingWeek: context.currentTeachingWeek,
    todayWeekday: context.todayWeekday,
    todayDate: context.todayDate,
    termStartDate: context.termStartDate,
    totalWeeks: context.totalWeeks,
    userPreferences: context.userPreferences,
    currentScheduleSummary: {
      enabled: false,
      targetType: "personal-redacted",
      targetName: "personal schedule",
      term: summary.term || context.term || "",
      source: summary.source || "",
      courseCount: Number(summary.courseCount || (Array.isArray(summary.courses) ? summary.courses.length : 0)) || 0,
      courses: [],
    },
  });
}

function stableAction(action) {
  return generatedPayloadContract.stableAction(action);
}

function stableCard(card) {
  return generatedPayloadContract.stableCard(card);
}

function stableGeneratedPayload(payload, options = {}) {
  return generatedPayloadContract.stableGeneratedPayload(payload, options);
}

function isPublicRuntime(runtimeMode) {
  return (runtimeMode || providerFactory.getRuntimeMode && providerFactory.getRuntimeMode()) === "public";
}

const PUBLIC_BLOCK_PATTERNS = [
  /Oracle/gi,
  /CloudBase/gi,
  /Provider/gi,
  /DeepSeek/gi,
  /Coze/gi,
  /Hunyuan/gi,
  /腾讯混元/g,
  /扣子/g,
  /比赛模式|比赛|竞赛/g,
  /OPENID|openid/gi,
  /白名单/g,
  /API\s*Base\s*URL/gi,
  /https?:\/\/[^\s"'<>）)]+/gi,
  /Bearer\s+[A-Za-z0-9._~+/=-]+/gi,
  /[A-Z][A-Z0-9_]{5,}/g,
  /系统\s*Prompt|system\s*prompt/gi,
  /环境变量/g,
  /管理员|管理后台|后台操作/g,
  /发布流程|Release\s*Pack|Docker|GitHub\s*Actions/gi,
  /模型额度|免费权益/g,
];

const PUBLIC_DENY_RESPONSE = "我不能提供内部部署、密钥、名单策略、非公开活动、系统提示或后台信息。可以继续帮你查询课表、空教室、教学周，或说明佛课小表的使用方法。";

function containsPublicBlockedText(text) {
  return PUBLIC_BLOCK_PATTERNS.some((pattern) => {
    pattern.lastIndex = 0;
    return pattern.test(String(text || ""));
  });
}

function sanitizePublicText(value, fallback = "") {
  const text = safetyGuard.redactSensitiveText(String(value || fallback || ""));
  if (!text) return "";
  if (!containsPublicBlockedText(text)) return text;
  return PUBLIC_DENY_RESPONSE;
}

const PUBLIC_TOOL_NAMES = {
  search_empty_rooms: "查询空教室",
  get_today_courses: "查询今日课程",
  get_tomorrow_courses: "查询明日课程",
  get_next_course: "查询下一节课",
  get_week_schedule: "查询本周课表",
  get_teaching_week: "查询教学周",
  get_term_calendar: "查询校历",
  search_continuous_empty_rooms: "查询连续空教室",
  search_school_index: "查询全校课程",
  get_schedule_detail: "查询课表详情",
  diagnose_data_status: "检查数据状态",
  explain_personal_import: "说明个人课表导入",
  recommend_meeting_time: "推荐空闲时间",
  clarify_missing_slot: "补充查询条件",
  get_campus_weather: "查询校区天气",
  get_course_weather_advice: "查询天气建议",
  search_campus_place: "查询校园地图",
  get_campus_route: "查询校园地图",
  get_classroom_location: "查询校园地图",
  safety_guard: "安全检查",
};

function publicToolName(name) {
  return PUBLIC_TOOL_NAMES[String(name || "").toLowerCase()] || "校园工具";
}

function configValue(runtimeConfig, key, fallback = "") {
  const source = runtimeConfig || {};
  if (Object.prototype.hasOwnProperty.call(source, key)) {
    const value = source[key];
    return value === undefined || value === null || value === "" ? fallback : value;
  }
  return process.env[key] || fallback;
}

function getProviderPolicy(runtimeConfig) {
  const value = String(configValue(runtimeConfig, "AI_PROVIDER_POLICY", "auto")).trim().toLowerCase();
  return ["auto", "always", "tool-only"].includes(value) ? value : "auto";
}

function getToolResult(toolCalls, name) {
  const match = Array.isArray(toolCalls) ? toolCalls.find((item) => item && item.name === name) : null;
  return match && match.result;
}

function getPrimaryToolResult(toolCalls) {
  return Array.isArray(toolCalls) && toolCalls.length ? toolCalls[0].result : null;
}

function countResultItems(result) {
  if (!result || typeof result !== "object") return 0;
  if (Array.isArray(result.items)) return result.items.length;
  if (Array.isArray(result.rooms)) return result.rooms.length;
  if (Array.isArray(result.courses)) return result.courses.length;
  if (Array.isArray(result.candidates)) return result.candidates.length;
  return Number(result.total || result.courseCount || 0) || 0;
}

function getItemCount(toolCalls) {
  return (Array.isArray(toolCalls) ? toolCalls : []).reduce((sum, item) => {
    return sum + countResultItems(item && item.result);
  }, 0);
}

const FACT_TOOL_INTENTS = new Set(Object.values(capabilityManifestService.getManifest().intents)
  .filter((item) => item.factualTask)
  .map((item) => item.id));

function isProjectKnowledgeIntent(intent) {
  const name = intent && intent.name;
  return name === "project_qa" || name === "conversational_help";
}

function isFactToolIntent(intent) {
  const name = intent && intent.name;
  return FACT_TOOL_INTENTS.has(name);
}

function isKnownRuleIntentName(name) {
  const value = String(name || "").trim();
  return Boolean(value && (FACT_TOOL_INTENTS.has(value) || value === "project_qa" || value === "conversational_help" || value === "next_course_location"));
}

function shouldRuleOverrideIntent(ruleIntentName, parsedIntent) {
  if (!isKnownRuleIntentName(ruleIntentName)) return false;
  const parsedName = parsedIntent && parsedIntent.name || "";
  if (!parsedName || parsedName === "generic" || parsedName === "conversational_help" || parsedName === "project_qa") return true;
  if (parsedName === "rag_search" && ruleIntentName !== "rag_search") return true;
  return parsedName === ruleIntentName;
}

function resolveRuleBackedIntent(message, context = {}) {
  const parsedIntent = toolRegistry.resolveIntent(message, context);
  const environment = context.assistantEnvironment || context.runtimeMode || "public";
  let ruleMatch = null;
  try {
    const matched = knowledgeBaseService.matchLocalRule({ query: message, environment });
    ruleMatch = matched && matched.matched ? matched : null;
  } catch (error) {
    ruleMatch = null;
  }
  if (!ruleMatch || !ruleMatch.rule || !shouldRuleOverrideIntent(ruleMatch.rule.intentName, parsedIntent)) {
    return { intent: parsedIntent, ruleMatch };
  }
  const intent = Object.assign({}, parsedIntent, {
    name: ruleMatch.rule.intentName,
    slots: Object.assign({}, parsedIntent.slots || {}),
    ruleId: ruleMatch.rule.id,
    ruleTitle: ruleMatch.rule.title,
    ruleScore: ruleMatch.score,
    source: "knowledge-rule",
  });
  return { intent, ruleMatch };
}

function evaluateProviderPolicy(intent, toolCalls, policy, providerName, runtimeMode, runtimeConfig) {
  const normalizedPolicy = ["auto", "always", "tool-only"].includes(String(policy || "").toLowerCase())
    ? String(policy).toLowerCase()
    : "auto";
  const provider = String(providerName || providerFactory.getProviderName(runtimeMode, runtimeConfig) || "mock").toLowerCase();
  const intentName = intent && intent.name || "generic";
  const agentEnabled = String(configValue(runtimeConfig, "AI_AGENT_ENABLED", "false")).toLowerCase() !== "false";

  if (capabilityManifestService.normalizeRuntimeMode(runtimeMode) === "public") {
    return { useExternal: false, reason: "public_runtime_forbids_external_provider" };
  }
  if (!capabilityManifestService.isExternalProviderAllowed(intentName, runtimeMode)) {
    return { useExternal: false, reason: "capability_manifest_forbids_external_provider" };
  }
  if (!agentEnabled) return { useExternal: false, reason: "AI_AGENT_ENABLED=false" };
  if (provider === "mock") return { useExternal: false, reason: "AI_PROVIDER=mock" };
  if (normalizedPolicy === "tool-only") return { useExternal: false, reason: "AI_PROVIDER_POLICY=tool-only" };
  if (intentName === "clarify_missing_slot") {
    return { useExternal: false, reason: "缺槽追问使用本地模板" };
  }
  if (intentName === "explain_personal_import") {
    return { useExternal: false, reason: "XLS 导入安全说明使用本地模板" };
  }
  if (normalizedPolicy === "always") {
    return { useExternal: true, reason: "AI_PROVIDER_POLICY=always" };
  }
  if (isProjectKnowledgeIntent(intent)) {
    return { useExternal: true, reason: "项目问答或自然语言帮助调用外部 Provider" };
  }
  if (isFactToolIntent(intent)) {
    return { useExternal: false, reason: "事实类任务使用确定性工具渲染" };
  }
  return { useExternal: true, reason: "未命中本地确定性规则，交给外部 Provider" };
}

function shouldUseExternalProvider(intent, toolCalls, policy, runtimeMode) {
  return evaluateProviderPolicy(intent, toolCalls, policy, providerFactory.getProviderName(runtimeMode), runtimeMode || providerFactory.getRuntimeMode()).useExternal;
}

function buildMetrics(options = {}) {
  return {
    latencyMs: Math.max(0, Date.now() - (options.startTime || Date.now())),
    intentName: options.intentName || (options.intent && options.intent.name) || "generic",
    toolCallCount: Array.isArray(options.toolCalls) ? options.toolCalls.length : 0,
    externalProviderUsed: options.externalProviderUsed === true,
    fallback: options.fallback === true,
    itemCount: getItemCount(options.toolCalls),
    usedPersonalContext: options.usedPersonalContext === true,
    // Planner vs Response diagnostics (no secrets)
    plannerProvider: options.plannerProvider || "none",
    responseProvider: options.responseProvider || options.provider || "none",
    plannerLatency: Math.max(0, Number(options.plannerLatency || 0) || 0),
    responseLatency: Math.max(0, Number(options.responseLatency || 0) || 0),
    plannerFallback: options.plannerFallback === true,
    responseFallback: options.responseFallback === true,
    plannerType: options.plannerType || "",
  };
}

function normalizeMetrics(metrics = {}, fallbackOptions = {}) {
  const base = Object.assign({}, buildMetrics(fallbackOptions), metrics || {});
  return {
    latencyMs: Math.max(0, Number(base.latencyMs || 0) || 0),
    intentName: String(base.intentName || fallbackOptions.intentName || fallbackOptions.intent && fallbackOptions.intent.name || "generic"),
    toolCallCount: Math.max(0, Number(base.toolCallCount || 0) || 0),
    externalProviderUsed: base.externalProviderUsed === true,
    fallback: base.fallback === true,
    itemCount: Math.max(0, Number(base.itemCount || 0) || 0),
    usedPersonalContext: base.usedPersonalContext === true,
    plannerProvider: String(base.plannerProvider || "none"),
    responseProvider: String(base.responseProvider || "none"),
    plannerLatency: Math.max(0, Number(base.plannerLatency || 0) || 0),
    responseLatency: Math.max(0, Number(base.responseLatency || 0) || 0),
    plannerFallback: base.plannerFallback === true,
    responseFallback: base.responseFallback === true,
    plannerType: String(base.plannerType || ""),
  };
}

function classifyProviderFailure(error) {
  const code = String(error && error.code || "");
  if (["provider_bad_request", "invalid_model", "invalid_payload", "provider_timeout"].includes(code)) {
    return code;
  }
  if (/timeout|ECONNABORTED|ETIMEDOUT/i.test(code) || /timeout|超时/i.test(String(error && error.message || ""))) {
    return "provider_timeout";
  }
  const status = Number(error && error.response && error.response.status);
  const body = error && error.response && error.response.data;
  const text = JSON.stringify(body || {}).toLowerCase();
  if (status === 400 || code === "ERR_BAD_REQUEST") {
    if (/model/.test(text)) return "invalid_model";
    if (/response_format|payload|json|schema|thinking|reasoning/.test(text)) return "invalid_payload";
    return "provider_bad_request";
  }
  return code || "provider_fallback";
}

function summarizeProviderChainFallback(chain = []) {
  const reasons = Array.from(new Set((Array.isArray(chain) ? chain : [])
    .filter((item) => item && item.provider !== "mock" && item.status !== "success")
    .map((item) => String(item.reason || item.status || "").trim())
    .filter(Boolean)));
  return reasons.length ? `provider_chain_fallback:${reasons.join(",")}` : "provider_chain_fallback";
}

function addUniqueText(target, value, limit) {
  const text = safetyGuard.redactSensitiveText(String(value || "").trim()).slice(0, limit || 80);
  if (text && target.indexOf(text) < 0) target.push(text);
}

function collectEvidenceValue(result, keyNames, target, limit) {
  if (!result || typeof result !== "object") return;
  keyNames.forEach((key) => {
    if (result[key] != null) addUniqueText(target, result[key], limit);
  });
  ["meta", "metadata", "release", "releaseInfo", "termConfig", "calendar"].forEach((nestedKey) => {
    const nested = result[nestedKey];
    if (nested && typeof nested === "object") {
      keyNames.forEach((key) => {
        if (nested[key] != null) addUniqueText(target, nested[key], limit);
      });
    }
  });
}

function buildEvidence(toolCalls = [], context = {}, intent = null) {
  const calls = Array.isArray(toolCalls) ? toolCalls : [];
  const successfulCalls = calls.filter((call) => {
    const result = call && call.result;
    return call && call.status !== "failed" && call.status !== "skipped" && (!result || result.success !== false);
  });
  // 只有该 intent 的事实工具成功才算证据；诊断类辅助工具成功不能冒充事实证据。
  const successfulEvidenceCalls = successfulCalls.filter((call) =>
    capabilityManifestService.isEvidenceToolCall(intent && intent.name || intent, call));
  const terms = [];
  const releaseVersions = [];
  const weeks = [];
  const sources = [];
  const checkedAt = nowIso();
  collectEvidenceValue(context, ["term", "semester"], terms, 32);
  collectEvidenceValue(context, ["releaseVersion", "version"], releaseVersions, 64);
  if (context && context.releaseInfo) {
    collectEvidenceValue(context.releaseInfo, ["term", "semester"], terms, 32);
    collectEvidenceValue(context.releaseInfo, ["releaseVersion", "version"], releaseVersions, 64);
  }
  if (context && context.currentScheduleSummary) {
    collectEvidenceValue(context.currentScheduleSummary, ["term", "semester"], terms, 32);
    collectEvidenceValue(context.currentScheduleSummary, ["source"], sources, 80);
  }
  successfulCalls.forEach((call) => {
    const result = call && call.result;
    collectEvidenceValue(result, ["term", "semester"], terms, 32);
    collectEvidenceValue(result, ["releaseVersion", "version"], releaseVersions, 64);
    collectEvidenceValue(result, ["currentWeek", "teachingWeek", "week"], weeks, 16);
    collectEvidenceValue(result, ["source", "sourceMode", "scopeSource", "dataSource"], sources, 80);
  });
  return {
    checkedAt,
    term: terms[0] || "",
    releaseVersion: releaseVersions[0] || "",
    currentWeek: weeks[0] || "",
    sources: sources.slice(0, 6),
    toolCount: successfulEvidenceCalls.length,
    attemptedToolCount: calls.length,
    complete: successfulEvidenceCalls.length > 0,
  };
}

function buildPublicEvidence(evidence) {
  const source = evidence || {};
  return {
    checkedAt: source.checkedAt || nowIso(),
    term: source.term || "",
    releaseVersion: safetyGuard.redactSensitiveText(String(source.releaseVersion || "")).slice(0, 80),
    currentWeek: source.currentWeek || "",
    toolCount: Number(source.toolCount || 0) || 0,
    verified: Number(source.toolCount || 0) > 0,
    complete: source.complete === true || Number(source.toolCount || 0) > 0,
    sources: (Array.isArray(source.sources) ? source.sources : [])
      .map((item) => safetyGuard.redactSensitiveText(String(item || "")).slice(0, 80))
      .filter(Boolean)
      .slice(0, 6),
  };
}

function sanitizePublicActionPayload(type, payload) {
  const source = payload && typeof payload === "object" && !Array.isArray(payload) ? payload : {};
  if (type === "manageReminders" || type === "openSheet") {
    return {
      sheet: String(source.sheet || source.name || source.target || "reminders").slice(0, 40),
      openCreate: source.openCreate === true,
    };
  }
  if (type === "confirmReminder") {
    const lead = Number(source.leadMinutes);
    return {
      operation: ["create", "update", "delete"].includes(source.operation) ? source.operation : "create",
      reminderId: String(source.reminderId || "").slice(0, 80),
      leadMinutes: Number.isFinite(lead) ? Math.min(180, Math.max(5, Math.round(lead))) : 20,
      scope: String(source.scope || "all_courses").slice(0, 32),
      // confirmationProof is re-attached after buildResponse; keep empty here in public sanitize.
      idempotencyKey: String(source.idempotencyKey || "").slice(0, 160),
    };
  }
  if (type === "retry" || type === "ask") {
    return {
      message: sanitizePublicText(source.message || "", "").slice(0, 200),
    };
  }
  if (type === "toggleFloat") {
    return {
      enabled: typeof source.enabled === "boolean" ? source.enabled : undefined,
    };
  }
  return {};
}

function sanitizePublicAction(action) {
  const source = stableAction(action || {});
  const url = String(source.url || "");
  const safeUrl = generatedPayloadContract.isAllowedNavigationUrl(url) ? url : "";
  return Object.assign({}, source, {
    label: sanitizePublicText(source.label, "查看"),
    url: safeUrl,
    // Preserve allowlisted action payloads; do not blank manageReminders / confirmReminder / retry.
    payload: sanitizePublicActionPayload(source.type, source.payload),
  });
}

function normalizeProactiveSuggestion(raw) {
  if (!raw || typeof raw !== "object") return null;
  const type = String(raw.type || "").slice(0, 40);
  const title = safetyGuard.redactSensitiveText(String(raw.title || "")).slice(0, 40);
  const body = safetyGuard.redactSensitiveText(String(raw.body || "")).slice(0, 120);
  if (!type || !title) return null;
  return {
    type,
    title,
    body,
    actions: (Array.isArray(raw.actions) ? raw.actions : []).slice(0, 2).map((action) => ({
      label: String(action && action.label || "").slice(0, 24),
      type: String(action && action.type || "noop").slice(0, 32),
      payload: action && action.payload && typeof action.payload === "object" ? action.payload : {},
    })),
    source: String(raw.source || "proactive_engine").slice(0, 40),
    expiresAt: String(raw.expiresAt || "").slice(0, 40),
  };
}

/**
 * Optional proactive evaluation when client supplies a validated event on context.
 */
function maybeAttachProactive(response, input = {}, memoryBundle = null, toolCalls = []) {
  const context = input.context || {};
  const event = String(context.proactiveEvent || input.proactiveEvent || "").slice(0, 64);
  if (!event || !PROACTIVE_TRIGGER_EVENTS.includes(event)) return response;
  try {
    const principal = memoryBundle && memoryBundle.principal;
    const facts = Object.assign(
      {},
      factsFromContext(context),
      factsFromToolCalls(toolCalls || response.toolCalls || [])
    );
    const result = evaluateProactive({
      event,
      principal,
      principalKey: principal && principal.principalKey || "",
      context: {
        disabledProactiveTypes: context.disabledProactiveTypes || context.proactiveOptOut,
        proactiveOptOut: context.proactiveOptOut,
      },
      facts,
    });
    if (result && result.suggestion) {
      response.proactiveSuggestion = normalizeProactiveSuggestion(result.suggestion);
    }
  } catch (_) {
    // Proactive must never break the main chat path.
  }
  return response;
}

/**
 * Public evaluate entry used by POST /api/ai/agent/proactive/evaluate
 */
function evaluateProactiveForRequest(input = {}) {
  const context = safetyGuard.sanitizeAgentContext(input.context || {});
  const event = String(input.event || context.proactiveEvent || "").slice(0, 64);
  const memoryBundle = defaultMemoryController.load({
    message: "",
    context,
    conversationId: input.conversationId,
    serverSession: input.serverSession,
    runtimeMode: input.runtimeMode,
    memoryMode: context.memoryMode || input.memoryMode,
    cloudSyncEnabled: context.cloudSyncEnabled === true,
  });
  const facts = Object.assign({}, factsFromContext(context), input.facts && typeof input.facts === "object" ? input.facts : {});
  const result = evaluateProactive({
    event,
    principal: memoryBundle.principal,
    principalKey: memoryBundle.principal && memoryBundle.principal.principalKey || "",
    context: {
      disabledProactiveTypes: context.disabledProactiveTypes || context.proactiveOptOut,
      proactiveOptOut: context.proactiveOptOut,
    },
    facts,
  });
  return {
    success: true,
    event: result.event || event,
    reason: result.reason || "",
    proactiveSuggestion: result.suggestion ? normalizeProactiveSuggestion(result.suggestion) : null,
    serverTime: nowIso(),
  };
}

function sanitizePublicCard(card) {
  const source = stableCard(card || {});
  const urlOptionalActionTypes = new Set([
    "noop", "retry", "ask", "openSheet", "toggleFloat", "confirmReminder", "manageReminders",
  ]);
  return Object.assign({}, source, {
    title: sanitizePublicText(source.title, "结果"),
    subtitle: sanitizePublicText(source.subtitle, ""),
    badges: (source.badges || []).map((item) => sanitizePublicText(item, "")).filter(Boolean).slice(0, 4),
    items: (source.items || []).map((item) => ({
      title: sanitizePublicText(item.title, ""),
      subtitle: sanitizePublicText(item.subtitle, ""),
      value: sanitizePublicText(item.value, ""),
    })).filter((item) => item.title || item.subtitle || item.value).slice(0, 8),
    actions: (source.actions || []).map(sanitizePublicAction).filter((item) => item.url || urlOptionalActionTypes.has(item.type)).slice(0, 3),
  });
}

function sanitizePublicToolCall(toolCall) {
  const source = toolCall || {};
  return {
    name: publicToolName(source.name),
    status: safetyGuard.redactSensitiveText(String(source.status || "")).slice(0, 20),
    summary: sanitizePublicText(source.summary, "").slice(0, 160),
  };
}

function sanitizePublicSkill(skill) {
  if (!skill) return null;
  return {
    id: safetyGuard.redactSensitiveText(String(skill.id || skill)).slice(0, 80),
    version: safetyGuard.redactSensitiveText(String(skill.version || "")).slice(0, 32),
    description: sanitizePublicText(skill.description, "").slice(0, 180),
  };
}

function sanitizePublicPlan(plan) {
  const list = Array.isArray(plan) ? plan : [];
  return list.map((step) => {
    const source = step && typeof step === "object" ? step : {};
    const args = source.args && typeof source.args === "object" && !Array.isArray(source.args)
      ? source.args
      : {};
    const safeArgs = {};
    Object.keys(args).forEach((key) => {
      const value = args[key];
      if (value == null) return;
      if (typeof value === "number" || typeof value === "boolean") {
        safeArgs[key] = value;
        return;
      }
      if (typeof value === "string") {
        // Never echo full user message / internal tokens into public plan args.
        if (key === "message" || key === "q" || key === "query" || key === "prompt") {
          safeArgs[key] = sanitizePublicText(value, "").slice(0, 40);
          return;
        }
        safeArgs[key] = sanitizePublicText(value, "").slice(0, 80);
      }
    });
    return {
      toolName: sanitizePublicText(source.toolName || source.name || "", "").slice(0, 60),
      args: safeArgs,
      reason: sanitizePublicText(source.reason || source.reasonCode || "", "").slice(0, 40),
    };
  }).filter((step) => step.toolName);
}

function sanitizePublicResponse(response) {
  const evidence = buildPublicEvidence(response.evidence);
  const sourceSafety = response.safety || {};
  const sourceMetrics = response.metrics || {};
  return Object.assign({}, response, {
    answer: sanitizePublicText(response.answer, ""),
    cards: (Array.isArray(response.cards) ? response.cards : []).map(sanitizePublicCard),
    suggestions: (Array.isArray(response.suggestions) ? response.suggestions : []).map((item) => sanitizePublicText(item, "")).filter(Boolean).slice(0, 6),
    toolCalls: (Array.isArray(response.toolCalls) ? response.toolCalls : []).map(sanitizePublicToolCall),
    plan: sanitizePublicPlan(response.plan),
    skill: sanitizePublicSkill(response.skill),
    evidence,
    safety: {
      redacted: true,
      usedPersonalContext: Boolean(sourceSafety.usedPersonalContext),
      mode: sourceSafety.mode || "tool-grounded",
      externalProviderUsed: false,
      fallbackReason: sourceSafety.fallbackReason ? "已使用本地规则" : "",
      fallbackLayer: response.fallbackLayer || "none",
      pendingClarification: sourceSafety.pendingClarification || null,
      clearPendingClarification: sourceSafety.clearPendingClarification === true,
    },
    metrics: {
      latencyMs: sourceMetrics.latencyMs,
      intentName: sourceMetrics.intentName,
      toolCallCount: sourceMetrics.toolCallCount,
      externalProviderUsed: false,
      fallback: sourceMetrics.fallback === true,
      itemCount: sourceMetrics.itemCount,
      usedPersonalContext: Boolean(sourceMetrics.usedPersonalContext),
      canonicalIntent: sourceMetrics.intentName || "",
    },
    externalProviderUsed: false,
  });
}

function buildTaskSteps(intent = {}, toolCalls = []) {
  const steps = [{ key: "understand", label: "已理解需求", status: "done" }];
  const names = (Array.isArray(toolCalls) ? toolCalls : []).map((item) => String(item && item.name || "").toLowerCase());
  const addStep = (key, label) => {
    if (!steps.some((item) => item.key === key)) {
      steps.push({ key, label, status: "done" });
    }
  };
  if (names.some((name) => /today|tomorrow|next_course|schedule|meeting|personal|recommend_meeting/.test(name))) {
    addStep("schedule", "已读取课表");
  }
  if (names.some((name) => /empty_room|empty-room|空教室/.test(name))) {
    addStep("empty-room", "已核验空教室");
  }
  // Avoid matching search_empty_rooms as school-index search.
  if (names.some((name) => /school_index|schedule_detail|search_school|全校|课表详情/.test(name))) {
    addStep("search", "已查询校园索引");
  }
  if (names.some((name) => /recommend|plan|meeting/.test(name)) || /recommend|plan|meeting/.test(String(intent && intent.name || ""))) {
    addStep("decision", "已生成建议");
  }
  if (names.some((name) => /diagnose|data_status|数据状态/.test(name))) {
    addStep("diagnose", "已检查数据状态");
  }
  if (names.some((name) => /weather|天气/.test(name))) {
    addStep("weather", "已查询天气");
  }
  // Always keep “complete” as the final visible process step (max 6).
  const body = steps.slice(0, 5);
  body.push({ key: "complete", label: "已完成", status: "done" });
  return body;
}

function buildContextSlots(intent = {}, slots = {}) {
  const source = slots && typeof slots === "object" ? slots : {};
  const weekRaw = source.week != null ? source.week : source.lastWeek;
  const weekdayRaw = source.weekday != null ? source.weekday : source.lastWeekday;
  const week = Number(weekRaw);
  const weekday = Number(weekdayRaw);
  return safetyGuard.sanitizeToolResult({
    lastIntent: String(intent && intent.name || intent || "").slice(0, 80),
    lastTargetType: String(source.type || source.targetType || source.lastTargetType || "").slice(0, 30),
    lastTargetName: String(
      source.q || source.targetName || source.className || source.classroom
      || source.courseName || source.teacherName || source.lastTargetName || ""
    ).replace(/\s+/g, "").slice(0, 80),
    // Keep null when unset — never coerce missing week/weekday to 0 (pollutes working memory).
    lastWeek: Number.isFinite(week) && week >= 1 ? week : null,
    lastWeekday: Number.isFinite(weekday) && weekday >= 1 && weekday <= 7 ? weekday : null,
    className: String(source.className || (source.type === "class" ? source.q : "") || "").replace(/\s+/g, "").slice(0, 80),
    teacherName: String(source.teacherName || "").slice(0, 80),
    week: Number.isFinite(week) && week >= 1 ? week : null,
    weekday: Number.isFinite(weekday) && weekday >= 1 && weekday <= 7 ? weekday : null,
    lastQueryResult: "",
    lastSource: "server-agent-kernel",
  });
}

/**
 * Soft-fill intent slots from Working Memory for follow-ups and incomplete queries.
 */
function enrichIntentFromWorkingMemory(intent, context = {}, conversationState = null) {
  if (!intent || typeof intent !== "object") return intent;
  const wm = (conversationState && conversationState.workingMemory)
    || context.workingMemory
    || {};
  const slots = Object.assign({}, intent.slots || {});
  const className = String(wm.className || slots.className || "").replace(/\s+/g, "");
  const teacherName = String(wm.teacherName || slots.teacherName || "").replace(/\s+/g, "");

  if (intent.name === "search_school_index" || intent.followUp === true) {
    if (!slots.q) {
      if (className) {
        slots.q = className;
        slots.type = slots.type || "class";
        slots.className = className;
      } else if (teacherName) {
        slots.q = teacherName;
        slots.type = slots.type || "teacher";
      }
    } else {
      slots.q = String(slots.q).replace(/\s+/g, "");
      if (!slots.type && /班/.test(slots.q)) slots.type = "class";
    }
    if ((slots.week == null || slots.week === "" || Number(slots.week) === 0)
      && wm.teachingWeek != null && Number(wm.teachingWeek) >= 1) {
      slots.week = Number(wm.teachingWeek);
    }
    if ((slots.weekday == null || slots.weekday === "" || Number(slots.weekday) === 0)
      && wm.weekday != null && Number(wm.weekday) >= 1) {
      slots.weekday = Number(wm.weekday);
    }
    if (!slots.periodHint && wm.periodHint) slots.periodHint = wm.periodHint;
  }

  if (/get_today_courses|get_tomorrow_courses|get_week_schedule|search_empty_rooms|search_continuous_empty_rooms/.test(String(intent.name || ""))) {
    if ((slots.week == null || Number(slots.week) === 0) && wm.teachingWeek != null && Number(wm.teachingWeek) >= 1) {
      slots.week = Number(wm.teachingWeek);
    }
    if ((slots.weekday == null || Number(slots.weekday) === 0) && wm.weekday != null && Number(wm.weekday) >= 1) {
      slots.weekday = Number(wm.weekday);
    }
    if (!slots.campus && wm.campus) slots.campus = wm.campus;
    if (!slots.periodHint && wm.periodHint) slots.periodHint = wm.periodHint;
  }

  return Object.assign({}, intent, { slots });
}

function buildResponse(payload) {
  const rawToolCalls = payload.rawToolCalls || payload.toolCalls || [];
  const requestedProtocolVersion = agentProtocol.normalizeProtocolVersion(payload.protocolVersion);
  const envelope = agentProtocol.buildProtocolEnvelope({
    protocolVersion: requestedProtocolVersion,
    requestId: payload.requestId,
    conversationId: payload.conversationId,
    runtimeMode: payload.runtimeMode || "public",
    intent: payload.intent,
    plan: payload.plan,
    rawToolCalls,
    slots: payload.slots,
  });
  const validation = agentProtocol.validateResponse({
    protocolVersion: requestedProtocolVersion,
    runtimeMode: envelope.canonicalRuntimeMode,
    intent: payload.intent,
    plan: payload.plan,
    cards: payload.cards,
  });
  const taskSteps = payload.taskSteps || buildTaskSteps(payload.intent, rawToolCalls);
  let evidence = payload.evidence || buildEvidence(rawToolCalls, payload.context, payload.intent);
  const errors = (Array.isArray(payload.errors) ? payload.errors : []).concat(validation.errors || []);
  // Kernel verification is authoritative for evidence completeness on fact tasks.
  if (payload.verification && payload.verification.evidenceComplete === false) {
    evidence = Object.assign({}, evidence, {
      complete: false,
      verified: false,
      toolCount: 0,
    });
  } else if (errors.some((item) => item && item.code === "FACT_TOOL_EVIDENCE_REQUIRED")) {
    evidence = Object.assign({}, evidence, {
      complete: false,
      verified: false,
      toolCount: 0,
    });
  }
  const response = {
    protocolVersion: envelope.protocolVersion,
    requestId: envelope.requestId,
    conversationId: envelope.conversationId,
    runtimeMode: envelope.runtimeMode,
    runId: payload.runId || agentProtocol.createRunId(),
    status: payload.status || (errors.length ? "partial" : "completed"),
    success: payload.success !== false && errors.length === 0,
    answer: payload.answer,
    intent: payload.intent,
    slots: envelope.slots,
    plan: envelope.plan,
    cards: validation.cards,
    toolCalls: payload.toolCalls || [],
    taskSteps,
    steps: payload.steps || taskSteps,
    observations: payload.observations || rawToolCalls.map((item, index) => ({
      id: `observation-${index + 1}`,
      tool: item.name,
      status: item.status,
      code: item.result && item.result.code || "",
      summary: item.summary || "",
      sourceId: item.result && (item.result.sourceId || item.result.source) || "",
      factCount: countResultItems(item.result),
    })),
    skill: payload.skill || null,
    evidence,
    evidenceItems: envelope.evidenceItems,
    suggestions: payload.suggestions,
    // Presentation protocol (Response Composer) — required for mini-program one-focus UI
    presentationMode: payload.presentationMode || "",
    presentation: payload.presentation || null,
    runSummary: payload.runSummary || null,
    taskTrajectory: payload.taskTrajectory || null,
    evidenceDisplay: payload.evidenceDisplay || null,
    planMeta: agentProtocol.normalizeStructuredPlanMeta
      ? agentProtocol.normalizeStructuredPlanMeta(payload.plan)
      : null,
    contextMeta: payload.contextMeta || null,
    contextSlots: payload.contextSlots || buildContextSlots(payload.intent, envelope.slots),
    fallback: payload.fallback === true,
    fallbackLayer: payload.fallbackLayer || (payload.fallback === true ? "server" : "none"),
    fallbackReason: payload.fallbackReason || "",
    fallbackAllowed: payload.fallbackAllowed === true,
    externalProviderUsed: payload.externalProviderUsed === true,
    safety: {
      redacted: true,
      usedPersonalContext: Boolean(payload.usedPersonalContext),
      provider: payload.provider || "mock",
      desiredProvider: payload.desiredProvider || payload.provider || "mock",
      resolvedProvider: payload.resolvedProvider || payload.provider || "mock",
      mode: "tool-grounded",
      providerPolicy: payload.providerPolicy || getProviderPolicy(),
      externalProviderUsed: payload.externalProviderUsed === true,
      providerDecisionReason: payload.providerDecisionReason || "",
      fallbackReason: payload.fallbackReason || "",
      pendingClarification: payload.pendingClarification || null,
      clearPendingClarification: payload.clearPendingClarification === true,
      runtimeMode: envelope.canonicalRuntimeMode,
      requestedRuntimeMode: payload.requestedRuntimeMode || envelope.canonicalRuntimeMode,
      competitionAuthorized: payload.competitionAuthorized === true,
      validationOk: validation.ok,
    },
    metrics: normalizeMetrics(payload.metrics, {
      intent: payload.intent,
      toolCalls: rawToolCalls,
      externalProviderUsed: payload.externalProviderUsed === true,
      fallback: payload.externalProviderUsed !== true,
      usedPersonalContext: payload.usedPersonalContext === true,
    }),
    memory: payload.memory || {
      mode: "local_only",
      authenticated: false,
      persisted: false,
      synced: false,
      revision: 0,
      expiresAt: "",
      summaryAvailable: false,
      canClear: false,
    },
    errors,
    serverTime: nowIso(),
  };
  if (requestedProtocolVersion === agentProtocol.PROTOCOL_V2) {
    response.memoryPreferencePatch = payload.memoryPreferencePatch || {};
  }
  if (payload.proactiveSuggestion) {
    response.proactiveSuggestion = normalizeProactiveSuggestion(payload.proactiveSuggestion);
  }
  if (payload.reusedToolCount != null) response.reusedToolCount = Number(payload.reusedToolCount) || 0;
  if (payload.avoidedDuplicateCalls != null) response.avoidedDuplicateCalls = Number(payload.avoidedDuplicateCalls) || 0;
  if (payload.replanReason) response.replanReason = String(payload.replanReason).slice(0, 120);
  if (payload.partialCompletion === true) response.partialCompletion = true;
  if (payload.goalContract) response.goalContract = payload.goalContract;
  const safeResponse = isPublicRuntime(envelope.canonicalRuntimeMode) ? sanitizePublicResponse(response) : response;
  if (requestedProtocolVersion === agentProtocol.PROTOCOL_V2) {
    return agentProtocol.buildV2Response(Object.assign({}, safeResponse, {
      protocolVersion: agentProtocol.PROTOCOL_V2,
      runtimeMode: envelope.canonicalRuntimeMode,
      intent: payload.intent,
      plan: payload.plan,
      skill: payload.skill,
      steps: payload.steps || taskSteps,
      observations: payload.observations || safeResponse.observations,
      evidence: safeResponse.evidence,
      memory: safeResponse.memory,
      errors: safeResponse.errors,
      presentationMode: safeResponse.presentationMode || payload.presentationMode || "",
      presentation: safeResponse.presentation || payload.presentation || null,
      runSummary: safeResponse.runSummary || payload.runSummary || null,
      taskTrajectory: safeResponse.taskTrajectory || payload.taskTrajectory || null,
      evidenceDisplay: safeResponse.evidenceDisplay || payload.evidenceDisplay || null,
      planMeta: safeResponse.planMeta || null,
      metrics: safeResponse.metrics,
    }));
  }
  return safeResponse;
}

function sensitiveCredentialResponse(message, context, startTime, providerRuntimeConfig, metadata = {}) {
  const guide = toolRegistry.executeTool("explain_personal_import", { mode: "xls", message }, context);
  const generated = mockProvider.generate({
    intent: { name: "explain_personal_import" },
    toolResults: [{ name: "explain_personal_import", status: "success", summary: "敏感信息拦截后返回安全导入指引", result: guide }],
  });
  const stable = stableGeneratedPayload(generated);
  const response = buildResponse(Object.assign({}, stable, {
    protocolVersion: metadata.protocolVersion,
    requestId: metadata.requestId,
    conversationId: metadata.conversationId,
    runtimeMode: metadata.runtimeMode || "public",
    requestedRuntimeMode: metadata.requestedRuntimeMode,
    runId: metadata.runId,
    intent: { name: "explain_personal_import", confidence: 1, slots: {} },
    skill: metadata.skill || null,
    fallback: true,
    fallbackLayer: "server",
    fallbackAllowed: false,
    answer: "系统不能接收或处理学号、密码、Cookie、token 等敏感信息。请不要在查询框里输入这些内容；如需导入个人课表，请打开个人课表同步页面。",
    toolCalls: [{ name: "safety_guard", status: "skipped", summary: "检测到敏感凭证，已拦截并脱敏" }],
    provider: "mock",
    usedPersonalContext: false,
    providerPolicy: getProviderPolicy(providerRuntimeConfig),
    externalProviderUsed: false,
    fallbackReason: "检测到敏感凭证",
    memory: metadata.memory || {
      mode: "local_only",
      authenticated: false,
      persisted: false,
      synced: false,
      revision: 0,
      expiresAt: "",
      summaryAvailable: false,
      canClear: false,
    },
    metrics: buildMetrics({
      startTime,
      intentName: "sensitive_credential_response",
      toolCalls: [{ name: "safety_guard", status: "skipped", result: {} }],
      externalProviderUsed: false,
      fallback: true,
      usedPersonalContext: false,
    }),
  }));
  return response;
}

function mergeGeneratedPayloads(options = {}) {
  const intent = options.intent || {};
  const deterministic = options.deterministicPayload || { answer: "", cards: [], suggestions: [] };
  const provider = options.providerPayload || { answer: "", cards: [], suggestions: [] };
  if (isProjectKnowledgeIntent(intent) && options.externalProviderUsed === true) {
    return {
      answer: provider.answer || deterministic.answer,
      cards: provider.cards && provider.cards.length ? provider.cards : deterministic.cards,
      suggestions: provider.suggestions && provider.suggestions.length ? provider.suggestions : deterministic.suggestions,
    };
  }
  return {
    answer: deterministic.answer || provider.answer || "我已根据项目工具整理出结果。",
    cards: deterministic.cards || [],
    suggestions: deterministic.suggestions && deterministic.suggestions.length
      ? deterministic.suggestions
      : (provider.suggestions || []),
  };
}

function buildClarificationPatch(intent = {}) {
  if (!intent || intent.name !== "clarify_missing_slot") {
    return { pendingClarification: null, clearPendingClarification: false };
  }
  const slot = intent.slots && intent.slots.slot || {};
  const type = ["teacher", "classroom", "course", "class"].includes(slot.type) ? slot.type : "";
  if (!type) {
    return { pendingClarification: null, clearPendingClarification: false };
  }
  const createdAt = Date.now();
  return {
    pendingClarification: {
      intentName: "search_school_index",
      type,
      missing: slot.missing || `${type}Name`,
      createdAt,
      expiresAt: createdAt + 5 * 60 * 1000,
    },
    clearPendingClarification: false,
  };
}

async function chat(input = {}) {
  const startTime = Date.now();
  const rawMessage = String(input.message || "").trim();
  const safeMessage = safetyGuard.redactSensitiveText(rawMessage).slice(0, 2000);
  let context = safetyGuard.sanitizeAgentContext(input.context || {});
  const runtimeDecision = runtimeModeService.resolveRuntimeMode({
    context,
    serverSession: input.serverSession,
    runtimeMode: input.runtimeMode,
  });
  context.runtimeMode = runtimeDecision.runtimeMode;
  context.serverSession = input.serverSession || context.serverSession || null;
  const requestId = input.requestId || agentProtocol.createRequestId();
  const conversationId = input.conversationId || context.conversationId || "";
  const requestedProtocolVersion = input.protocolVersion || context.protocolVersion || agentProtocol.PROTOCOL_VERSION;
  const protocolVersion = agentProtocol.normalizeProtocolVersion(requestedProtocolVersion);
  const runId = input.runId || agentProtocol.createRunId();
  const eventInput = Object.assign({}, input, {
    runtimeMode: runtimeDecision.runtimeMode,
    onEvent: input.onEvent,
  });
  emitChatEvent(eventInput, {
    type: "request.sanitized",
    runtimeMode: runtimeDecision.runtimeMode,
    status: "sanitized",
  });
  if (input.runId && agentRunEventService.isCancelled(runId)) {
    emitChatEvent(eventInput, { type: "run.cancelled", runtimeMode: runtimeDecision.runtimeMode });
    return buildResponse({
      protocolVersion,
      runId,
      requestId,
      conversationId,
      runtimeMode: runtimeDecision.runtimeMode,
      requestedRuntimeMode: runtimeDecision.requestedMode,
      competitionAuthorized: runtimeDecision.authorized,
      answer: "",
      cards: [],
      suggestions: [],
      toolCalls: [],
      provider: "mock",
      providerPolicy: "tool-only",
      externalProviderUsed: false,
      fallback: false,
      fallbackLayer: "none",
      success: true,
      status: "cancelled",
      intent: { name: "conversational_help", slots: {} },
      plan: [],
      steps: [],
      metrics: buildMetrics({ startTime, intentName: "cancelled", toolCalls: [] }),
    });
  }

  let memoryBundle = {
    principal: { authenticated: false, principalKey: "", runtimeMode: runtimeDecision.runtimeMode },
    state: null,
    memory: {
      mode: "local_only",
      authenticated: false,
      persisted: false,
      synced: false,
      revision: 0,
      expiresAt: "",
      summaryAvailable: false,
      canClear: false,
    },
    context,
  };
  let conversationState = null;
  try {
    // Unified MemoryController: working + thread + user memory (single authoritative path).
    memoryBundle = defaultMemoryController.load({
      serverSession: input.serverSession,
      runtimeMode: runtimeDecision.runtimeMode,
      conversationId,
      message: safeMessage,
      context,
      memoryMode: context.memoryMode,
    });
    conversationState = memoryBundle.conversationState || null;
    context = safetyGuard.sanitizeAgentContext(memoryBundle.context || context);
    context.runtimeMode = runtimeDecision.runtimeMode;
    context.serverSession = input.serverSession || null;
    if (conversationState) {
      context.conversationSummary = conversationState.conversationSummary || context.conversationSummary;
      context.workingMemory = conversationState.workingMemory || context.workingMemory;
      context.userMemories = conversationState.userMemories || context.userMemories || [];
      context.recentMessages = conversationState.recentMessages || context.recentMessages;
    }
  } catch (error) {
    memoryBundle.memory = {
      mode: "local_only",
      authenticated: Boolean(input.serverSession && input.serverSession.openidHash),
      persisted: false,
      synced: false,
      revision: 0,
      expiresAt: "",
      summaryAvailable: false,
      canClear: false,
    };
    conversationState = null;
  }

  const providerRuntimeConfig = providerConfigService.resolveRuntimeProviderConfig({
    context,
    runtimeMode: runtimeDecision.runtimeMode,
  });
  context.assistantEnvironment = providerConfigService.getEnvironmentForContext(context, runtimeDecision.runtimeMode);
  if (!agentProtocol.isSupportedProtocolVersion(input.protocolVersion || context.protocolVersion || agentProtocol.PROTOCOL_VERSION)) {
    recordEarlyTrace({
      runId,
      requestId,
      conversationId,
      runtimeMode: "public",
      startTime,
      intent: "clarify_missing_slot",
      fallbackReason: "PROTOCOL_VERSION_UNSUPPORTED",
      errorCode: "PROTOCOL_VERSION_UNSUPPORTED",
    });
    return buildResponse({
      protocolVersion: agentProtocol.PROTOCOL_VERSION,
      runId,
      requestId,
      conversationId,
      runtimeMode: "public",
      requestedRuntimeMode: runtimeDecision.requestedMode,
      competitionAuthorized: false,
      answer: "当前小佛协议版本不兼容，请刷新小程序后再试。",
      cards: [],
      suggestions: ["刷新后重试", "查看使用说明"],
      toolCalls: [],
      provider: "mock",
      providerPolicy: "tool-only",
      externalProviderUsed: false,
      fallbackReason: "PROTOCOL_VERSION_UNSUPPORTED",
      fallback: true,
      fallbackLayer: "server",
      fallbackAllowed: true,
      success: false,
      errors: [{ code: "PROTOCOL_VERSION_UNSUPPORTED" }],
      intent: { name: "clarify_missing_slot", slots: {} },
      plan: [],
      memory: memoryBundle.memory,
      metrics: buildMetrics({ startTime, intentName: "protocol_version_unsupported", toolCalls: [] }),
    });
  }
  const usedPersonalContext = Boolean(context.currentScheduleSummary &&
    context.currentScheduleSummary.enabled &&
    context.currentScheduleSummary.courses &&
    context.currentScheduleSummary.courses.length);

  if (!rawMessage) {
    const generic = mockProvider.generate({ intent: { name: "generic" }, toolResults: [] });
    const stable = stableGeneratedPayload(generic);
    const response = buildResponse(Object.assign({}, stable, {
      protocolVersion,
      runId,
      requestId,
      conversationId,
      runtimeMode: runtimeDecision.runtimeMode,
      requestedRuntimeMode: runtimeDecision.requestedMode,
      competitionAuthorized: runtimeDecision.authorized,
      toolCalls: [],
      intent: { name: "conversational_help", slots: {} },
      plan: [],
      provider: "mock",
      usedPersonalContext,
      providerPolicy: getProviderPolicy(providerRuntimeConfig),
      externalProviderUsed: false,
      fallback: true,
      fallbackLayer: "server",
      fallbackReason: "空消息",
      memory: memoryBundle.memory,
      metrics: buildMetrics({
        startTime,
        intentName: "generic",
        toolCalls: [],
        externalProviderUsed: false,
        fallback: true,
        usedPersonalContext,
      }),
    }));
    recordEarlyTrace({
      runId,
      requestId,
      conversationId,
      runtimeMode: runtimeDecision.runtimeMode,
      startTime,
      intent: "conversational_help",
      selectedSkill: "knowledge_search",
      fallbackReason: "EMPTY_MESSAGE",
      errorCode: "EMPTY_MESSAGE",
    });
    return response;
  }

  if (safetyGuard.hasSensitiveCredential(rawMessage)) {
    const response = sensitiveCredentialResponse(safeMessage, context, startTime, providerRuntimeConfig, {
      protocolVersion,
      requestId,
      conversationId,
      runtimeMode: runtimeDecision.runtimeMode,
      requestedRuntimeMode: runtimeDecision.requestedMode,
      runId,
      memory: memoryBundle.memory,
    });
    recordEarlyTrace({
      runId,
      requestId,
      conversationId,
      runtimeMode: runtimeDecision.runtimeMode,
      startTime,
      intent: "explain_personal_import",
      selectedSkill: "personal_schedule_import_help",
      fallbackReason: "SENSITIVE_CREDENTIAL_BLOCKED",
      errorCode: "SENSITIVE_CREDENTIAL_BLOCKED",
    });
    return response;
  }

  const personalMemoryTurn = resolvePersonalMemoryTurn({
    message: safeMessage,
    context,
    principal: memoryBundle.principal,
    memoryMode: memoryBundle.memory && memoryBundle.memory.mode || context.memoryMode,
    preferenceService: defaultUserPreferenceService,
  });
  if (personalMemoryTurn.handled) {
    emitChatEvent(eventInput, {
      type: "response.composing",
      runtimeMode: runtimeDecision.runtimeMode,
      intentName: personalMemoryTurn.intentName,
      providerUsed: false,
    });
    const memoryIntent = {
      name: personalMemoryTurn.intentName,
      confidence: 1,
      slots: personalMemoryTurn.preferencePatch || {},
    };
    const preferenceActions = Array.isArray(personalMemoryTurn.actions) ? personalMemoryTurn.actions : [];
    const preferenceCards = preferenceActions.length
      ? [{
        type: "reminder",
        title: personalMemoryTurn.preferencePatch && personalMemoryTurn.preferencePatch.defaultReminderLeadMinutes
          ? "默认提醒已更新"
          : "提醒偏好",
        subtitle: personalMemoryTurn.preferencePatch && personalMemoryTurn.preferencePatch.defaultReminderLeadMinutes
          ? `上课前 ${personalMemoryTurn.preferencePatch.defaultReminderLeadMinutes} 分钟 · 可一键创建`
          : "可直接点选，或打开智能课程提醒面板",
        badges: ["智能配置", "本机偏好"],
        actions: preferenceActions.slice(0, 3),
      }]
      : [];
    const response = attachMemory(buildResponse({
      protocolVersion,
      runId,
      requestId,
      conversationId,
      runtimeMode: runtimeDecision.runtimeMode,
      requestedRuntimeMode: runtimeDecision.requestedMode,
      competitionAuthorized: runtimeDecision.authorized,
      answer: personalMemoryTurn.answer,
      cards: preferenceCards,
      suggestions: personalMemoryTurn.intentName === "update_user_preference"
        ? ["打开智能课程提醒", "默认提前20分钟提醒我", "默认提前30分钟提醒我"]
        : [],
      toolCalls: [],
      intent: memoryIntent,
      plan: [],
      steps: [],
      observations: [],
      skill: {
        id: "personal_memory",
        version: "1.0.0",
        description: "显式偏好与会话上下文",
      },
      provider: "mock",
      desiredProvider: "mock",
      resolvedProvider: "mock",
      providerPolicy: "tool-only",
      externalProviderUsed: false,
      fallback: false,
      fallbackLayer: "none",
      memory: memoryBundle.memory,
      memoryPreferencePatch: personalMemoryTurn.preferencePatch || {},
      context,
      metrics: buildMetrics({
        startTime,
        intentName: personalMemoryTurn.intentName,
        toolCalls: [],
        externalProviderUsed: false,
        fallback: false,
        usedPersonalContext: Boolean(personalMemoryTurn.source && personalMemoryTurn.source !== "none"),
      }),
    }), memoryBundle, {
      message: safeMessage,
      answer: personalMemoryTurn.answer,
      intentName: personalMemoryTurn.intentName,
      context,
      runId,
      status: "completed",
      stepCount: 0,
      contextSlots: buildContextSlots(memoryIntent, Object.assign(
        {},
        personalMemoryTurn.sessionFacts || {},
        personalMemoryTurn.preferencePatch || {}
      )),
      clearPendingClarification: false,
      cloudSyncEnabled: context.cloudSyncEnabled === true || (memoryBundle.memory && memoryBundle.memory.mode === "cloud_sync"),
      preferencePatch: personalMemoryTurn.preferencePatch || {},
      memoryCandidates: personalMemoryTurn.memoryCandidates || [],
      preferredName: (personalMemoryTurn.preferencePatch && personalMemoryTurn.preferencePatch.preferredName)
        || (personalMemoryTurn.sessionFacts && personalMemoryTurn.sessionFacts.preferredName)
        || "",
      autoMemoryEnabled: context.autoMemoryEnabled !== false,
    });
    if (personalMemoryTurn.autoMemoryHint && !response.autoMemoryHint) {
      response.autoMemoryHint = personalMemoryTurn.autoMemoryHint;
    }
    maybeAttachProactive(response, { context, proactiveEvent: context.proactiveEvent }, memoryBundle, []);
    recordEarlyTrace({
      runId,
      requestId,
      conversationId,
      runtimeMode: runtimeDecision.runtimeMode,
      startTime,
      intent: personalMemoryTurn.intentName,
      selectedSkill: "personal_memory",
    });
    emitChatEvent(eventInput, {
      type: "run.completed",
      runtimeMode: runtimeDecision.runtimeMode,
      intentName: personalMemoryTurn.intentName,
      providerUsed: false,
    });
    return response;
  }

  const ruleResolution = resolveRuleBackedIntent(safeMessage, context);
  // Follow-up inheritance: “那周三呢 / 下午呢 / 换成第17周” reuses working memory entities.
  const intent = enrichIntentFromWorkingMemory(ruleResolution.intent, context, conversationState);
  const localRuleMatch = ruleResolution.ruleMatch;

  // Dedicated planner model adapter (trial/dev only). public never calls models.
  const plannerGenerate = plannerModelAdapter.createModelGenerate({
    runtimeMode: runtimeDecision.runtimeMode,
    providerRuntimeConfig,
    onEvent: (event) => emitChatEvent(eventInput, Object.assign({
      runtimeMode: runtimeDecision.runtimeMode,
      intentName: intent.name,
    }, event)),
  });

  const execution = await agentKernel.execute({
    message: safeMessage,
    context,
    contextAlreadySanitized: true,
    runtimeDecision,
    intent,
    conversationState: conversationState || {
      conversationSummary: context.conversationSummary || "",
      summary: context.conversationSummary || "",
      recentMessages: context.recentMessages || [],
      workingMemory: context.workingMemory || null,
      userMemories: context.userMemories || [],
      pendingClarification: context.pendingClarification || null,
      contextSlots: context.conversationSlots || {},
    },
    requestId,
    conversationId,
    runId,
    onEvent: input.onEvent,
    modelGenerate: runtimeDecision.runtimeMode === "public" ? undefined : plannerGenerate,
  });
  const plan = execution.plan;
  const toolCalls = execution.toolCalls;
  const plannerDiag = typeof plannerGenerate.getDiagnostics === "function"
    ? plannerGenerate.getDiagnostics()
    : { plannerProvider: "none", plannerLatency: 0, plannerFallback: false, plannerStatus: "not_called" };
  // Prefer structured plan metadata when available (array plan loses plannerType).
  const planType = (plan && plan.plannerType)
    || (Array.isArray(plan) ? "" : "")
    || "";
  if (planType === "model" || planType === "model_replan" || plannerDiag.plannerStatus === "ok") {
    plannerDiag.plannerFallback = false;
    if (plannerDiag.plannerStatus === "not_called") plannerDiag.plannerStatus = "ok";
    if (plan && plan.plannerProvider) plannerDiag.plannerProvider = plan.plannerProvider;
    if (plan && plan.plannerLatencyMs) {
      plannerDiag.plannerLatency = Math.max(
        Number(plannerDiag.plannerLatency) || 0,
        Number(plan.plannerLatencyMs) || 0
      );
    }
    if (!planType && plannerDiag.successCount) {
      plannerDiag.inferredPlannerType = "model";
    } else if (planType) {
      plannerDiag.inferredPlannerType = planType;
    }
  } else if (planType === "deterministic_fallback" || plannerDiag.plannerStatus === "failed") {
    plannerDiag.plannerFallback = true;
    plannerDiag.inferredPlannerType = planType || "deterministic_fallback";
  } else if (runtimeDecision.runtimeMode === "public") {
    plannerDiag.inferredPlannerType = "deterministic";
    plannerDiag.plannerProvider = "none";
  } else {
    plannerDiag.inferredPlannerType = planType || "deterministic";
  }
  const publicToolCalls = toolCalls.map((item) => ({
    name: safetyGuard.redactSensitiveText(item.name || "").slice(0, 60),
    status: safetyGuard.redactSensitiveText(item.status || "").slice(0, 20),
    summary: safetyGuard.redactSensitiveText(item.summary || "").slice(0, 160),
  }));

  if (input.runId && agentRunEventService.isCancelled(runId)) {
    emitChatEvent(eventInput, { type: "run.cancelled", runtimeMode: runtimeDecision.runtimeMode });
    return buildResponse({
      protocolVersion,
      runId,
      requestId,
      conversationId,
      runtimeMode: runtimeDecision.runtimeMode,
      requestedRuntimeMode: runtimeDecision.requestedMode,
      competitionAuthorized: runtimeDecision.authorized,
      answer: "",
      cards: [],
      suggestions: [],
      toolCalls: publicToolCalls,
      provider: "mock",
      providerPolicy: "tool-only",
      externalProviderUsed: false,
      success: true,
      status: "cancelled",
      intent,
      plan,
      steps: execution.steps,
      metrics: buildMetrics({ startTime, intent, toolCalls, fallback: false }),
    });
  }

  if (runtimeDecision.runtimeMode === "public" &&
    !isFactToolIntent(intent) &&
    !isProjectKnowledgeIntent(intent) &&
    intent.name !== "explain_personal_import" &&
    intent.name !== "clarify_missing_slot") {
    emitChatEvent(eventInput, {
      type: "response.composing",
      runtimeMode: runtimeDecision.runtimeMode,
      intentName: intent.name,
      providerUsed: false,
    });
    const publicPlain = responseComposer.compose({
      answer: intent.name === "conversational_help"
        ? "你好，我是小佛。正式版里我可以帮你查课表、空教室、教学周和产品使用说明。"
        : "小佛目前只提供佛课小表、课表、课程查询和使用帮助。",
      cards: [],
      suggestions: [],
      intentName: intent.name,
      intent,
      runtimeMode: "public",
      toolCalls: publicToolCalls,
      steps: [],
      generalAssistant: false,
    });
    const response = attachMemory(buildResponse({
      protocolVersion,
      runId,
      answer: publicPlain.answer,
      cards: publicPlain.cards,
      suggestions: publicPlain.suggestions,
      presentationMode: publicPlain.presentationMode,
      presentation: publicPlain,
      runSummary: null,
      taskTrajectory: null,
      toolCalls: publicToolCalls,
      provider: "mock",
      desiredProvider: "mock",
      resolvedProvider: "mock",
      providerPolicy: "tool-only",
      externalProviderUsed: false,
      fallbackReason: "AI_RUNTIME_MODE=public",
      requestId,
      conversationId,
      runtimeMode: runtimeDecision.runtimeMode,
      requestedRuntimeMode: runtimeDecision.requestedMode,
      competitionAuthorized: runtimeDecision.authorized,
      intent,
      plan,
      skill: execution.skill,
      steps: execution.steps,
      observations: execution.observations,
      context,
      rawToolCalls: toolCalls,
      fallback: true,
      fallbackLayer: "server",
      metrics: buildMetrics({
        startTime,
        intentName: intent.name,
        toolCalls,
        externalProviderUsed: false,
        fallback: true,
        usedPersonalContext,
        plannerType: plan && plan.plannerType || "deterministic",
        plannerProvider: "none",
        responseProvider: "mock",
      }),
      errors: execution.verification && execution.verification.errors || [],
      verification: execution.verification || null,
    }), memoryBundle, {
      message: safeMessage,
      intentName: intent.name,
      context,
      runId,
      status: "completed",
      stepCount: (execution.steps || []).length,
      contextSlots: buildContextSlots(intent, intent.slots || {}),
      pendingClarification: null,
      clearPendingClarification: true,
      evidence: null,
    });
    agentKernel.finalize(execution, {
      totalDurationMs: Date.now() - startTime,
      providerUsed: false,
      fallbackLayer: "server",
      fallbackReason: "AI_RUNTIME_MODE=public",
      evidenceComplete: response.evidence && response.evidence.complete === true,
    });
    return response;
  }

  const providerPolicy = getProviderPolicy(providerRuntimeConfig);
  const desiredProviderName = providerFactory.getProviderName(runtimeDecision.runtimeMode, providerRuntimeConfig);
  const policyDecision = evaluateProviderPolicy(intent, toolCalls, providerPolicy, desiredProviderName, runtimeDecision.runtimeMode, providerRuntimeConfig);
  const provider = policyDecision.useExternal ? providerFactory.createProvider(runtimeDecision.runtimeMode, providerRuntimeConfig) : mockProvider;
  let providerName = policyDecision.useExternal
    ? (provider.name || desiredProviderName)
    : (intent.name === "clarify_missing_slot" ? "mock/template" : "mock");
  // 体验/开发对话类意图始终注入公开产品知识，帮助模型做人设化表达；不含私密部署信息。
  const shouldInjectProjectKnowledge = isProjectKnowledgeIntent(intent)
    || runtimeDecision.runtimeMode !== "public";
  const toolResultsForProvider = toolCalls.map((item) => ({
    name: item.name,
    status: item.status,
    summary: safetyGuard.redactSensitiveText(item.summary || ""),
    result: safetyGuard.sanitizeToolResult(item.result),
  }));
  const projectKnowledgeText = shouldInjectProjectKnowledge
    ? projectKnowledgeService.getProjectKnowledgePrompt(context.assistantEnvironment || runtimeDecision.runtimeMode, safeMessage)
    : "";
  // Budgeted response context — never dump unbounded history or full schedule into provider.
  const responseContext = assembleContext("response", {
    message: safeMessage,
    runtimeMode: runtimeDecision.runtimeMode,
    currentTeachingWeek: context.currentTeachingWeek,
    toolResults: toolResultsForProvider,
    toolCalls: toolResultsForProvider,
    projectKnowledge: projectKnowledgeText,
    history: Array.isArray(context.recentMessages) ? context.recentMessages : [],
    messages: Array.isArray(context.recentMessages) ? context.recentMessages : [],
    historyLimit: 10,
    conversationSummary: context.conversationSummary || "",
    userMemories: context.userMemories || [],
  });
  const providerInput = {
    message: safeMessage,
    context: buildMinimalProviderContext(context),
    intent,
    localRule: localRuleMatch && localRuleMatch.rule || null,
    projectKnowledge: projectKnowledgeText,
    providerRuntimeConfig,
    toolResults: toolResultsForProvider,
    contextMeta: {
      contextTokenEstimate: responseContext.contextTokenEstimate,
      contextSections: responseContext.sections,
      truncatedSections: responseContext.truncatedSections,
      compressionUsed: responseContext.compressionUsed === true,
    },
  };
  const deterministicGenerated = mockProvider.generate(providerInput);
  const deterministicPayload = stableGeneratedPayload(deterministicGenerated, {
    fallbackAnswer: "我已根据项目工具整理出结果。",
  });
  let providerPayload = null;
  let externalProviderUsed = false;
  let fallback = !policyDecision.useExternal;
  let fallbackReason = "";
  let responseLatencyMs = 0;
  const providerDecisionReason = policyDecision.reason || (policyDecision.useExternal ? "external provider selected" : "local provider selected");
  try {
    const responseStartedAt = Date.now();
    const generated = policyDecision.useExternal
      ? await providerChainService.generateWithChain(providerInput, {
        runtimeMode: runtimeDecision.runtimeMode,
        providerRuntimeConfig,
        principal: memoryBundle.principal,
        onEvent: (event) => emitChatEvent(eventInput, Object.assign({
          runtimeMode: runtimeDecision.runtimeMode,
          intentName: intent.name,
        }, event)),
      })
      : deterministicGenerated;
    responseLatencyMs = Date.now() - responseStartedAt;
    if (!policyDecision.useExternal) {
      emitChatEvent(eventInput, {
        type: "response.composing",
        runtimeMode: runtimeDecision.runtimeMode,
        intentName: intent.name,
        providerUsed: false,
      });
    }
    providerName = generated.provider || providerName;
    providerPayload = stableGeneratedPayload(generated);
    externalProviderUsed = policyDecision.useExternal && providerName !== "mock";
    fallback = !externalProviderUsed;
    if (externalProviderUsed) fallbackReason = "";
    if (generated.providerChain) {
      publicToolCalls.push({
        name: "provider_chain",
        status: externalProviderUsed ? "success" : "skipped",
        summary: externalProviderUsed ? "external_provider_used" : "deterministic_fallback",
      });
      if (!externalProviderUsed) {
        fallbackReason = summarizeProviderChainFallback(generated.providerChain);
        emitChatEvent(eventInput, {
          type: "run.degraded",
          runtimeMode: runtimeDecision.runtimeMode,
          intentName: intent.name,
          reasonCode: String(fallbackReason || "PROVIDER_FALLBACK").slice(0, 80),
          providerUsed: false,
        });
      }
    }
  } catch (error) {
    providerName = "mock";
    externalProviderUsed = false;
    fallback = true;
    fallbackReason = classifyProviderFailure(error);
    emitChatEvent(eventInput, {
      type: "provider.failed",
      runtimeMode: runtimeDecision.runtimeMode,
      intentName: intent.name,
      reasonCode: String(fallbackReason || "provider_failed").slice(0, 80),
      providerUsed: false,
    });
    providerPayload = isProjectKnowledgeIntent(intent)
      ? stableGeneratedPayload(projectKnowledgeService.generateFallbackResponse(intent.name))
      : null;
    publicToolCalls.push({
      name: provider.name || providerFactory.getProviderName(runtimeDecision.runtimeMode, providerRuntimeConfig),
      status: "skipped",
      summary: fallbackReason,
    });
  }

  emitChatEvent(eventInput, {
    type: "response.composing",
    runtimeMode: runtimeDecision.runtimeMode,
    intentName: intent.name,
    providerUsed: externalProviderUsed,
  });

  const stable = mergeGeneratedPayloads({
    intent,
    providerPolicy,
    deterministicPayload,
    providerPayload,
    externalProviderUsed,
  });
  const pendingPatch = buildClarificationPatch(intent);
  if (intent.name !== "clarify_missing_slot" && intent.slots && intent.slots.filledFromPendingClarification) {
    pendingPatch.clearPendingClarification = true;
  } else if (intent.name !== "clarify_missing_slot" && context.pendingClarification) {
    pendingPatch.clearPendingClarification = true;
  }
  const composed = responseComposer.compose({
    answer: stable.answer,
    cards: stable.cards,
    suggestions: stable.suggestions,
    intentName: intent.name,
    intent,
    runtimeMode: runtimeDecision.runtimeMode,
    toolCalls: publicToolCalls,
    steps: execution.steps,
    plan: execution.plan || plan,
    needsClarification: intent.name === "clarify_missing_slot" || (execution.plan && execution.plan.needsClarification),
    clarification: execution.plan && execution.plan.clarification,
    generalAssistant: isGeneralAssistantEnabled(runtimeDecision.runtimeMode),
    context,
    message: safeMessage,
    userMessage: safeMessage,
    durationMs: Date.now() - startTime,
    replanUsed: execution.replanUsed === true,
    success: true,
    status: fallbackReason ? "degraded" : "completed",
    errors: execution.verification && execution.verification.errors || [],
  });
  const response = attachMemory(buildResponse(Object.assign({}, stable, {
    answer: composed.answer,
    cards: composed.cards,
    suggestions: composed.suggestions,
    presentationMode: composed.presentationMode,
    presentation: composed,
    evidenceDisplay: composed.evidence,
    runSummary: composed.runSummary,
    feedback: composed.feedback,
    protocolVersion,
    runId,
    requestId,
    conversationId,
    runtimeMode: runtimeDecision.runtimeMode,
    requestedRuntimeMode: runtimeDecision.requestedMode,
    competitionAuthorized: runtimeDecision.authorized,
    toolCalls: publicToolCalls,
    rawToolCalls: toolCalls,
    intent,
    plan: execution.plan || plan,
    skill: execution.skill,
    steps: execution.steps,
    observations: execution.observations,
    context,
    provider: providerName,
    desiredProvider: desiredProviderName,
    resolvedProvider: providerName,
    usedPersonalContext,
    providerPolicy,
    externalProviderUsed,
    providerDecisionReason,
    fallbackReason,
    fallback: Boolean(fallbackReason),
    fallbackLayer: fallbackReason ? "server" : "none",
    pendingClarification: pendingPatch.pendingClarification,
    clearPendingClarification: pendingPatch.clearPendingClarification,
    errors: execution.verification && execution.verification.errors || [],
    verification: execution.verification || null,
    reusedToolCount: execution.reusedToolCount || 0,
    avoidedDuplicateCalls: execution.avoidedDuplicateCalls || 0,
    replanReason: execution.replanReason || "",
    partialCompletion: execution.partialCompletion === true,
    goalContract: execution.goalContract || (execution.verification && execution.verification.goalContract) || null,
    metrics: buildMetrics({
      startTime,
      intent,
      toolCalls,
      externalProviderUsed,
      fallback,
      usedPersonalContext,
      plannerProvider: plannerDiag.plannerProvider || (plan && plan.plannerProvider) || "none",
      responseProvider: providerName,
      plannerLatency: plannerDiag.plannerLatency || (plan && plan.plannerLatencyMs) || 0,
      responseLatency: responseLatencyMs,
      plannerFallback: plannerDiag.plannerFallback === true,
      responseFallback: Boolean(fallbackReason),
      plannerType: plannerDiag.inferredPlannerType || (plan && plan.plannerType) || "",
    }),
    taskTrajectory: composed.taskTrajectory || null,
    contextMeta: providerInput.contextMeta || null,
  })), memoryBundle, {
    message: safeMessage,
    intentName: intent.name,
    context,
    runId,
    status: fallbackReason ? "degraded" : (execution.partialCompletion ? "partial" : "completed"),
    stepCount: (execution.steps || []).length,
    contextSlots: buildContextSlots(intent, intent.slots || {}),
    pendingClarification: pendingPatch.pendingClarification,
    clearPendingClarification: pendingPatch.clearPendingClarification,
    answer: composed.answer,
    evidence: null,
    cloudSyncEnabled: context.cloudSyncEnabled === true || (memoryBundle.memory && memoryBundle.memory.mode === "cloud_sync"),
    allowPartialCommit: true,
    autoMemoryEnabled: context.autoMemoryEnabled !== false,
  });
  maybeAttachProactive(response, { context, proactiveEvent: context.proactiveEvent }, memoryBundle, toolCalls);
  attachReminderConfirmation(response, execution, memoryBundle.principal);
  agentKernel.finalize(execution, {
    totalDurationMs: Date.now() - startTime,
    providerUsed: externalProviderUsed,
    fallbackLayer: fallbackReason ? "server" : "none",
    fallbackReason,
    evidenceComplete: response.evidence && response.evidence.complete === true,
    plannerType: plan && plan.plannerType,
    plannerProvider: plannerDiag.plannerProvider,
  });
  emitChatEvent(eventInput, {
    type: fallbackReason ? "run.degraded" : "run.completed",
    runtimeMode: runtimeDecision.runtimeMode,
    intentName: intent.name,
    providerUsed: externalProviderUsed,
    reasonCode: fallbackReason ? String(fallbackReason).slice(0, 80) : "",
    plannerType: plan && plan.plannerType || "",
  });
  return response;
}

function attachMemory(response, memoryBundle, options = {}) {
  const status = options.status || response.status;
  if (status === "cancelled" || response.status === "cancelled") {
    response.memory = memoryBundle && memoryBundle.memory || {
      mode: "local_only",
      authenticated: false,
      persisted: false,
      synced: false,
      revision: 0,
    };
    return response;
  }
  // Unified commit path: working + thread + user memory candidates.
  const commitResult = defaultMemoryController.commit({
    principal: memoryBundle && memoryBundle.principal,
    state: memoryBundle && memoryBundle.state,
    memoryBundle,
    conversationId: response.conversationId,
    memoryMode: memoryBundle && memoryBundle.memory && memoryBundle.memory.mode,
    cloudSyncEnabled: options.cloudSyncEnabled === true,
    message: options.message,
    answer: options.answer || response.answer,
    intentName: options.intentName || (response.intent && response.intent.name) || response.intent,
    context: options.context,
    runId: options.runId || response.runId,
    status,
    stepCount: options.stepCount || (Array.isArray(response.steps) ? response.steps.length : 0),
    contextSlots: options.contextSlots || response.contextSlots || response.slots,
    slots: options.slots || response.slots,
    pendingClarification: options.pendingClarification,
    clearPendingClarification: options.clearPendingClarification,
    evidence: options.evidence || response.evidence,
    failed: response.success === false,
    cancelled: status === "cancelled",
    securityBlocked: false,
    toolCalls: options.toolCalls || response.toolCalls,
    observations: options.observations || response.observations,
    preferencePatch: options.preferencePatch || response.memoryPreferencePatch,
    preferredName: options.preferredName,
    memoryCandidates: options.memoryCandidates || [],
    providerPayload: options.providerPayload || null,
    autoMemoryEnabled: options.autoMemoryEnabled !== false,
    allowPartialCommit: options.allowPartialCommit === true,
  });
  const memory = commitResult.memory;
  response.memory = memory;
  if (commitResult.autoMemoryHints && commitResult.autoMemoryHints.length) {
    response.autoMemoryHint = commitResult.autoMemoryHints[0];
  }
  if (commitResult.workingMemory) {
    const tw = commitResult.workingMemory.teachingWeek;
    const wd = commitResult.workingMemory.weekday;
    response.workingMemory = {
      className: commitResult.workingMemory.className || "",
      campus: commitResult.workingMemory.campus || "",
      teachingWeek: tw != null && Number(tw) >= 1 ? Number(tw) : null,
      weekday: wd != null && Number(wd) >= 1 ? Number(wd) : null,
      periodHint: commitResult.workingMemory.periodHint || "",
      preferredName: commitResult.workingMemory.preferredName || "",
      currentGoal: commitResult.workingMemory.currentGoal || "",
    };
  }
  if (response.safety && typeof response.safety === "object") {
    response.safety.memoryMode = memory.mode;
  }
  return response;
}

function buildServiceFailureResponse(input = {}, error = {}) {
  const protocolVersion = agentProtocol.isSupportedProtocolVersion(input.protocolVersion)
    ? agentProtocol.normalizeProtocolVersion(input.protocolVersion)
    : agentProtocol.PROTOCOL_VERSION;
  const requestId = input.requestId || agentProtocol.createRequestId();
  const conversationId = String(input.conversationId || "").slice(0, 80);
  const runId = input.runId || agentProtocol.createRunId();
  const runtimeMode = runtimeModeService.resolveRuntimeMode({
    context: safetyGuard.sanitizeAgentContext(input.context || {}),
    serverSession: input.serverSession,
  }).runtimeMode;
  const errorCode = String(error.code || "AGENT_SERVICE_UNAVAILABLE").slice(0, 80);
  recordEarlyTrace({
    runId,
    requestId,
    conversationId,
    runtimeMode,
    startTime: input.startTime || Date.now(),
    intent: "conversational_help",
    selectedSkill: "knowledge_search",
    fallbackReason: errorCode,
    errorCode,
  });
  return buildResponse({
    protocolVersion,
    requestId,
    conversationId,
    runId,
    runtimeMode,
    success: false,
    status: "failed",
    answer: "服务端 Agent 暂时不可用，客户端可以切换到离线降级能力。",
    cards: [{
      type: "generic",
      title: "服务暂不可用",
      subtitle: "可继续使用已缓存课表和本地校园入口。",
      badges: ["可降级"],
      items: [],
      actions: [],
    }],
    suggestions: ["查看今天课表", "打开全校课表", "打开空教室"],
    toolCalls: [],
    intent: { name: "conversational_help", confidence: 0, slots: {} },
    skill: { id: "knowledge_search", version: "1.0.0", description: "服务异常降级" },
    plan: [],
    steps: [],
    observations: [],
    evidence: {
      checkedAt: nowIso(),
      term: "",
      releaseVersion: "",
      currentWeek: "",
      sources: [],
      toolCount: 0,
      complete: false,
    },
    provider: "mock",
    providerPolicy: "tool-only",
    externalProviderUsed: false,
    fallback: true,
    fallbackLayer: "server",
    fallbackReason: errorCode,
    fallbackAllowed: true,
    errors: [{ code: errorCode }],
    memory: {
      mode: "local_only",
      authenticated: Boolean(input.serverSession && input.serverSession.openidHash),
      persisted: false,
      synced: false,
      revision: 0,
      expiresAt: "",
      summaryAvailable: false,
      canClear: false,
    },
    metrics: buildMetrics({
      startTime: input.startTime || Date.now(),
      intentName: "agent_service_failure",
      toolCalls: [],
      fallback: true,
    }),
  });
}

module.exports = {
  buildEvidence,
  buildServiceFailureResponse,
  chat,
  evaluateProviderPolicy,
  evaluateProactiveForRequest,
  shouldUseExternalProvider,
  stableAction,
  stableCard,
  stableGeneratedPayload,
  classifyProviderFailure,
  normalizeProactiveSuggestion,
};
