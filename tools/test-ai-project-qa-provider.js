const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");

const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "fosu-ai-project-qa-provider-"));
const deepseekProfiles = JSON.stringify({
  public: { environment: "public", enabled: false, provider: "mock", providerPolicy: "tool-only" },
  trial: { environment: "trial", enabled: true, provider: "deepseek", providerPolicy: "auto" },
  dev: { environment: "dev", enabled: true, provider: "deepseek", providerPolicy: "auto" },
});
const mockProfiles = JSON.stringify({
  public: { environment: "public", enabled: false, provider: "mock", providerPolicy: "tool-only" },
  trial: { environment: "trial", enabled: false, provider: "mock", providerPolicy: "tool-only" },
  dev: { environment: "dev", enabled: false, provider: "mock", providerPolicy: "tool-only" },
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
deepseekProvider.generate = async (input) => {
  assert.strictEqual(input.intent.name, "project_qa");
  return {
    provider: "deepseek",
    answer: "DeepSeek project answer grounded in local project knowledge.",
    cards: [],
    suggestions: ["How does Release Pack publishing work?"],
  };
};

const agentService = require("../server/src/services/ai/agentService");
process.env.AI_AGENT_ENABLED = "true";
process.env.AI_PROVIDER = "deepseek";
process.env.AI_PROVIDER_POLICY = "auto";
process.env.AI_API_KEY = "test-provider-key-not-real";
process.env.AI_PROVIDER_CHAIN = "deepseek,mock";
process.env.AI_RUNTIME_MODE = "competition";
process.env.AI_PROVIDER_ACTIVE_ENV = process.env.AI_PROVIDER_ACTIVE_ENV || "trial";
process.env.AI_COMPETITION_ALLOW_ALL_SESSIONS = "true";
process.env.NODE_ENV = "development";
process.env.AI_PROVIDER_ENVIRONMENTS = deepseekProfiles;

async function run() {
  assert.strictEqual(
    agentService.shouldUseExternalProvider({ name: "project_qa" }, [], "auto", "competition"),
    true,
    "project_qa should use external provider in auto policy"
  );

  const response = await agentService.chat({
    message: "Please explain the Release Pack architecture for FosuClass.",
    context: { timezone: "Asia/Shanghai", envVersion: "develop" },
    runtimeMode: "competition",
    serverSession: { openidHash: "unit-test-openid" },
  });
  assert.strictEqual(response.safety.externalProviderUsed, true);
  assert.strictEqual(response.safety.desiredProvider, "deepseek");
  assert.strictEqual(response.safety.resolvedProvider, "deepseek");
  assert.strictEqual(response.metrics.externalProviderUsed, true);
  assert.strictEqual(response.answer, "DeepSeek project answer grounded in local project knowledge.");

  process.env.AI_PROVIDER = "mock";
  process.env.AI_PROVIDER_ENVIRONMENTS = mockProfiles;
  const fallback = await agentService.chat({
    message: "Please explain Release Pack.",
    context: { timezone: "Asia/Shanghai", envVersion: "develop" },
    runtimeMode: "competition",
    serverSession: { openidHash: "unit-test-openid" },
  });
  assert.strictEqual(fallback.safety.externalProviderUsed, false);
  assert.strictEqual(fallback.safety.resolvedProvider, "mock");
  const text = JSON.stringify(fallback);
  assert(!text.includes(process.env.AI_API_KEY), "answer must not contain provider key");
  assert(/佛课小表|课表查询|个人课表|空教室/.test(text), "mock fallback should include local project knowledge");

  console.log("test-ai-project-qa-provider passed");
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
}).finally(() => {
  fs.rmSync(tempRoot, { recursive: true, force: true });
});
