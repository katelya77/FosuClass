const mockProvider = require("./providers/mockProvider");
const deepseekProvider = require("./providers/deepseekProvider");
const cozeProvider = require("./providers/cozeProvider");
const cloudbaseOpenaiProvider = require("./providers/cloudbaseOpenaiProvider");
const openrouterProvider = require("./providers/openrouterProvider");
const providerChainService = require("./providerChainService");
const capabilityManifestService = require("./capabilityManifestService");

function configValue(runtimeConfig, key, fallback = "") {
  const source = runtimeConfig || {};
  if (Object.prototype.hasOwnProperty.call(source, key)) {
    const value = source[key];
    return value === undefined || value === null || value === "" ? fallback : value;
  }
  return process.env[key] || fallback;
}

function getRuntimeMode(runtimeConfig) {
  const raw = String(configValue(runtimeConfig, "AI_RUNTIME_MODE", "")).trim().toLowerCase();
  if (raw === "competition") {
    const active = String(configValue(runtimeConfig, "AI_PROVIDER_ACTIVE_ENV", "trial")).trim().toLowerCase();
    return active === "dev" ? "dev" : "trial";
  }
  return capabilityManifestService.normalizeRuntimeMode(raw);
}

function getProviderName(runtimeMode, runtimeConfig) {
  if ((runtimeMode || getRuntimeMode(runtimeConfig)) === "public") {
    return "mock";
  }
  if (String(configValue(runtimeConfig, "AI_AGENT_ENABLED", "false")).toLowerCase() === "false") {
    return "mock";
  }
  const disabled = providerChainService.getDisabledProviderSet(runtimeConfig);
  const isInstalled = (name) => !disabled.has(name);
  const configured = String(configValue(runtimeConfig, "AI_PROVIDER", "")).trim().toLowerCase();
  if (configured === "mock") return "mock";
  if (["cloudbase-openai", "hunyuan3", "hunyuan-3", "tencent-hunyuan3"].includes(configured) && isInstalled("cloudbase-openai")) return "cloudbase-openai";
  if (configured === "coze" && isInstalled("coze")) return "coze";
  if (configured === "deepseek" && isInstalled("deepseek")) return "deepseek";
  if (configured === "openrouter" && isInstalled("openrouter")) return "openrouter";
  if (isInstalled("openrouter") && openrouterProvider.getConfig(runtimeConfig).enabled && openrouterProvider.firstConfiguredKey(runtimeConfig)) return "openrouter";
  if (isInstalled("cloudbase-openai") && cloudbaseOpenaiProvider.firstConfiguredKey(runtimeConfig) && String(configValue(runtimeConfig, "CLOUDBASE_OPENAI_ENABLED", "false")).toLowerCase() === "true") return "cloudbase-openai";
  if (isInstalled("deepseek") && deepseekProvider.firstConfiguredKey(runtimeConfig)) return "deepseek";
  return "mock";
}

function createProvider(runtimeMode, runtimeConfig) {
  const provider = getProviderName(runtimeMode, runtimeConfig);
  if (provider === "deepseek") return deepseekProvider;
  if (provider === "cloudbase-openai") return cloudbaseOpenaiProvider;
  if (provider === "coze") return cozeProvider;
  if (provider === "openrouter") return openrouterProvider;
  return mockProvider;
}

module.exports = {
  configValue,
  createProvider,
  getProviderName,
  getRuntimeMode,
  providerChainService,
  cloudbaseOpenaiProvider,
  openrouterProvider,
  mockProvider,
};
