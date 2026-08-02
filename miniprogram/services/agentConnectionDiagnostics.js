const { API_BASE_URL } = require("../config/api");
const request = require("../utils/request");
const platform = require("../utils/platform");
const readinessClient = require("./agentReadinessClient");
const sessionService = require("./securitySessionService");
const runClient = require("./agentRunClient");
const memoryClient = require("./agentMemoryClient");
const errorMapper = require("./agentClientErrorMapper");

function safeText(value, max = 160) {
  return String(value == null ? "" : value).trim().slice(0, max);
}

function createRequestId(now) {
  return `diag-${Number(now || Date.now()).toString(36)}-${Math.random().toString(36).slice(2, 9)}`;
}

function hostnameOf(url) {
  const match = String(url || "").match(/^https?:\/\/([^/:?#]+)/i);
  return match ? match[1].toLowerCase() : "";
}

function isDiagnosticsVisible(envVersion) {
  return ["trial", "develop"].includes(platform.normalizeMiniProgramEnvVersion(envVersion));
}

function failureLayer(code) {
  const value = safeText(code, 80).toUpperCase();
  if (/MEMORY/.test(value)) return "memory";
  if (/PROVIDER/.test(value)) return "provider";
  if (/SESSION/.test(value)) return "session";
  if (/RUN_(?:CREATE|POLL|EXPIRED|EXECUTOR)/.test(value)) return "run";
  if (/TOOL/.test(value)) return "tool";
  if (/WECHAT|DOMAIN/.test(value)) return "wechat";
  if (/DNS|TLS|NETWORK|TIMEOUT|CONNECT/.test(value)) return "network";
  if (/HTTP_4/.test(value)) return "http_client";
  if (/HTTP_5/.test(value)) return "server";
  return "unknown";
}

function suggestionFor(code) {
  const value = safeText(code, 80).toUpperCase();
  const messages = {
    NETWORK_OFFLINE: "打开移动数据或 Wi-Fi 后重新诊断。",
    DNS_FAILED: "检查 API 域名的 A、AAAA、CNAME 与移动网络解析。",
    TLS_FAILED: "检查证书链、SNI、有效期与 TLS 1.2 以上支持。",
    WECHAT_DOMAIN_NOT_ALLOWED: "在微信公众平台把 HTTPS API 主机加入 request 合法域名。",
    WECHAT_NETWORK_REQUEST_FAILED: "复制脱敏 errMsg，分别在 5G 与 Wi-Fi 复测微信网络层。",
    FOSU_SESSION_REQUIRED: "重新进入小程序获取 Session，并检查反向代理是否保留 X-Fosu-Session。",
    FOSU_SESSION_INVALID: "清理失效 Session 后重新登录并再次诊断。",
    RUNTIME_NOT_AUTHORIZED: "核对体验版环境、Session capability 与服务端运行模式授权。",
    RUN_CREATE_FAILED: "按 requestId 检查反向代理、WAF 与 Run create 日志。",
    RUN_POLL_FAILED: "按 runId 检查轮询路由、Run Store 与执行器。",
    RUN_EXPIRED: "重新执行诊断，并检查 Run TTL 与执行耗时。",
    RUN_EXECUTOR_LOST: "检查执行器重启、队列租约与持久化 Run Store。",
    PROVIDER_NOT_CONFIGURED: "为当前 trial/dev 配置 Provider；不要把配置存在当成验证成功。",
    PROVIDER_UNVERIFIED: "从助手运行中心执行一次真实 Provider Probe。",
    PROVIDER_TIMEOUT: "检查 Provider 延迟、出口网络、超时与熔断状态。",
    PROVIDER_UNAUTHORIZED: "检查 Provider 凭据权限与有效期，不要在报告中粘贴密钥。",
    PROVIDER_RATE_LIMITED: "检查 Provider 配额和 429 退避策略。",
    TOOL_FAILED: "按 runId 查看失败 Tool、Release Pack 与数据版本。",
    MEMORY_STORE_UNAVAILABLE: "检查 PostgreSQL/Memory Store，并保持本机记忆可浏览。",
  };
  return messages[value] || errorMapper.userMessage(value || "WECHAT_NETWORK_REQUEST_FAILED");
}

function errorDetails(error, fallbackCode) {
  const code = safeText(error && (
    error.reasonCode || error.code || error.errorCode ||
    error.payload && (error.payload.reasonCode || error.payload.code)
  ), 80) || fallbackCode;
  return {
    failureLayer: safeText(error && error.failureLayer, 40) || failureLayer(code),
    reasonCode: code,
    statusCode: Number(error && error.statusCode || 0) || 0,
    elapsedMs: Number(error && error.elapsedMs || 0) || 0,
    requestId: safeText(error && (error.requestId || error.payload && error.payload.requestId), 96),
    runId: safeText(error && (error.runId || error.payload && error.payload.runId), 96),
    errMsg: safeText(error && (error.safeErrMsg || error.errMsg || error.message), 180),
    suggestion: suggestionFor(code),
  };
}

function defaultNetworkType() {
  return new Promise((resolve) => {
    try {
      wx.getNetworkType({
        success: (res) => resolve(safeText(res && res.networkType, 24) || "unknown"),
        fail: () => resolve("unknown"),
      });
    } catch (error) {
      resolve("unknown");
    }
  });
}

function defaultDependencies() {
  return {
    apiBaseUrl: API_BASE_URL,
    envVersion: platform.getMiniProgramEnvVersion(),
    getNetworkType: defaultNetworkType,
    getHealth: () => request.get("/api/health", {}, {
      showLoading: false, silentError: true, timeout: 8000, retries: 0, dedupe: false,
    }),
    getReadiness: readinessClient.fetchReadiness,
    ensureSession: () => sessionService.ensureSession({ refreshSkewMs: 0 }),
    createRun: runClient.createRun,
    pollRun: (runId, pollToken) => runClient.pollRunUntilDone(runId, pollToken, { maxWaitMs: 20000 }),
    getMemorySnapshot: memoryClient.getMemorySnapshot,
    now: Date.now,
  };
}

async function runStep(id, label, operation, fallbackCode) {
  const startedAt = Date.now();
  try {
    const value = await operation();
    const failed = !value || value.success === false || value.ok === false || value.timeout === true || value.status === "failed";
    if (failed) {
      const detail = errorDetails(value || {}, fallbackCode);
      return Object.assign({ id, label, status: "failed", elapsedMs: Date.now() - startedAt }, detail, { value });
    }
    return { id, label, status: "passed", elapsedMs: Date.now() - startedAt, value };
  } catch (error) {
    return Object.assign({ id, label, status: "failed", elapsedMs: Date.now() - startedAt }, errorDetails(error, fallbackCode));
  }
}

function runtimeFromRun(runResult) {
  const result = runResult && (runResult.result || runResult) || {};
  return safeText(result.runtimeMode || result.environment || result.safety && result.safety.runtimeMode, 24);
}

function configFromRun(runResult) {
  const result = runResult && (runResult.result || runResult) || {};
  return safeText(result.configVersion || result.config && result.config.version || result.safety && result.safety.configVersion, 96);
}

async function runConnectionDiagnostics(input = {}, injectedDependencies) {
  const deps = Object.assign(defaultDependencies(), injectedDependencies || {});
  const envVersion = platform.normalizeMiniProgramEnvVersion(input.envVersion || deps.envVersion);
  if (!isDiagnosticsVisible(envVersion)) {
    const error = new Error("DIAGNOSTICS_NOT_AVAILABLE_IN_RELEASE");
    error.code = "DIAGNOSTICS_NOT_AVAILABLE_IN_RELEASE";
    throw error;
  }
  const requestId = safeText(input.requestId, 96) || createRequestId(deps.now());
  const steps = [];
  let readiness = {};
  let runCreate = {};
  let runPoll = {};

  steps.push(await runStep("network", "微信网络类型", async () => {
    const networkType = await deps.getNetworkType();
    if (networkType === "none") return { success: false, code: "NETWORK_OFFLINE", networkType };
    return { success: true, networkType };
  }, "WECHAT_NETWORK_REQUEST_FAILED"));
  steps.push(await runStep("health", "/api/health", deps.getHealth, "HTTP_5XX"));
  const readinessStep = await runStep("readiness", "Agent Readiness", deps.getReadiness, "SERVER_UNREACHABLE");
  steps.push(readinessStep);
  readiness = readinessStep.value || {};
  steps.push(await runStep("session", "Session", async () => {
    const session = await deps.ensureSession();
    if (!session || !session.sessionToken) return { success: false, code: "FOSU_SESSION_REQUIRED" };
    return { success: true, valid: true, expiresAt: session.expiresAt || "", securityMode: session.securityMode || "" };
  }, "FOSU_SESSION_REQUIRED"));
  const createStep = await runStep("run_create", "创建 Run", async () => deps.createRun({
    message: "你好",
    requestId,
    conversationId: `diagnostic-${requestId}`,
    protocolVersion: "agent.v2",
    memoryMode: "local_only",
    context: { envVersion, diagnostic: true, memoryMode: "local_only" },
  }), "RUN_CREATE_FAILED");
  steps.push(createStep);
  runCreate = createStep.value || {};
  const pollStep = await runStep("run_poll", "轮询 Run", async () => {
    if (!runCreate.runId) return { success: false, code: "RUN_CREATE_FAILED", requestId };
    const outcome = await deps.pollRun(runCreate.runId, runCreate.pollToken);
    if (outcome && outcome.timeout) return Object.assign({}, outcome, { success: false, code: "RUN_POLL_FAILED" });
    return Object.assign({ success: Boolean(outcome && outcome.result) }, outcome || {});
  }, "RUN_POLL_FAILED");
  steps.push(pollStep);
  runPoll = pollStep.value || {};
  steps.push(await runStep("memory_snapshot", "Memory Snapshot", deps.getMemorySnapshot, "MEMORY_STORE_UNAVAILABLE"));

  const runtimeMode = safeText(readiness.runtimeMode, 24);
  const runRuntimeMode = runtimeFromRun(runPoll);
  if (runtimeMode && runRuntimeMode && runtimeMode !== runRuntimeMode) {
    const mismatch = errorDetails({ code: "RUNTIME_ENVIRONMENT_MISMATCH", requestId, runId: runCreate.runId }, "RUNTIME_ENVIRONMENT_MISMATCH");
    steps.push(Object.assign({ id: "runtime_consistency", label: "运行环境一致性", status: "failed", elapsedMs: 0 }, mismatch));
  }

  const failedSteps = steps.filter((step) => step.status === "failed");
  const latestFailure = failedSteps.length ? failedSteps[failedSteps.length - 1] : null;
  const lastFailure = latestFailure ? {
    failureLayer: latestFailure.failureLayer,
    reasonCode: latestFailure.reasonCode,
    statusCode: latestFailure.statusCode,
    elapsedMs: latestFailure.elapsedMs,
    requestId: latestFailure.requestId || requestId,
    runId: latestFailure.runId || safeText(runCreate.runId, 96),
    errMsg: latestFailure.errMsg,
    suggestion: latestFailure.suggestion,
  } : null;

  return {
    schemaVersion: "fosu.real-device-diagnostics.v1",
    checkedAt: new Date(Number(deps.now())).toISOString(),
    envVersion,
    apiHostname: hostnameOf(deps.apiBaseUrl),
    requestId,
    runId: safeText(runCreate.runId, 96),
    runtimeMode,
    runRuntimeMode,
    configVersion: safeText(readiness.configVersion, 96) || configFromRun(runPoll),
    provider: {
      name: safeText(readiness.provider || readiness.providerName, 48),
      configured: readiness.providerConfigured === true,
      verified: readiness.providerVerified === true,
      reachable: readiness.providerReachable === true,
      lastProbeAt: safeText(readiness.lastProbeAt, 40),
      lastSuccessAt: safeText(readiness.lastSuccessAt, 40),
      circuitState: safeText(readiness.circuitState, 24) || "unknown",
    },
    steps: steps.map((step) => {
      const value = step.value || {};
      return {
        id: step.id,
        label: step.label,
        status: step.status,
        elapsedMs: step.elapsedMs,
        reasonCode: step.reasonCode || "",
        failureLayer: step.failureLayer || "",
        statusCode: step.statusCode || 0,
        requestId: step.requestId || safeText(value.requestId, 96),
        runId: step.runId || safeText(value.runId, 96),
        detail: step.id === "network" ? safeText(value.networkType, 24) : "",
        suggestion: step.suggestion || "",
      };
    }),
    lastFailure,
    overallStatus: failedSteps.length ? (failedSteps.length === steps.length ? "fault" : "degraded") : "healthy",
  };
}

function serializeDiagnosticReport(report) {
  const source = report || {};
  return JSON.stringify({
    schemaVersion: source.schemaVersion,
    checkedAt: source.checkedAt,
    envVersion: source.envVersion,
    apiHostname: source.apiHostname,
    requestId: source.requestId,
    runId: source.runId,
    runtimeMode: source.runtimeMode,
    runRuntimeMode: source.runRuntimeMode,
    configVersion: source.configVersion,
    provider: source.provider,
    steps: source.steps,
    lastFailure: source.lastFailure,
    overallStatus: source.overallStatus,
  }, null, 2);
}

module.exports = {
  failureLayer,
  isDiagnosticsVisible,
  runConnectionDiagnostics,
  serializeDiagnosticReport,
  suggestionFor,
};
