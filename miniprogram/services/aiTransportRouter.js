const request = require("../utils/request");
const agentCapabilityCompat = require("../shared/agentCapabilityCompat.generated");
const agentRunShell = require("./agentRunShell");
const cloudbaseConfig = require("../config/cloudbase");

// Runs transport is the production path: UI states must come from real server
// Run Events. The legacy direct-chat oracle is compatibility-only/deprecated
// (P6b): it may trigger ONLY when (a) the explicit rollback switch
// AI_AGENT_RUNS_TRANSPORT_ENABLED=false, or (b) the server fails protocol
// negotiation (RUN_PROTOCOL_UNSUPPORTED = old server without Run API). Plain
// network errors/timeouts must NOT silently downgrade product semantics into
// direct chat — they surface as retriable errors toward the offline fallback
// chain. Every compat engagement is recorded locally with its reason.
function runsTransportEnabled() {
  return cloudbaseConfig.AI_AGENT_RUNS_TRANSPORT_ENABLED !== false;
}

const METRICS_KEY = "FOSU_AI_GENERATIVE_METRICS";
const DIRECT_CHAT_COMPAT_KEY = "FOSU_AI_DIRECT_CHAT_COMPAT";
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

// direct chat 兼容通道使用记录（compatibility-only）：原因、协议版本、
// 客户端版本、传输与功能影响五元组，供退役门槛量化（旧量归零才可删除）。
function recordDirectChatCompat(compatReason, metadata = {}, extra = {}) {
  const source = readStorage(DIRECT_CHAT_COMPAT_KEY, []);
  const list = Array.isArray(source) ? source : [];
  const entry = {
    compatReason: String(compatReason || "").slice(0, 40),
    protocolVersion: String(metadata.protocolVersion || "agent.v2").slice(0, 32),
    clientVersion: String(extra.clientVersion || "miniprogram").slice(0, 40),
    transport: "direct_chat_compat",
    featureImpact: String(extra.featureImpact || "no_run_events").slice(0, 80),
    at: nowIso(),
  };
  writeStorage(DIRECT_CHAT_COMPAT_KEY, list.concat(entry).slice(-40));
  return entry;
}

function isProtocolUnsupportedError(error) {
  if (!error) return false;
  return error.errorClass === "unsupported_protocol"
    || String(error.code || error.reasonCode || "").toUpperCase() === "RUN_PROTOCOL_UNSUPPORTED";
}

// 兼容通道（deprecated）：只搬运服务端 direct chat 的真实应答并打上兼容
// 标记；绝不伪造 plan/tool_progress/verification/action_receipt 执行状态。
async function directChatCompat(safeMessage, context, metadata, compatReason, callbacks = {}) {
  recordDirectChatCompat(compatReason, metadata);
  if (callbacks.onStatus) {
    callbacks.onStatus({
      type: "run.status_unavailable",
      text: compatReason === "protocol_unsupported" ? "服务端版本较低，已切换兼容通道" : "已切换兼容通道",
    });
  }
  const response = await request.post("/api/ai/agent/chat", {
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
  if (response && typeof response === "object") {
    response.compatMode = "direct_chat";
    response.compatReason = compatReason;
    response.transport = "direct_chat_compat";
  }
  return response;
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
  // 单一 active-run 状态源（agentRunShell）驱动：建 Run → 事件扇出 → 终态
  // 交还。onRunEvents 桥接为（新批次, 累计）二元，保持页面回调契约不变。
  let fannedCount = 0;
  const done = await agentRunShell.shell.startRun({
    message: safeMessage,
    context,
    requestId: metadata.requestId || "",
    conversationId: metadata.conversationId || "",
    memoryMode: context.memoryMode || "local_only",
    cloudSyncEnabled: context.cloudSyncEnabled === true,
    shouldCancel: () => callbacks.shouldCancel && callbacks.shouldCancel() === true,
    callbacks: {
      onRunCreated: (info) => {
        if (callbacks.onRunCreated) callbacks.onRunCreated(info);
      },
      onRunEvents: (allEvents) => {
        const batch = allEvents.slice(fannedCount);
        fannedCount = allEvents.length;
        if (callbacks.onRunEvents) callbacks.onRunEvents(batch, allEvents.slice());
      },
      onStatus: (status) => {
        if (callbacks.onStatus) callbacks.onStatus(status);
      },
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
      runEvents: done.events || [],
    };
  }
  if (done.result) {
    return Object.assign({}, done.result, { runEvents: done.events || [] });
  }
  if (done.timeout) {
    // 超时不等于失败：Run 在服务端可能仍存活（句柄已保留，可在页面重开/
    // 网络恢复时续跑恢复）。如实抛可重试错误，绝不静默转 direct chat。
    const timeoutError = new Error("RUN_TIMEOUT");
    timeoutError.code = "TIMEOUT";
    timeoutError.reasonCode = "RUN_TIMEOUT";
    timeoutError.retriable = true;
    throw timeoutError;
  }
  const error = new Error(done.gone ? "RUN_GONE" : "RUN_FAILED");
  error.code = done.gone ? "RUN_GONE" : "RUN_FAILED";
  throw error;
}

async function callOracle(oracleChat, safeMessage, context, callbacks = {}, metadata = {}) {
  // Never guess loading from client intent. Prefer real run events.
  if (callbacks.onStatus) {
    callbacks.onStatus({ type: "request.submitted", text: "正在建立校园任务" });
  }
  // 兼容开关（显式 opt-out）：唯一允许绕过 Run API 的配置路径。
  if (oracleChat && !runsTransportEnabled()) {
    recordDirectChatCompat("explicit_flag", metadata);
    return oracleChat(safeMessage, context, metadata);
  }
  try {
    return await callOracleViaRuns(safeMessage, context, callbacks, metadata);
  } catch (error) {
    // 协议协商确认旧服务端无 Run API：受控兼容（记录原因，标记应答）。
    if (isProtocolUnsupportedError(error)) {
      return directChatCompat(safeMessage, context, metadata, "protocol_unsupported", callbacks);
    }
    // 普通网络错误/超时/失败：如实上抛，由离线降级链接管，不静默改语义。
    throw error;
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
    callbacks.onStatus({ type: "request.submitted", text: "正在建立校园任务" });
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
  DIRECT_CHAT_COMPAT_KEY,
  METRICS_KEY,
  buildGenericCard,
  chat: serverFirstChat,
  recordDirectChatCompat,
  recordMetric,
  safeText,
  shouldDisableGenerativeInClient,
};
