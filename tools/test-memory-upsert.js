#!/usr/bin/env node
/**
 * Repro: local new conversation → enable session_state
 * Must NOT return Conversation not found.
 */
const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const crypto = require("crypto");

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "fosu-memory-upsert-"));
process.env.FOSU_DATA_DIR = tempDir;
process.env.FOSU_CONVERSATION_DATA_DIR = path.join(tempDir, "conversations");
process.env.FOSU_AGENT_MEMORY_SECRET = "test-memory-secret-final";
process.env.NODE_ENV = "test";

const { FileConversationRepository } = require("../server/src/services/ai/conversation/fileConversationRepository");
const { ConversationMemoryService } = require("../server/src/services/ai/conversation/conversationMemoryService");
const { resolvePrincipal } = require("../server/src/services/ai/conversation/conversationPrincipalService");

function session(openidHash) {
  return { openidHash, sessionIdHash: crypto.randomBytes(8).toString("hex"), appid: "wx-test" };
}

function run() {
  const repo = new FileConversationRepository({ dataDir: process.env.FOSU_CONVERSATION_DATA_DIR });
  const memory = new ConversationMemoryService({ repository: repo });
  const principal = resolvePrincipal({ serverSession: session("upsert-user-openid-hash"), runtimeMode: "public" });
  assert.strictEqual(principal.authenticated, true);

  const conversationId = `local-xf-${Date.now()}`;
  // Simulate: client has local conversationId never seen by server
  assert.strictEqual(repo.get(principal.principalKey, conversationId), null);

  const policy = memory.setMemoryPolicy({
    serverSession: session("upsert-user-openid-hash"),
    runtimeMode: "public",
    mode: "session_state",
    conversationId,
    title: "新对话",
  });
  assert.strictEqual(policy.success, true);
  assert.strictEqual(policy.created, true);
  assert.strictEqual(policy.upserted, true);
  assert.ok(policy.conversation);
  assert.strictEqual(policy.memory.mode, "session_state");
  assert.strictEqual(Number(policy.conversation.revision), 1);

  // Idempotent second call
  const again = memory.setMemoryPolicy({
    serverSession: session("upsert-user-openid-hash"),
    runtimeMode: "public",
    mode: "session_state",
    conversationId,
    title: "新对话",
  });
  assert.strictEqual(again.success, true);
  assert.strictEqual(again.created, false);
  assert.strictEqual(again.memory.mode, "session_state");

  // Cross-user isolation: other principal cannot see
  const other = resolvePrincipal({ serverSession: session("other-user-openid-hashxx"), runtimeMode: "public" });
  assert.strictEqual(repo.get(other.principalKey, conversationId), null);

  // cloud_sync first enable also upserts
  const cloudId = `local-cloud-${Date.now()}`;
  const cloud = memory.setMemoryPolicy({
    serverSession: session("upsert-user-openid-hash"),
    runtimeMode: "trial",
    mode: "cloud_sync",
    conversationId: cloudId,
    title: "同步对话",
  });
  assert.strictEqual(cloud.success, true);
  assert.strictEqual(cloud.created, true);
  assert.strictEqual(cloud.memory.mode, "cloud_sync");

  // Cancelled must not persist
  const loaded = memory.loadForChat({
    serverSession: session("upsert-user-openid-hash"),
    runtimeMode: "public",
    conversationId,
    memoryMode: "session_state",
    message: "hello",
    context: {},
  });
  const afterCancel = memory.persistAfterSuccess({
    principal,
    state: loaded.state,
    conversationId,
    memoryMode: "session_state",
    message: "cancel me",
    answer: "should not save",
    status: "cancelled",
    cancelled: true,
  });
  assert.notStrictEqual(afterCancel.summaryAvailable === true && afterCancel.persisted === true && afterCancel.mode === "broken", true);

  console.log("test-memory-upsert passed");
}

run();
