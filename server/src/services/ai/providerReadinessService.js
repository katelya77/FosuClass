/**
 * Provider readiness diagnostics for admin and (sanitized) agent readiness.
 */
const providerChainService = require("./providerChainService");
const providerConfigService = require("./providerConfigService");
const providerFactory = require("./providerFactory");
const runtimeModeService = require("./runtimeModeService");
const cozeProvider = require("./providers/cozeProvider");

function boolish(value) {
  return String(value || "").toLowerCase() === "true";
}

function configValue(runtimeConfig, key, fallback = "") {
  const source = runtimeConfig || {};
  if (Object.prototype.hasOwnProperty.call(source, key)) {
    const value = source[key];
    return value === undefined || value === null || value === "" ? fallback : value;
  }
  return process.env[key] || fallback;
}

function isCozeExpired(runtimeConfig = {}) {
  if (typeof cozeProvider.isExpired === "function") {
    return cozeProvider.isExpired(runtimeConfig);
  }
  const expiresAt = String(configValue(runtimeConfig, "COZE_EXPIRES_AT", "")).trim();
  if (!expiresAt) return false;
  const ms = Date.parse(expiresAt);
  return Number.isFinite(ms) && ms <= Date.now();
}

function evaluateEnvironment(environment = "public") {
  const env = providerConfigService.normalizeEnvironment(environment);
  const runtimeConfig = providerConfigService.getRuntimeConfigForEnvironment(env);
  const runtimeMode = env === "public" ? "public" : env;
  const agentEnabled = boolish(configValue(runtimeConfig, "AI_AGENT_ENABLED", "false"));
  const provider = String(configValue(runtimeConfig, "AI_PROVIDER", "mock")).toLowerCase() || "mock";
  const policy = String(configValue(runtimeConfig, "AI_PROVIDER_POLICY", "auto")).toLowerCase() || "auto";
  const chain = providerChainService.getProviderChain(runtimeMode, runtimeConfig);
  const model = provider === "openrouter"
    ? String(configValue(runtimeConfig, "OPENROUTER_MODELS", "")).split(",")[0].trim()
    : provider === "cloudbase-openai"
      ? String(configValue(runtimeConfig, "CLOUDBASE_OPENAI_TEXT_MODEL", "")).trim()
      : String(configValue(runtimeConfig, "AI_MODEL", "")).trim();
  const thinkingEnabled = boolish(configValue(runtimeConfig, "AI_THINKING_ENABLED", "false"));
  const keyConfigured = provider === "mock"
    ? true
    : providerChainService.isProviderConfigured(provider, runtimeConfig);
  const chainStatus = providerChainService.getStatus(runtimeMode, runtimeConfig);
  const cozeExpired = isCozeExpired(runtimeConfig);
  const configuredMode = runtimeModeService.resolveConfiguredMode();

  let reasonCode = "PROVIDER_HEALTHY";
  if (env === "public" || runtimeMode === "public") {
    reasonCode = "SERVER_RUNTIME_PUBLIC";
  } else if (!agentEnabled) {
    reasonCode = "AGENT_DISABLED";
  } else if (provider === "mock" && policy !== "always") {
    reasonCode = "PROVIDER_MOCK";
  } else if (!keyConfigured) {
    reasonCode = "PROVIDER_KEY_MISSING";
  } else if (!model && (provider === "deepseek" || provider === "openrouter")) {
    reasonCode = "PROVIDER_MODEL_MISSING";
  } else if (provider === "coze" && cozeExpired) {
    reasonCode = "PROVIDER_EXPIRED";
  } else {
    const openCircuit = (chainStatus || []).find((item) => item.circuitBreaker && item.circuitBreaker.state === "open");
    if (openCircuit) reasonCode = "PROVIDER_CIRCUIT_OPEN";
  }

  return {
    environment: env,
    runtimeMode,
    agentEnabled: env === "public" ? false : agentEnabled,
    provider: env === "public" ? "mock" : provider,
    providerChain: chain,
    policy: env === "public" ? "tool-only" : policy,
    model: env === "public" ? "" : model,
    reasoningModel: env === "public" ? "" : String(configValue(runtimeConfig, "AI_REASONING_MODEL", "")),
    thinkingEnabled: env === "public" ? false : thinkingEnabled,
    keyConfigured: env === "public" ? false : keyConfigured,
    providerConfigured: env === "public" ? false : keyConfigured && (provider !== "mock" || agentEnabled),
    configuredAvailable: env === "public"
      ? false
      : keyConfigured && !(provider === "coze" && cozeExpired) && !providerChainService.isCircuitOpen(provider),
    verified: env === "public" ? false : providerChainService.isProviderVerified(provider),
    coze: {
      enabled: boolish(configValue(runtimeConfig, "COZE_ENABLED", provider === "coze" ? "true" : "false")),
      role: String(configValue(runtimeConfig, "COZE_PROVIDER_ROLE", "temporary") || "temporary"),
      apiMode: String(configValue(runtimeConfig, "COZE_API_MODE", "bot") || "bot"),
      botConfigured: Boolean(configValue(runtimeConfig, "COZE_BOT_ID", "")),
      projectConfigured: Boolean(configValue(runtimeConfig, "COZE_WORKLOAD_ENDPOINT", "") && configValue(runtimeConfig, "COZE_PROJECT_ID", "")),
      keyConfigured: Boolean(configValue(runtimeConfig, "COZE_API_KEY", "")),
      expiresAt: String(configValue(runtimeConfig, "COZE_EXPIRES_AT", "")),
      expired: cozeExpired,
    },
    chainStatus,
    reasonCode,
    activeConfiguredMode: configuredMode,
    envOverridesRuntime: Boolean(process.env.AI_RUNTIME_MODE || process.env.AI_PROVIDER_ACTIVE_ENV),
  };
}

function getAdminMatrix() {
  const active = providerConfigService.getStatus().activeEnvironment || "public";
  const environments = {};
  providerConfigService.ENVIRONMENTS.forEach((env) => {
    environments[env] = evaluateEnvironment(env);
  });
  return {
    activeEnvironment: active,
    configuredMode: runtimeModeService.resolveConfiguredMode(),
    authorization: runtimeModeService.getAuthorizationStatus(),
    environments,
    checkedAt: new Date().toISOString(),
  };
}

function publicProviderFlags(runtimeMode, runtimeConfig) {
  const mode = String(runtimeMode || "public");
  if (mode === "public") {
    return {
      providerConfigured: false,
      configuredAvailable: false,
      providerReachable: false,
      verified: false,
      lastProbeAt: "",
      lastSuccessAt: "",
      lastFailureAt: "",
      circuitState: "closed",
      reasonCode: "SERVER_RUNTIME_PUBLIC",
    };
  }
  const name = providerFactory.getProviderName(mode, runtimeConfig);
  const configured = name !== "mock" && providerChainService.isProviderConfigured(name, runtimeConfig);
  const expired = name === "coze" && isCozeExpired(runtimeConfig);
  const status = providerChainService.getStatus(mode, runtimeConfig)
    .find((item) => item && item.name === name) || {};
  const circuitState = String(status.circuitBreaker && status.circuitBreaker.state || "closed");
  const lastSuccessAt = String(status.lastSuccessAt || "");
  const lastFailureAt = String(status.lastFailureAt || "");
  const verified = Boolean(lastSuccessAt);
  const providerReachable = verified
    && status.health === "ok"
    && circuitState !== "open"
    && (!lastFailureAt || lastSuccessAt >= lastFailureAt);
  let reasonCode = "PROVIDER_HEALTHY";
  if (String(configValue(runtimeConfig, "AI_AGENT_ENABLED", "false")).toLowerCase() === "false") {
    reasonCode = "AGENT_DISABLED";
  } else if (name === "mock") {
    reasonCode = "PROVIDER_MOCK";
  } else if (!configured) {
    reasonCode = "PROVIDER_KEY_MISSING";
  } else if (expired) {
    reasonCode = "PROVIDER_EXPIRED";
  } else if (circuitState === "open") {
    reasonCode = "PROVIDER_CIRCUIT_OPEN";
  } else if (!verified) {
    reasonCode = "PROVIDER_UNVERIFIED";
  } else if (!providerReachable) {
    reasonCode = "PROVIDER_UNREACHABLE";
  }
  // configuredAvailable：已配置 && 未到期 && 熔断未打开（不代表真实触达）。
  const configuredAvailable = configured && !expired && !providerChainService.isCircuitOpen(name);
  return {
    providerConfigured: configured && !expired,
    configuredAvailable,
    providerReachable,
    // verified：本进程内有真实成功调用或 probe 成功。
    verified,
    lastProbeAt: String(status.lastProbeAt || ""),
    lastSuccessAt,
    lastFailureAt,
    circuitState,
    reasonCode,
  };
}

module.exports = {
  evaluateEnvironment,
  getAdminMatrix,
  publicProviderFlags,
};
