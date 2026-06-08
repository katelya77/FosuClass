const mockProvider = require("./providers/mockProvider");
const deepseekProvider = require("./providers/deepseekProvider");
const cozeProvider = require("./providers/cozeProvider");

function getProviderName() {
  if (String(process.env.AI_AGENT_ENABLED || "false").toLowerCase() === "false") {
    return "mock";
  }
  const configured = String(process.env.AI_PROVIDER || "").trim().toLowerCase();
  if (configured === "coze") return "coze";
  if (configured === "deepseek") return "deepseek";
  if (deepseekProvider.firstConfiguredKey()) return "deepseek";
  return "mock";
}

function createProvider() {
  const provider = getProviderName();
  if (provider === "deepseek") return deepseekProvider;
  if (provider === "coze") return cozeProvider;
  return mockProvider;
}

module.exports = {
  createProvider,
  getProviderName,
  mockProvider,
};
