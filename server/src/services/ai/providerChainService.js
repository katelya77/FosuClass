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

const DEFAULT_COMPETITION_CHAIN = ["cloudbase-openai", "deepseek", "coze", "mock"];
const DEFAULT_PUBLIC_CHAIN = ["mock"];
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
    });
  }
  return state.get(name);
}

function parseChain(value, fallback) {
  const items = String(value || "")
    .split(",")
    .map((item) => item.trim().toLowerCase())
    .filter((item) => PROVIDERS[item]);
  return items.length ? items : fallback.slice();
}

function normalizeProviderName(name) {
  const provider = String(name || "").trim().toLowerCase();
  return PROVIDERS[provider] ? provider : "";
}

function getProviderChain(runtimeMode = "public", runtimeConfig = {}) {
  if (runtimeMode === "public") return DEFAULT_PUBLIC_CHAIN.slice();
  const explicit = parseChain(configValue(runtimeConfig, "AI_PROVIDER_CHAIN", process.env.AI_PROVIDER_CHAIN || ""), []);
  if (explicit.length) return explicit;
  const configured = normalizeProviderName(configValue(runtimeConfig, "AI_PROVIDER", ""));
  if (configured && configured !== "mock") {
    return [configured, "mock"];
  }
  return DEFAULT_COMPETITION_CHAIN.slice();
}

function getProviderModule(name) {
  return PROVIDERS[name] || mockProvider;
}

function isProviderConfigured(name, runtimeConfig = {}) {
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

function markSuccess(name, latencyMs) {
  const item = readState(name);
  item.health = "ok";
  item.lastSuccessAt = nowIso();
  item.latencyMs = latencyMs;
  item.failureCount = 0;
  item.fallbackReason = "";
  item.circuitBreaker = { state: "closed", openedAt: "", nextProbeAt: "" };
  item.callCount += 1;
  item.latencies = item.latencies.concat(latencyMs).slice(-100);
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

function markFailure(name, reason) {
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

async function generateWithChain(input = {}, options = {}) {
  const runtimeMode = options.runtimeMode || "public";
  const runtimeConfig = options.providerRuntimeConfig || input.providerRuntimeConfig || {};
  const names = getProviderChain(runtimeMode, runtimeConfig);
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
    const started = Date.now();
    emitProviderEvent(options, {
      type: "provider.selected",
      status: "selected",
      reasonCode: name === "coze" ? "PROVIDER_TEMPORARY" : "PROVIDER_SELECTED",
    });
    emitProviderEvent(options, {
      type: "provider.started",
      status: "started",
      providerUsed: true,
    });
    try {
      const payload = await provider.generate(Object.assign({}, input, {
        providerRuntimeConfig: runtimeConfig,
        principal: input.principal || options.principal || null,
      }));
      markSuccess(name, Date.now() - started);
      emitProviderEvent(options, {
        type: "provider.completed",
        status: "success",
        providerUsed: true,
      });
      return Object.assign({}, payload, {
        provider: payload.provider || name,
        providerChain: attempts.concat({ provider: name, status: "success", latencyMs: Date.now() - started }),
      });
    } catch (error) {
      const reason = classifyFailure(error);
      markFailure(name, reason);
      attempts.push({ provider: name, status: "failed", reason });
      emitProviderEvent(options, {
        type: "provider.failed",
        status: "failed",
        reasonCode: String(reason || "provider_failed").slice(0, 80),
        providerUsed: false,
      });
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
    return Object.assign({}, item, {
      enabled: isProviderConfigured(name, runtimeConfig),
      p50LatencyMs: percentile(item.latencies, 50),
      p95LatencyMs: percentile(item.latencies, 95),
    });
  });
}

function resetForTest() {
  state.clear();
}

module.exports = {
  classifyFailure,
  generateWithChain,
  getProviderChain,
  getProviderModule,
  getStatus,
  isCircuitOpen,
  isProviderConfigured,
  resetForTest,
};
