const assert = require("assert");

process.env.AI_AGENT_ENABLED = "true";
process.env.AI_PROVIDER = "deepseek";
process.env.AI_PROVIDER_POLICY = "always";
process.env.AI_PROVIDER_IGNORE_ENV_FILE = "true";
process.env.AI_API_KEY = "test-provider-key-not-real";
process.env.AI_RUNTIME_MODE = "competition";
process.env.AI_COMPETITION_ALLOW_ALL_SESSIONS = "true";
process.env.AI_PROVIDER_CHAIN = "deepseek,mock";
process.env.NODE_ENV = "development";

const deepseekProvider = require("../server/src/services/ai/providers/deepseekProvider");
deepseekProvider.generate = async () => ({
  provider: "deepseek",
  answer: "每周一至周五第1-2节都可以，今天第1-2节有999间空教室。",
  cards: [{
    type: "reminder",
    title: "伪造推荐卡",
    items: [{ title: "今天第1-2节", subtitle: "伪造", value: "999间" }],
    actions: [{ label: "伪造按钮", type: "navigate", url: "/pages/school/school" }],
  }],
  suggestions: ["伪造建议"],
});

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
  const response = await agentService.chat({
    message: "帮我推荐连续 2 节自习时间",
    context: buildContext(),
    runtimeMode: "competition",
    serverSession: { openidHash: "unit-test-openid" },
  });
  const text = JSON.stringify(response);
  assert.strictEqual(response.safety.externalProviderUsed, true, "always policy should call mocked provider");
  assert(!text.includes("伪造推荐卡"), "provider cards must not override deterministic cards");
  assert(!text.includes("伪造按钮"), "provider actions must not override deterministic actions");
  assert(!text.includes("999间"), "provider room facts must not override tool facts");
  assert.strictEqual(response.cards[0].title, "连续自习时间推荐");
  assert(response.cards[0].actions.some((action) => action.label === "查看最佳时段空教室"));
  assert(!response.answer.includes("每周一至周五"), "deterministic answer should not repeat provider over-generalization");
  assert(!response.answer.includes("今天第1-2节"), "deterministic answer should not repeat provider past time");

  console.log("test-ai-factual-card-authority passed");
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
