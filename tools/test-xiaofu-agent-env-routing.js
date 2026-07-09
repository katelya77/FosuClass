#!/usr/bin/env node
/**
 * 体验版/开发版优先走服务端 AI；正式版走本地多变体 mock。
 */
const assert = require("assert");

const storage = {};

global.wx = {
  getStorageSync(key) {
    return Object.prototype.hasOwnProperty.call(storage, key) ? storage[key] : "";
  },
  setStorageSync(key, value) {
    storage[key] = value;
  },
  removeStorageSync(key) {
    delete storage[key];
  },
  getSystemInfoSync() {
    return { platform: "devtools" };
  },
  getAccountInfoSync() {
    return { miniProgram: { envVersion: "develop" } };
  },
  showLoading() {},
  hideLoading() {},
  showToast() {},
  showModal() {},
  request(options) {
    if (options && options.success) {
      options.success({ statusCode: 200, data: { success: true } });
    }
  },
};

global.getCurrentPages = () => [];
global.getApp = () => ({
  globalData: {
    activeRelease: { term: "test-term", releaseVersion: "test-release", manifest: {} },
    appConfig: { currentSemester: "test-term", availableTerms: [] },
  },
});

const aiTransportRouter = require("../miniprogram/services/aiTransportRouter");
const aiAssistantService = require("../miniprogram/services/aiAssistantService");
const xiaofuAgentRouter = require("../miniprogram/services/xiaofuAgentRouter");
const projectKnowledgeService = require("../server/src/services/ai/projectKnowledgeService");
const mockProvider = require("../server/src/services/ai/providers/mockProvider");
const deepseekProvider = require("../server/src/services/ai/providers/deepseekProvider");

const originalTransportChat = aiTransportRouter.chat;
let agentCallCount = 0;
let lastTransportInput = null;

function stubTransport(responseFactory) {
  agentCallCount = 0;
  lastTransportInput = null;
  aiTransportRouter.chat = async (input) => {
    agentCallCount += 1;
    lastTransportInput = input;
    return typeof responseFactory === "function" ? responseFactory(input) : responseFactory;
  };
}

function restoreTransport() {
  aiTransportRouter.chat = originalTransportChat;
}

async function run() {
  assert.strictEqual(aiAssistantService.isAiEnhancedClientEnv("trial"), true);
  assert.strictEqual(aiAssistantService.isAiEnhancedClientEnv("develop"), true);
  assert.strictEqual(aiAssistantService.isAiEnhancedClientEnv("devtools"), true);
  assert.strictEqual(aiAssistantService.isAiEnhancedClientEnv("release"), false);
  assert.strictEqual(xiaofuAgentRouter.isIdentityOrPersonaQuery("你是谁 介绍一下自己"), true);
  assert.strictEqual(xiaofuAgentRouter.routeMessage("你好").intent, "smalltalk");
  assert.strictEqual(xiaofuAgentRouter.routeMessage("你是谁 介绍一下自己").intent, "smalltalk");

  stubTransport({
    success: true,
    answer: "我是小佛，体验版智能体已接入。可以帮你查课表和空教室。",
    cards: [],
    suggestions: ["查今日课表"],
    metrics: { intentName: "project_qa", externalProviderUsed: true },
    safety: { externalProviderUsed: true, provider: "deepseek" },
  });
  const trialIdentity = await aiAssistantService.chat("你是谁 介绍一下自己", {
    envVersion: "trial",
    timezone: "Asia/Shanghai",
  });
  assert.strictEqual(agentCallCount, 1, "trial identity query should call server agent");
  assert.match(trialIdentity.answer || "", /小佛|体验版智能体|课表/);
  assert.strictEqual(lastTransportInput && lastTransportInput.context && lastTransportInput.context.envVersion, "trial");

  stubTransport({
    success: true,
    answer: "这是不该出现的正式版服务端答案",
    metrics: { intentName: "project_qa" },
  });
  const releaseHello = await aiAssistantService.chat("你好", {
    envVersion: "release",
    timezone: "Asia/Shanghai",
  });
  assert.strictEqual(agentCallCount, 0, "release greeting must stay on local mock rules");
  assert.match(releaseHello.answer || "", /小佛|课表|空教室|在|嗨|你好/);
  assert.strictEqual(releaseHello.metrics && releaseHello.metrics.intentName, "smalltalk");
  assert.strictEqual(releaseHello.safety && releaseHello.safety.externalProviderUsed, false);

  stubTransport({
    success: true,
    answer: "",
    cards: [],
    metrics: { intentName: "conversational_help" },
  });
  const developFallback = await aiAssistantService.chat("随便问一句普通话", {
    envVersion: "develop",
    timezone: "Asia/Shanghai",
  });
  assert.strictEqual(agentCallCount, 1, "develop should try server agent first");
  assert.match(developFallback.answer || "", /普通话/, "empty server answer should fall back to local variant");

  stubTransport({
    success: true,
    answer: "我是小佛，可以帮你查课表和空教室。",
    cards: [],
    metrics: { intentName: "project_qa", externalProviderUsed: true },
    safety: { externalProviderUsed: true },
  });
  const trialHelp = await aiAssistantService.chat("可以查询什么", {
    envVersion: "trial",
    timezone: "Asia/Shanghai",
  });
  assert.strictEqual(agentCallCount, 1, "trial general help should prefer server agent");
  assert.match(trialHelp.answer || "", /小佛|课表/);

  stubTransport({
    success: true,
    answer: "服务端不应处理结构化导入帮助",
  });
  const trialImportHelp = await aiAssistantService.chat("怎么导入个人课表", {
    envVersion: "trial",
    timezone: "Asia/Shanghai",
  });
  assert.strictEqual(agentCallCount, 0, "structured import help should stay local for action cards");
  assert.ok(trialImportHelp.cards && trialImportHelp.cards[0], "import help should keep local card");

  const mockA = mockProvider.generate({
    intent: { name: "conversational_help" },
    toolResults: [],
    message: "你好呀",
    context: { assistantEnvironment: "public" },
  });
  assert.match(mockA.answer || "", /小佛|课表|空教室|你好|嗨|在/);
  assert.ok(!/CloudBase|DeepSeek|API\s*Key|Oracle/i.test(mockA.answer || ""), "public mock must not leak internals");

  const prompt = deepseekProvider.buildSystemPrompt("公开能力摘要", { useJsonMode: false, conversational: true });
  assert.match(prompt, /小佛/);
  assert.match(prompt, /不要机械复读|换种说法/);
  assert.match(prompt, /不得|不要/);

  const knowledge = projectKnowledgeService.getProjectKnowledgePrompt("public", "你是谁");
  assert.match(knowledge, /小佛/);
  assert.ok(!/密钥清单|内部服务器地址/.test(knowledge));

  restoreTransport();
  console.log("test-xiaofu-agent-env-routing passed");
}

run().catch((error) => {
  restoreTransport();
  console.error(error);
  process.exit(1);
});
