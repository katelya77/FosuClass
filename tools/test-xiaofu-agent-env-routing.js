#!/usr/bin/env node
/**
 * All online environments use the server Agent Kernel. Client rules are only
 * entered after an explicit, protocol-compatible fallback condition.
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
    const response = typeof responseFactory === "function" ? responseFactory(input) : responseFactory;
    return Object.assign({ protocolVersion: "agent.v2" }, response || {});
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
    answer: "这是正式版服务端确定性 Agent 的答案",
    metrics: { intentName: "project_qa" },
  });
  const releaseHello = await aiAssistantService.chat("你好", {
    envVersion: "release",
    timezone: "Asia/Shanghai",
  });
  assert.strictEqual(agentCallCount, 1, "release greeting must use the server Agent Kernel first");
  assert.match(releaseHello.answer || "", /服务端确定性 Agent/);
  assert.strictEqual(lastTransportInput.protocolVersion, "agent.v2");

  stubTransport({
    success: true,
    answer: "",
    cards: [],
    fallbackAllowed: true,
    fallbackReason: "SERVICE_UNAVAILABLE",
    metrics: { intentName: "conversational_help" },
  });
  const developFallback = await aiAssistantService.chat("随便问一句普通话", {
    envVersion: "develop",
    timezone: "Asia/Shanghai",
  });
  assert.strictEqual(agentCallCount, 1, "develop should try server agent first");
  assert.match(developFallback.answer || "", /普通话/, "explicit server fallback should use the local variant");
  assert.strictEqual(developFallback.fallbackLayer, "client");

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
    answer: "服务端返回结构化导入帮助",
    cards: [{ type: "import_guide", title: "个人课表导入", items: [], actions: [] }],
  });
  const trialImportHelp = await aiAssistantService.chat("怎么导入个人课表", {
    envVersion: "trial",
    timezone: "Asia/Shanghai",
  });
  assert.strictEqual(agentCallCount, 1, "structured import help should use the server Agent Kernel first");
  assert.ok(trialImportHelp.cards && trialImportHelp.cards[0], "server import help should preserve action-card protocol");

  const mockA = mockProvider.generate({
    intent: { name: "conversational_help" },
    toolResults: [],
    message: "你好呀",
    context: { assistantEnvironment: "public" },
  });
  assert.match(mockA.answer || "", /小佛|课表|空教室|你好|嗨|在/);
  assert.ok(!/CloudBase|DeepSeek|API\s*Key|Oracle/i.test(mockA.answer || ""), "public mock must not leak internals");

  const prompt = deepseekProvider.buildSystemPrompt("公开能力摘要", { useJsonMode: false, conversational: true });
  assert.match(prompt, /小序/);
  assert.match(prompt, /不要机械复读|换种说法/);
  assert.match(prompt, /不得|不要/);

  const knowledge = projectKnowledgeService.getProjectKnowledgePrompt("public", "你是谁");
  assert.match(knowledge, /小序/);
  assert.ok(!/密钥清单|内部服务器地址/.test(knowledge));

  restoreTransport();
  console.log("test-xiaofu-agent-env-routing passed");
}

run().catch((error) => {
  restoreTransport();
  console.error(error);
  process.exit(1);
});
