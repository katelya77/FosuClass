#!/usr/bin/env node
const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { UserPreferenceService } = require("../server/src/services/ai/conversation/userPreferenceService");

function main() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "xiaofu-memory-v2-"));
  const principal = { authenticated: true, principalKey: "principal-memory-v2" };
  let now = Date.parse("2026-07-30T08:00:00.000Z");
  const service = new UserPreferenceService({
    dataDir: root,
    secret: "unit-test-memory-secret-v2",
    clock: { now: () => now },
  });
  try {
    const first = service.upsertMemory({
      principal,
      memoryMode: "cloud_sync",
      explicit: true,
      entry: {
        kind: "stable_preference",
        key: "campus",
        content: "我常用仙溪校区",
        normalizedValue: "仙溪校区",
        provenance: {
          type: "user_explicit",
          turnId: "turn-1",
          runId: "run-1",
        },
        confidence: 0.98,
        scope: "user",
        ttlMs: 90 * 86400000,
      },
    });
    assert.strictEqual(first.persisted, true);
    assert.ok(first.memory.memoryId.startsWith("mem_"));
    assert.strictEqual(first.memory.status, "active");
    assert.strictEqual(first.memory.provenance.turnId, "turn-1");
    assert.strictEqual(first.memory.confidence, 0.98);
    assert.ok(first.memory.expiresAt);
    assert.strictEqual(first.memory.scope, "user");
    assert.strictEqual(first.memory.revision, 1);

    const correction = service.upsertMemory({
      principal,
      memoryMode: "cloud_sync",
      explicit: true,
      expectedRevision: first.revision,
      entry: {
        kind: "stable_preference",
        key: "campus",
        content: "不是仙溪校区，是江湾校区",
        normalizedValue: "江湾校区",
        provenance: {
          type: "user_correction",
          turnId: "turn-2",
          runId: "run-2",
        },
        confidence: 1,
        scope: "user",
        correction: true,
      },
    });
    assert.strictEqual(correction.memory.supersedes, first.memory.memoryId);
    const all = service.listMemoryItems({ principal, includeInactive: true, pageSize: 20 });
    const old = all.items.find((item) => item.memoryId === first.memory.memoryId);
    assert.strictEqual(old.status, "superseded");
    assert.strictEqual(old.supersededBy, correction.memory.memoryId);
    assert.strictEqual(
      service.listMemoryItems({ principal }).items.some((item) => item.memoryId === old.memoryId),
      false,
    );

    const retrieved = service.retrieveMemories({
      principal,
      query: "我以后主要在哪个校区找空教室？",
      goal: "find_empty_room",
      limit: 5,
    });
    assert.strictEqual(retrieved.items[0].memoryId, correction.memory.memoryId);
    assert.ok(retrieved.items[0].score > 0);
    assert.ok(retrieved.items[0].scoreBreakdown.lexical >= 0);
    assert.ok(retrieved.items[0].scoreBreakdown.vector >= 0);
    assert.ok(!JSON.stringify(retrieved).includes("featureVector"));

    const schedule = service.upsertMemory({
      principal,
      memoryMode: "cloud_sync",
      explicit: true,
      expectedRevision: retrieved.revision,
      entry: {
        kind: "task_constraint",
        key: "preferredClassName",
        content: "当前目标班级是25动物医学6班",
        normalizedValue: "25动物医学6班",
        provenance: { type: "action_receipt", runId: "run-schedule" },
        confidence: 1,
        scope: "release",
        termId: "2025-2026-2",
        releaseVersion: "rel-1",
      },
    });
    const invalidated = service.invalidateContext({
      principal,
      expectedRevision: schedule.revision,
      termId: "2026-2027-1",
      releaseVersion: "rel-2",
    });
    assert.ok(invalidated.invalidatedIds.includes(schedule.memory.memoryId));
    assert.strictEqual(
      service.listMemoryItems({ principal, includeInactive: true, pageSize: 20 })
        .items.find((item) => item.memoryId === schedule.memory.memoryId).status,
      "expired_context",
    );
    assert.strictEqual(
      service.retrieveMemories({ principal, query: "我的课表班级", limit: 5 })
        .items.some((item) => item.memoryId === schedule.memory.memoryId),
      false,
    );

    const episode = service.appendEpisode({
      principal,
      memoryMode: "cloud_sync",
      expectedRevision: invalidated.revision,
      verified: true,
      episode: {
        goal: "find_empty_room",
        outcomeSummary: "在江湾校区找到连续两节空教室",
        reusableConstraints: { campus: "江湾校区", duration: 2 },
        provenanceRunId: "run-episode",
        status: "success",
      },
    });
    assert.strictEqual(episode.persisted, true);
    assert.ok(episode.episode.episodeId.startsWith("episode_"));
    const episodes = service.retrieveEpisodes({
      principal,
      query: "继续找两节空教室",
      goal: "find_empty_room",
      limit: 3,
    });
    assert.strictEqual(episodes.items[0].episodeId, episode.episode.episodeId);

    const paused = service.setMemoryPolicy({
      principal,
      expectedRevision: episode.revision,
      patch: { autoMemoryEnabled: false, paused: true, capacity: 30 },
    });
    assert.strictEqual(paused.policy.paused, true);
    const autoDenied = service.upsertMemory({
      principal,
      memoryMode: "cloud_sync",
      explicit: false,
      expectedRevision: paused.revision,
      entry: {
        kind: "interaction_preference",
        key: "answerDetailLevel",
        content: "回答详细",
        normalizedValue: "detailed",
        provenance: { type: "auto_extract", turnId: "turn-3" },
        confidence: 0.95,
        scope: "user",
      },
    });
    assert.strictEqual(autoDenied.persisted, false);
    assert.strictEqual(autoDenied.reason, "MEMORY_PAUSED");

    // Low#5：pause 只停自动抽取/implicit 写入；explicit 纠正、手动修改/删除/导出不受阻。
    const explicitWhilePaused = service.upsertMemory({
      principal,
      memoryMode: "cloud_sync",
      explicit: true,
      expectedRevision: paused.revision,
      entry: {
        kind: "stable_preference",
        key: "preferredBuilding",
        content: "手动指定常用楼栋C9",
        normalizedValue: "C9",
        provenance: { type: "user_edit", turnId: "turn-4" },
        confidence: 1,
        scope: "user",
      },
    });
    assert.strictEqual(explicitWhilePaused.persisted, true, "explicit edit must bypass the pause gate");
    const pausedManaged = service.patchMemory({
      principal,
      memoryId: explicitWhilePaused.memory.memoryId,
      expectedRevision: explicitWhilePaused.revision,
      patch: { content: "手动改成C10", normalizedValue: "C10" },
    });
    assert.strictEqual(pausedManaged.memory.normalizedValue, "C10", "manual patch must work while paused");
    const pausedExport = service.exportMemories({ principal });
    assert.ok(pausedExport.items.length >= 1, "export must work while paused");
    const pausedDelete = service.deleteMemory({
      principal,
      memoryId: explicitWhilePaused.memory.memoryId,
      expectedRevision: pausedManaged.revision,
    });
    assert.strictEqual(pausedDelete.deleted, true, "manual delete must work while paused");

    // Low#5：implicit 永不覆盖有效 explicit（即使置信度更高）。
    const highConfidenceImplicit = service.upsertMemory({
      principal,
      memoryMode: "cloud_sync",
      explicit: false,
      expectedRevision: pausedDelete.revision,
      entry: {
        kind: "stable_preference",
        key: "campus",
        content: "自动提取的校区",
        normalizedValue: "仙溪校区",
        provenance: { type: "auto_extract", turnId: "turn-5" },
        confidence: 0.99,
        scope: "user",
      },
    });
    assert.strictEqual(highConfidenceImplicit.persisted, false, "paused blocks implicit regardless of confidence");

    // Low#5（UserMemoryStore 编排层）：autoMemoryEnabled=false 时 explicit 仍持久化、implicit 被停。
    const { UserMemoryStore } = require("../server/src/services/ai/memory/userMemory");
    const pauseStoreOwner = { authenticated: true, principalKey: "principal-pause-store-owner" };
    const pauseStore = new UserMemoryStore({ preferenceService: service });
    const pausePolicy = service.setMemoryPolicy({
      principal: pauseStoreOwner,
      patch: { paused: true, autoMemoryEnabled: false },
    });
    const implicitDenied = pauseStore.commit({
      principal: pauseStoreOwner,
      memoryMode: "cloud_sync",
      autoMemoryEnabled: false,
      expectedRevision: pausePolicy.revision,
      runId: "run-pause-implicit",
      candidates: [{
        type: "location_pref",
        key: "campus",
        value: "仙溪校区",
        scope: "user",
        confidence: 0.9,
        reasonCode: "campus_preference",
        source: "deterministic",
      }],
    });
    assert.strictEqual(implicitDenied.persisted, false, "implicit candidate must stop while auto memory disabled");
    assert.strictEqual(service.getObject({ principal: pauseStoreOwner }).campus, undefined);
    const explicitAllowed = pauseStore.commit({
      principal: pauseStoreOwner,
      memoryMode: "cloud_sync",
      autoMemoryEnabled: false,
      expectedRevision: pausePolicy.revision,
      runId: "run-pause-explicit",
      candidates: [{
        type: "location_pref",
        key: "campus",
        value: "江湾校区",
        scope: "user",
        confidence: 0.98,
        reasonCode: "user_correction",
        source: "explicit_user",
        correction: true,
      }],
    });
    assert.strictEqual(explicitAllowed.persisted, true, "explicit candidate must persist while paused");
    assert.strictEqual(service.getObject({ principal: pauseStoreOwner }).campus, "江湾校区");
    // 恢复后验证优先级：implicit 永不覆盖有效 explicit（即使置信度更高）。
    const resumedPolicy = service.setMemoryPolicy({
      principal: pauseStoreOwner,
      expectedRevision: explicitAllowed.revision,
      patch: { paused: false, autoMemoryEnabled: true },
    });
    const implicitHigherConfidence = pauseStore.commit({
      principal: pauseStoreOwner,
      memoryMode: "cloud_sync",
      autoMemoryEnabled: true,
      expectedRevision: resumedPolicy.revision,
      runId: "run-pause-implicit-high",
      candidates: [{
        type: "location_pref",
        key: "campus",
        value: "仙溪校区",
        scope: "user",
        confidence: 0.99,
        reasonCode: "campus_preference",
        source: "deterministic",
      }],
    });
    assert.strictEqual(implicitHigherConfidence.persisted, false, "implicit must never override a live explicit");
    assert.strictEqual(implicitHigherConfidence.reason, "MEMORY_CONFLICT_LOWER_CONFIDENCE");
    assert.strictEqual(service.getObject({ principal: pauseStoreOwner }).campus, "江湾校区");

    const resumed = service.setMemoryPolicy({
      principal,
      expectedRevision: pausedDelete.revision,
      patch: { autoMemoryEnabled: true, paused: false },
    });
    const patched = service.patchMemory({
      principal,
      memoryId: correction.memory.memoryId,
      expectedRevision: resumed.revision,
      patch: { content: "我主要在江湾校区", normalizedValue: "江湾校区" },
    });
    assert.ok(patched.memory.content.includes("江湾"));
    const exported = service.exportMemories({ principal });
    assert.strictEqual(exported.schemaVersion, "user-memory.export.v1");
    assert.ok(exported.items.some((item) => item.memoryId === correction.memory.memoryId));
    assert.ok(!JSON.stringify(exported).includes("featureVector"));

    const deleted = service.deleteMemory({
      principal,
      memoryId: correction.memory.memoryId,
      expectedRevision: patched.revision,
    });
    assert.strictEqual(deleted.deleted, true);
    assert.strictEqual(
      service.listMemoryItems({ principal, includeInactive: true, pageSize: 50 })
        .items.some((item) => item.memoryId === correction.memory.memoryId),
      false,
    );

    assert.throws(() => service.upsertMemory({
      principal,
      memoryMode: "cloud_sync",
      explicit: true,
      entry: {
        kind: "schedule_snapshot",
        key: "schedule",
        content: "完整课表",
        normalizedValue: [{ course: "不应保存" }],
        provenance: { type: "tool_result" },
        confidence: 1,
        scope: "user",
      },
    }), (error) => error && error.code === "MEMORY_KIND_FORBIDDEN");
    assert.throws(() => service.setMemoryPolicy({
      principal,
      expectedRevision: 1,
      patch: { paused: false },
    }), (error) => error && error.code === "MEMORY_REVISION_CONFLICT");

    now += 100 * 86400000;
    assert.strictEqual(
      service.retrieveMemories({ principal, query: "校区", limit: 5 }).items.length,
      0,
      "expired memory must not be refreshed by reads",
    );
    console.log("test-agent-long-term-memory: PASS");
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

try {
  main();
} catch (error) {
  console.error("test-agent-long-term-memory: FAIL");
  console.error(error && error.stack || error);
  process.exit(1);
}
