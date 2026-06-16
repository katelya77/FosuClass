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

let providerCalls = 0;
const deepseekProvider = require("../server/src/services/ai/providers/deepseekProvider");
deepseekProvider.generate = async (input) => {
  providerCalls += 1;
  return {
    provider: "deepseek",
    answer: `Provider answer for ${input.intent && input.intent.name}`,
    cards: [],
    suggestions: [],
  };
};

const agentService = require("../server/src/services/ai/agentService");

function buildContext() {
  return {
    timezone: "Asia/Shanghai",
    clientLocalTime: "2026-06-09T21:26:00+08:00",
    envVersion: "develop",
    termStartDate: "2026-03-09",
    totalWeeks: 20,
    currentTeachingWeek: 14,
    todayTeachingInfo: { weekNo: 14, weekday: 2, date: "2026-06-09", termStartDate: "2026-03-09" },
    currentScheduleSummary: {
      enabled: true,
      courses: [{ courseName: "测试课", weekday: 3, startSection: 1, endSection: 2, weeks: [14] }],
    },
  };
}

async function run() {
  const recommendation = await agentService.chat({
    message: "帮我推荐连续 2 节自习时间",
    context: buildContext(),
    runtimeMode: "competition",
    serverSession: { openidHash: "unit-test-openid" },
  });
  assert.strictEqual(providerCalls, 0, "recommendation must not call DeepSeek in auto policy");
  assert.strictEqual(recommendation.safety.externalProviderUsed, false);
  assert.strictEqual(recommendation.safety.desiredProvider, "deepseek");
  assert.strictEqual(recommendation.safety.resolvedProvider, "mock");
  assert(recommendation.toolCalls.length >= 2, "recommendation should still have multiple deterministic tool calls");
  assert.strictEqual(recommendation.metrics.externalProviderUsed, false);

  const qa = await agentService.chat({
    message: "这个小程序怎么用？",
    context: { timezone: "Asia/Shanghai", envVersion: "develop" },
    runtimeMode: "competition",
    serverSession: { openidHash: "unit-test-openid" },
  });
  assert.strictEqual(providerCalls, 1, "project QA should call DeepSeek in auto policy");
  assert.strictEqual(qa.safety.externalProviderUsed, true);
  assert.strictEqual(qa.safety.resolvedProvider, "deepseek");
  assert.strictEqual(qa.answer, "Provider answer for project_qa");

  console.log("test-ai-auto-policy-tool-local passed");
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
