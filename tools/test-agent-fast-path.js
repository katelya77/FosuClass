/**
 * 快路径（低延迟）契约测试：
 * 1) 事实类意图本地高置信命中 → 跳过 understanding 模型调用（deterministic_rule_first），
 *    且规则命中理解同样跳过模型 planner → 事实链路全程零模型调用
 * 2) project_qa 显式命中 → 同样跳过 understanding；response 仍走外部 Provider
 * 3) 无模式命中的闲聊 → understanding 必须走模型；conversational_help 无工具 → 跳过模型 planner
 * 4) 个人记忆问句 → 理解前短路，全程零模型调用
 * 与 test-ai-auto-policy-tool-local.js 互补：那边显式关闭快路径验证模型链，这里验证默认快路径。
 */
const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");

const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "fosu-ai-fast-path-"));

process.env.AI_AGENT_ENABLED = "true";
process.env.AI_PROVIDER = "deepseek";
process.env.AI_PROVIDER_POLICY = "auto";
process.env.AI_PROVIDER_IGNORE_ENV_FILE = "true";
process.env.FOSU_AI_PROVIDER_CONFIG_PATH = path.join(tempRoot, "ai-provider-config.json");
process.env.FOSU_CONVERSATION_DATA_DIR = path.join(tempRoot, "conversations");
process.env.FOSU_USER_PREFERENCE_DATA_DIR = path.join(tempRoot, "user-preferences");
process.env.AI_API_KEY = "test-provider-key-not-real";
process.env.AI_RUNTIME_MODE = "trial";
process.env.AI_PROVIDER_ACTIVE_ENV = "trial";
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
    // 返回而非抛错：避免共享熔断器被 consecutive 失败打开，串扰后续用例的 response 链。
    return {
      provider: "deepseek",
      content: JSON.stringify({ steps: [{ toolName: "get_today_courses", args: {} }] }),
      latencyMs: 3,
    };
  }
  return {
    provider: "deepseek",
    content: JSON.stringify({
      goal: "conversational_help",
      entityType: "none",
      entity: "",
      normalizedEntity: "",
      constraints: {},
      followUpMode: "new_goal",
      confidence: 0.9,
      needsClarification: false,
    }),
    latencyMs: 3,
  };
};

const agentService = require("../server/src/services/ai/agentService");

function baseContext() {
  return {
    timezone: "Asia/Shanghai",
    envVersion: "trial",
    memoryMode: "local_only",
    termStartDate: "2026-03-09",
    totalWeeks: 20,
    currentTeachingWeek: 14,
    todayTeachingInfo: { weekNo: 14, weekday: 2, date: "2026-06-09", termStartDate: "2026-03-09" },
    currentScheduleSummary: { enabled: true, courses: [] },
  };
}

async function chat(message) {
  return agentService.chat({
    message,
    context: baseContext(),
    runtimeMode: "trial",
    protocolVersion: "agent.v2",
    serverSession: { openidHash: "fast-path-test-user" },
  });
}

function intentNameOf(response) {
  return typeof response.intent === "string" ? response.intent : response.intent && response.intent.name || "";
}

async function run() {
  // 1) 事实类意图：本地高置信 → 跳过 understanding 模型调用；规则命中理解同样跳过模型 planner，
  //    事实链路全程零模型调用（与 public 确定性规划对齐），只剩工具执行。
  const fact = await chat("今天有什么课");
  assert.strictEqual(intentNameOf(fact), "get_today_courses", "fact intent resolved locally");
  assert.strictEqual(fact.understanding.source, "deterministic_rule_first", "fact understanding skipped model");
  assert.strictEqual(fact.providerStages.understanding.attempted, false, "no understanding model call for fact");
  assert.deepStrictEqual(structuredPurposes, [], "rule-first fact path pays zero structured model calls (understanding + planner both skipped)");
  assert.strictEqual(responseProviderCalls, 0, "fact response stays deterministic");

  // 2) project_qa 显式命中：understanding 跳过；response 走外部 Provider。
  structuredPurposes.length = 0;
  const qa = await chat("你能做什么");
  assert.strictEqual(intentNameOf(qa), "project_qa");
  assert.strictEqual(qa.understanding.source, "deterministic_rule_first", "project_qa understanding skipped model");
  assert.strictEqual(qa.providerStages.understanding.attempted, false);
  assert.strictEqual(responseProviderCalls, 1, "project_qa response uses external provider");
  assert.strictEqual(qa.answer, "Provider answer for project_qa");

  // 3) 无模式命中的闲聊：understanding 必须走模型；conversational_help 无工具 → 跳过模型 planner。
  structuredPurposes.length = 0;
  responseProviderCalls = 0;
  const chatty = await chat("我有点无聊，陪我聊聊");
  assert.strictEqual(intentNameOf(chatty), "conversational_help");
  assert.ok(structuredPurposes.includes("understanding"), "unmatched chat must keep model understanding");
  assert.ok(!structuredPurposes.includes("planning"), "no-tool conversational intent must skip model planner");
  assert.strictEqual(chatty.understanding.source, "model");
  assert.strictEqual(responseProviderCalls, 1, "conversational response uses external provider");

  // 4) 个人记忆问句：理解前短路，全程零模型调用。
  structuredPurposes.length = 0;
  responseProviderCalls = 0;
  const memory = await chat("我叫什么名字");
  assert.strictEqual(intentNameOf(memory), "conversation_memory");
  assert.deepStrictEqual(structuredPurposes, [], "personal memory turn must not call structured models");
  assert.strictEqual(responseProviderCalls, 0, "personal memory turn must not call response provider");

  console.log("test-agent-fast-path: PASS");
}

run().catch((error) => {
  console.error("test-agent-fast-path: FAIL");
  console.error(error);
  process.exit(1);
});
