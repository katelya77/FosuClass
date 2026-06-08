const providerFactory = require("./providerFactory");
const mockProvider = require("./providers/mockProvider");
const projectKnowledgeService = require("./projectKnowledgeService");
const safetyGuard = require("./safetyGuard");
const toolRegistry = require("./toolRegistry");

const ALLOWED_CARD_TYPES = new Set(["empty_room", "schedule", "teacher", "course", "diagnosis", "guide", "reminder", "generic"]);
const ALLOWED_ACTION_TYPES = new Set(["navigate", "copy", "retry", "bind", "noop"]);
const ALLOWED_NAVIGATION_URLS = new Set([
  "/pages/school/school",
  "/pages/today/today",
  "/pages/empty-room/empty-room",
  "/pages/schedule-view/schedule-view",
  "/pages/personal-sync/personal-sync",
  "/pages/ai-assistant/ai-assistant",
]);

function nowIso() {
  return new Date().toISOString();
}

function stableAction(action) {
  const source = action || {};
  let type = ALLOWED_ACTION_TYPES.has(source.type) ? source.type : "noop";
  const rawUrl = String(source.url || "");
  const pathOnly = rawUrl.split("?")[0];
  if (rawUrl && (!pathOnly || !ALLOWED_NAVIGATION_URLS.has(pathOnly))) {
    type = "noop";
  }
  return {
    label: safetyGuard.redactSensitiveText(source.label || "查看").slice(0, 30),
    type,
    url: type === "noop" ? "" : rawUrl,
    payload: source.payload && typeof source.payload === "object"
      ? safetyGuard.sanitizeToolResult(source.payload)
      : {},
  };
}

function stableCard(card) {
  const source = card || {};
  const type = ALLOWED_CARD_TYPES.has(source.type) ? source.type : "generic";
  return {
    type,
    title: safetyGuard.redactSensitiveText(source.title || "结果卡片").slice(0, 80),
    subtitle: safetyGuard.redactSensitiveText(source.subtitle || "").slice(0, 160),
    badges: Array.isArray(source.badges) ? source.badges.slice(0, 8).map((item) => safetyGuard.redactSensitiveText(item).slice(0, 40)) : [],
    items: Array.isArray(source.items) ? source.items.slice(0, 12).map((item) => {
      const sourceItem = safetyGuard.sanitizeToolResult(item || {});
      return {
        title: safetyGuard.redactSensitiveText(sourceItem.title || "").slice(0, 80),
        subtitle: safetyGuard.redactSensitiveText(sourceItem.subtitle || "").slice(0, 160),
        value: safetyGuard.redactSensitiveText(sourceItem.value || "").slice(0, 80),
      };
    }) : [],
    actions: Array.isArray(source.actions) ? source.actions.slice(0, 4).map(stableAction) : [],
  };
}

function stableGeneratedPayload(payload) {
  const source = payload && typeof payload === "object" ? payload : {};
  return {
    answer: safetyGuard.redactSensitiveText(source.answer || "我已经根据项目内工具整理了结果。").slice(0, 1200),
    cards: Array.isArray(source.cards) ? source.cards.slice(0, 6).map(stableCard) : [],
    suggestions: Array.isArray(source.suggestions) ? source.suggestions.slice(0, 6).map((item) => safetyGuard.redactSensitiveText(item).slice(0, 60)) : [],
  };
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

function evaluateProviderPolicy(intent, toolCalls, policy, providerName) {
  const normalizedPolicy = ["auto", "always", "tool-only"].includes(String(policy || "").toLowerCase())
    ? String(policy).toLowerCase()
    : "auto";
  const provider = String(providerName || providerFactory.getProviderName() || "mock").toLowerCase();
  const intentName = intent && intent.name || "generic";
  const primary = getPrimaryToolResult(toolCalls);
  const agentEnabled = String(process.env.AI_AGENT_ENABLED || "false").toLowerCase() !== "false";

  if (!agentEnabled) return { useExternal: false, reason: "AI_AGENT_ENABLED=false" };
  if (provider === "mock") return { useExternal: false, reason: "AI_PROVIDER=mock" };
  if (normalizedPolicy === "tool-only") return { useExternal: false, reason: "AI_PROVIDER_POLICY=tool-only" };
  if (intentName === "project_qa" || intentName === "conversational_help") {
    return { useExternal: true, reason: "项目知识问答/自然聊天调用外部 Provider" };
  }
  if (intentName === "clarify_missing_slot") return { useExternal: false, reason: "缺少必要关键词，使用固定追问模板" };
  if (intentName === "explain_personal_import") return { useExternal: false, reason: "导入指引用固定安全模板" };
  if (intentName === "diagnose_data_status") return { useExternal: false, reason: "数据诊断使用本地模板" };
  if (normalizedPolicy === "always") return { useExternal: true, reason: "" };
  if (intentName === "search_school_index") {
    const q = primary && primary.q || intent && intent.slots && intent.slots.q || "";
    const items = primary && Array.isArray(primary.items) ? primary.items : [];
    if (q && items.length === 0) {
      return { useExternal: true, reason: "" };
    }
    if (!q) {
      return { useExternal: false, reason: "缺少索引关键词，使用本地规则" };
    }
  }
  if (intentName === "recommend_meeting_time") {
    const candidates = primary && Array.isArray(primary.candidates) ? primary.candidates : [];
    if (candidates.length) return { useExternal: true, reason: "" };
  }
  if (intentName === "search_empty_rooms") {
    const rooms = primary && Array.isArray(primary.rooms) ? primary.rooms : [];
    if (rooms.length > 1) return { useExternal: true, reason: "" };
  }
  if (Array.isArray(toolCalls) && toolCalls.filter((item) => item && item.status !== "skipped").length > 1) {
    return { useExternal: true, reason: "" };
  }
  return { useExternal: false, reason: "简单工具结果使用本地规则" };
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
  let generated;
  let externalProviderUsed = false;
  let fallback = !policyDecision.useExternal;
  let fallbackReason = policyDecision.reason || "";
  const providerDecisionReason = policyDecision.reason || (policyDecision.useExternal ? "external provider selected" : "local provider selected");
  try {
    const isProjectKnowledgeIntent = intent && (intent.name === "project_qa" || intent.name === "conversational_help");
    const providerInput = {
      message: safeMessage,
      context,
      intent,
      projectKnowledge: isProjectKnowledgeIntent ? projectKnowledgeService.getProjectKnowledgePrompt() : "",
      toolResults: toolCalls.map((item) => ({
        name: item.name,
        status: item.status,
        summary: safetyGuard.redactSensitiveText(item.summary || ""),
        result: safetyGuard.sanitizeToolResult(item.result),
      })),
    };
    generated = policyDecision.useExternal
      ? await provider.generate(providerInput)
      : mockProvider.generate(providerInput);
    providerName = generated.provider || providerName;
    externalProviderUsed = policyDecision.useExternal && providerName !== "mock";
    fallback = !externalProviderUsed;
    if (externalProviderUsed) fallbackReason = "";
  } catch (error) {
    generated = intent && (intent.name === "project_qa" || intent.name === "conversational_help")
      ? projectKnowledgeService.generateFallbackResponse(intent.name)
      : mockProvider.generate({ message: safeMessage, context, intent, toolResults: toolCalls });
    providerName = "mock";
    externalProviderUsed = false;
    fallback = true;
    fallbackReason = classifyProviderFailure(error);
    publicToolCalls.push({
      name: provider.name || providerFactory.getProviderName(),
      status: "skipped",
      summary: fallbackReason,
    });
  }

  const stable = stableGeneratedPayload(generated);
  if (!stable.cards.length) {
    const fallback = stableGeneratedPayload(mockProvider.generate({ message: safeMessage, context, intent, toolResults: toolCalls }));
    stable.cards = fallback.cards;
    stable.suggestions = stable.suggestions.length ? stable.suggestions : fallback.suggestions;
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
