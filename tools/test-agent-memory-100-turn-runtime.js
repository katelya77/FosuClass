#!/usr/bin/env node
const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");

const { createContextAssembler } = require("../packages/agent-runtime");
const { FileConversationRepository } = require("../server/src/services/ai/conversation/fileConversationRepository");
const { ConversationMemoryService } = require("../server/src/services/ai/conversation/conversationMemoryService");
const { UserPreferenceService } = require("../server/src/services/ai/conversation/userPreferenceService");
const { UserMemoryStore } = require("../server/src/services/ai/memory/userMemory");
const { MemoryController } = require("../server/src/services/ai/memory/memoryController");

async function main() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "xiaofu-memory-runtime-100-"));
  const conversationDir = path.join(root, "conversations");
  const preferenceDir = path.join(root, "preferences");
  const secret = "unit-test-memory-runtime-100-secret";
  const conversationId = "runtime-100-turns";
  const releaseContext = { active: true, term: "2026-2027-1", releaseVersion: "rel-100" };
  const firstSession = { openidHash: "same-user-across-devices", sessionIdHash: "device-a", appid: "wx-test" };
  const secondSession = { openidHash: "same-user-across-devices", sessionIdHash: "device-b", appid: "wx-test" };

  function createController() {
    const repository = new FileConversationRepository({ dataDir: conversationDir });
    const preferenceService = new UserPreferenceService({ dataDir: preferenceDir, secret });
    return new MemoryController({
      conversationMemory: new ConversationMemoryService({ repository, userPreferenceService: preferenceService }),
      userMemory: new UserMemoryStore({ preferenceService }),
    });
  }

  try {
    let controller = createController();
    for (let turn = 1; turn <= 100; turn += 1) {
      const isFirst = turn === 1;
      const message = isFirst
        ? "\u8bf7\u8bb0\u4f4f\uff0c\u4ee5\u540e\u53eb\u6211\u661f\u6cb3\u540c\u5b66"
        : `routine turn ${turn}`;
      const loaded = controller.load({
        serverSession: firstSession,
        runtimeMode: "trial",
        conversationId,
        message,
        memoryMode: "cloud_sync",
        context: {
          memoryMode: "cloud_sync",
          cloudSyncEnabled: true,
          term: releaseContext.term,
          releaseVersion: releaseContext.releaseVersion,
        },
        releaseContext,
      });
      const committed = controller.commit({
        principal: loaded.principal,
        state: loaded.state,
        memoryBundle: loaded,
        conversationId,
        memoryMode: "cloud_sync",
        cloudSyncEnabled: true,
        message,
        answer: isFirst ? "\u597d\u7684\uff0c\u6211\u4f1a\u53eb\u4f60\u661f\u6cb3\u540c\u5b66\u3002" : `completed ${turn}`,
        intentName: isFirst ? "update_user_preference" : "conversational_help",
        context: { term: releaseContext.term, releaseVersion: releaseContext.releaseVersion },
        runId: `run-memory-${turn}`,
        status: "completed",
        stepCount: 0,
        verified: true,
        preferencePatch: isFirst ? { preferredName: "\u661f\u6cb3\u540c\u5b66" } : undefined,
        autoMemoryEnabled: true,
      });
      assert.strictEqual(committed.memory.mode, "cloud_sync");
    }

    // Simulate a process restart and another device/session for the same OpenID.
    controller = createController();
    const restored = controller.load({
      serverSession: secondSession,
      runtimeMode: "trial",
      conversationId,
      message: "\u6211\u4e4b\u524d\u8bf4\u8fc7\u4f60\u5e94\u8be5\u600e\u4e48\u79f0\u547c\u6211\uff1f",
      memoryMode: "cloud_sync",
      context: {
        memoryMode: "cloud_sync",
        cloudSyncEnabled: true,
        term: releaseContext.term,
        releaseVersion: releaseContext.releaseVersion,
      },
      releaseContext,
    });
    assert.strictEqual(restored.memoryMode, "cloud_sync");
    assert(restored.conversationState.recentMessages.length <= 12);
    assert(!JSON.stringify(restored.conversationState.recentMessages).includes("\u8bf7\u8bb0\u4f4f"));
    assert(restored.conversationState.conversationSummary.includes("\u661f\u6cb3\u540c\u5b66"));
    assert(restored.conversationState.userMemories.some((item) => (
      item.key === "preferredName" && item.normalizedValue === "\u661f\u6cb3\u540c\u5b66"
    )));

    const snapshot = await createContextAssembler().assemble({
      currentMessage: "\u6211\u4e4b\u524d\u8bf4\u8fc7\u4f60\u5e94\u8be5\u600e\u4e48\u79f0\u547c\u6211\uff1f",
      runtimeMode: "trial",
      recentMessages: restored.conversationState.recentMessages,
      rollingSummary: restored.conversationState.conversationSummary,
      workingState: restored.conversationState.workingMemory,
      memoryItems: restored.conversationState.userMemories,
      episodicMemories: restored.conversationState.episodicMemories,
      runtimeContext: { term: releaseContext.term, releaseVersion: releaseContext.releaseVersion },
    });
    assert(snapshot.views.decision.rollingSummary.includes("\u661f\u6cb3\u540c\u5b66"));
    assert(snapshot.views.decision.memories.some((item) => item.normalizedValue === "\u661f\u6cb3\u540c\u5b66"));
    assert(!JSON.stringify(snapshot).includes("currentScheduleSummary"));
    console.log("test-agent-memory-100-turn-runtime: PASS");
  } finally {
    const resolved = path.resolve(root);
    if (resolved.startsWith(path.resolve(os.tmpdir()))) fs.rmSync(resolved, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(error && error.stack || error);
  process.exit(1);
});
