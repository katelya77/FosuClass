const providerFactory = require("./providerFactory");
const generatedPayloadContract = require("./generatedPayloadContract");
const mockProvider = require("./providers/mockProvider");
const projectKnowledgeService = require("./projectKnowledgeService");
const safetyGuard = require("./safetyGuard");
const toolRegistry = require("./toolRegistry");
const agentProtocol = require("./agentProtocol");
const runtimeModeService = require("./runtimeModeService");
const providerChainService = require("./providerChainService");

function nowIso() {
  return new Date().toISOString();
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
  safety_guard: "安全检查",
};

function publicToolName(name) {
  return PUBLIC_TOOL_NAMES[String(name || "").toLowerCase()] || "校园工具";
}

function getProviderPolicy() {
  const value = String(process.env.AI_PROVIDER_POLICY || "auto").trim().toLowerCase();
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

const FACT_TOOL_INTENTS = new Set([
  "clarify_missing_slot",
  "get_today_courses",
  "get_tomorrow_courses",
  "get_next_course",
  "get_week_schedule",
  "get_teaching_week",
  "get_term_calendar",
  "search_empty_rooms",
  "search_continuous_empty_rooms",
  "search_school_index",
  "get_schedule_detail",
  "recommend_meeting_time",
  "diagnose_data_status",
  "explain_personal_import",
  "get_campus_weather",
  "get_course_weather_advice",
  "search_campus_place",
  "get_campus_route",
  "get_classroom_location",
  "rag_search",
  "campus_multi_step_advice",
]);

function isProjectKnowledgeIntent(intent) {
  const name = intent && intent.name;
  return name === "project_qa" || name === "conversational_help";
}

function isFactToolIntent(intent) {
  const name = intent && intent.name;
  return FACT_TOOL_INTENTS.has(name);
}

function evaluateProviderPolicy(intent, toolCalls, policy, providerName, runtimeMode) {
  const normalizedPolicy = ["auto", "always", "tool-only"].includes(String(policy || "").toLowerCase())
    ? String(policy).toLowerCase()
    : "auto";
  const provider = String(providerName || providerFactory.getProviderName(runtimeMode) || "mock").toLowerCase();
  const intentName = intent && intent.name || "generic";
  const agentEnabled = String(process.env.AI_AGENT_ENABLED || "false").toLowerCase() !== "false";

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

function buildEvidence(toolCalls = [], context = {}) {
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
  (Array.isArray(toolCalls) ? toolCalls : []).forEach((call) => {
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
    toolCount: Array.isArray(toolCalls) ? toolCalls.length : 0,
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
  };
}

function sanitizePublicAction(action) {
  const source = stableAction(action || {});
  const url = String(source.url || "");
  const safeUrl = url.startsWith("/pages/") && !/admin|debug|provider|token|oracle|cloudbase/i.test(url) ? url : "";
  return Object.assign({}, source, {
    label: sanitizePublicText(source.label, "查看"),
    url: safeUrl,
    payload: {},
  });
}

function sanitizePublicCard(card) {
  const source = stableCard(card || {});
  return Object.assign({}, source, {
    title: sanitizePublicText(source.title, "结果"),
    subtitle: sanitizePublicText(source.subtitle, ""),
    badges: (source.badges || []).map((item) => sanitizePublicText(item, "")).filter(Boolean).slice(0, 4),
    items: (source.items || []).map((item) => ({
      title: sanitizePublicText(item.title, ""),
      subtitle: sanitizePublicText(item.subtitle, ""),
      value: sanitizePublicText(item.value, ""),
    })).filter((item) => item.title || item.subtitle || item.value).slice(0, 8),
    actions: (source.actions || []).map(sanitizePublicAction).filter((item) => item.type === "noop" || item.url || item.type === "copy").slice(0, 3),
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

function sanitizePublicResponse(response) {
  const evidence = buildPublicEvidence(response.evidence);
  const sourceSafety = response.safety || {};
  const sourceMetrics = response.metrics || {};
  return Object.assign({}, response, {
    answer: sanitizePublicText(response.answer, ""),
    cards: (Array.isArray(response.cards) ? response.cards : []).map(sanitizePublicCard),
    suggestions: (Array.isArray(response.suggestions) ? response.suggestions : []).map((item) => sanitizePublicText(item, "")).filter(Boolean).slice(0, 6),
    toolCalls: (Array.isArray(response.toolCalls) ? response.toolCalls : []).map(sanitizePublicToolCall),
    evidence,
    safety: {
      redacted: true,
      usedPersonalContext: Boolean(sourceSafety.usedPersonalContext),
      mode: sourceSafety.mode || "tool-grounded",
      fallbackReason: sourceSafety.fallbackReason ? "已使用本地规则" : "",
      pendingClarification: sourceSafety.pendingClarification || null,
      clearPendingClarification: sourceSafety.clearPendingClarification === true,
    },
    metrics: {
      latencyMs: sourceMetrics.latencyMs,
      intentName: sourceMetrics.intentName,
      toolCallCount: sourceMetrics.toolCallCount,
      fallback: sourceMetrics.fallback === true,
      itemCount: sourceMetrics.itemCount,
      usedPersonalContext: Boolean(sourceMetrics.usedPersonalContext),
    },
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
  if (names.some((name) => /today|schedule|meeting|personal/.test(name))) {
    addStep("schedule", "已读取课表");
  }
  if (names.some((name) => /empty|room/.test(name))) {
    addStep("empty-room", "已核验空教室");
  }
  if (names.some((name) => /school|detail|search/.test(name))) {
    addStep("search", "已查询校园索引");
  }
  if (names.some((name) => /recommend|plan|meeting/.test(name)) || /recommend|plan|meeting/.test(String(intent && intent.name || ""))) {
    addStep("decision", "已生成建议");
  }
  if (names.some((name) => /diagnose|status/.test(name))) {
    addStep("diagnose", "已检查数据状态");
  }
  addStep("complete", "已完成");
  return steps.slice(0, 6);
}

function buildResponse(payload) {
  const rawToolCalls = payload.rawToolCalls || payload.toolCalls || [];
  const envelope = agentProtocol.buildProtocolEnvelope({
    requestId: payload.requestId,
    conversationId: payload.conversationId,
    runtimeMode: payload.runtimeMode || "public",
    intent: payload.intent,
    plan: payload.plan,
    rawToolCalls,
    slots: payload.slots,
  });
  const validation = agentProtocol.validateResponse({
    protocolVersion: envelope.protocolVersion,
    runtimeMode: envelope.runtimeMode,
    intent: payload.intent,
    plan: payload.plan,
    cards: payload.cards,
  });
  const response = {
    protocolVersion: envelope.protocolVersion,
    requestId: envelope.requestId,
    conversationId: envelope.conversationId,
    runtimeMode: envelope.runtimeMode,
    success: true,
    answer: payload.answer,
    intent: payload.intent,
    slots: envelope.slots,
    plan: envelope.plan,
    cards: validation.cards.length ? validation.cards : payload.cards,
    toolCalls: payload.toolCalls || [],
    taskSteps: payload.taskSteps || buildTaskSteps(payload.intent, rawToolCalls),
    evidence: payload.evidence || buildEvidence(rawToolCalls, payload.context),
    evidenceItems: envelope.evidenceItems,
    suggestions: payload.suggestions,
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
      runtimeMode: envelope.runtimeMode,
      requestedRuntimeMode: payload.requestedRuntimeMode || envelope.runtimeMode,
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
    errors: validation.errors || [],
    serverTime: nowIso(),
  };
  return isPublicRuntime(envelope.runtimeMode) ? sanitizePublicResponse(response) : response;
}

function sensitiveCredentialResponse(message, context, startTime) {
  const guide = toolRegistry.executeTool("explain_personal_import", { mode: "xls", message }, context);
  const generated = mockProvider.generate({
    intent: { name: "explain_personal_import" },
    toolResults: [{ name: "explain_personal_import", status: "success", summary: "敏感信息拦截后返回安全导入指引", result: guide }],
  });
  const stable = stableGeneratedPayload(generated);
  return buildResponse(Object.assign({}, stable, {
    answer: "我不能接收或处理学号、密码、Cookie、token 等敏感信息。请不要在聊天里输入这些内容；如需导入个人课表，请使用 XLS 导入页面。",
    toolCalls: [{ name: "safety_guard", status: "skipped", summary: "检测到敏感凭证，已拦截并脱敏" }],
    provider: "mock",
    usedPersonalContext: false,
    providerPolicy: getProviderPolicy(),
    externalProviderUsed: false,
    fallbackReason: "检测到敏感凭证",
    metrics: buildMetrics({
      startTime,
      intentName: "sensitive_credential_response",
      toolCalls: [{ name: "safety_guard", status: "skipped", result: {} }],
      externalProviderUsed: false,
      fallback: true,
      usedPersonalContext: false,
    }),
  }));
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
  const context = safetyGuard.sanitizeAgentContext(input.context || {});
  const runtimeDecision = runtimeModeService.resolveRuntimeMode({
    context,
    serverSession: input.serverSession,
    runtimeMode: input.runtimeMode,
  });
  context.runtimeMode = runtimeDecision.runtimeMode;
  context.serverSession = input.serverSession || context.serverSession || null;
  const requestId = input.requestId || agentProtocol.createRequestId();
  const conversationId = input.conversationId || context.conversationId || "";
  if (!agentProtocol.isSupportedProtocolVersion(input.protocolVersion || context.protocolVersion || agentProtocol.PROTOCOL_VERSION)) {
    return buildResponse({
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
      intent: { name: "clarify_missing_slot", slots: {} },
      plan: [],
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
    return buildResponse(Object.assign({}, stable, {
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
      providerPolicy: getProviderPolicy(),
      externalProviderUsed: false,
      fallbackReason: "空消息",
      metrics: buildMetrics({
        startTime,
        intentName: "generic",
        toolCalls: [],
        externalProviderUsed: false,
        fallback: true,
        usedPersonalContext,
      }),
    }));
  }

  if (safetyGuard.hasSensitiveCredential(rawMessage)) {
    return sensitiveCredentialResponse(safeMessage, context, startTime);
  }

  const intent = toolRegistry.resolveIntent(safeMessage, context);
  const plan = typeof toolRegistry.buildPlanForIntent === "function"
    ? toolRegistry.buildPlanForIntent(intent, safeMessage, context)
    : [];
  const toolCalls = typeof toolRegistry.runToolChainForIntentAsync === "function"
    ? await toolRegistry.runToolChainForIntentAsync(intent, safeMessage, context)
    : typeof toolRegistry.runToolChainForIntent === "function"
      ? toolRegistry.runToolChainForIntent(intent, safeMessage, context)
    : toolRegistry.runToolsForIntent(intent, safeMessage, context);
  const publicToolCalls = toolCalls.map((item) => ({
    name: safetyGuard.redactSensitiveText(item.name || "").slice(0, 60),
    status: safetyGuard.redactSensitiveText(item.status || "").slice(0, 20),
    summary: safetyGuard.redactSensitiveText(item.summary || "").slice(0, 160),
  }));

  if (runtimeDecision.runtimeMode === "public" &&
    !isFactToolIntent(intent) &&
    !isProjectKnowledgeIntent(intent) &&
    intent.name !== "explain_personal_import" &&
    intent.name !== "clarify_missing_slot") {
    return buildResponse({
      answer: "小佛目前只提供佛课小表、课表、课程查询和使用帮助。",
      cards: [],
      suggestions: ["查今日课程", "查空教室", "佛课小表怎么用？"],
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
      metrics: buildMetrics({
        startTime,
        intentName: intent.name,
        toolCalls,
        externalProviderUsed: false,
        fallback: true,
        usedPersonalContext,
      }),
    });
  }

  const providerPolicy = getProviderPolicy();
  const desiredProviderName = providerFactory.getProviderName(runtimeDecision.runtimeMode);
  const policyDecision = evaluateProviderPolicy(intent, toolCalls, providerPolicy, desiredProviderName, runtimeDecision.runtimeMode);
  const provider = policyDecision.useExternal ? providerFactory.createProvider(runtimeDecision.runtimeMode) : mockProvider;
  let providerName = policyDecision.useExternal
    ? (provider.name || desiredProviderName)
    : (intent.name === "clarify_missing_slot" ? "mock/template" : "mock");
  const providerInput = {
    message: safeMessage,
    context,
    intent,
    projectKnowledge: isProjectKnowledgeIntent(intent) ? projectKnowledgeService.getProjectKnowledgePrompt() : "",
    toolResults: toolCalls.map((item) => ({
      name: item.name,
      status: item.status,
      summary: safetyGuard.redactSensitiveText(item.summary || ""),
      result: safetyGuard.sanitizeToolResult(item.result),
    })),
  };
  const deterministicGenerated = mockProvider.generate(providerInput);
  const deterministicPayload = stableGeneratedPayload(deterministicGenerated, {
    fallbackAnswer: "我已根据项目工具整理出结果。",
  });
  let providerPayload = null;
  let externalProviderUsed = false;
  let fallback = !policyDecision.useExternal;
  let fallbackReason = "";
  const providerDecisionReason = policyDecision.reason || (policyDecision.useExternal ? "external provider selected" : "local provider selected");
  try {
    const generated = policyDecision.useExternal
      ? await providerChainService.generateWithChain(providerInput, { runtimeMode: runtimeDecision.runtimeMode })
      : deterministicGenerated;
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
    }
  } catch (error) {
    providerName = "mock";
    externalProviderUsed = false;
    fallback = true;
    fallbackReason = classifyProviderFailure(error);
    providerPayload = isProjectKnowledgeIntent(intent)
      ? stableGeneratedPayload(projectKnowledgeService.generateFallbackResponse(intent.name))
      : null;
    publicToolCalls.push({
      name: provider.name || providerFactory.getProviderName(),
      status: "skipped",
      summary: fallbackReason,
    });
  }

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
  return buildResponse(Object.assign({}, stable, {
    requestId,
    conversationId,
    runtimeMode: runtimeDecision.runtimeMode,
    requestedRuntimeMode: runtimeDecision.requestedMode,
    competitionAuthorized: runtimeDecision.authorized,
    toolCalls: publicToolCalls,
    rawToolCalls: toolCalls,
    intent,
    plan,
    context,
    provider: providerName,
    desiredProvider: desiredProviderName,
    resolvedProvider: providerName,
    usedPersonalContext,
    providerPolicy,
    externalProviderUsed,
    providerDecisionReason,
    fallbackReason,
    pendingClarification: pendingPatch.pendingClarification,
    clearPendingClarification: pendingPatch.clearPendingClarification,
    metrics: buildMetrics({
      startTime,
      intent,
      toolCalls,
      externalProviderUsed,
      fallback,
      usedPersonalContext,
    }),
  }));
}

module.exports = {
  chat,
  shouldUseExternalProvider,
  stableAction,
  stableCard,
  stableGeneratedPayload,
  classifyProviderFailure,
};
