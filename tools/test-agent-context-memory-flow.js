#!/usr/bin/env node
const assert = require("assert");

const storage = new Map();
global.wx = {
  getStorageSync(key) {
    return storage.has(key) ? storage.get(key) : "";
  },
  setStorageSync(key, value) {
    storage.set(key, value);
  },
  removeStorageSync(key) {
    storage.delete(key);
  },
  getAccountInfoSync() {
    return { miniProgram: { envVersion: "release" } };
  },
};
global.getApp = () => ({
  globalData: {
    appConfig: { currentSemester: "2025-2026-2", availableTerms: [] },
    activeRelease: { term: "2025-2026-2", releaseVersion: "rel-memory-test", manifest: {} },
  },
});
global.getCurrentPages = () => [{ route: "packageXiaofu/pages/ai-assistant/ai-assistant" }];

const aiAssistantService = require("../miniprogram/services/aiAssistantService");
const conversationStore = require("../miniprogram/services/conversationStore");
const safetyGuard = require("../server/src/services/ai/safetyGuard");
const agentService = require("../server/src/services/ai/agentService");

async function run() {
  conversationStore.createConversation({ conversationId: "conv-memory-flow", title: "记忆测试" });
  aiAssistantService.saveUserPreferences({
    preferredName: "王奕章",
    campus: "仙溪校区",
    defaultReminderLeadMinutes: 25,
  });
  aiAssistantService.saveAiHistory([
    { id: "u1", role: "user", content: "我的名字叫王奕章" },
    { id: "a1", role: "assistant", content: "好的，这次对话里我记住了。" },
    { id: "u2", role: "user", content: "password=secret123" },
  ], "conv-memory-flow", {});

  const context = aiAssistantService.buildClientContext({
    conversationId: "conv-memory-flow",
    memoryMode: "session_state",
  });
  assert.strictEqual(context.memoryMode, "session_state");
  assert.strictEqual(context.userPreferences.preferredName, "王奕章");
  assert.strictEqual(context.userPreferences.defaultReminderLeadMinutes, 25);
  assert.ok(Array.isArray(context.recentMessages));
  assert.ok(context.recentMessages.some((item) => item.content.includes("王奕章")));
  assert.ok(!JSON.stringify(context.recentMessages).includes("secret123"));

  const sanitized = safetyGuard.sanitizeAgentContext({
    memoryMode: "cloud_sync",
    cloudSyncEnabled: true,
    conversationId: "conv-memory-flow",
    conversationSummary: "用户正在规划明天下午课程",
    recentMessages: [
      { role: "user", content: "我的名字叫王奕章" },
      { role: "user", content: "token=abcdef123456" },
    ],
    userPreferences: {
      preferredName: "王奕章",
      campus: "仙溪校区",
      defaultReminderLeadMinutes: 25,
    },
  });
  assert.strictEqual(sanitized.memoryMode, "cloud_sync");
  assert.strictEqual(sanitized.cloudSyncEnabled, true);
  assert.strictEqual(sanitized.conversationId, "conv-memory-flow");
  assert.ok(sanitized.conversationSummary.includes("明天下午"));
  assert.strictEqual(sanitized.userPreferences.preferredName, "王奕章");
  assert.ok(Array.isArray(sanitized.recentMessages));
  assert.ok(!JSON.stringify(sanitized.recentMessages).includes("abcdef123456"));

  const recalled = await agentService.chat({
    message: "我叫什么名字？",
    conversationId: "conv-memory-flow",
    protocolVersion: "agent.v2",
    runtimeMode: "public",
    context: {
      runtimeMode: "public",
      memoryMode: "session_state",
      recentMessages: [{ role: "user", content: "我的名字叫王奕章" }],
      userPreferences: {},
    },
  });
  assert.ok(recalled.answer.includes("王奕章"));
  assert.strictEqual(recalled.externalProviderUsed, false);
  assert.strictEqual(recalled.intent, "conversation_memory");

  // Auto memory: session_state saves low-risk name without requiring “记住”
  const remembered = await agentService.chat({
    message: "我的名字叫王奕章",
    conversationId: "conv-memory-flow-auto",
    protocolVersion: "agent.v2",
    runtimeMode: "public",
    context: { runtimeMode: "public", memoryMode: "session_state", recentMessages: [] },
  });
  assert.ok(
    (remembered.memoryPreferencePatch && remembered.memoryPreferencePatch.preferredName === "王奕章")
    || (remembered.workingMemory && remembered.workingMemory.preferredName === "王奕章")
    || String(remembered.answer || "").includes("王奕章")
  );
  assert.strictEqual(remembered.externalProviderUsed, false);

  console.log("test-agent-context-memory-flow: PASS");
}

run().catch((error) => {
  console.error(error && error.stack || error);
  process.exit(1);
});
