const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");

const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "fosu-ai-auto-policy-tool-local-"));

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
process.env.AI_PROVIDER_ENVIRONMENTS = JSON.stringify({
  public: { environment: "public", enabled: false, provider: "mock", providerPolicy: "tool-only" },
  trial: { environment: "trial", enabled: true, provider: "deepseek", providerPolicy: "auto" },
  dev: { environment: "dev", enabled: true, provider: "deepseek", providerPolicy: "auto" },
});

let responseProviderCalls = 0;
const structuredPurposes = [];
const deepseekProvider = require("../server/src/services/ai/providers/deepseekProvider");
deepseekProvider.generate = async (input) => {
  responseProviderCalls += 1;
  return {
    provider: "deepseek",
    answer: `Provider answer for ${input.intent && input.intent.name}`,
    cards: [],
    suggestions: [],
  };
};
deepseekProvider.generateStructured = async (input) => {
  structuredPurposes.push(input.purpose || "structured");
  if (input.purpose === "planning") {
    const error = new Error("force deterministic planner for this policy test");
    error.code = "INVALID_PROVIDER_JSON";
    throw error;
  }
  const isRecommendation = /连续\s*2\s*节自习/.test(String(input.message || ""));
  return {
    provider: "deepseek",
    content: JSON.stringify({
      goal: isRecommendation ? "recommend_meeting_time" : "project_qa",
      entityType: "none",
      entity: "",
      normalizedEntity: "",
      constraints: isRecommendation ? { durationSections: 2 } : {},
      followUpMode: "new_goal",
      confidence: 0.99,
      needsClarification: false,
    }),
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
  assert.deepStrictEqual(structuredPurposes, ["understanding", "planning"], "recommendation must understand first, then use the constrained planner boundary");
  assert.strictEqual(responseProviderCalls, 0, "factual recommendation must not use DeepSeek as its response fact source");
  assert.strictEqual(recommendation.safety.externalProviderUsed, false);
  assert.strictEqual(recommendation.safety.desiredProvider, "deepseek");
  assert.strictEqual(recommendation.safety.resolvedProvider, "mock");
  assert(recommendation.toolCalls.length >= 2, "recommendation should still have multiple deterministic tool calls");
  assert.strictEqual(recommendation.metrics.externalProviderUsed, false);

  const qa = await agentService.chat({
    message: "如何使用校园查询？",
    context: { timezone: "Asia/Shanghai", envVersion: "develop" },
    runtimeMode: "competition",
    serverSession: { openidHash: "unit-test-openid" },
  });
  assert.deepStrictEqual(structuredPurposes, ["understanding", "planning", "understanding", "planning"], "each message must run model Understanding before planning");
  assert.strictEqual(responseProviderCalls, 1, "project QA should use DeepSeek for expression in auto policy");
  assert.strictEqual(qa.safety.externalProviderUsed, true);
  assert.strictEqual(qa.safety.resolvedProvider, "deepseek");
  assert.strictEqual(qa.answer, "Provider answer for project_qa");

  console.log("test-ai-auto-policy-tool-local passed");
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
}).finally(() => {
  fs.rmSync(tempRoot, { recursive: true, force: true });
});
