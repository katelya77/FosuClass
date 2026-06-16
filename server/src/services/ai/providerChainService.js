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

function getProviderChain(runtimeMode = "public") {
  if (runtimeMode !== "competition") return DEFAULT_PUBLIC_CHAIN.slice();
  return parseChain(process.env.AI_PROVIDER_CHAIN, DEFAULT_COMPETITION_CHAIN);
}

function getProviderModule(name) {
  return PROVIDERS[name] || mockProvider;
}

function isProviderConfigured(name) {
  if (name === "mock") return true;
  if (name === "deepseek") return Boolean(deepseekProvider.firstConfiguredKey());
  if (name === "coze") {
    const cfg = cozeProvider.getConfig();
    return Boolean(cfg.apiKey && cfg.botId);
  }
  if (name === "cloudbase-openai") {
    return process.env.CLOUDBASE_OPENAI_ENABLED === "true" && Boolean(cloudbaseOpenaiProvider.firstConfiguredKey());
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

async function generateWithChain(input = {}, options = {}) {
  const runtimeMode = options.runtimeMode || "public";
  const names = getProviderChain(runtimeMode);
  const attempts = [];
  for (const name of names) {
    if (isCircuitOpen(name)) {
      attempts.push({ provider: name, status: "skipped", reason: "circuit_open" });
      continue;
    }
    if (!isProviderConfigured(name)) {
      markFailure(name, "not_configured");
      attempts.push({ provider: name, status: "skipped", reason: "not_configured" });
      continue;
    }
    const provider = getProviderModule(name);
    const started = Date.now();
    try {
      const payload = await provider.generate(input);
      markSuccess(name, Date.now() - started);
      return Object.assign({}, payload, {
        provider: payload.provider || name,
        providerChain: attempts.concat({ provider: name, status: "success", latencyMs: Date.now() - started }),
      });
    } catch (error) {
      const reason = classifyFailure(error);
      markFailure(name, reason);
      attempts.push({ provider: name, status: "failed", reason });
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

function getStatus(runtimeMode = "competition") {
  return getProviderChain(runtimeMode).map((name) => {
    const item = readState(name);
    return Object.assign({}, item, {
      enabled: isProviderConfigured(name),
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
  isProviderConfigured,
  resetForTest,
};
