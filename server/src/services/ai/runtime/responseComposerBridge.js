const safetyGuard = require("../safetyGuard");
const agentProtocol = require("../agentProtocol");
const capabilityManifestService = require("../capabilityManifestService");
const generatedPayloadContract = require("../generatedPayloadContract");
const toolRegistry = require("../toolRegistry");
const mockProvider = require("../providers/mockProvider");
const {
  evaluateProactive,
  factsFromToolCalls,
  factsFromContext,
  TRIGGER_EVENTS: PROACTIVE_TRIGGER_EVENTS,
} = require("../proactiveEngine");
const { nowIso, isPublicRuntime, stableAction, stableCard, stableGeneratedPayload, getProviderPolicy } = require("./shared");
const { isProjectKnowledgeIntent } = require("./understandingCoordinator");

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

function deriveExecutionOutcome(input = {}) {
  const execution = input.execution || {};
  const verification = execution.verification && typeof execution.verification === "object"
    ? execution.verification
    : { ok: true, errors: [] };
  const errors = Array.isArray(verification.errors) ? verification.errors : [];
  const partialCompletion = execution.partialCompletion === true;
  const verificationOk = verification.ok !== false;
  let status = "completed";
  let eventType = "run.completed";
  if (partialCompletion) {
    status = "partial";
    eventType = "run.degraded";
  } else if (!verificationOk || errors.length > 0) {
    status = "failed";
    eventType = "run.failed";
  } else if (input.providerTruth && input.providerTruth.fallback === true) {
    status = "degraded";
    eventType = "run.degraded";
  }
  return {
    status,
    success: status !== "failed" && execution.success !== false,
    eventType,
    partialCompletion,
    verificationOk,
    errors,
  };
}

function deriveValidatedResponseStatus(payload = {}, errors = []) {
  const requested = String(payload.status || "").toLowerCase();
  if (requested === "cancelled") return "cancelled";
  if (requested === "failed" || requested === "error") return "failed";
  if (payload.partialCompletion === true || requested === "partial" || (Array.isArray(errors) && errors.length > 0)) {
    return "partial";
  }
  if (payload.success === false) return "failed";
  if (requested === "degraded" || payload.fallback === true) return "degraded";
  return "completed";
}

function deriveFinalResponseOutcome(response = {}, providerTruth = {}) {
  const errors = Array.isArray(response.errors) ? response.errors : [];
  const verification = response.verification && typeof response.verification === "object"
    ? response.verification
    : {};
  const partialCompletion = response.partialCompletion === true || response.status === "partial";
  return deriveExecutionOutcome({
    execution: {
      success: response.success !== false,
      partialCompletion,
      verification: {
        ok: response.success !== false && verification.ok !== false && errors.length === 0,
        errors,
      },
    },
    providerTruth,
  });
}

function applyFinalResponseOutcome(response, outcome) {
  if (!response || !outcome) return response;
  response.status = outcome.status;
  response.success = outcome.success;
  if (outcome.partialCompletion) response.partialCompletion = true;
  const statusLabel = outcome.status === "partial"
    ? "部分完成"
    : (outcome.status === "failed" ? "未完成" : (outcome.status === "degraded" ? "校园工具已完成" : "已完成"));
  const reconcileSummary = (summary) => {
    if (!summary || typeof summary !== "object") return;
    summary.status = outcome.status;
    const parts = String(summary.compact || "").split(" · ").filter(Boolean);
    summary.compact = [statusLabel].concat(parts.slice(1)).join(" · ");
  };
  reconcileSummary(response.runSummary);
  if (response.presentation && typeof response.presentation === "object") {
    reconcileSummary(response.presentation.runSummary);
  }
  return response;
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
  const publicResponse = Object.assign({}, response, {
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
  // public is deliberately model/provider opaque. Keep the explicit boolean
  // safety signal, but do not expose diagnostic stage names or implementations.
  delete publicResponse.providerStages;
  delete publicResponse.understanding;
  if (publicResponse.planMeta && typeof publicResponse.planMeta === "object") {
    publicResponse.planMeta = Object.assign({}, publicResponse.planMeta);
    delete publicResponse.planMeta.plannerProvider;
  }
  return publicResponse;
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
  const responseStatus = deriveValidatedResponseStatus(payload, errors);
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
    status: responseStatus,
    success: payload.success !== false && errors.length === 0 && responseStatus !== "failed",
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
    // Action Command Bus：由服务端按工具结果确定性派生（见 deriveActionCommands），
    // 仅引用 manifest.actions 中的 command，写操作由客户端执行后回传 Receipt。
    actions: Array.isArray(payload.actions) ? payload.actions : [],
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
    providerStages: payload.providerStages && typeof payload.providerStages === "object"
      ? safetyGuard.sanitizeToolResult(payload.providerStages)
      : null,
    verification: payload.verification && typeof payload.verification === "object"
      ? safetyGuard.sanitizeToolResult({
        // Fail closed (P3 Low#6): only a strict boolean true counts as passed.
        // Missing/null/"true"-string/malformed ok all surface as not verified.
        ok: payload.verification.ok === true,
        evidenceComplete: payload.verification.evidenceComplete !== false,
        errors: Array.isArray(payload.verification.errors) ? payload.verification.errors.slice(0, 8) : [],
      })
      : null,
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
  if (requestedProtocolVersion === agentProtocol.PROTOCOL_V2 && payload.goalContract) {
    response.goalContract = payload.goalContract;
    response.verificationGoalContract = payload.verificationGoalContract || null;
    response.understanding = payload.understanding || null;
  }
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
      goalContract: safeResponse.goalContract || null,
      verificationGoalContract: safeResponse.verificationGoalContract || null,
      understanding: safeResponse.understanding || null,
      providerStages: safeResponse.providerStages || null,
      verification: safeResponse.verification || null,
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

module.exports = {
  containsPublicBlockedText,
  sanitizePublicText,
  publicToolName,
  countResultItems,
  getItemCount,
  buildMetrics,
  normalizeMetrics,
  deriveExecutionOutcome,
  deriveValidatedResponseStatus,
  deriveFinalResponseOutcome,
  applyFinalResponseOutcome,
  buildEvidence,
  buildPublicEvidence,
  sanitizePublicAction,
  sanitizePublicCard,
  sanitizePublicPlan,
  sanitizePublicResponse,
  buildTaskSteps,
  buildContextSlots,
  buildResponse,
  sensitiveCredentialResponse,
  mergeGeneratedPayloads,
  normalizeProactiveSuggestion,
  maybeAttachProactive,
};
