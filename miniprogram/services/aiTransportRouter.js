const request = require("../utils/request");
const agentCapabilityCompat = require("../shared/agentCapabilityCompat.generated");

const METRICS_KEY = "FOSU_AI_GENERATIVE_METRICS";
const INVALID_TEXT_TOKENS = new Set(["[object Object]", "undefined", "null", "NaN"]);

function nowIso() {
  return new Date().toISOString();
}

function safeText(value, maxLength) {
  let text = String(value == null ? "" : value);
  text = text
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<[^>]+>/g, "")
    .replace(/\b(?:javascript|data|file|wxfile):[^\s，。；;]*/gi, "[链接已省略]")
    .replace(/\bhttps?:\/\/[^\s，。；;]+/gi, "[链接已省略]")
    .trim();
  if (!text || INVALID_TEXT_TOKENS.has(text)) return "";
  return text.slice(0, maxLength || 1200);
}

function readStorage(key, fallback) {
  try {
    const value = wx.getStorageSync(key);
    return value === undefined || value === "" ? fallback : value;
  } catch (error) {
    return fallback;
  }
}

function writeStorage(key, value) {
  try {
    wx.setStorageSync(key, value);
  } catch (error) {
    // local anonymous metrics are best-effort only.
  }
}

function recordMetric(metric) {
  const source = readStorage(METRICS_KEY, []);
  const list = Array.isArray(source) ? source : [];
  const safe = {
    provider: String(metric.provider || "unknown").slice(0, 40),
    latencyMs: Math.max(0, Math.round(Number(metric.latencyMs || 0) || 0)),
    totalTokens: Math.max(0, Math.round(Number(metric.totalTokens || 0) || 0)),
    success: metric.success === true,
    fallback: metric.fallback === true,
    errorCode: String(metric.errorCode || "").slice(0, 80),
    intentName: String(metric.intentName || "").slice(0, 80),
    at: nowIso(),
  };
  writeStorage(METRICS_KEY, list.concat(safe).slice(-80));
  return safe;
}

function normalizeOracleResponse(response) {
  return Object.assign({
    success: true,
    answer: "",
    cards: [],
    suggestions: [],
    toolCalls: [],
    taskSteps: [],
    evidence: null,
    safety: {},
    metrics: {},
  }, response || {});
}

function normalizeRequestMetadata(input = {}, context = {}) {
  return {
    protocolVersion: agentCapabilityCompat.PROTOCOL_VERSIONS.indexOf(input.protocolVersion) >= 0
      ? input.protocolVersion
      : "agent.v2",
    requestId: safeText(input.requestId, 96),
    conversationId: safeText(
      input.conversationId || context.conversation && context.conversation.conversationId,
      96
    ),
  };
}

function buildEvidence(context = {}, extra = {}) {
  return {
    term: context.term || context.selectedTerm || "",
    releaseVersion: context.releaseVersion || "",
    currentWeek: context.currentTeachingWeek || "",
    checkedAt: nowIso(),
    sources: extra.sources || [],
  };
}

function buildSafety(provider, options = {}) {
  return {
    redacted: true,
    provider,
    desiredProvider: options.desiredProvider || provider,
    resolvedProvider: provider,
    mode: options.mode || "tool-grounded",
    externalProviderUsed: options.externalProviderUsed === true,
    fallbackReason: options.fallbackReason || "",
    providerDecisionReason: options.providerDecisionReason || "",
  };
}

function buildMetrics(startTime, intentName, options = {}) {
  return {
    latencyMs: Math.max(0, Date.now() - startTime),
    intentName,
    externalProviderUsed: options.externalProviderUsed === true,
    fallback: options.fallback === true,
    totalTokens: Number(options.totalTokens || 0) || 0,
  };
}

function buildGenericCard(providerLabel, subtitle) {
  return {
    type: "generic",
    title: "校园查询结果",
    subtitle: subtitle || "课表信息仅供参考，以学校教务系统为准。",
    badges: [providerLabel].filter(Boolean),
    items: [],
    actions: [],
  };
}

function buildSensitiveFallback(context, startTime, intentName) {
  const answer = "请勿输入学号、密码、登录凭证、API Key 等敏感信息。查课和课表同步可以继续使用校园工具。";
  recordMetric({
    provider: "mock",
    latencyMs: Date.now() - startTime,
    totalTokens: 0,
    success: true,
    fallback: true,
    errorCode: "SENSITIVE_REDACTED",
    intentName,
  });
  return {
    protocolVersion: "agent.v2",
    success: true,
    status: "blocked",
    fallback: true,
    fallbackLayer: "client",
    fallbackReason: "SENSITIVE_CREDENTIAL_REDACTED",
    externalProviderUsed: false,
    intent: "explain_personal_import",
    confidence: 1,
    slots: {},
    skill: { id: "personal_schedule_import_help", version: "1.0.0" },
    plan: [],
    steps: [{ id: "client-safety", status: "done", tool: "safety_guard", durationMs: 0, errorCode: "", retried: false }],
    observations: [],
    answer,
    cards: [buildGenericCard("安全提醒", "已拦截敏感信息，不会继续处理。")],
    suggestions: ["怎么导入个人课表？", "数据会上传吗？"],
    toolCalls: [{ name: "safety_guard", status: "skipped", summary: "敏感内容已脱敏" }],
    taskSteps: [{ key: "safety", label: "已完成安全拦截", status: "done" }],
    evidence: buildEvidence(context, { sources: ["client-safety-guard"] }),
    safety: Object.assign(buildSafety("mock", { mode: "fallback", fallbackReason: "sensitive_redacted" }), {
      externalProviderUsed: false,
    }),
    metrics: Object.assign(buildMetrics(startTime, intentName, { fallback: true }), {
      canonicalIntent: "explain_personal_import",
      externalProviderUsed: false,
    }),
    errors: [],
    serverTime: "",
  };
}

function shouldDisableGenerativeInClient() {
  // Phase 1 moves all generative expression to the server Agent Kernel in
  // every mini-program environment. Kept as a compatibility probe for callers.
  return true;
}

async function callOracle(oracleChat, safeMessage, context, callbacks = {}, metadata = {}) {
  if (callbacks.onStatus) callbacks.onStatus({ type: "query-tools", text: "正在查询课表" });
  if (oracleChat) return oracleChat(safeMessage, context, metadata);
  return request.post("/api/ai/agent/chat", {
    message: safeMessage,
    context,
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

// Phase 1 online entrypoint. Semantic requests always go to the server Agent
// Kernel. The former client expression pipeline remains below as a temporary
// compatibility implementation, but it is no longer exported or called here.
async function serverFirstChat(input = {}) {
  const startTime = Date.now();
  const rawMessage = String(input.message || "");
  const redact = input.redactSensitiveText || ((text) => String(text || ""));
  const safeMessage = redact(rawMessage).slice(0, 2000);
  const context = input.context || {};
  const callbacks = input.options && input.options.callbacks || input.callbacks || {};
  const metadata = normalizeRequestMetadata(input, context);

  if (callbacks.onStatus) {
    callbacks.onStatus({ type: "understanding", text: "小佛助手正在理解" });
  }

  // Credentials stop before every network/provider boundary. The original
  // secret is never required to return safe import guidance.
  if (safeMessage !== rawMessage) {
    return Object.assign(buildSensitiveFallback(context, startTime, "explain_personal_import"), metadata);
  }

  const response = await callOracle(input.oracleChat, safeMessage, context, callbacks, metadata);
  return normalizeOracleResponse(response);
}

module.exports = {
  METRICS_KEY,
  buildGenericCard,
  chat: serverFirstChat,
  recordMetric,
  safeText,
  shouldDisableGenerativeInClient,
};
