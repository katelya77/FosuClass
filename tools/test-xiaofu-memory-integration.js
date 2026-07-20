#!/usr/bin/env node
const assert = require("assert");
const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
const memoryClient = fs.readFileSync(path.join(root, "miniprogram/services/agentMemoryClient.js"), "utf8");
const assistant = fs.readFileSync(path.join(root, "miniprogram/pages/ai-assistant/ai-assistant.js"), "utf8");
const memorySheet = fs.readFileSync(path.join(root, "miniprogram/components/xiaofu-memory-sheet/index.wxml"), "utf8");
const memoryCss = fs.readFileSync(path.join(root, "miniprogram/components/xiaofu-memory-sheet/index.wxss"), "utf8");
const conversationSheet = fs.readFileSync(path.join(root, "miniprogram/components/xiaofu-conversation-sheet/index.wxml"), "utf8");
const transport = fs.readFileSync(path.join(root, "miniprogram/services/aiTransportRouter.js"), "utf8");
const aiRoutes = fs.readFileSync(path.join(root, "server/src/routes/ai.js"), "utf8");

function mustInclude(source, snippet, label) {
  assert.ok(source.includes(snippet), `${label} missing: ${snippet}`);
}

function mustNotInclude(source, snippet, label) {
  assert.ok(!source.includes(snippet), `${label} should not include: ${snippet}`);
}

function run() {
  mustInclude(memoryClient, "listCloudConversations", "memory client");
  mustInclude(memoryClient, "updateMemoryPolicy", "memory client");
  mustInclude(memoryClient, "clearCloudMemory", "memory client");
  mustInclude(memoryClient, "mergeLocalAndCloudConversations", "memory client");
  mustInclude(memoryClient, "/api/ai/agent/memory", "memory client");

  mustInclude(assistant, "agentMemoryClient", "assistant");
  mustInclude(assistant, "updateMemoryPolicy", "assistant");
  mustInclude(assistant, "clearCloudMemory", "assistant");
  mustInclude(assistant, "refreshConversationList", "assistant");
  mustInclude(assistant, "onClearLocalMemory", "assistant");
  mustNotInclude(assistant, "applyMemoryMode(mode);\n    wx.showToast", "assistant no local-only success without server for session");

  mustInclude(memorySheet, "memory-mode-check", "memory sheet");
  mustInclude(memorySheet, "清空本机消息", "memory sheet");
  mustInclude(memorySheet, "清除服务端会话状态", "memory sheet");
  mustInclude(memorySheet, "清除全部云端记忆", "memory sheet");
  mustInclude(memoryCss, "width: 100%", "memory css");
  mustInclude(memoryCss, "min-width: 0", "memory css");
  mustInclude(memoryCss, "flex-direction: row", "memory css");

  mustInclude(conversationSheet, "source-badge", "conversation sheet");
  mustInclude(conversationSheet, "conversation-more", "conversation sheet");
  mustNotInclude(conversationSheet, "本机与云端会话合并展示，不会重复条目", "false merge copy");

  mustInclude(transport, "callOracleViaRuns", "transport");
  mustInclude(transport, "正在理解你的问题", "transport");
  mustNotInclude(transport, 'text: "正在查询课表"', "transport hardcoded schedule loading");

  mustInclude(aiRoutes, "resolveMemoryRuntimeMode", "routes");
  mustInclude(aiRoutes, "/agent/readiness", "routes");
  mustInclude(aiRoutes, "/agent/runs", "routes");
  mustInclude(aiRoutes, "resolveRequestRuntimeDecision", "routes");

  // runtime merge unit via require
  const client = require("../miniprogram/services/agentMemoryClient.js");
  const merged = client.mergeLocalAndCloudConversations(
    [{ conversationId: "a", title: "本地", updatedAt: "2026-01-01T00:00:00.000Z", revision: 1, messageCount: 2, memoryMode: "local_only" }],
    [{ conversationId: "a", title: "云端", updatedAt: "2026-01-02T00:00:00.000Z", revision: 2, messageCount: 3, memoryMode: "cloud_sync" },
      { conversationId: "b", title: "仅云端", updatedAt: "2026-01-03T00:00:00.000Z", revision: 0, messageCount: 1, memoryMode: "session_state" }],
    "a"
  );
  assert.strictEqual(merged.length, 2);
  assert.strictEqual(merged.find((item) => item.conversationId === "a").title, "云端");
  assert.strictEqual(merged.find((item) => item.conversationId === "a").revision, 2);
  assert.ok(merged.find((item) => item.conversationId === "b"));

  console.log("test-xiaofu-memory-integration: PASS");
}

run();
