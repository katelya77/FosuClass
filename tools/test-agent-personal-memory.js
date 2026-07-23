#!/usr/bin/env node
/**
 * Personal memory semantics:
 * - local_only: session fact only, no server User Memory
 * - session_state: session/working only, no User Memory file
 * - cloud_sync: durable User Memory via MemoryController (sole write path)
 * Interpreter never dual-writes preferences.
 */
const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "fosu-personal-memory-"));
process.env.NODE_ENV = "test";
process.env.FOSU_DATA_DIR = tempDir;
process.env.FOSU_AGENT_MEMORY_SECRET = "test-personal-memory-secret";

const {
  defaultUserPreferenceService,
} = require("../server/src/services/ai/conversation/userPreferenceService");
const {
  parsePersonalMemoryCommand,
  resolvePersonalMemoryTurn,
} = require("../server/src/services/ai/conversation/personalMemoryInterpreter");
const { defaultMemoryController } = require("../server/src/services/ai/memory/memoryController");
const toolRegistry = require("../server/src/services/ai/toolRegistry");

const principal = {
  authenticated: true,
  principalKey: "principal_test_9f3d7c2a",
  runtimeMode: "public",
  openidHash: "openid_hash_personal_memory",
};

function commitPatch(turn, message, memoryMode) {
  return defaultMemoryController.commit({
    principal,
    memoryMode,
    message,
    answer: turn.answer,
    intentName: turn.intentName,
    preferencePatch: turn.preferencePatch || {},
    preferredName: (turn.preferencePatch && turn.preferencePatch.preferredName)
      || (turn.sessionFacts && turn.sessionFacts.preferredName)
      || "",
    memoryCandidates: turn.memoryCandidates || [],
    status: "completed",
  });
}

function run() {
  const preferences = defaultUserPreferenceService;

  // local_only: name is session_fact (not durable).
  const ordinary = parsePersonalMemoryCommand("我的名字叫王奕章", { memoryMode: "local_only" });
  assert.strictEqual(ordinary.kind, "session_fact");
  assert.strictEqual(ordinary.key, "preferredName");
  assert.strictEqual(ordinary.value, "王奕章");
  assert.strictEqual(ordinary.persist, false);

  // session_state: still session_fact — no User Memory cross-conversation
  const autoSession = parsePersonalMemoryCommand("我的名字叫王奕章", { memoryMode: "session_state" });
  assert.strictEqual(autoSession.key, "preferredName");
  assert.strictEqual(autoSession.persist, false);

  // cloud_sync: durable preference flag on parse
  const autoCloud = parsePersonalMemoryCommand("我的名字叫王奕章", { memoryMode: "cloud_sync" });
  assert.strictEqual(autoCloud.key, "preferredName");
  assert.strictEqual(autoCloud.persist, true);

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

  // session_state: interpreter does not write; sessionFacts carry name for working memory
  const sessionTurn = resolvePersonalMemoryTurn({
    message: "我的名字叫王奕章",
    context: { recentMessages: [], userPreferences: {} },
    principal,
    memoryMode: "session_state",
    preferenceService: preferences,
  });
  assert.strictEqual(sessionTurn.handled, true);
  assert.strictEqual(sessionTurn.persisted, false);
  assert.ok(sessionTurn.sessionFacts && sessionTurn.sessionFacts.preferredName === "王奕章");
  commitPatch(sessionTurn, "我的名字叫王奕章", "session_state");
  assert.deepStrictEqual(preferences.getObject({ principal }), {}, "session_state must not write User Memory");

  // cloud_sync: MemoryController is sole durable writer
  const explicitCloud = resolvePersonalMemoryTurn({
    message: "记住我叫李测试",
    context: { recentMessages: [], userPreferences: {} },
    principal,
    memoryMode: "cloud_sync",
    preferenceService: preferences,
  });
  assert.strictEqual(explicitCloud.persisted, false, "interpreter never dual-writes");
  assert.ok(explicitCloud.preferencePatch && explicitCloud.preferencePatch.preferredName === "李测试");
  const committed = commitPatch(explicitCloud, "记住我叫李测试", "cloud_sync");
  assert.ok(committed.userCommit && committed.userCommit.persisted === true);
  assert.strictEqual(preferences.getObject({ principal }).preferredName, "李测试");

  const crossConversation = resolvePersonalMemoryTurn({
    message: "我叫什么？",
    context: { recentMessages: [], userPreferences: {} },
    principal,
    memoryMode: "cloud_sync",
    preferenceService: preferences,
  });
  assert.strictEqual(crossConversation.handled, true);
  assert.ok(crossConversation.answer.includes("李测试"));
  assert.strictEqual(crossConversation.source, "cloud_preference");

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

  const campusTurn = resolvePersonalMemoryTurn({
    message: "记住我常用仙溪校区，默认提前25分钟提醒",
    context: { recentMessages: [], userPreferences: {} },
    principal,
    memoryMode: "cloud_sync",
    preferenceService: preferences,
  });
  commitPatch(campusTurn, "记住我常用仙溪校区，默认提前25分钟提醒", "cloud_sync");
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
