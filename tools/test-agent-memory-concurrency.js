#!/usr/bin/env node
/**
 * M1 — 单 Turn 单次原子记忆提交：并发与 revision 闭环测试。
 *
 * 覆盖 p3-acceptance.md M1 的 16 条既定用例：
 *  1. 单次权威 mutate（偏好/约束/Episode 一个锁一个 revision）
 *  2. 无 Promise.all 并发写同一用户记忆（静态源码约束）
 *  3. 首次携带本轮读取的 expectedRevision
 *  4. 无冲突一次成功
 *  5. 冲突 → 重读 → 以最新状态重算合并成功
 *  6. 重算不覆盖他设备新增
 *  7. 两次仍冲突 → 停止（无第三次、不无 revision 写入、不 LWW）
 *  8. fail-soft 不影响聊天主链
 *  9. memory.write_skipped 结构化事件字段完整
 * 10. Trace/事件不含记忆原文
 * 11. 真实双客户端同 revision 并发写不同偏好都保留
 * 12. 并发下“不是 A 是 B”只留 B
 * 13. Episode 不重复（provenanceRunId 幂等）
 * 14. TTL/scope/confidence/容量在重算后仍生效
 * 15. Schema/认证/存储错误准确分类，不伪装成 revision conflict、不盲目重试
 * 16. 写入后跨设备可读最新 revision
 *
 * 另含 Low#3 canonical 边界用例（权威边界优先、legacy 兼容映射、结构化冲突、
 * 学期/Release 变化后真实失效）。全部 fixture 为虚构数据。
 */
const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");

const root = fs.mkdtempSync(path.join(os.tmpdir(), "xiaofu-memory-concurrency-"));
const secret = "memory-concurrency-test-secret";
let now = Date.parse("2026-07-30T08:00:00.000Z");
const clock = { now: () => now };

const { UserPreferenceService } = require("../server/src/services/ai/conversation/userPreferenceService");
const {
  UserMemoryStore,
  listMemoryWriteEventsForTest,
  clearMemoryWriteEventsForTest,
} = require("../server/src/services/ai/memory/userMemory");
const { MemoryController } = require("../server/src/services/ai/memory/memoryController");

const DAY = 24 * 60 * 60 * 1000;
const createService = () => new UserPreferenceService({ dataDir: root, secret, clock });
const createStore = (service) => new UserMemoryStore({ preferenceService: service });
const principalOf = (name) => ({ authenticated: true, principalKey: `concurrency-${name}` });

function prefCandidate(key, value, extra = {}) {
  return {
    type: "preference",
    key,
    value,
    scope: extra.scope || "user",
    confidence: extra.confidence === undefined ? 0.95 : extra.confidence,
    reasonCode: extra.reasonCode || "user_correction",
    source: extra.source || "explicit_user",
    correction: extra.correction === true,
    termId: extra.termId || "",
    releaseVersion: extra.releaseVersion || "",
  };
}

function episodeOf(runId, goal = "find_empty_room") {
  return {
    goal,
    outcomeSummary: "verified deterministic outcome",
    reusableConstraints: { campus: "仙溪校区" },
    provenanceRunId: runId,
    status: "success",
  };
}

function snapshotRevision(service, principal) {
  return service.readRevision({ principal }).revision;
}

function main() {
  try {
    // 用例 2（静态约束）：写路径禁止 Promise.all 并发写同一用户记忆。
    ["../server/src/services/ai/memory/userMemory.js", "../server/src/services/ai/memory/memoryController.js"]
      .forEach((rel) => {
        const source = fs.readFileSync(path.resolve(__dirname, rel), "utf8");
        assert.ok(!source.includes("Promise.all"), `${rel} must not use Promise.all for memory writes`);
      });

    // 用例 4：无冲突一次成功；事件 write_succeeded attemptCount=1。
    clearMemoryWriteEventsForTest();
    {
      const service = createService();
      const store = createStore(service);
      const principal = principalOf("clean-write");
      const snapshotRev = snapshotRevision(service, principal);
      const result = store.commit({
        principal,
        memoryMode: "cloud_sync",
        candidates: [prefCandidate("campus", "仙溪校区")],
        expectedRevision: snapshotRev,
        runId: "run-clean",
        conversationId: "conv-clean",
        policyVersion: "memory-default-v1",
      });
      assert.strictEqual(result.persisted, true);
      assert.strictEqual(result.writeStatus, "succeeded");
      assert.strictEqual(result.attemptCount, 1);
      assert.strictEqual(result.retried, false);
      assert.strictEqual(result.revision, snapshotRev + 1);
      const events = listMemoryWriteEventsForTest();
      assert.strictEqual(events.length, 1);
      assert.strictEqual(events[0].event, "memory.write_succeeded");
      assert.strictEqual(events[0].attemptCount, 1);
      assert.deepStrictEqual(events[0].mutationCategories, ["preference"]);
    }

    // 用例 3：首次提交携带本轮读取的 expectedRevision（store 层与 controller 层）。
    {
      const calls = [];
      const fakeService = {
        applyMutationPlan(input) {
          calls.push(input);
          return {
            success: true,
            persisted: true,
            reason: "",
            items: [],
            results: [],
            episode: { persisted: false, reason: "not_successful_task" },
            revision: Number(input.expectedRevision) + 1,
          };
        },
        readRevision() {
          return { success: true, revision: 0, policyVersion: "v-fake" };
        },
      };
      const store = createStore(fakeService);
      store.commit({
        principal: principalOf("revision-pass"),
        memoryMode: "cloud_sync",
        candidates: [prefCandidate("campus", "仙溪校区")],
        expectedRevision: 7,
        runId: "run-rev",
      });
      assert.strictEqual(calls.length, 1);
      assert.strictEqual(calls[0].expectedRevision, 7, "first attempt must carry the turn-read revision");

      const controllerCommits = [];
      const controller = new MemoryController({
        conversationMemory: {
          persistAfterSuccess() {
            return { mode: "cloud_sync", persisted: true, synced: true, revision: 3 };
          },
        },
        userMemory: {
          commit(input) {
            controllerCommits.push(input);
            return { persisted: true, keys: ["preferredName"], items: [], revision: 8, writeStatus: "succeeded", attemptCount: 1 };
          },
        },
      });
      controller.commit({
        principal: principalOf("revision-controller"),
        memoryBundle: { memoryRevision: 7, memoryPolicy: { configVersion: "v-ctrl", paused: false, autoMemoryEnabled: true } },
        memoryMode: "cloud_sync",
        message: "请记住叫我并发同学",
        answer: "好的",
        intentName: "update_user_preference",
        status: "completed",
        runId: "run-ctrl-rev",
        preferencePatch: { preferredName: "并发同学" },
        autoMemoryEnabled: true,
      });
      assert.strictEqual(controllerCommits.length, 1);
      assert.strictEqual(controllerCommits[0].expectedRevision, 7, "controller must forward memoryBundle.memoryRevision");
      assert.strictEqual(controllerCommits[0].policyVersion, "v-ctrl");
    }

    // 用例 5 + 6：冲突 → 重读 → 重算成功；不覆盖他设备新增。
    clearMemoryWriteEventsForTest();
    {
      const serviceA = createService();
      const serviceB = createService();
      const storeA = createStore(serviceA);
      const storeB = createStore(serviceB);
      const principal = principalOf("retry-merge");
      const baseRevision = snapshotRevision(serviceA, principal);
      const writeA = storeA.commit({
        principal,
        memoryMode: "cloud_sync",
        candidates: [prefCandidate("preferredBuilding", "C7")],
        expectedRevision: baseRevision,
        runId: "run-a",
      });
      assert.strictEqual(writeA.persisted, true);
      assert.strictEqual(writeA.attemptCount, 1);
      const writeB = storeB.commit({
        principal,
        memoryMode: "cloud_sync",
        candidates: [prefCandidate("answerDetailLevel", "detailed")],
        expectedRevision: baseRevision,
        runId: "run-b",
        conversationId: "conv-b",
      });
      assert.strictEqual(writeB.persisted, true, "retry must recompute against the latest state and succeed");
      assert.strictEqual(writeB.attemptCount, 2);
      assert.strictEqual(writeB.retried, true);
      assert.strictEqual(writeB.revision, writeA.revision + 1);
      const values = serviceA.getObject({ principal });
      assert.strictEqual(values.preferredBuilding, "C7", "device A write must survive device B retry");
      assert.strictEqual(values.answerDetailLevel, "detailed");
      const events = listMemoryWriteEventsForTest().map((entry) => entry.event);
      assert.ok(events.includes("memory.write_retried"), "retry must emit memory.write_retried");
      assert.strictEqual(events.filter((event) => event === "memory.write_succeeded").length, 2);
      const retried = listMemoryWriteEventsForTest().find((entry) => entry.event === "memory.write_retried");
      assert.strictEqual(retried.oldRevision, baseRevision);
      assert.strictEqual(retried.latestRevision, writeA.revision, "retry baseline must be the latest revision");
    }

    // 用例 11：真实双客户端（双 service 实例）同 revision 并发写不同偏好，最终都保留。
    {
      const serviceA = createService();
      const serviceB = createService();
      const storeA = createStore(serviceA);
      const storeB = createStore(serviceB);
      const principal = principalOf("dual-client");
      const revA = serviceA.prepareTurnSnapshot({ principal }).revision;
      const revB = serviceB.prepareTurnSnapshot({ principal }).revision;
      assert.strictEqual(revA, revB, "both clients read the same base revision");
      const writeA = storeA.commit({
        principal,
        memoryMode: "cloud_sync",
        candidates: [prefCandidate("preferredName", "星河同学")],
        expectedRevision: revA,
        runId: "run-dual-a",
      });
      const writeB = storeB.commit({
        principal,
        memoryMode: "cloud_sync",
        candidates: [prefCandidate("campus", "江湾校区")],
        expectedRevision: revB,
        runId: "run-dual-b",
      });
      assert.strictEqual(writeA.persisted, true);
      assert.strictEqual(writeB.persisted, true);
      const values = createService().getObject({ principal });
      assert.strictEqual(values.preferredName, "星河同学");
      assert.strictEqual(values.campus, "江湾校区", "concurrent different preferences must both be preserved");
      assert.strictEqual(snapshotRevision(createService(), principal), 2);
    }

    // 用例 12：并发下“不是 A，是 B”只留 B（冲突重算重跑 supersede）。
    {
      const serviceA = createService();
      const serviceB = createService();
      const storeA = createStore(serviceA);
      const storeB = createStore(serviceB);
      const principal = principalOf("correction-race");
      const baseRevision = snapshotRevision(serviceA, principal);
      const writeA = storeA.commit({
        principal,
        memoryMode: "cloud_sync",
        candidates: [prefCandidate("campus", "仙溪校区", { reasonCode: "campus_preference", correction: false })],
        expectedRevision: baseRevision,
        runId: "run-race-a",
      });
      assert.strictEqual(writeA.persisted, true);
      const writeB = storeB.commit({
        principal,
        memoryMode: "cloud_sync",
        candidates: [prefCandidate("campus", "江湾校区", { correction: true, confidence: 0.98 })],
        expectedRevision: baseRevision,
        runId: "run-race-b",
      });
      assert.strictEqual(writeB.persisted, true);
      assert.strictEqual(writeB.attemptCount, 2);
      const active = serviceA.listMemoryItems({ principal }).items;
      assert.strictEqual(active.length, 1, "only the corrected fact may stay active");
      assert.strictEqual(active[0].normalizedValue, "江湾校区");
      const historical = serviceA.listMemoryItems({ principal, includeInactive: true, pageSize: 10 }).items;
      assert.strictEqual(
        historical.find((item) => item.normalizedValue === "仙溪校区").status,
        "superseded",
        "loser of the race must be superseded, not last-writer-wins resurrected"
      );
    }

    // 用例 13：并发提交同一 Turn 的 Episode 不重复。
    {
      const serviceA = createService();
      const serviceB = createService();
      const storeA = createStore(serviceA);
      const storeB = createStore(serviceB);
      const principal = principalOf("episode-race");
      const baseRevision = snapshotRevision(serviceA, principal);
      const episode = episodeOf("run-episode-shared");
      const writeA = storeA.commit({
        principal,
        memoryMode: "cloud_sync",
        candidates: [],
        episode,
        verified: true,
        expectedRevision: baseRevision,
        runId: "run-episode-shared",
      });
      const writeB = storeB.commit({
        principal,
        memoryMode: "cloud_sync",
        candidates: [],
        episode,
        verified: true,
        expectedRevision: baseRevision,
        runId: "run-episode-shared",
      });
      assert.strictEqual(writeA.episode.persisted, true);
      assert.strictEqual(writeB.attemptCount, 2, "conflict forces a recompute on the latest document");
      assert.strictEqual(writeB.episode.persisted, false);
      assert.strictEqual(writeB.episode.reason, "EPISODE_DEDUPLICATED");
      assert.strictEqual(serviceA.listEpisodes({ principal }).total, 1, "same-turn episode must be idempotent");
    }

    // 用例 7 + 9 + 10：两次仍冲突 → fail-soft 跳过；结构化事件完整且不含原文。
    clearMemoryWriteEventsForTest();
    {
      let applyCalls = 0;
      let observedRevision = 40;
      const alwaysConflict = {
        applyMutationPlan() {
          applyCalls += 1;
          const error = new Error("Memory revision conflict");
          error.code = "MEMORY_REVISION_CONFLICT";
          error.statusCode = 409;
          throw error;
        },
        readRevision() {
          observedRevision += 1;
          return { success: true, revision: observedRevision, policyVersion: "v-conflict" };
        },
      };
      const store = createStore(alwaysConflict);
      const result = store.commit({
        principal: principalOf("conflict-exhausted"),
        memoryMode: "cloud_sync",
        candidates: [prefCandidate("preferredName", "冲突同学")],
        episode: episodeOf("run-conflict"),
        verified: true,
        expectedRevision: 40,
        runId: "run-exhausted",
        conversationId: "conv-exhausted",
        policyVersion: "v-conflict",
      });
      assert.strictEqual(applyCalls, 2, "at most one retry — no third attempt");
      assert.strictEqual(result.persisted, false);
      assert.strictEqual(result.writeStatus, "skipped");
      assert.strictEqual(result.reason, "revision_conflict_exhausted");
      assert.strictEqual(result.attemptCount, 2);
      const events = listMemoryWriteEventsForTest();
      const skipped = events.find((entry) => entry.event === "memory.write_skipped");
      assert.ok(skipped, "memory.write_skipped event must be produced");
      assert.strictEqual(skipped.reason, "revision_conflict_exhausted");
      assert.strictEqual(skipped.attemptCount, 2);
      assert.strictEqual(skipped.oldRevision, 40);
      assert.strictEqual(skipped.latestRevision, 41);
      assert.deepStrictEqual(skipped.mutationCategories, ["preference", "episode"]);
      assert.strictEqual(skipped.runId, "run-exhausted");
      assert.ok(skipped.conversationIdHash && skipped.conversationIdHash !== "conv-exhausted", "conversationId must be hashed");
      assert.strictEqual(skipped.policyVersion, "v-conflict");
      assert.ok(Number.isFinite(Date.parse(skipped.at)));
      assert.ok(events.some((entry) => entry.event === "memory.write_retried"));
      const blob = JSON.stringify(events);
      assert.ok(!blob.includes("冲突同学"), "trace/events must not contain memory content");
      assert.ok(!blob.includes("preferredName"), "trace/events must not contain memory keys");
      assert.ok(!blob.includes("find_empty_room"), "trace/events must not contain episode content");
    }

    // 用例 8：fail-soft 不影响聊天主链（controller 不抛错、会话 persist 照常、不报 409）。
    {
      const alwaysConflict = {
        applyMutationPlan() {
          const error = new Error("Memory revision conflict");
          error.code = "MEMORY_REVISION_CONFLICT";
          error.statusCode = 409;
          throw error;
        },
        readRevision() {
          return { success: true, revision: 99, policyVersion: "v-main" };
        },
      };
      let conversationPersisted = 0;
      const controller = new MemoryController({
        conversationMemory: {
          persistAfterSuccess() {
            conversationPersisted += 1;
            return { mode: "cloud_sync", persisted: true, synced: true, revision: 5 };
          },
        },
        userMemory: createStore(alwaysConflict),
      });
      const committed = controller.commit({
        principal: principalOf("main-chain"),
        memoryBundle: { memoryRevision: 3, memoryPolicy: { configVersion: "v-main", paused: false, autoMemoryEnabled: true } },
        memoryMode: "cloud_sync",
        message: "以后叫我主链同学",
        answer: "好的，已记住。",
        intentName: "update_user_preference",
        status: "completed",
        runId: "run-main-chain",
        conversationId: "conv-main-chain",
        preferencePatch: { preferredName: "主链同学" },
        autoMemoryEnabled: true,
      });
      assert.strictEqual(conversationPersisted, 1, "conversation persist must still run");
      assert.strictEqual(committed.memory.persisted, true, "chat turn must not fail on memory skip");
      assert.strictEqual(committed.userCommit.writeStatus, "skipped");
      assert.strictEqual(committed.userCommit.persisted, false);
      assert.strictEqual(committed.memoryWrite.status, "skipped");
      assert.deepStrictEqual(committed.autoMemoryHints, [], "skipped write must not claim 已记住/已同步");
    }

    // 用例 1 + 16：单次权威 mutate（偏好+Episode 同 revision）；写入后跨设备可读最新 revision。
    clearMemoryWriteEventsForTest();
    {
      const service = createService();
      let mutateCalls = 0;
      const originalMutate = service.mutate;
      service.mutate = function counted(...args) {
        mutateCalls += 1;
        return originalMutate.apply(this, args);
      };
      const store = createStore(service);
      let conversationPersisted = 0;
      const controller = new MemoryController({
        conversationMemory: {
          persistAfterSuccess() {
            conversationPersisted += 1;
            return { mode: "cloud_sync", persisted: true, synced: true, revision: 1 };
          },
        },
        userMemory: store,
      });
      const principal = principalOf("atomic-turn");
      const committed = controller.commit({
        principal,
        memoryBundle: { memoryRevision: 0, memoryPolicy: { configVersion: "v-atomic", paused: false, autoMemoryEnabled: true } },
        memoryMode: "cloud_sync",
        message: "查我的课表",
        answer: "已查到权威课表",
        intentName: "schedule_lookup",
        status: "completed",
        verified: true,
        runId: "run-atomic",
        conversationId: "conv-atomic",
        preferencePatch: { preferredName: "原子同学" },
        toolCalls: [{ name: "getClassSchedule", result: { ok: true } }],
        autoMemoryEnabled: true,
        context: { term: "2025-2026-2", releaseVersion: "rel-atomic" },
      });
      assert.strictEqual(mutateCalls, 1, "preference + episode must commit in one authoritative mutate");
      assert.strictEqual(conversationPersisted, 1);
      assert.strictEqual(committed.userCommit.persisted, true);
      assert.strictEqual(committed.userCommit.revision, 1, "one atomic revision bump for the whole turn");
      assert.strictEqual(committed.episodeCommit.persisted, true, "episode shares the same atomic commit");
      assert.ok(committed.autoMemoryHints.length >= 1);
      const crossDevice = createService().prepareTurnSnapshot({ principal });
      assert.strictEqual(crossDevice.revision, 1, "another device reads the latest revision");
      assert.strictEqual(crossDevice.values.preferredName, "原子同学");
      assert.strictEqual(service.listEpisodes({ principal }).total, 1);
      const succeeded = listMemoryWriteEventsForTest().find((entry) => entry.event === "memory.write_succeeded");
      assert.deepStrictEqual(succeeded.mutationCategories, ["preference", "episode"]);
    }

    // 用例 14：TTL/scope/confidence/容量在冲突重算后仍生效。
    {
      const serviceA = createService();
      const serviceB = createService();
      const storeA = createStore(serviceA);
      const storeB = createStore(serviceB);
      const principal = principalOf("recompute-policy");
      const baseRevision = snapshotRevision(serviceA, principal);
      // 设备 A 先写一条 explicit 高置信楼栋。
      const writeA = storeA.commit({
        principal,
        memoryMode: "cloud_sync",
        candidates: [prefCandidate("preferredBuilding", "B1", { confidence: 0.98 })],
        expectedRevision: baseRevision,
        runId: "run-recompute-a",
      });
      assert.strictEqual(writeA.persisted, true);
      // 另一个操作把容量收紧为 1（介于 B 读取与提交之间）。
      const tightened = serviceA.setMemoryPolicy({
        principal,
        expectedRevision: writeA.revision,
        patch: { capacity: 1 },
      });
      // 设备 B 从旧 revision 提交：低置信 implicit 楼栋（不得覆盖 explicit）+ explicit 称呼。
      const ttlBefore = now;
      now += 60 * 1000; // 冲突重试发生在一分钟之后
      const writeB = storeB.commit({
        principal,
        memoryMode: "cloud_sync",
        candidates: [
          prefCandidate("preferredBuilding", "D2", {
            confidence: 0.75,
            reasonCode: "building_preference",
            source: "deterministic",
          }),
          prefCandidate("preferredName", "重算同学", { confidence: 0.9 }),
        ],
        expectedRevision: baseRevision,
        runId: "run-recompute-b",
      });
      assert.strictEqual(writeB.attemptCount, 2, "stale revision must be recomputed on the latest state");
      assert.strictEqual(writeB.revision, tightened.revision + 1);
      const active = serviceA.listMemoryItems({ principal }).items;
      assert.strictEqual(active.length, 1, "capacity=1 must be re-enforced on the recomputed merge");
      assert.strictEqual(active[0].key, "preferredBuilding");
      assert.strictEqual(active[0].normalizedValue, "B1", "implicit lower-confidence candidate must not override explicit");
      const all = serviceA.listMemoryItems({ principal, includeInactive: true, pageSize: 20 }).items;
      const retriedName = all.find((item) => item.key === "preferredName");
      assert.ok(retriedName, "the name entry was merged (then capacity-evicted to inactive)");
      assert.strictEqual(
        Date.parse(retriedName.expiresAt),
        ttlBefore + 60 * 1000 + 90 * DAY,
        "policy-default TTL must be recomputed at the retried apply time, not the stale turn time"
      );
      now -= 60 * 1000;
    }

    // 用例 15：错误准确分类 —— 存储损坏/敏感校验/认证错误不伪装成 revision conflict，且不盲目重试。
    clearMemoryWriteEventsForTest();
    {
      const makeFailing = (code, statusCode) => ({
        calls: 0,
        applyMutationPlan() {
          this.calls += 1;
          const error = new Error(code);
          error.code = code;
          error.statusCode = statusCode;
          throw error;
        },
        readRevision() {
          return { success: true, revision: 0, policyVersion: "v-err" };
        },
      });
      const corrupt = makeFailing("MEMORY_DOCUMENT_CORRUPT", 500);
      const corruptResult = createStore(corrupt).commit({
        principal: principalOf("err-corrupt"),
        memoryMode: "cloud_sync",
        candidates: [prefCandidate("campus", "仙溪校区")],
        expectedRevision: 0,
        runId: "run-err-corrupt",
      });
      assert.strictEqual(corrupt.calls, 1, "storage errors must not be retried blindly");
      assert.strictEqual(corruptResult.writeStatus, "failed");
      assert.strictEqual(corruptResult.reason, "storage_corrupt");

      const sensitive = makeFailing("MEMORY_SENSITIVE_REJECTED", 400);
      const sensitiveResult = createStore(sensitive).commit({
        principal: principalOf("err-sensitive"),
        memoryMode: "cloud_sync",
        candidates: [prefCandidate("campus", "仙溪校区")],
        expectedRevision: 0,
        runId: "run-err-sensitive",
      });
      assert.strictEqual(sensitive.calls, 1);
      assert.strictEqual(sensitiveResult.writeStatus, "failed");
      assert.strictEqual(sensitiveResult.reason, "schema_validation");

      const auth = makeFailing("PRINCIPAL_REQUIRED", 401);
      const authResult = createStore(auth).commit({
        principal: principalOf("err-auth"),
        memoryMode: "cloud_sync",
        candidates: [prefCandidate("campus", "仙溪校区")],
        expectedRevision: 0,
        runId: "run-err-auth",
      });
      assert.strictEqual(auth.calls, 1);
      assert.strictEqual(authResult.writeStatus, "failed");
      assert.strictEqual(authResult.reason, "auth");

      // 冲突后无法重读可信基线：不无 revision 盲写，准确分类为基线不可用。
      const noBaseline = {
        calls: 0,
        applyMutationPlan() {
          this.calls += 1;
          const error = new Error("Memory revision conflict");
          error.code = "MEMORY_REVISION_CONFLICT";
          error.statusCode = 409;
          throw error;
        },
        readRevision() {
          throw new Error("storage unreadable");
        },
      };
      const noBaselineResult = createStore(noBaseline).commit({
        principal: principalOf("err-baseline"),
        memoryMode: "cloud_sync",
        candidates: [prefCandidate("campus", "仙溪校区")],
        expectedRevision: 0,
        runId: "run-err-baseline",
      });
      assert.strictEqual(noBaseline.calls, 1, "must not retry without a trustworthy revision baseline");
      assert.strictEqual(noBaselineResult.writeStatus, "failed");
      assert.strictEqual(noBaselineResult.reason, "revision_baseline_unavailable");

      const failures = listMemoryWriteEventsForTest().filter((entry) => entry.event === "memory.write_failed");
      assert.deepStrictEqual(
        failures.map((entry) => entry.reason).sort(),
        ["auth", "revision_baseline_unavailable", "schema_validation", "storage_corrupt"].sort(),
        "failure categories must be classified accurately"
      );
      assert.ok(!listMemoryWriteEventsForTest().some((entry) => entry.event === "memory.write_skipped"), "non-conflict errors must not be reported as conflict skip");
    }

    // Low#3：canonical 边界 —— 权威边界优先、legacy 兼容映射、结构化冲突、学期变化真实失效。
    {
      const service = createService();
      const store = createStore(service);
      const principal = principalOf("canonical-boundary");
      // 权威边界与 candidate legacy 字段冲突 → 权威胜出并记录结构化冲突。
      const conflicted = store.commit({
        principal,
        memoryMode: "cloud_sync",
        candidates: [prefCandidate("preferredClassName", "25边界3班", {
          scope: "release",
          termId: "2024-2025-legacy",
          releaseVersion: "rel-legacy",
        })],
        expectedRevision: 0,
        runId: "run-boundary",
        termId: "2025-2026-2",
        releaseVersion: "rel-new",
      });
      assert.strictEqual(conflicted.persisted, true);
      assert.deepStrictEqual(conflicted.boundaryConflicts.sort(), ["release_boundary_conflict", "term_boundary_conflict"].sort());
      const stored = service.listMemoryItems({ principal }).items[0];
      assert.strictEqual(stored.termId, "2025-2026-2", "authoritative boundary wins over legacy candidate fields");
      assert.strictEqual(stored.releaseVersion, "rel-new");
      assert.strictEqual(stored.scope, "release");

      // legacy 候选字段在权威边界缺失时确定性补位（兼容读取/迁移转换）。
      const legacyOnly = store.commit({
        principal,
        memoryMode: "cloud_sync",
        candidates: [prefCandidate("preferredBuilding", "C3", {
          scope: "term",
          termId: "2025-2026-2",
        })],
        expectedRevision: conflicted.revision,
        runId: "run-boundary-legacy",
      });
      assert.strictEqual(legacyOnly.persisted, true);
      assert.deepStrictEqual(legacyOnly.boundaryConflicts, []);
      const legacyStored = service.listMemoryItems({ principal }).items.find((item) => item.key === "preferredBuilding");
      assert.strictEqual(legacyStored.termId, "2025-2026-2", "legacy candidate boundary fills in when authoritative boundary absent");
      assert.strictEqual(legacyStored.scope, "term");

      // 学期/Release 变化后时效记忆真实失效：scope 边界不匹配即不进 Turn 快照。
      const otherTerm = service.prepareTurnSnapshot({ principal, termId: "2026-2027-1", releaseVersion: "rel-next" });
      assert.strictEqual(otherTerm.values.preferredClassName, undefined, "release-scoped memory must not project across terms");
      assert.strictEqual(otherTerm.values.preferredBuilding, undefined, "term-scoped memory must not project across terms");
      const invalidated = service.invalidateContext({
        principal,
        termId: "2026-2027-1",
        releaseVersion: "rel-next",
        expectedRevision: legacyOnly.revision,
      });
      assert.ok(invalidated.invalidatedIds.length >= 2, "term/release change must invalidate versioned memories");
      const afterInvalidation = service.listMemoryItems({ principal });
      assert.strictEqual(afterInvalidation.items.length, 0);
    }

    console.log("test-agent-memory-concurrency: PASS (16 M1 cases + Low#3 boundary)");
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

try {
  main();
} catch (error) {
  console.error("test-agent-memory-concurrency: FAIL");
  console.error(error && error.stack || error);
  process.exit(1);
}
