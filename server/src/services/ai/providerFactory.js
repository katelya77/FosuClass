const mockProvider = require("./providers/mockProvider");
const deepseekProvider = require("./providers/deepseekProvider");
const cozeProvider = require("./providers/cozeProvider");
const cloudbaseOpenaiProvider = require("./providers/cloudbaseOpenaiProvider");
const providerChainService = require("./providerChainService");

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
  if (raw === "public") return "public";
  if (raw === "competition") return "competition";
  return "public";
}

function getProviderName(runtimeMode, runtimeConfig) {
  if ((runtimeMode || getRuntimeMode(runtimeConfig)) === "public") {
    return "mock";
  }
  if (String(configValue(runtimeConfig, "AI_AGENT_ENABLED", "false")).toLowerCase() === "false") {
    return "mock";
  }
  const configured = String(configValue(runtimeConfig, "AI_PROVIDER", "")).trim().toLowerCase();
  if (configured === "mock") return "mock";
  if (configured === "cloudbase-openai") return "cloudbase-openai";
  if (configured === "coze") return "coze";
  if (configured === "deepseek") return "deepseek";
  if (cloudbaseOpenaiProvider.firstConfiguredKey(runtimeConfig) && String(configValue(runtimeConfig, "CLOUDBASE_OPENAI_ENABLED", "false")).toLowerCase() === "true") return "cloudbase-openai";
  if (deepseekProvider.firstConfiguredKey(runtimeConfig)) return "deepseek";
  return "mock";
}

function createProvider(runtimeMode, runtimeConfig) {
  const provider = getProviderName(runtimeMode, runtimeConfig);
  if (provider === "deepseek") return deepseekProvider;
  if (provider === "cloudbase-openai") return cloudbaseOpenaiProvider;
  if (provider === "coze") return cozeProvider;
  return mockProvider;
}

module.exports = {
  configValue,
  createProvider,
  getProviderName,
  getRuntimeMode,
  providerChainService,
  cloudbaseOpenaiProvider,
  mockProvider,
};
