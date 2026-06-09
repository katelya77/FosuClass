const providerFactory = require("./providerFactory");
const generatedPayloadContract = require("./generatedPayloadContract");
const mockProvider = require("./providers/mockProvider");
const projectKnowledgeService = require("./projectKnowledgeService");
const safetyGuard = require("./safetyGuard");
const toolRegistry = require("./toolRegistry");

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
  "search_empty_rooms",
  "search_school_index",
  "get_schedule_detail",
  "recommend_meeting_time",
  "diagnose_data_status",
  "explain_personal_import",
]);

function isProjectKnowledgeIntent(intent) {
  const name = intent && intent.name;
  return name === "project_qa" || name === "conversational_help";
}

function isFactToolIntent(intent) {
  const name = intent && intent.name;
  return FACT_TOOL_INTENTS.has(name);
}

function evaluateProviderPolicy(intent, toolCalls, policy, providerName) {
  const normalizedPolicy = ["auto", "always", "tool-only"].includes(String(policy || "").toLowerCase())
    ? String(policy).toLowerCase()
    : "auto";
  const provider = String(providerName || providerFactory.getProviderName() || "mock").toLowerCase();
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

function shouldUseExternalProvider(intent, toolCalls, policy) {
  return evaluateProviderPolicy(intent, toolCalls, policy, providerFactory.getProviderName()).useExternal;
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

function buildResponse(payload) {
  return {
    success: true,
    answer: payload.answer,
    cards: payload.cards,
    toolCalls: payload.toolCalls || [],
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
    },
    metrics: payload.metrics || buildMetrics(),
    serverTime: nowIso(),
  };
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
  const usedPersonalContext = Boolean(context.currentScheduleSummary &&
    context.currentScheduleSummary.enabled &&
    context.currentScheduleSummary.courses &&
    context.currentScheduleSummary.courses.length);

  if (!rawMessage) {
    const generic = mockProvider.generate({ intent: { name: "generic" }, toolResults: [] });
    const stable = stableGeneratedPayload(generic);
    return buildResponse(Object.assign({}, stable, {
      toolCalls: [],
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
  const toolCalls = typeof toolRegistry.runToolChainForIntent === "function"
    ? toolRegistry.runToolChainForIntent(intent, safeMessage, context)
    : toolRegistry.runToolsForIntent(intent, safeMessage, context);
  const publicToolCalls = toolCalls.map((item) => ({
    name: safetyGuard.redactSensitiveText(item.name || "").slice(0, 60),
    status: safetyGuard.redactSensitiveText(item.status || "").slice(0, 20),
    summary: safetyGuard.redactSensitiveText(item.summary || "").slice(0, 160),
  }));

  const providerPolicy = getProviderPolicy();
  const desiredProviderName = providerFactory.getProviderName();
  const policyDecision = evaluateProviderPolicy(intent, toolCalls, providerPolicy, desiredProviderName);
  const provider = policyDecision.useExternal ? providerFactory.createProvider() : mockProvider;
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
      ? await provider.generate(providerInput)
      : deterministicGenerated;
    providerName = generated.provider || providerName;
    providerPayload = stableGeneratedPayload(generated);
    externalProviderUsed = policyDecision.useExternal && providerName !== "mock";
    fallback = !externalProviderUsed;
    if (externalProviderUsed) fallbackReason = "";
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
    toolCalls: publicToolCalls,
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
