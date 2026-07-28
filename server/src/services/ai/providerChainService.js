const mockProvider = require("./providers/mockProvider");
const deepseekProvider = require("./providers/deepseekProvider");
const cozeProvider = require("./providers/cozeProvider");
const cloudbaseOpenaiProvider = require("./providers/cloudbaseOpenaiProvider");

const PROVIDERS = {
  mock: mockProvider,
  deepseek: deepseekProvider,
  coze: cozeProvider,
  "cloudbase-openai": cloudbaseOpenaiProvider,
};
const PROVIDER_ALIASES = Object.freeze({
  hunyuan3: "cloudbase-openai",
  "hunyuan-3": "cloudbase-openai",
  "tencent-hunyuan3": "cloudbase-openai",
});

// trial/dev 推荐：Coze Agent → CloudBase 内置模型 → DeepSeek → 确定性 mock
const DEFAULT_COMPETITION_CHAIN = ["coze", "cloudbase-openai", "deepseek", "mock"];
const DEFAULT_PUBLIC_CHAIN = ["mock"];
// 阶段显式分配：Profile 字段（空 = 跟随主链）对应的运行时配置键。
const STAGE_CONFIG_KEYS = Object.freeze({
  understanding: "AI_UNDERSTANDING_PROVIDER",
  planner: "AI_PLANNER_PROVIDER",
  response: "AI_RESPONSE_PROVIDER",
});
const state = new Map();

function configValue(runtimeConfig, key, fallback = "") {
  const source = runtimeConfig || {};
  if (Object.prototype.hasOwnProperty.call(source, key)) {
    const value = source[key];
    return value === undefined || value === null || value === "" ? fallback : value;
  }
  return process.env[key] || fallback;
}

function nowIso() {
  return new Date().toISOString();
}

function readState(name) {
  if (!state.has(name)) {
    state.set(name, {
      name,
      enabled: true,
      model: "",
      health: "unknown",
      lastSuccessAt: "",
      lastFailureAt: "",
      latencyMs: 0,
      failureCount: 0,
      fallbackReason: "",
      circuitBreaker: { state: "closed", openedAt: "", nextProbeAt: "" },
      quotaState: "unknown",
      callCount: 0,
      fallbackCount: 0,
      latencies: [],
      shadowCallCount: 0,
      shadowSuccessCount: 0,
      shadowFailureCount: 0,
      shadowLatencyMs: 0,
    });
  }
  return state.get(name);
}

function parseChain(value, fallback) {
  const items = String(value || "")
    .split(",")
    .map((item) => normalizeProviderName(item))
    .filter(Boolean);
  return items.length ? Array.from(new Set(items)) : fallback.slice();
}

function normalizeProviderName(name) {
  const provider = String(name || "").trim().toLowerCase();
  const canonical = PROVIDER_ALIASES[provider] || provider;
  return PROVIDERS[canonical] ? canonical : "";
}

function getProviderChain(runtimeMode = "public", runtimeConfig = {}) {
  if (runtimeMode === "public") return DEFAULT_PUBLIC_CHAIN.slice();
  const request = runtimeConfig || {};
  const hasRequestChain = Object.prototype.hasOwnProperty.call(request, "AI_PROVIDER_CHAIN");
  const hasRequestProvider = Object.prototype.hasOwnProperty.call(request, "AI_PROVIDER");
  if (hasRequestChain) {
    const requestChain = parseChain(request.AI_PROVIDER_CHAIN, []);
    if (requestChain.length) return requestChain;
  }
  if (hasRequestProvider) {
    const requestProvider = normalizeProviderName(request.AI_PROVIDER);
    if (requestProvider === "mock") return ["mock"];
    if (requestProvider) return [requestProvider, "mock"];
  }
  if (!hasRequestChain) {
    const processChain = parseChain(process.env.AI_PROVIDER_CHAIN || "", []);
    if (processChain.length) return processChain;
  }
  const configured = normalizeProviderName(process.env.AI_PROVIDER || "");
  if (configured === "mock") return ["mock"];
  if (configured) {
    return [configured, "mock"];
  }
  return DEFAULT_COMPETITION_CHAIN.slice();
}

function getProviderModule(name) {
  return PROVIDERS[name] || mockProvider;
}

/**
 * 阶段显式链路：stage 字段非空 → [stageProvider, ...主链剔除它]；空 → 主链。
 * public 一律 ["mock"]，绝不触达外部 Provider。
 */
function resolveStageChain(stage, runtimeConfig = {}, runtimeMode = "") {
  const mode = String(
    runtimeMode || configValue(runtimeConfig, "AI_RUNTIME_MODE", "public")
  ).trim().toLowerCase();
  if (mode === "public") return DEFAULT_PUBLIC_CHAIN.slice();
  const mainChain = getProviderChain(mode, runtimeConfig);
  const key = STAGE_CONFIG_KEYS[String(stage || "").trim().toLowerCase()];
  if (!key) return mainChain;
  const stageProvider = normalizeProviderName(configValue(runtimeConfig, key, ""));
  if (!stageProvider) return mainChain;
  return [stageProvider].concat(mainChain.filter((name) => name !== stageProvider));
}

/** 本进程内是否有真实成功调用（真实请求或 probe 成功）。 */
function isProviderVerified(name) {
  const canonical = normalizeProviderName(name);
  if (!canonical) return false;
  return Boolean(readState(canonical).lastSuccessAt);
}

/** 最近一次真实外部（非 mock）成功调用，用于后台"实际使用"横幅。 */
function getLastExternalCall() {
  let best = null;
  state.forEach((item, name) => {
    if (name === "mock" || !item.lastSuccessAt) return;
    if (!best || item.lastSuccessAt > best.at) {
      best = { provider: publicProviderName(name), at: item.lastSuccessAt };
    }
  });
  return best;
}

function isProviderConfigured(name, runtimeConfig = {}) {
  name = normalizeProviderName(name);
  if (name === "mock") return true;
  if (name === "deepseek") return Boolean(deepseekProvider.firstConfiguredKey(runtimeConfig));
  if (name === "coze") {
    if (typeof cozeProvider.isEnabled === "function" && !cozeProvider.isEnabled(runtimeConfig)) {
      return false;
    }
    if (typeof cozeProvider.isExpired === "function" && cozeProvider.isExpired(runtimeConfig)) {
      return false;
    }
    const cfg = cozeProvider.getConfig(runtimeConfig);
    return cfg.apiMode === "workload"
      ? Boolean(cfg.apiKey && cfg.workloadEndpoint && cfg.projectId)
      : Boolean(cfg.apiKey && cfg.botId);
  }
  if (name === "cloudbase-openai") {
    return configValue(runtimeConfig, "CLOUDBASE_OPENAI_ENABLED", "false") === "true" && Boolean(cloudbaseOpenaiProvider.firstConfiguredKey(runtimeConfig));
  }
  return false;
}

function getCircuitConfig() {
  return {
    threshold: Math.max(1, Number(process.env.AI_PROVIDER_CIRCUIT_FAILURES || 3) || 3),
    cooldownMs: Math.max(1000, Number(process.env.AI_PROVIDER_CIRCUIT_COOLDOWN_MS || 60000) || 60000),
  };
}

function isCircuitOpen(name) {
  const item = readState(name);
  if (item.circuitBreaker.state !== "open") return false;
  const nextProbeAt = Date.parse(item.circuitBreaker.nextProbeAt || "");
  if (Number.isFinite(nextProbeAt) && Date.now() >= nextProbeAt) {
    item.circuitBreaker.state = "half-open";
    return false;
  }
  return true;
}

function markSuccess(name, latencyMs, meta = {}) {
  const item = readState(name);
  item.health = "ok";
  item.lastSuccessAt = nowIso();
  item.latencyMs = latencyMs;
  item.failureCount = 0;
  item.fallbackReason = "";
  item.circuitBreaker = { state: "closed", openedAt: "", nextProbeAt: "" };
  item.callCount += 1;
  item.latencies = item.latencies.concat(latencyMs).slice(-100);
  recordCallEvent({
    provider: publicProviderName(name),
    ok: true,
    latencyMs: Math.max(0, Math.round(Number(latencyMs) || 0)),
    kind: String(meta.kind || "").slice(0, 24),
    stage: String(meta.stage || "").slice(0, 24),
  });
}

function classifyFailure(error = {}) {
  const code = String(error.code || "");
  const status = Number(error.status || error.statusCode || error.response && error.response.status || 0) || 0;
  if (status === 400 || code === "provider_bad_request" || code === "invalid_payload") return "bad_request";
  if (status === 401) return "unauthorized";
  if (status === 403) return "forbidden";
  if (status === 429) return "rate_limited";
  if (code === "invalid_model") return "invalid_model";
  if (/timeout/i.test(code) || /timeout/i.test(String(error.message || ""))) return "timeout";
  if (code === "NOT_CONFIGURED") return "not_configured";
  return code || "provider_failed";
}

/**
 * 瞬时网络错误允许同 Provider 立即重试一次（不断线重试会让链抖动直接降级到下一 Provider）。
 * 只对连接级错误重试；4xx/鉴权/限流/超时（已等满超时预算）不重试。
 */
const TRANSIENT_RETRY_REASONS = new Set(["ECONNRESET", "ECONNREFUSED", "EAI_AGAIN", "UND_ERR_SOCKET", "socket"]);

function isTransientRetryable(reason) {
  const code = String(reason || "");
  if (TRANSIENT_RETRY_REASONS.has(code)) return true;
  return /socket hang up|ECONNRESET|EAI_AGAIN/i.test(code);
}

function markFailure(name, reason, meta = {}) {
  const item = readState(name);
  const cfg = getCircuitConfig();
  item.health = reason === "not_configured" ? "disabled" : "degraded";
  item.lastFailureAt = nowIso();
  item.failureCount += 1;
  item.fallbackReason = reason;
  item.fallbackCount += 1;
  if (item.failureCount >= cfg.threshold && name !== "mock") {
    const openedAt = Date.now();
    item.circuitBreaker = {
      state: "open",
      openedAt: new Date(openedAt).toISOString(),
      nextProbeAt: new Date(openedAt + cfg.cooldownMs).toISOString(),
    };
  }
  recordCallEvent({
    provider: publicProviderName(name),
    ok: false,
    latencyMs: Math.max(0, Math.round(Number(meta.latencyMs) || 0)),
    reason: String(reason || "").slice(0, 80),
    kind: String(meta.kind || "").slice(0, 24),
    stage: String(meta.stage || "").slice(0, 24),
  });
}

const CALL_LOG_LIMIT = 120;
const callLog = [];

/** 进程内调用日志（环形缓冲）：只记录元信息（provider/阶段/耗时/成败分类），绝不记录消息内容。 */
function recordCallEvent(entry) {
  callLog.push(Object.assign({ at: new Date().toISOString() }, entry));
  if (callLog.length > CALL_LOG_LIMIT) callLog.splice(0, callLog.length - CALL_LOG_LIMIT);
}

function getRecentCallEvents(limit = 60) {
  const size = Math.max(1, Math.min(CALL_LOG_LIMIT, Number(limit) || 60));
  return callLog.slice(-size).reverse();
}

function emitProviderEvent(options, event) {
  if (typeof options.onEvent === "function") {
    try {
      options.onEvent(event);
    } catch (error) {
      // event emission must never break provider chain
    }
  }
}

function publicProviderName(name) {
  return name === "cloudbase-openai" ? "hunyuan3" : String(name || "");
}

function withTimeout(promise, timeoutMs) {
  let timer = null;
  return Promise.race([
    Promise.resolve(promise),
    new Promise((resolve, reject) => {
      timer = setTimeout(() => {
        const error = new Error("Shadow provider timed out");
        error.code = "SHADOW_TIMEOUT";
        reject(error);
      }, timeoutMs);
    }),
  ]).finally(() => {
    if (timer) clearTimeout(timer);
  });
}

/**
 * Optional trial/dev shadow evaluation. The shadow result is diagnostic only:
 * its content is never returned to Planner, Tool Router, Response Composer, or memory.
 */
async function runShadowEvaluation(input = {}, options = {}, primaryName = "") {
  const runtimeMode = String(options.runtimeMode || "public");
  if (runtimeMode === "public") {
    return { provider: "", status: "skipped", latencyMs: 0, reason: "public_forbidden" };
  }
  const runtimeConfig = options.providerRuntimeConfig || input.providerRuntimeConfig || {};
  const enabled = String(configValue(runtimeConfig, "AI_PROVIDER_SHADOW_ENABLED", "false")).toLowerCase();
  if (enabled !== "true" && enabled !== "1") {
    return { provider: "", status: "skipped", latencyMs: 0, reason: "disabled" };
  }
  const configuredName = String(configValue(runtimeConfig, "AI_PROVIDER_SHADOW", "")).trim();
  const shadowName = normalizeProviderName(configuredName);
  const displayName = publicProviderName(shadowName || configuredName.toLowerCase());
  if (!shadowName || shadowName === "mock") {
    return { provider: displayName, status: "skipped", latencyMs: 0, reason: "not_configured" };
  }
  if (shadowName === normalizeProviderName(primaryName)) {
    return { provider: displayName, status: "skipped", latencyMs: 0, reason: "same_provider" };
  }
  if (typeof options.shadowGenerate !== "function" && !isProviderConfigured(shadowName, runtimeConfig)) {
    return { provider: displayName, status: "skipped", latencyMs: 0, reason: "not_configured" };
  }

  const shadowState = readState(shadowName);
  shadowState.shadowCallCount += 1;
  const started = Date.now();
  emitProviderEvent(options, {
    type: "provider.shadow.started",
    status: "started",
    provider: displayName,
    purpose: String(options.purpose || input.purpose || "response").slice(0, 32),
    providerUsed: true,
  });
  try {
    const provider = getProviderModule(shadowName);
    const invoke = typeof options.shadowGenerate === "function"
      ? options.shadowGenerate({ provider: displayName, canonicalProvider: shadowName, input })
      : (options.structured === true && typeof provider.generateStructured === "function"
        ? provider.generateStructured(Object.assign({}, input, { providerRuntimeConfig: runtimeConfig }))
        : provider.generate(Object.assign({}, input, { providerRuntimeConfig: runtimeConfig })));
    const timeoutMs = Math.max(250, Math.min(10000, Number(configValue(runtimeConfig, "AI_PROVIDER_SHADOW_TIMEOUT_MS", "3000")) || 3000));
    await withTimeout(invoke, timeoutMs);
    const latencyMs = Date.now() - started;
    shadowState.shadowSuccessCount += 1;
    shadowState.shadowLatencyMs = latencyMs;
    emitProviderEvent(options, {
      type: "provider.shadow.completed",
      status: "success",
      provider: displayName,
      purpose: String(options.purpose || input.purpose || "response").slice(0, 32),
      latencyMs,
      providerUsed: true,
    });
    return { provider: displayName, status: "success", latencyMs, reason: "" };
  } catch (error) {
    const latencyMs = Date.now() - started;
    const reason = classifyFailure(error);
    shadowState.shadowFailureCount += 1;
    shadowState.shadowLatencyMs = latencyMs;
    emitProviderEvent(options, {
      type: "provider.shadow.failed",
      status: "failed",
      provider: displayName,
      purpose: String(options.purpose || input.purpose || "response").slice(0, 32),
      latencyMs,
      reasonCode: String(reason).slice(0, 80),
      providerUsed: false,
    });
    return { provider: displayName, status: "failed", latencyMs, reason };
  }
}

/**
 * Schedule diagnostic shadow work without extending the user-facing request.
 * Results are observable only through safe events / an optional diagnostic hook.
 */
function scheduleShadowEvaluation(input = {}, options = {}, primaryName = "") {
  const runtimeConfig = options.providerRuntimeConfig || input.providerRuntimeConfig || {};
  const configuredName = String(configValue(runtimeConfig, "AI_PROVIDER_SHADOW", "")).trim();
  const displayName = publicProviderName(normalizeProviderName(configuredName) || configuredName.toLowerCase());
  const enabled = String(configValue(runtimeConfig, "AI_PROVIDER_SHADOW_ENABLED", "false")).toLowerCase();
  if (String(options.runtimeMode || "public") === "public") {
    return { provider: "", status: "skipped", latencyMs: 0, reason: "public_forbidden" };
  }
  if (enabled !== "true" && enabled !== "1") {
    return { provider: "", status: "skipped", latencyMs: 0, reason: "disabled" };
  }

  Promise.resolve()
    .then(() => runShadowEvaluation(input, options, primaryName))
    .then((result) => {
      if (typeof options.onShadowEvaluation === "function") {
        try {
          options.onShadowEvaluation(result);
        } catch (error) {
          // Diagnostics must never affect the primary request.
        }
      }
    })
    .catch((error) => {
      emitProviderEvent(options, {
        type: "provider.shadow.failed",
        status: "failed",
        provider: displayName,
        purpose: String(options.purpose || input.purpose || "response").slice(0, 32),
        reasonCode: String(classifyFailure(error)).slice(0, 80),
        providerUsed: false,
      });
    });

  return { provider: displayName, status: "scheduled", latencyMs: 0, reason: "background" };
}

/** Explicit, bounded health probe for admin/readiness jobs; never runs in public. */
async function probeProvider(name, input = {}) {
  const runtimeMode = String(input.runtimeMode || "public");
  const canonical = normalizeProviderName(name);
  const displayName = publicProviderName(canonical || name);
  if (runtimeMode === "public") {
    return { provider: displayName, health: "forbidden", latencyMs: 0, reasonCode: "PUBLIC_PROVIDER_FORBIDDEN" };
  }
  if (!canonical || canonical === "mock") {
    if (canonical === "mock") markSuccess("mock", 0);
    return { provider: displayName, health: canonical === "mock" ? "ok" : "disabled", latencyMs: 0, reasonCode: canonical ? "" : "PROVIDER_UNKNOWN" };
  }
  const runtimeConfig = input.providerRuntimeConfig || {};
  if (typeof input.probeGenerate !== "function" && !isProviderConfigured(canonical, runtimeConfig)) {
    markFailure(canonical, "not_configured", { kind: "probe" });
    return { provider: displayName, health: "disabled", latencyMs: 0, reasonCode: "NOT_CONFIGURED" };
  }
  const started = Date.now();
  try {
    const provider = getProviderModule(canonical);
    if (typeof input.probeGenerate === "function") {
      await input.probeGenerate({ provider: displayName, canonicalProvider: canonical });
    } else if (typeof provider.testConnection === "function") {
      const result = await provider.testConnection({ providerRuntimeConfig: runtimeConfig });
      if (!result || result.ok === false || result.success === false) {
        const error = new Error("Provider health probe failed");
        error.code = result && result.code || "PROVIDER_HEALTH_FAILED";
        throw error;
      }
    } else if (typeof provider.generateStructured === "function") {
      await provider.generateStructured({
        purpose: "health",
        messages: [
          { role: "system", content: "Return only {\"ok\":true}." },
          { role: "user", content: "health-check" },
        ],
        maxTokens: 32,
        timeoutMs: Math.max(1000, Math.min(5000, Number(input.timeoutMs || 2500) || 2500)),
        providerRuntimeConfig: runtimeConfig,
      });
    } else {
      const error = new Error("Provider has no health probe");
      error.code = "PROVIDER_HEALTH_UNSUPPORTED";
      throw error;
    }
    const latencyMs = Date.now() - started;
    markSuccess(canonical, latencyMs, { kind: "probe" });
    return { provider: displayName, health: "ok", latencyMs, reasonCode: "" };
  } catch (error) {
    const reasonCode = classifyFailure(error);
    const latencyMs = Date.now() - started;
    markFailure(canonical, reasonCode, { kind: "probe", latencyMs });
    return { provider: displayName, health: "degraded", latencyMs, reasonCode };
  }
}

async function generateWithChain(input = {}, options = {}) {
  const runtimeMode = options.runtimeMode || "public";
  const runtimeConfig = options.providerRuntimeConfig || input.providerRuntimeConfig || {};
  const names = options.stage
    ? resolveStageChain(options.stage, runtimeConfig, runtimeMode)
    : getProviderChain(runtimeMode, runtimeConfig);
  const attempts = [];
  for (const name of names) {
    if (name === "coze" && typeof cozeProvider.isExpired === "function" && cozeProvider.isExpired(runtimeConfig)) {
      markFailure(name, "expired");
      attempts.push({ provider: name, status: "skipped", reason: "expired" });
      continue;
    }
    if (isCircuitOpen(name)) {
      attempts.push({ provider: name, status: "skipped", reason: "circuit_open" });
      continue;
    }
    if (!isProviderConfigured(name, runtimeConfig)) {
      markFailure(name, "not_configured");
      attempts.push({ provider: name, status: "skipped", reason: "not_configured" });
      continue;
    }
    if (name === "mock") {
      const payload = mockProvider.generate(input);
      return Object.assign({}, payload, {
        provider: "mock",
        providerChain: attempts.concat({ provider: "mock", status: "success", reason: "deterministic_local_response" }),
      });
    }
    const provider = getProviderModule(name);
    emitProviderEvent(options, {
      type: "provider.selected",
      status: "selected",
      provider: name === "cloudbase-openai" ? "hunyuan3" : name,
      purpose: String(options.purpose || input.purpose || "response").slice(0, 32),
      reasonCode: name === "coze" ? "PROVIDER_TEMPORARY" : "PROVIDER_SELECTED",
    });
    // 瞬时连接错误（ECONNRESET/socket hang up）同 Provider 原地重试一次，避免链路抖动直接降级。
    for (let attempt = 1; attempt <= 2; attempt += 1) {
      const started = Date.now();
      emitProviderEvent(options, {
        type: "provider.started",
        status: "started",
        provider: name === "cloudbase-openai" ? "hunyuan3" : name,
        purpose: String(options.purpose || input.purpose || "response").slice(0, 32),
        providerUsed: true,
      });
      try {
        const generate = options.structured === true && typeof provider.generateStructured === "function"
          ? provider.generateStructured
          : provider.generate;
        const payload = await generate(Object.assign({}, input, {
          providerRuntimeConfig: runtimeConfig,
          principal: input.principal || options.principal || null,
        }));
        const latencyMs = Date.now() - started;
        markSuccess(name, latencyMs, {
          kind: options.structured === true ? "structured" : "generate",
          stage: String(options.stage || options.purpose || input.purpose || ""),
        });
        emitProviderEvent(options, {
          type: "provider.completed",
          status: "success",
          provider: name === "cloudbase-openai" ? "hunyuan3" : name,
          purpose: String(options.purpose || input.purpose || "response").slice(0, 32),
          latencyMs,
          providerUsed: true,
        });
        const shadowEvaluation = scheduleShadowEvaluation(input, options, name);
        return Object.assign({}, payload, {
          provider: payload.provider || name,
          providerChain: attempts.concat({ provider: name, status: "success", latencyMs }),
          shadowEvaluation,
        });
      } catch (error) {
        const reason = classifyFailure(error);
        markFailure(name, reason, {
          kind: options.structured === true ? "structured" : "generate",
          stage: String(options.stage || options.purpose || input.purpose || ""),
          latencyMs: Date.now() - started,
        });
        emitProviderEvent(options, {
          type: "provider.failed",
          status: "failed",
          provider: name === "cloudbase-openai" ? "hunyuan3" : name,
          purpose: String(options.purpose || input.purpose || "response").slice(0, 32),
          latencyMs: Date.now() - started,
          reasonCode: String(reason || "provider_failed").slice(0, 80),
          providerUsed: false,
        });
        if (attempt === 1 && isTransientRetryable(reason)) continue;
        attempts.push({ provider: name, status: "failed", reason });
        break;
      }
    }
  }
  const fallback = mockProvider.generate(input);
  return Object.assign({}, fallback, {
    provider: "mock",
    providerChain: attempts.concat({ provider: "mock", status: "success", reason: "deterministic_local_response" }),
  });
}

function percentile(values, p) {
  const nums = (values || []).filter((item) => Number.isFinite(Number(item))).map(Number).sort((a, b) => a - b);
  if (!nums.length) return 0;
  const index = Math.min(nums.length - 1, Math.max(0, Math.ceil((p / 100) * nums.length) - 1));
  return nums[index];
}

function getStatus(runtimeMode = "competition", runtimeConfig = {}) {
  return getProviderChain(runtimeMode, runtimeConfig).map((name) => {
    const item = readState(name);
    const configured = isProviderConfigured(name, runtimeConfig);
    const expired = name === "coze"
      && typeof cozeProvider.isExpired === "function"
      && cozeProvider.isExpired(runtimeConfig);
    return Object.assign({}, item, {
      enabled: configured,
      // configuredAvailable = 已配置 && 未到期 && 熔断未打开（从不等于"真实触达"）
      configuredAvailable: configured && !expired && !isCircuitOpen(name),
      // verified = 本进程内有真实成功调用或 probe 成功
      verified: Boolean(item.lastSuccessAt),
      p50LatencyMs: percentile(item.latencies, 50),
      p95LatencyMs: percentile(item.latencies, 95),
    });
  });
}

function resetForTest() {
  state.clear();
  callLog.length = 0;
}

/**
 * 配置变更后调用：清空各 Provider 的熔断/失败计数，让新配置立即生效。
 * 保留 lastSuccessAt / 延迟样本等真实成功指标（它们是历史事实，不是陈旧状态）。
 */
function resetCircuitState() {
  state.forEach((item) => {
    item.failureCount = 0;
    item.fallbackReason = "";
    item.circuitBreaker = { state: "closed", openedAt: "", nextProbeAt: "" };
    if (item.health !== "ok") item.health = "unknown";
  });
}

module.exports = {
  classifyFailure,
  generateWithChain,
  getLastExternalCall,
  getProviderChain,
  getProviderModule,
  getRecentCallEvents,
  getStatus,
  isCircuitOpen,
  isProviderConfigured,
  isProviderVerified,
  normalizeProviderName,
  probeProvider,
  resetCircuitState,
  resolveStageChain,
  runShadowEvaluation,
  scheduleShadowEvaluation,
  resetForTest,
};
