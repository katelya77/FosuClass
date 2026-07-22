const request = require("../utils/request");
const agentCapabilityCompat = require("../shared/agentCapabilityCompat.generated");
const agentRunClient = require("./agentRunClient");

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

async function callOracleViaRuns(safeMessage, context, callbacks = {}, metadata = {}) {
  const created = await agentRunClient.createRun({
    message: safeMessage,
    context,
    protocolVersion: metadata.protocolVersion || "agent.v2",
    requestId: metadata.requestId || "",
    conversationId: metadata.conversationId || "",
    memoryMode: context.memoryMode || "local_only",
    cloudSyncEnabled: context.cloudSyncEnabled === true,
  });
  if (callbacks.onRunCreated) {
    callbacks.onRunCreated({
      runId: created.runId,
      pollToken: created.pollToken,
    });
  }
  if (callbacks.onStatus) {
    callbacks.onStatus({ type: "run.accepted", text: "任务已受理，等待服务端状态" });
  }
  const collectedEvents = [];
  const done = await agentRunClient.pollRunUntilDone(created.runId, created.pollToken, {
    maxWaitMs: 45000,
    shouldCancel: () => callbacks.shouldCancel && callbacks.shouldCancel() === true,
    onEvents: (events) => {
      collectedEvents.push(...events);
      if (callbacks.onRunEvents) callbacks.onRunEvents(events, collectedEvents.slice());
    },
    onStatus: (status) => {
      if (callbacks.onStatus) callbacks.onStatus(status);
    },
  });
  if (done.cancelled) {
    return {
      success: true,
      status: "cancelled",
      answer: "",
      cards: [],
      suggestions: [],
      toolCalls: [],
      taskSteps: [],
      steps: [],
      evidence: null,
      safety: { provider: "mock", externalProviderUsed: false, mode: "cancelled" },
      metrics: {},
      runEvents: collectedEvents,
    };
  }
  if (done.result) {
    return Object.assign({}, done.result, { runEvents: collectedEvents });
  }
  // Fallback to legacy chat if run timed out without result.
  if (done.timeout) {
    if (callbacks.onStatus) callbacks.onStatus({ type: "run.status_unavailable", text: "实时状态中断，正在请求最终结果" });
    return request.post("/api/ai/agent/chat", {
      message: safeMessage,
      context,
      protocolVersion: metadata.protocolVersion || "agent.v2",
      requestId: metadata.requestId || "",
      conversationId: metadata.conversationId || "",
      memoryMode: context.memoryMode || "local_only",
      cloudSyncEnabled: context.cloudSyncEnabled === true,
    }, {
      showLoading: false,
      silentError: true,
      timeout: 28000,
      retries: 1,
      dedupe: false,
    });
  }
  const error = new Error("RUN_FAILED");
  error.code = "RUN_FAILED";
  throw error;
}

async function callOracle(oracleChat, safeMessage, context, callbacks = {}, metadata = {}) {
  // Never guess loading from client intent. Prefer real run events.
  if (callbacks.onStatus) {
    callbacks.onStatus({ type: "request.submitted", text: "正在理解你的问题" });
  }
  if (oracleChat) return oracleChat(safeMessage, context, metadata);
  try {
    return await callOracleViaRuns(safeMessage, context, callbacks, metadata);
  } catch (error) {
    // Compatibility path if run API unavailable.
    if (callbacks.onStatus) {
      callbacks.onStatus({ type: "run.status_unavailable", text: "实时状态不可用，正在请求最终结果" });
    }
    return request.post("/api/ai/agent/chat", {
      message: safeMessage,
      context,
      protocolVersion: metadata.protocolVersion || "agent.v2",
      requestId: metadata.requestId || "",
      conversationId: metadata.conversationId || "",
      memoryMode: context.memoryMode || "local_only",
      cloudSyncEnabled: context.cloudSyncEnabled === true,
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
    callbacks.onStatus({ type: "request.submitted", text: "正在理解你的问题" });
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
