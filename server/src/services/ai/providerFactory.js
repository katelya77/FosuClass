const mockProvider = require("./providers/mockProvider");
const deepseekProvider = require("./providers/deepseekProvider");
const cozeProvider = require("./providers/cozeProvider");
const cloudbaseOpenaiProvider = require("./providers/cloudbaseOpenaiProvider");

function getRuntimeMode() {
  const raw = String(process.env.AI_RUNTIME_MODE || "").trim().toLowerCase();
  if (raw === "public") return "public";
  if (raw === "competition") return "competition";
  return "legacy";
}

function getProviderName() {
  if (getRuntimeMode() === "public") {
    return "mock";
  }
  if (String(process.env.AI_AGENT_ENABLED || "false").toLowerCase() === "false") {
    return "mock";
  }
  const configured = String(process.env.AI_PROVIDER || "").trim().toLowerCase();
  if (configured === "mock") return "mock";
  if (configured === "cloudbase-openai") return "cloudbase-openai";
  if (configured === "coze") return "coze";
  if (configured === "deepseek") return "deepseek";
  if (cloudbaseOpenaiProvider.firstConfiguredKey() && String(process.env.CLOUDBASE_OPENAI_ENABLED || "false").toLowerCase() === "true") return "cloudbase-openai";
  if (deepseekProvider.firstConfiguredKey()) return "deepseek";
  return "mock";
}

function createProvider() {
  const provider = getProviderName();
  if (provider === "deepseek") return deepseekProvider;
  if (provider === "cloudbase-openai") return cloudbaseOpenaiProvider;
  if (provider === "coze") return cozeProvider;
  return mockProvider;
}

module.exports = {
  createProvider,
  getProviderName,
  getRuntimeMode,
  cloudbaseOpenaiProvider,
  mockProvider,
};
