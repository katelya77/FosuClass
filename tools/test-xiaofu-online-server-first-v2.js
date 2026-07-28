#!/usr/bin/env node
const assert = require("assert");

const storage = {};
global.wx = {
  getStorageSync: (key) => Object.prototype.hasOwnProperty.call(storage, key) ? storage[key] : "",
  setStorageSync: (key, value) => { storage[key] = value; },
  removeStorageSync: (key) => { delete storage[key]; },
  getSystemInfoSync: () => ({ platform: "devtools" }),
  getAccountInfoSync: () => ({ miniProgram: { envVersion: "release" } }),
  showLoading() {}, hideLoading() {}, showToast() {}, showModal() {},
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
const contextManager = require("../miniprogram/services/xiaofuContextManager");

const originalChat = aiTransportRouter.chat;

async function run() {
  const calls = [];
  aiTransportRouter.chat = async (input) => {
    calls.push(input);
    return {
      protocolVersion: "agent.v2",
      requestId: "req-client-online",
      conversationId: input.conversationId,
      runId: "run-client-online",
      status: "completed",
      runtimeMode: "public",
      intent: "conversational_help",
      confidence: 0.9,
      slots: {},
      skill: { id: "knowledge_search", version: "1.0.0" },
      plan: [], steps: [], observations: [], toolCalls: [], cards: [], suggestions: [], errors: [],
      answer: "这是服务端统一 Agent Kernel 的回答。",
      evidence: { checkedAt: new Date().toISOString(), toolCount: 0 },
      safety: { externalProviderUsed: false },
      metrics: { externalProviderUsed: false },
      serverTime: new Date().toISOString(),
    };
  };

  const context = {
    envVersion: "release",
    conversation: { conversationId: "conversation-client-v2", contextSlots: {} },
    contextSlots: {},
  };
  for (const message of ["你好", "怎么导入个人课表", "课表数据最新吗", "仙溪校区天气", "C7 在哪里"]) {
    const response = await aiAssistantService.chat(message, context);
    assert.strictEqual(response.answer, "这是服务端统一 Agent Kernel 的回答。");
  }
  assert.strictEqual(calls.length, 5, "all semantic online requests use the server first");
  calls.forEach((call) => {
    assert.strictEqual(call.protocolVersion, "agent.v2");
    assert.strictEqual(call.conversationId, "conversation-client-v2");
    assert.strictEqual(call.runtimeMode, undefined, "client must not select server runtime mode");
    assert.strictEqual(call.history, undefined, "raw conversation history must not cross the Agent boundary");
  });

  aiTransportRouter.chat = async () => ({
    protocolVersion: "agent.v1",
    answer: "V1 compatibility response",
    intent: { name: "conversational_help", confidence: 0.8 },
    metrics: { intentName: "conversational_help", externalProviderUsed: false },
    safety: { externalProviderUsed: false },
  });
  const v1 = await aiAssistantService.chat("你好", context);
  assert.strictEqual(v1.answer, "V1 compatibility response", "V1 server responses remain accepted");
  assert.strictEqual(v1.fallback, undefined, "compatible V1 response must not enter client fallback");

  aiTransportRouter.chat = async () => ({
    protocolVersion: "agent.v2",
    status: "failed",
    answer: "",
    fallbackAllowed: true,
    fallbackReason: "SERVER_TEMPORARILY_UNAVAILABLE",
    errors: [{ code: "SERVER_TEMPORARILY_UNAVAILABLE" }],
  });
  const allowed = await aiAssistantService.chat("你好", context);
  assert.strictEqual(allowed.fallbackLayer, "client");
  assert.strictEqual(allowed.fallbackReason, "SERVER_TEMPORARILY_UNAVAILABLE");

  aiTransportRouter.chat = async () => {
    const error = new Error("network unavailable");
    error.code = "NETWORK_UNAVAILABLE";
    throw error;
  };
  const fallback = await aiAssistantService.chat("你好", context);
  assert.strictEqual(fallback.fallback, true);
  assert.strictEqual(fallback.fallbackLayer, "client");
  assert.strictEqual(fallback.externalProviderUsed, false);
  assert.strictEqual(fallback.safety.externalProviderUsed, false);
  assert.strictEqual(fallback.fallbackReason, "NETWORK_UNAVAILABLE");
  assert.strictEqual(fallback.metrics.canonicalIntent, "conversational_help");
  assert.strictEqual(fallback.status, "degraded", "offline envelope must be uniformly marked degraded");
  assert.ok(!fallback.runId, "offline greeting must not fabricate a runId");

  const cachedContext = Object.assign({}, context, {
    currentTeachingWeek: 2,
    todayWeekday: 1,
    currentScheduleSummary: {
      enabled: true,
      courseCount: 1,
      source: "xls-import",
      term: "test-term",
      courses: [{
        courseName: "高等数学",
        teacherName: "张老师",
        classroom: "A1-101",
        weekday: 1,
        startSection: 1,
        endSection: 2,
        weeks: [2],
      }],
    },
  });
  const cached = await aiAssistantService.chat("今天有什么课", cachedContext);
  assert.strictEqual(cached.fallbackLayer, "client");
  assert.strictEqual(cached.intent, "get_today_courses");
  assert.match(cached.answer, /本机缓存/);
  assert.match(JSON.stringify(cached.cards), /高等数学/);
  // 离线降级应答不得伪造核验语义：degraded 标注、无伪造 runId/steps、证据不标 verified/complete
  assert.strictEqual(cached.status, "degraded", "offline cached answer must be marked degraded");
  assert.ok(!cached.runId, "offline answer must not fabricate a runId");
  assert.deepStrictEqual(cached.steps, [], "offline answer must not fabricate run steps");
  assert.strictEqual(cached.evidence.verified, false, "offline cache must not claim verified evidence");
  assert.strictEqual(cached.evidence.complete, false, "offline cache must not claim complete evidence");
  assert.match(JSON.stringify(cached.cards), /离线降级/, "degraded disclosure badge must stay");

  // 提醒语义收回服务端：离线路径不得本地改写偏好，不得伪造提醒类工具结果
  storage[aiAssistantService.USER_PREFERENCES_KEY] = { defaultReminderLeadMinutes: 20 };
  const reminderOffline = await aiAssistantService.chat("默认提前45分钟提醒我", context);
  assert.strictEqual(reminderOffline.fallback, true, "reminder request offline stays a degraded fallback");
  assert.ok(
    !JSON.stringify(reminderOffline.toolCalls || []).includes("update_user_preference"),
    "offline path must not fabricate preference tool calls"
  );
  assert.strictEqual(
    (storage[aiAssistantService.USER_PREFERENCES_KEY] || {}).defaultReminderLeadMinutes,
    20,
    "offline path must not rewrite local reminder preferences"
  );
  delete storage[aiAssistantService.USER_PREFERENCES_KEY];

  aiTransportRouter.chat = async () => ({ protocolVersion: "agent.v9", answer: "bad protocol" });
  const incompatible = await aiAssistantService.chat("你好", context);
  assert.strictEqual(incompatible.fallback, true);
  assert.strictEqual(incompatible.fallbackReason, "PROTOCOL_INCOMPATIBLE");

  aiTransportRouter.chat = async () => {
    const error = new Error("bad client request");
    error.code = "HTTP_4XX";
    throw error;
  };
  await assert.rejects(
    () => aiAssistantService.chat("你好", context),
    (error) => error && error.code === "HTTP_4XX",
    "non-fallbackable client/server errors must not silently enter offline mode"
  );

  const updatedSlots = contextManager.updateFromResponse({}, {
    protocolVersion: "agent.v2",
    intent: "search_school_index",
    slots: { targetType: "teacher", targetName: "张三", week: 8, weekday: 3 },
    metrics: { resultCount: 2 },
    evidence: { sources: ["release-pack-index"] },
  });
  assert.strictEqual(updatedSlots.lastIntent, "search_school_index");
  assert.strictEqual(updatedSlots.lastTargetType, "teacher");
  assert.strictEqual(updatedSlots.lastTargetName, "张三");
  assert.strictEqual(updatedSlots.lastWeek, 8);
  assert.strictEqual(updatedSlots.lastWeekday, 3);

  let credentialNetworkCalls = 0;
  const credential = await originalChat({
    message: "password=super-secret-value",
    context,
    protocolVersion: "agent.v2",
    requestId: "req-sensitive",
    conversationId: "conversation-client-v2",
    redactSensitiveText: aiAssistantService.redactSensitiveText,
    oracleChat: async () => {
      credentialNetworkCalls += 1;
      throw new Error("must not be called");
    },
  });
  assert.strictEqual(credentialNetworkCalls, 0, "credential input must stop before the network boundary");
  assert.strictEqual(credential.fallbackReason, "SENSITIVE_CREDENTIAL_REDACTED");
  assert.strictEqual(credential.externalProviderUsed, false);

  console.log("test-xiaofu-online-server-first-v2 passed");
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
}).finally(() => {
  aiTransportRouter.chat = originalChat;
});
