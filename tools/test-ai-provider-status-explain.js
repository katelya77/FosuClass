const assert = require("assert");

process.env.AI_AGENT_ENABLED = "true";
process.env.AI_PROVIDER = "deepseek";
process.env.AI_PROVIDER_POLICY = "auto";
process.env.AI_PROVIDER_IGNORE_ENV_FILE = "true";
process.env.AI_API_KEY = "test-provider-key-not-real";
process.env.AI_RUNTIME_MODE = "competition";
process.env.AI_COMPETITION_ALLOW_ALL_SESSIONS = "true";
process.env.AI_PROVIDER_CHAIN = "deepseek,mock";
process.env.NODE_ENV = "development";

const deepseekProvider = require("../server/src/services/ai/providers/deepseekProvider");
deepseekProvider.generate = async () => ({
  provider: "deepseek",
  answer: "DeepSeek 已参与项目问答。",
  cards: [],
  suggestions: [],
});

const agentService = require("../server/src/services/ai/agentService");
process.env.AI_AGENT_ENABLED = "true";
process.env.AI_PROVIDER = "deepseek";
process.env.AI_PROVIDER_POLICY = "auto";
process.env.AI_API_KEY = "test-provider-key-not-real";
process.env.AI_RUNTIME_MODE = "competition";
process.env.AI_COMPETITION_ALLOW_ALL_SESSIONS = "true";
process.env.AI_PROVIDER_CHAIN = "deepseek,mock";
process.env.NODE_ENV = "development";

async function run() {
  const response = await agentService.chat({
    message: "AI 管家架构是什么？",
    context: { timezone: "Asia/Shanghai", envVersion: "develop" },
    runtimeMode: "competition",
    serverSession: { openidHash: "unit-test-openid" },
  });
  assert(response.safety, "safety should exist");
  assert.strictEqual(response.safety.desiredProvider, "deepseek");
  assert.strictEqual(response.safety.resolvedProvider, "deepseek");
  assert.strictEqual(response.safety.providerPolicy, "auto");
  assert.strictEqual(typeof response.safety.providerDecisionReason, "string");
  assert(response.safety.providerDecisionReason.length > 0, "providerDecisionReason should explain decision");
  assert.strictEqual(response.safety.externalProviderUsed, true);

  console.log("test-ai-provider-status-explain passed");
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
