const assert = require("assert");

process.env.AI_AGENT_ENABLED = "true";
process.env.AI_PROVIDER = "deepseek";
process.env.AI_PROVIDER_POLICY = "auto";
process.env.AI_PROVIDER_IGNORE_ENV_FILE = "true";
process.env.AI_API_KEY = "test-provider-key-not-real";

const deepseekProvider = require("../server/src/services/ai/providers/deepseekProvider");
deepseekProvider.generate = async (input) => {
  assert.strictEqual(input.intent.name, "project_qa");
  assert(/FosuClass|XLS-only|Release Pack/.test(input.projectKnowledge), "project knowledge should be passed to DeepSeek");
  return {
    provider: "deepseek",
    answer: "DeepSeek 已基于项目知识说明 FosuClass：课程事实走工具，项目解释走模型。",
    cards: [],
    suggestions: ["怎么同步新学期课表"],
  };
};

const agentService = require("../server/src/services/ai/agentService");

async function run() {
  assert.strictEqual(
    agentService.shouldUseExternalProvider({ name: "project_qa" }, [], "auto"),
    true,
    "project_qa should use external provider in auto policy"
  );

  const response = await agentService.chat({
    message: "FosuClass 是什么？小佛你了解当前项目吗",
    context: { timezone: "Asia/Shanghai" },
  });
  assert.strictEqual(response.safety.externalProviderUsed, true);
  assert.strictEqual(response.safety.desiredProvider, "deepseek");
  assert.strictEqual(response.safety.resolvedProvider, "deepseek");
  assert.strictEqual(response.metrics.externalProviderUsed, true);

  process.env.AI_PROVIDER = "mock";
  const fallback = await agentService.chat({
    message: "你是谁",
    context: { timezone: "Asia/Shanghai" },
  });
  assert.strictEqual(fallback.safety.externalProviderUsed, false);
  assert.strictEqual(fallback.safety.resolvedProvider, "mock");
  const text = JSON.stringify(fallback);
  assert(!text.includes(process.env.AI_API_KEY), "answer must not contain provider key");
  assert(/FosuClass|佛课小表|XLS-only|XLS/.test(text), "mock fallback should include local project knowledge");

  console.log("test-ai-project-qa-provider passed");
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
