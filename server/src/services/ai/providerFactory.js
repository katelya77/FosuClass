const mockProvider = require("./providers/mockProvider");
const deepseekProvider = require("./providers/deepseekProvider");
const cozeProvider = require("./providers/cozeProvider");

function getProviderName() {
  if (String(process.env.AI_AGENT_ENABLED || "false").toLowerCase() === "false") {
    return "mock";
  }
  return String(process.env.AI_PROVIDER || "mock").trim().toLowerCase() || "mock";
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
