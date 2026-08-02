#!/usr/bin/env node
"use strict";

const assert = require("assert");
const { extractFromMessage } = require("../server/src/services/ai/memory/memoryCandidateExtractor");
const {
  validateMemoryCandidate,
  validateMemoryCandidates,
  migrateInvalidStoredMemories,
} = require("../server/src/services/ai/memory/memorySemanticValidator");
const { MemoryController } = require("../server/src/services/ai/memory/memoryController");

function fakeController() {
  const commits = [];
  const controller = new MemoryController({
    conversationMemory: {
      persistAfterSuccess(input) {
        return { mode: input.memoryMode, persisted: input.memoryMode !== "local_only", revision: 1 };
      },
    },
    userMemory: {
      commit(input) {
        commits.push(input);
        const durable = (input.candidates || []).filter((candidate) => candidate.durable);
        return {
          persisted: durable.length > 0,
          keys: durable.map((candidate) => candidate.key),
          items: durable,
          writeStatus: "succeeded",
          revision: durable.length ? 1 : 0,
        };
      },
    },
  });
  return { controller, commits };
}

function commit(controller, patch) {
  return controller.commit(Object.assign({
    principal: { authenticated: true, principalKey: "semantic-validator-user" },
    conversationId: "semantic-validator-conversation",
    runId: "semantic-validator-run",
    state: { revision: 0, workingMemory: {}, recentTurns: [], contextSlots: {} },
    status: "completed",
    failed: false,
    verified: true,
    intentName: "update_user_preference",
    answer: "已处理",
    context: {},
    toolCalls: [],
  }, patch));
}

assert.strictEqual(extractFromMessage("你能记住什么？").filter((item) => item.key === "preferredName").length, 0);
assert.strictEqual(extractFromMessage("我叫什么？").filter((item) => item.key === "preferredName").length, 0);
assert.strictEqual(extractFromMessage("我是什么学院？").length, 0);
assert.strictEqual(extractFromMessage("默认提醒是什么？").length, 0);

["什么", "啥", "谁", "哪个", "怎么", "如何", "你", "我", "用户", "同学", "老师", "未知", "哦", "啊"].forEach((value) => {
  const result = validateMemoryCandidate({ key: "preferredName", value, scope: "user", confidence: 0.99 }, { message: "" });
  assert.strictEqual(result.accepted, false, `preferredName=${value} must be rejected`);
});

const validName = validateMemoryCandidate({
  key: "preferredName",
  value: "王奕章",
  scope: "user",
  confidence: 0.95,
  source: "explicit_user",
  reasonCode: "name_statement",
}, { message: "我叫王奕章" });
assert.strictEqual(validName.accepted, true);
assert.strictEqual(validName.candidate.value, "王奕章");
assert.ok(validName.candidate.sourceSummary);

const providerQuestion = validateMemoryCandidates([{
  key: "preferredName",
  value: "什么",
  scope: "user",
  confidence: 0.99,
  source: "provider_payload",
}], { message: "你能记住什么？" });
assert.strictEqual(providerQuestion.accepted.length, 0);
assert.strictEqual(providerQuestion.rejected.length, 1);

const lowConfidence = validateMemoryCandidate({
  key: "campus",
  value: "仙溪校区",
  scope: "user",
  confidence: 0.55,
  source: "provider_payload",
}, { message: "我可能常在仙溪校区" });
assert.strictEqual(lowConfidence.accepted, true);
assert.strictEqual(lowConfidence.candidate.scope, "working");
assert.strictEqual(lowConfidence.candidate.durable, false);
assert.strictEqual(lowConfidence.candidate.semanticDisposition, "working_only");

{
  const { controller, commits } = fakeController();
  const result = commit(controller, { memoryMode: "cloud_sync", message: "我叫王奕章" });
  assert.strictEqual(result.userCommit.persisted, true);
  assert.strictEqual(commits[0].candidates.find((candidate) => candidate.key === "preferredName").value, "王奕章");
  assert.strictEqual(result.workingMemory.preferredName, "王奕章");
}

{
  const { controller, commits } = fakeController();
  const result = commit(controller, { memoryMode: "local_only", message: "我叫王奕章" });
  assert.strictEqual(result.userCommit.persisted, false);
  assert.strictEqual(result.workingMemory.preferredName, "王奕章");
  assert.strictEqual(commits[0].candidates.some((candidate) => candidate.durable), false);
}

{
  const { controller, commits } = fakeController();
  const result = commit(controller, {
    memoryMode: "cloud_sync",
    message: "你能记住什么？",
    memoryCandidates: [{
      key: "preferredName", value: "什么", scope: "user", confidence: 0.99, source: "provider_payload",
    }],
    preferencePatch: { preferredName: "什么" },
  });
  assert.strictEqual(result.workingMemory.preferredName, "");
  assert.strictEqual(commits[0].candidates.some((candidate) => candidate.key === "preferredName"), false);
  assert.ok(result.memoryValidation.rejectedCount >= 1);
}

{
  const { controller } = fakeController();
  const result = commit(controller, {
    memoryMode: "cloud_sync",
    message: "不对，我叫奕章",
    state: { revision: 1, workingMemory: { preferredName: "王奕章" }, recentTurns: [], contextSlots: {} },
  });
  const corrected = result.candidates.find((candidate) => candidate.key === "preferredName");
  assert.strictEqual(corrected.value, "奕章");
  assert.strictEqual(corrected.correction, true);
  assert.strictEqual(result.workingMemory.preferredName, "奕章");
}

const document = {
  revision: 4,
  items: [
    { memoryId: "bad-name", key: "preferredName", normalizedValue: "什么", status: "active", revision: 4 },
    { memoryId: "good-campus", key: "campus", normalizedValue: "仙溪校区", status: "active", revision: 4 },
  ],
  audit: [],
};
const migrated = migrateInvalidStoredMemories(document, "2026-08-02T00:00:00.000Z");
assert.strictEqual(migrated.invalidatedCount, 1);
assert.strictEqual(document.items[0].status, "invalid_semantic");
assert.strictEqual(document.items[1].status, "active");
assert.strictEqual(document.audit[0].action, "invalidate_semantic");
assert.strictEqual(migrateInvalidStoredMemories(document, "2026-08-02T00:01:00.000Z").invalidatedCount, 0, "migration is idempotent");

console.log("test-agent-memory-semantic-validator passed");
