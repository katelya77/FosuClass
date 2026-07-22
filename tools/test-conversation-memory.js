#!/usr/bin/env node
const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const crypto = require("crypto");

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "fosu-conversation-memory-"));
process.env.FOSU_DATA_DIR = tempDir;
process.env.FOSU_CONVERSATION_DATA_DIR = path.join(tempDir, "conversations");
process.env.FOSU_AGENT_MEMORY_SECRET = "test-memory-secret-phase2";
process.env.NODE_ENV = "test";

const { resolvePrincipal } = require("../server/src/services/ai/conversation/conversationPrincipalService");
const { FileConversationRepository } = require("../server/src/services/ai/conversation/fileConversationRepository");
const { ConversationMemoryService } = require("../server/src/services/ai/conversation/conversationMemoryService");
const { UserPreferenceService } = require("../server/src/services/ai/conversation/userPreferenceService");
const {
  migrateConversationState,
  normalizeContextSlots,
  publicMemoryStatus,
} = require("../server/src/services/ai/conversation/conversationSchema");

function session(openidHash, appid = "wx-test") {
  return { openidHash, sessionIdHash: crypto.randomBytes(8).toString("hex"), appid };
}

function run() {
  const repo = new FileConversationRepository({ dataDir: process.env.FOSU_CONVERSATION_DATA_DIR });
  const memory = new ConversationMemoryService({ repository: repo });
  const preferenceService = new UserPreferenceService({ dataDir: path.join(tempDir, "preferences") });

  // 1-2. Same openid, different sessions share principal
  const p1 = resolvePrincipal({ serverSession: session("abc123openidhash"), runtimeMode: "public" });
  const p2 = resolvePrincipal({ serverSession: session("abc123openidhash"), runtimeMode: "public" });
  assert.strictEqual(p1.authenticated, true);
  assert.strictEqual(p1.principalKey, p2.principalKey);
  assert.ok(!p1.principalKey.includes("abc123openidhash"));

  // 3. Different users isolated
  const other = resolvePrincipal({ serverSession: session("otheropenidhashxx"), runtimeMode: "public" });
  assert.notStrictEqual(p1.principalKey, other.principalKey);

  // 5-6. No session → local_only, no persist
  const anon = memory.loadForChat({ conversationId: "xf-1", message: "hello" });
  assert.strictEqual(anon.memory.mode, "local_only");
  assert.strictEqual(anon.memory.persisted, false);
  assert.strictEqual(anon.principal.authenticated, false);

  // Create and restore session_state
  const conversationId = "xf-memory-1";
  const created = repo.create(p1.principalKey, {
    conversationId,
    runtimeMode: "public",
    memoryMode: "session_state",
    title: "班级课表",
  });
  assert.strictEqual(created.revision, 0);

  const saved = memory.persistAfterSuccess({
    principal: p1,
    state: created,
    conversationId,
    memoryMode: "session_state",
    message: "25动物医学6班第16周周三课程",
    answer: "已查询到课程结果。",
    intentName: "search_school_index",
    context: { term: "2025-2026-2", releaseVersion: "rel-1" },
    contextSlots: {
      lastIntent: "search_school_index",
      lastTargetName: "25动物医学6班",
      lastWeek: 16,
      lastWeekday: 3,
      lastSource: "search_school_index",
    },
    runId: "run_1",
    status: "completed",
    stepCount: 2,
  });
  assert.strictEqual(saved.mode, "session_state");
  assert.strictEqual(saved.persisted, true);
  assert.strictEqual(saved.synced, false);

  // 1. Same user restores
  const loaded = memory.loadForChat({
    serverSession: session("abc123openidhash"),
    runtimeMode: "public",
    conversationId,
    message: "那周三呢",
    context: { term: "2025-2026-2", releaseVersion: "rel-1" },
  });
  assert.ok(loaded.state);
  assert.strictEqual(loaded.state.contextSlots.lastTargetName, "25动物医学6班");
  assert.strictEqual(loaded.memory.mode, "session_state");

  // 4. Guessing conversationId under other principal fails
  const stolen = repo.get(other.principalKey, conversationId);
  assert.strictEqual(stolen, null);

  // 7. session_state does not store full recent turns
  assert.deepStrictEqual(loaded.state.recentTurns, []);

  // 8. cloud_sync must be explicit
  const cloudDenied = memory.resolveMemoryMode({
    principal: p1,
    requestedMode: "cloud_sync",
    explicitCloudSync: false,
    allowCloudSyncRequest: false,
  });
  assert.notStrictEqual(cloudDenied, "cloud_sync");
  const cloudOk = memory.resolveMemoryMode({
    principal: p1,
    requestedMode: "cloud_sync",
    explicitCloudSync: true,
    allowCloudSyncRequest: true,
  });
  assert.strictEqual(cloudOk, "cloud_sync");

  // cloud_sync restores explicitly saved preferences and bounded recent turns.
  preferenceService.upsert({
    principal: p1,
    memoryMode: "cloud_sync",
    explicit: true,
    values: { preferredName: "王奕章" },
  });
  const cloudConversation = repo.create(p1.principalKey, {
    conversationId: "xf-cloud-name",
    runtimeMode: "public",
    memoryMode: "cloud_sync",
  });
  const memoryWithPreferences = new ConversationMemoryService({
    repository: repo,
    userPreferenceService: preferenceService,
  });
  memoryWithPreferences.persistAfterSuccess({
    principal: p1,
    state: cloudConversation,
    conversationId: "xf-cloud-name",
    memoryMode: "cloud_sync",
    cloudSyncEnabled: true,
    message: "记住我叫王奕章",
    answer: "已记住。",
    intentName: "update_user_preference",
    context: {},
  });
  const restoredCloud = memoryWithPreferences.loadForChat({
    serverSession: session("abc123openidhash"),
    runtimeMode: "public",
    conversationId: "xf-cloud-name",
    message: "我叫什么？",
    memoryMode: "cloud_sync",
    context: { memoryMode: "cloud_sync", cloudSyncEnabled: true, recentMessages: [] },
  });
  assert.strictEqual(restoredCloud.context.userPreferences.preferredName, "王奕章");
  assert.ok(restoredCloud.context.recentMessages.some((item) => item.content.includes("王奕章")));

  // 9-10. Sensitive / full schedule not stored
  const sensitiveSaved = memory.persistAfterSuccess({
    principal: p1,
    state: loaded.state,
    conversationId,
    memoryMode: "session_state",
    message: "password=secret123 token=abc",
    answer: "已拦截",
    intentName: "explain_personal_import",
    contextSlots: {
      lastIntent: "explain_personal_import",
      lastQueryResult: { summary: "no full schedule", count: 0, courses: ["should-not-exist"] },
    },
  });
  const afterSensitive = repo.get(p1.principalKey, conversationId);
  assert.ok(!JSON.stringify(afterSensitive).includes("secret123"));
  assert.ok(!JSON.stringify(afterSensitive).includes("should-not-exist"));
  assert.ok(sensitiveSaved.persisted);

  // 12. Revision conflict
  let conflict = false;
  try {
    repo.update(p1.principalKey, conversationId, { title: "冲突" }, { expectedRevision: 999 });
  } catch (error) {
    conflict = error.code === "CONVERSATION_REVISION_CONFLICT";
  }
  assert.strictEqual(conflict, true);

  // 13. Concurrent-ish sequential writes bump revision
  const r1 = repo.update(p1.principalKey, conversationId, { title: "A" });
  const r2 = repo.update(p1.principalKey, conversationId, { title: "B" }, { expectedRevision: r1.revision });
  assert.ok(r2.revision > r1.revision);

  // 14-15. Delete current / clear all
  const del = repo.delete(p1.principalKey, conversationId);
  assert.strictEqual(del.deleted, true);
  repo.create(p1.principalKey, { conversationId: "xf-a", runtimeMode: "public" });
  repo.create(p1.principalKey, { conversationId: "xf-b", runtimeMode: "public" });
  const cleared = repo.clearPrincipal(p1.principalKey);
  assert.ok(cleared.deleted >= 2);

  // 16. Schema migration
  const migrated = migrateConversationState({
    schemaVersion: "conversation-state.v1",
    clientConversationId: "xf-old",
    principalKey: p1.principalKey,
    contextSlots: { lastWeek: "3" },
  }, { conversationId: "xf-old", principalKey: p1.principalKey });
  assert.strictEqual(migrated.schemaVersion, "conversation-state.v2");
  assert.strictEqual(migrated.contextSlots.lastWeek, 3);

  // 17. Corrupt file does not crash
  const convId = "xf-corrupt";
  repo.create(p1.principalKey, { conversationId: convId, runtimeMode: "public" });
  const hash = crypto.createHash("sha256").update(convId).digest("hex").slice(0, 32);
  const filePath = path.join(process.env.FOSU_CONVERSATION_DATA_DIR, p1.principalKey.slice(0, 16), `${hash}.json`);
  fs.writeFileSync(filePath, "{not-json", "utf8");
  const recovered = repo.get(p1.principalKey, convId);
  assert.strictEqual(recovered, null);

  // 18. Release version filters evidence
  const refs = memory.constructor === ConversationMemoryService
    ? require("../server/src/services/ai/conversation/conversationMemoryService").filterEvidenceRefsForRelease([
      { sourceId: "a", releaseVersion: "rel-1", factCount: 1 },
      { sourceId: "b", releaseVersion: "rel-2", factCount: 2 },
    ], "rel-1")
    : [];
  assert.strictEqual(refs.length, 1);
  assert.strictEqual(refs[0].sourceId, "a");

  // 19-20. Follow-up inherits; new task clears pending
  const withPending = repo.create(p1.principalKey, { conversationId: "xf-pending", runtimeMode: "public" });
  repo.update(p1.principalKey, "xf-pending", {
    pendingClarification: {
      intentName: "search_school_index",
      type: "class",
      missing: "className",
      createdAt: Date.now(),
      expiresAt: Date.now() + 60000,
    },
    contextSlots: normalizeContextSlots({ lastTargetName: "旧班级", lastWeek: 10 }),
  }, { expectedRevision: withPending.revision });
  const follow = memory.loadForChat({
    serverSession: session("abc123openidhash"),
    runtimeMode: "public",
    conversationId: "xf-pending",
    message: "那周三呢",
    context: {},
  });
  assert.ok(follow.context.pendingClarification || follow.state.pendingClarification);
  const fresh = memory.loadForChat({
    serverSession: session("abc123openidhash"),
    runtimeMode: "public",
    conversationId: "xf-pending",
    message: "帮我查询仙溪校区空教室现在有哪些",
    context: { pendingClarification: follow.state.pendingClarification },
  });
  assert.ok(fresh.context.clearPendingClarification === true || fresh.context.pendingClarification == null);

  // publicMemoryStatus unauthenticated
  const mem = publicMemoryStatus(null, { authenticated: false });
  assert.strictEqual(mem.mode, "local_only");
  assert.strictEqual(mem.persisted, false);

  // 11. TTL prune
  const ttlId = "xf-ttl";
  const ttlState = repo.create(p1.principalKey, { conversationId: ttlId, runtimeMode: "public" });
  repo.update(p1.principalKey, ttlId, {
    expiresAt: new Date(Date.now() - 1000).toISOString(),
  }, { expectedRevision: ttlState.revision });
  const pruned = repo.pruneExpired(p1.principalKey);
  assert.ok(pruned.pruned >= 1);
  assert.strictEqual(repo.get(p1.principalKey, ttlId), null);

  console.log("test-conversation-memory passed");
}

try {
  run();
} finally {
  fs.rmSync(tempDir, { recursive: true, force: true });
}
