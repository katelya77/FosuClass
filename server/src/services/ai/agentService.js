const providerFactory = require("./providerFactory");
const mockProvider = require("./providers/mockProvider");
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
      mode: "tool-grounded",
    },
    serverTime: nowIso(),
  };
}

function sensitiveCredentialResponse(message, context) {
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
  }));
}

async function chat(input = {}) {
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
    }));
  }

  if (safetyGuard.hasSensitiveCredential(rawMessage)) {
    return sensitiveCredentialResponse(safeMessage, context);
  }

  const intent = toolRegistry.resolveIntent(safeMessage, context);
  const toolCalls = toolRegistry.runToolsForIntent(intent, safeMessage, context);
  const publicToolCalls = toolCalls.map((item) => ({
    name: safetyGuard.redactSensitiveText(item.name || "").slice(0, 60),
    status: safetyGuard.redactSensitiveText(item.status || "").slice(0, 20),
    summary: safetyGuard.redactSensitiveText(item.summary || "").slice(0, 160),
  }));

  const provider = providerFactory.createProvider();
  let providerName = provider.name || providerFactory.getProviderName();
  let generated;
  try {
    generated = await provider.generate({
      message: safeMessage,
      context,
      intent,
      toolResults: toolCalls.map((item) => ({
        name: item.name,
        status: item.status,
        summary: safetyGuard.redactSensitiveText(item.summary || ""),
        result: safetyGuard.sanitizeToolResult(item.result),
      })),
    });
    providerName = generated.provider || providerName;
  } catch (error) {
    generated = mockProvider.generate({ message: safeMessage, context, intent, toolResults: toolCalls });
    providerName = "mock";
    publicToolCalls.push({
      name: provider.name || providerFactory.getProviderName(),
      status: "skipped",
      summary: error.code || "provider fallback to mock",
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
    usedPersonalContext,
  }));
}

module.exports = {
  chat,
  stableAction,
  stableCard,
  stableGeneratedPayload,
};
