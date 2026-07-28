const capabilityManifestService = require("./capabilityManifestService");
const providerChainService = require("./providerChainService");

async function generateStructured(input = {}) {
  const runtimeMode = capabilityManifestService.normalizeRuntimeMode(input.runtimeMode || "public");
  if (runtimeMode === "public") {
    const error = new Error("Structured inference is forbidden in public mode");
    error.code = "PUBLIC_PROVIDER_FORBIDDEN";
    throw error;
  }
  // 阶段显式链路：显式 input.stage 优先，其次按 purpose 映射；不再整条链隐式重来。
  const purpose = String(input.purpose || "structured");
  const stage = String(input.stage || "").trim().toLowerCase()
    || (purpose === "planning" ? "planner" : purpose === "understanding" ? "understanding" : "");
  return providerChainService.generateWithChain({
    messages: input.messages || [],
    message: input.message || "",
    intent: { name: "conversational_help", slots: {} },
    toolResults: [],
    projectKnowledge: "",
    context: { conversationId: input.conversationId || "", conversationSummary: "" },
    conversationId: input.conversationId || "",
    principal: input.principal || null,
    providerRuntimeConfig: input.providerRuntimeConfig || {},
    maxTokens: input.maxTokens,
    timeoutMs: input.timeoutMs,
    purpose: input.purpose || "structured",
  }, {
    runtimeMode,
    providerRuntimeConfig: input.providerRuntimeConfig || {},
    principal: input.principal || null,
    onEvent: input.onEvent,
    purpose: input.purpose || "structured",
    stage,
    structured: true,
  });
}

module.exports = {
  generateStructured,
};
