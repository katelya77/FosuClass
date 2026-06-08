const path = require("path");

require("../src/config");

const agentService = require("../src/services/ai/agentService");
const aiProviderConfigService = require("../src/services/ai/providerConfigService");

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

  const startedAt = Date.now();
  const response = await agentService.chat({
    message: "C7 附近现在有空教室吗？",
    context: {
      currentPage: "verify-ai-provider",
      timezone: "Asia/Shanghai",
      currentScheduleSummary: { enabled: false, targetType: "", targetName: "", courses: [] },
    },
  });

  console.log(JSON.stringify({
    success: true,
    provider: response.safety && response.safety.provider || "mock",
    fallbackMock: (response.safety && response.safety.provider) !== "deepseek" && status.provider === "deepseek",
    mode: response.safety && response.safety.mode || "tool-grounded",
    elapsedMs: Date.now() - startedAt,
    answerPreview: String(response.answer || "").slice(0, 100),
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
