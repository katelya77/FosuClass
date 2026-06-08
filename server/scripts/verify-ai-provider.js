const path = require("path");

require("../src/config");

const agentService = require("../src/services/ai/agentService");
const aiProviderConfigService = require("../src/services/ai/providerConfigService");

async function runProbe(message, contextPatch = {}) {
  const startedAt = Date.now();
  const response = await agentService.chat({
    message,
    context: Object.assign({
      currentPage: "verify-ai-provider",
      timezone: "Asia/Shanghai",
      currentScheduleSummary: { enabled: false, targetType: "", targetName: "", courses: [] },
    }, contextPatch),
  });
  return {
    provider: response.safety && response.safety.provider || "mock",
    desiredProvider: response.safety && response.safety.desiredProvider || "",
    resolvedProvider: response.safety && response.safety.resolvedProvider || "",
    externalProviderUsed: response.safety && response.safety.externalProviderUsed === true,
    providerPolicy: response.safety && response.safety.providerPolicy || "",
    providerDecisionReason: response.safety && response.safety.providerDecisionReason || "",
    mode: response.safety && response.safety.mode || "tool-grounded",
    elapsedMs: Date.now() - startedAt,
    toolCalls: response.toolCalls || [],
    answerPreview: String(response.answer || "").slice(0, 100),
  };
}

async function run() {
  const status = aiProviderConfigService.getStatus();
  console.log(JSON.stringify({
    provider: status.provider,
    model: status.model,
    baseUrl: status.baseUrl,
    enabled: status.enabled,
    keyConfigured: Boolean(status.deepseekKeyConfigured || status.cozeKeyConfigured),
    envPath: path.relative(process.cwd(), status.envPath),
  }, null, 2));

  const deterministicToolTest = await runProbe("今天还有课吗？");
  const projectQaProviderTest = await runProbe("FosuClass 是什么？小佛你了解当前项目吗？");
  const previousPolicy = process.env.AI_PROVIDER_POLICY;
  let forceProviderTest;
  try {
    process.env.AI_PROVIDER_POLICY = "always";
    forceProviderTest = await runProbe("请用项目知识解释 AI 管家架构。");
  } finally {
    if (previousPolicy === undefined) {
      delete process.env.AI_PROVIDER_POLICY;
    } else {
      process.env.AI_PROVIDER_POLICY = previousPolicy;
    }
  }

  console.log(JSON.stringify({
    success: true,
    provider: deterministicToolTest.provider,
    fallbackMock: deterministicToolTest.provider !== "deepseek" && status.provider === "deepseek",
    mode: deterministicToolTest.mode,
    deterministicToolTest,
    projectQaProviderTest,
    forceProviderTest,
  }, null, 2));
}

run().catch((error) => {
  console.error(JSON.stringify({
    success: false,
    code: error.code || "VERIFY_AI_PROVIDER_FAILED",
    message: error.message,
  }, null, 2));
  process.exit(1);
});
