const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");

const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "fosu-ai-provider-status-explain-"));
const deepseekProfiles = JSON.stringify({
  public: { environment: "public", enabled: false, provider: "mock", providerPolicy: "tool-only" },
  trial: { environment: "trial", enabled: true, provider: "deepseek", providerPolicy: "auto" },
  dev: { environment: "dev", enabled: true, provider: "deepseek", providerPolicy: "auto" },
});

process.env.AI_AGENT_ENABLED = "true";
process.env.AI_PROVIDER = "deepseek";
process.env.AI_PROVIDER_POLICY = "auto";
process.env.AI_PROVIDER_IGNORE_ENV_FILE = "true";
process.env.FOSU_AI_PROVIDER_CONFIG_PATH = path.join(tempRoot, "ai-provider-config.json");
process.env.AI_API_KEY = "test-provider-key-not-real";
process.env.AI_RUNTIME_MODE = "competition";
process.env.AI_PROVIDER_ACTIVE_ENV = process.env.AI_PROVIDER_ACTIVE_ENV || "trial";
process.env.AI_COMPETITION_ALLOW_ALL_SESSIONS = "true";
process.env.AI_PROVIDER_CHAIN = "deepseek,mock";
process.env.NODE_ENV = "development";
process.env.AI_PROVIDER_ENVIRONMENTS = deepseekProfiles;

const deepseekProvider = require("../server/src/services/ai/providers/deepseekProvider");
deepseekProvider.generate = async () => ({
  provider: "deepseek",
  answer: "DeepSeek 已参与项目问答。",
  cards: [],
  suggestions: [],
});

const agentService = require("../server/src/services/ai/agentService");
const providerChainService = require("../server/src/services/ai/providerChainService");
process.env.AI_AGENT_ENABLED = "true";
process.env.AI_PROVIDER = "deepseek";
process.env.AI_PROVIDER_POLICY = "auto";
process.env.AI_PROVIDER_IGNORE_ENV_FILE = "true";
process.env.AI_API_KEY = "test-provider-key-not-real";
process.env.AI_RUNTIME_MODE = "competition";
process.env.AI_PROVIDER_ACTIVE_ENV = process.env.AI_PROVIDER_ACTIVE_ENV || "trial";
process.env.AI_COMPETITION_ALLOW_ALL_SESSIONS = "true";
process.env.AI_PROVIDER_CHAIN = "deepseek,mock";
process.env.NODE_ENV = "development";
process.env.AI_PROVIDER_ENVIRONMENTS = deepseekProfiles;

async function run() {
  providerChainService.resetForTest();
  const response = await agentService.chat({
    message: "校园服务管家架构是什么？",
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
}).finally(() => {
  fs.rmSync(tempRoot, { recursive: true, force: true });
});
