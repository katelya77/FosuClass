#!/usr/bin/env node
const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "fosu-personal-memory-"));
process.env.NODE_ENV = "test";
process.env.FOSU_DATA_DIR = tempDir;
process.env.FOSU_AGENT_MEMORY_SECRET = "test-personal-memory-secret";

const {
  UserPreferenceService,
} = require("../server/src/services/ai/conversation/userPreferenceService");
const {
  parsePersonalMemoryCommand,
  resolvePersonalMemoryTurn,
} = require("../server/src/services/ai/conversation/personalMemoryInterpreter");
const toolRegistry = require("../server/src/services/ai/toolRegistry");

const principal = {
  authenticated: true,
  principalKey: "principal_test_9f3d7c2a",
  runtimeMode: "public",
};

function run() {
  const preferences = new UserPreferenceService({
    dataDir: path.join(tempDir, "preferences"),
  });

  // local_only: name is session_fact (not durable). session_state/cloud_sync auto-persist without “记住”.
  const ordinary = parsePersonalMemoryCommand("我的名字叫王奕章", { memoryMode: "local_only" });
  assert.strictEqual(ordinary.kind, "session_fact");
  assert.strictEqual(ordinary.key, "preferredName");
  assert.strictEqual(ordinary.value, "王奕章");
  assert.strictEqual(ordinary.persist, false);

  const autoSession = parsePersonalMemoryCommand("我的名字叫王奕章", { memoryMode: "session_state" });
  assert.strictEqual(autoSession.key, "preferredName");
  assert.strictEqual(autoSession.persist, true);

  const sameConversation = resolvePersonalMemoryTurn({
    message: "我叫什么名字？",
    context: {
      recentMessages: [
        { role: "user", content: "我的名字叫王奕章" },
        { role: "assistant", content: "好的，这次对话里我记住了。" },
      ],
      userPreferences: {},
    },
    principal,
    memoryMode: "session_state",
    preferenceService: preferences,
  });
  assert.strictEqual(sameConversation.handled, true);
  assert.ok(sameConversation.answer.includes("王奕章"));
  assert.strictEqual(sameConversation.source, "recent_messages");

  // session_state now persists low-risk name without requiring the keyword “记住”.
  const explicitLocal = resolvePersonalMemoryTurn({
    message: "我的名字叫王奕章",
    context: { recentMessages: [], userPreferences: {} },
    principal,
    memoryMode: "session_state",
    preferenceService: preferences,
  });
  assert.strictEqual(explicitLocal.handled, true);
  assert.deepStrictEqual(explicitLocal.preferencePatch, { preferredName: "王奕章" });
  assert.strictEqual(explicitLocal.persisted, true);
  assert.strictEqual(preferences.list({ principal }).items[0].key, "preferredName");

  const explicitCloud = resolvePersonalMemoryTurn({
    message: "记住我叫李测试",
    context: { recentMessages: [], userPreferences: {} },
    principal,
    memoryMode: "cloud_sync",
    preferenceService: preferences,
  });
  assert.strictEqual(explicitCloud.persisted, true);
  assert.ok(preferences.list({ principal }).items.some((item) => item.key === "preferredName"));
  assert.strictEqual(preferences.getObject({ principal }).preferredName, "李测试");

  const crossConversation = resolvePersonalMemoryTurn({
    message: "我叫什么？",
    context: { recentMessages: [], userPreferences: {} },
    principal,
    memoryMode: "cloud_sync",
    preferenceService: preferences,
  });
  assert.strictEqual(crossConversation.handled, true);
  assert.ok(crossConversation.answer.includes("李测试") || crossConversation.answer.includes("王奕章"));
  assert.ok(["cloud_preference", "session_preference", "local_preference"].includes(crossConversation.source));

  const removed = preferences.remove({ principal, key: "preferredName" });
  assert.strictEqual(removed.deleted, true);
  const afterClear = resolvePersonalMemoryTurn({
    message: "我叫什么名字？",
    context: { recentMessages: [], userPreferences: {} },
    principal,
    memoryMode: "cloud_sync",
    preferenceService: preferences,
  });
  assert.strictEqual(afterClear.handled, true);
  assert.ok(afterClear.answer.includes("还不知道"));

  assert.strictEqual(parsePersonalMemoryCommand("记住我的密码是 123456"), null);
  assert.strictEqual(parsePersonalMemoryCommand("记住 Cookie=abc"), null);

  resolvePersonalMemoryTurn({
    message: "记住我常用仙溪校区，默认提前25分钟提醒",
    context: { recentMessages: [], userPreferences: {} },
    principal,
    memoryMode: "cloud_sync",
    preferenceService: preferences,
  });
  const stored = preferences.getObject({ principal });
  assert.strictEqual(stored.campus, "仙溪校区");
  assert.strictEqual(stored.defaultReminderLeadMinutes, 25);
  const cleared = preferences.clear({ principal });
  assert.ok(cleared.deleted >= 2);
  assert.deepStrictEqual(preferences.getObject({ principal }), {});

  const toolContext = {
    runtimeMode: "trial",
    memoryMode: "cloud_sync",
    serverSession: { openidHash: "personal-memory-tool-user", sessionIdHash: "session-a" },
  };
  const deniedToolWrite = toolRegistry.executeTool("update_user_preference", {
    preferredName: "王奕章",
    message: "我的名字叫王奕章",
  }, toolContext);
  assert.strictEqual(deniedToolWrite.code, "EXPLICIT_USER_COMMAND_REQUIRED");
  const explicitToolWrite = toolRegistry.executeTool("update_user_preference", {
    preferredName: "王奕章",
    message: "记住我叫王奕章",
  }, toolContext);
  assert.strictEqual(explicitToolWrite.success, true);
  assert.strictEqual(explicitToolWrite.writeExecuted, true);
  assert.deepStrictEqual(explicitToolWrite.updatedKeys, ["preferredName"]);

  console.log("test-agent-personal-memory: PASS");
}

try {
  run();
} finally {
  fs.rmSync(tempDir, { recursive: true, force: true });
}
