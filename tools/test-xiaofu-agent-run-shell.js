#!/usr/bin/env node
/**
 * P6b W2：miniprogram/services/agentRunShell 验收。
 *
 * 覆盖：生成器产物新鲜度（--check）/ startRun happy path（create→事件
 * 累计扇出→终态结果，回调与 create 请求体字段）/ 服务端至少一次全量重
 * 放下 eventId 零重复扇出 / 终态 result 落库竞态宽限 / shouldCancel 真实
 * 取消一次且清句柄 / cancelActiveRun 网络失败不伪造 cancelled / resume
 * 无句柄返回 null / 页面重开后凭 storage 游标续跑（不重建 Run、终态恢复、
 * 清句柄）/ resume 404 → RUN_GONE / 轮询错误容忍不重建 Run / 超时信封 /
 * 无 active run 时 cancelActiveRun → NO_ACTIVE_RUN。
 *
 * 全程假后端 + 注入瞬时 sleep/时钟，无真实网络。
 */
"use strict";

const assert = require("assert");
const { execFileSync } = require("child_process");
const path = require("path");
const mockEnv = require("./mock-env"); // 必须先加载 wx stub

mockEnv.clearStorage();

const {
  ACTIVE_RUN_STORAGE_KEY,
  createAgentRunShell,
  shell,
} = require("../miniprogram/services/agentRunShell");

const checks = [];
function check(name, fn) {
  try {
    fn();
    checks.push(`PASS ${name}`);
  } catch (error) {
    console.error(`FAIL ${name}: ${error && error.message}`);
    process.exitCode = 1;
  }
}
async function checkAsync(name, fn) {
  try {
    await fn();
    checks.push(`PASS ${name}`);
  } catch (error) {
    console.error(`FAIL ${name}: ${error && error.message}`);
    process.exitCode = 1;
  }
}

const E1 = { type: "understanding.started", sequence: 1, eventId: "evt-1", label: "理解问题" };
const E2 = { type: "tool.started", sequence: 2, eventId: "evt-2", label: "查询课表" };
const E3 = { type: "run.completed", sequence: 3, eventId: "evt-3", label: "完成" };

/** 可编程假后端：SDK 级 request({method, path, body, query}) → {status, json}。 */
function createBackend(routes = {}) {
  const calls = [];
  async function request(req) {
    calls.push(req);
    if (req.method === "POST" && req.path === "/api/ai/agent/runs") {
      if (routes.createRun) return routes.createRun(req);
      return {
        status: 202,
        json: {
          runId: "run_1",
          pollToken: "pt_1",
          status: "queued",
          eventCursor: 0,
          nextPollMs: 100,
          protocolVersion: "agent.v2",
          capabilities: { cursorResume: true },
          diagnostics: {},
        },
      };
    }
    const runMatch = String(req.path).match(/^\/api\/ai\/agent\/runs\/([^/]+)$/);
    if (req.method === "GET" && runMatch) {
      if (routes.getRun) return routes.getRun(req, decodeURIComponent(runMatch[1]));
      return { status: 200, json: { success: true, events: [], status: "running", eventCursor: 0, nextPollMs: 100 } };
    }
    const cancelMatch = String(req.path).match(/^\/api\/ai\/agent\/runs\/([^/]+)\/cancel$/);
    if (req.method === "POST" && cancelMatch) {
      if (routes.cancel) return routes.cancel(req, decodeURIComponent(cancelMatch[1]));
      return { status: 200, json: { success: true, status: "cancelled", alreadyFinished: false } };
    }
    return { status: 404, json: { code: "RUN_NOT_FOUND" } };
  }
  return { request, calls };
}

function countCreates(backend) {
  return backend.calls.filter((call) => call.method === "POST" && call.path === "/api/ai/agent/runs").length;
}

function countGets(backend) {
  return backend.calls.filter((call) => call.method === "GET").length;
}

function countCancels(backend) {
  return backend.calls.filter((call) => call.method === "POST" && /\/cancel$/.test(call.path)).length;
}

function createMapStorage() {
  const map = new Map();
  return {
    get: (key) => (map.has(key) ? map.get(key) : null),
    set: (key, value) => { map.set(key, value); },
    remove: (key) => { map.delete(key); },
  };
}

/** 注入瞬时 sleep + 虚拟时钟，测试不消耗真实等待。 */
function makeShell(backend, options = {}) {
  const storage = options.storage || createMapStorage();
  let now = 0;
  const shellInstance = createAgentRunShell({
    request: backend.request,
    storage,
    sleep: (ms) => { now += Number(ms) || 0; return Promise.resolve(); },
    now: () => now,
    maxWaitMs: options.maxWaitMs || 5000,
  });
  return { shell: shellInstance, storage };
}

async function main() {
  check("G1 生成器产物新鲜度：generate-agent-sdk-compat --check 退出码 0", () => {
    const output = execFileSync(
      process.execPath,
      [path.join(__dirname, "generate-agent-sdk-compat.js"), "--check"],
      { encoding: "utf8" },
    );
    assert.ok(/current/.test(output), `unexpected output: ${output}`);
  });

  check("M1 模块导出：工厂 + 单例 + 存储键", () => {
    assert.strictEqual(ACTIVE_RUN_STORAGE_KEY, "agent-run:active");
    assert.strictEqual(typeof createAgentRunShell, "function");
    ["startRun", "cancelActiveRun", "resumeActiveRun", "getActiveRun", "clearActiveRun"].forEach((name) => {
      assert.strictEqual(typeof shell[name], "function", `singleton missing ${name}`);
    });
  });

  await checkAsync("R1 startRun happy path：create→累计扇出→终态结果", async () => {
    const backend = createBackend({
      getRun: (req) => {
        const after = Number(req.query.afterSequence || 0);
        if (after < 2) {
          return {
            status: 200,
            json: {
              success: true,
              events: [E1, E2].filter((event) => event.sequence > after),
              status: "running",
              eventCursor: 2,
              nextPollMs: 100,
            },
          };
        }
        return {
          status: 200,
          json: {
            success: true,
            events: [E3],
            status: "completed",
            eventCursor: 3,
            nextPollMs: 100,
            result: { answer: "今天有两节课" },
          },
        };
      },
    });
    const { shell: sh } = makeShell(backend);
    const created = [];
    const eventBatches = [];
    const statuses = [];
    const outcome = await sh.startRun({
      message: "  今天有什么课  ",
      context: { term: "2025-2026-2" },
      requestId: "req-1",
      conversationId: "conv-1",
      memoryMode: "cloud_sync",
      cloudSyncEnabled: true,
      idempotencyKey: "idem-1",
      callbacks: {
        onRunCreated: (info) => created.push(info),
        onRunEvents: (events) => eventBatches.push(events),
        onStatus: (status) => statuses.push(status),
      },
    });
    assert.strictEqual(outcome.status, "completed");
    assert.strictEqual(outcome.result.answer, "今天有两节课");
    assert.strictEqual(outcome.events.length, 3);
    assert.deepStrictEqual(outcome.events.map((event) => event.sequence), [1, 2, 3]); // 严格递增
    assert.strictEqual(new Set(outcome.events.map((event) => event.eventId)).size, 3); // 无重复 eventId
    // 回调：onRunCreated 一次；onRunEvents 累计全量；onStatus 取最新带 label 事件。
    assert.deepStrictEqual(created, [{ runId: "run_1", pollToken: "pt_1" }]);
    assert.strictEqual(eventBatches.length, 2);
    assert.strictEqual(eventBatches[0].length, 2);
    assert.strictEqual(eventBatches[1].length, 3); // 累计而非增量
    assert.deepStrictEqual(statuses.map((item) => item.text), ["查询课表", "完成"]);
    // create 请求体：业务字段与 legacy 协议版本齐全，message 已 trim。
    assert.strictEqual(countCreates(backend), 1);
    const body = backend.calls[0].body;
    assert.strictEqual(body.message, "今天有什么课");
    assert.strictEqual(body.protocolVersion, "agent.v2");
    assert.strictEqual(body.memoryMode, "cloud_sync");
    assert.strictEqual(body.cloudSyncEnabled, true);
    assert.strictEqual(body.idempotencyKey, "idem-1");
    assert.strictEqual(body.conversationId, "conv-1");
    // 轮询游标推进：create 返回 eventCursor 0 → 首查 afterSequence=0。
    const gets = backend.calls.filter((call) => call.method === "GET");
    assert.strictEqual(gets.length, 2);
    assert.strictEqual(gets[0].query.afterSequence, 0);
    assert.strictEqual(gets[0].query.pollToken, "pt_1");
    assert.strictEqual(gets[1].query.afterSequence, 2);
    assert.strictEqual(sh.getActiveRun(), null); // 终态后句柄已清
  });

  await checkAsync("R2 至少一次全量重放：扇出事件无重复 eventId", async () => {
    let polls = 0;
    const backend = createBackend({
      // 服务端可重放：忽略 afterSequence 总是返回全量事件。
      getRun: () => {
        polls += 1;
        if (polls === 1) {
          return { status: 200, json: { success: true, events: [E1, E2], status: "running", eventCursor: 2, nextPollMs: 100 } };
        }
        return {
          status: 200,
          json: {
            success: true,
            events: [E1, E2, E3], // 含已投递的 E1/E2
            status: "completed",
            eventCursor: 3,
            nextPollMs: 100,
            result: { answer: "done" },
          },
        };
      },
    });
    const { shell: sh } = makeShell(backend);
    const batches = [];
    const outcome = await sh.startRun({
      message: "hi",
      callbacks: { onRunEvents: (events) => batches.push(events.map((event) => event.eventId)) },
    });
    assert.strictEqual(outcome.status, "completed");
    // onRunEvents 是累计语义：每批必须是上一批的前序扩展，且“新出现”的
    // eventId 在整个 Run 周期内不重复（重放的 E1/E2 不得再次作为新事件投递）。
    assert.deepStrictEqual(batches, [["evt-1", "evt-2"], ["evt-1", "evt-2", "evt-3"]]);
    const seen = new Set();
    const newlyIntroduced = [];
    batches.forEach((batch) => {
      assert.strictEqual(new Set(batch).size, batch.length, "单批内不得重复");
      batch.forEach((eventId) => {
        if (!seen.has(eventId)) {
          seen.add(eventId);
          newlyIntroduced.push(eventId);
        }
      });
    });
    assert.deepStrictEqual(newlyIntroduced, ["evt-1", "evt-2", "evt-3"]);
    assert.deepStrictEqual(outcome.events.map((event) => event.sequence), [1, 2, 3]);
    assert.strictEqual(new Set(outcome.events.map((event) => event.eventId)).size, 3);
  });

  await checkAsync("R3 终态宽限：result 滞后两次后拿到真实结果", async () => {
    let polls = 0;
    const backend = createBackend({
      getRun: () => {
        polls += 1;
        const hasResult = polls >= 3;
        return {
          status: 200,
          json: {
            success: true,
            events: polls === 1 ? [{ type: "run.completed", sequence: 1, eventId: "evt-t" }] : [],
            status: "completed",
            eventCursor: 1,
            nextPollMs: 100,
            result: hasResult ? { answer: "real" } : null, // result 落库竞态
          },
        };
      },
    });
    const { shell: sh } = makeShell(backend);
    const outcome = await sh.startRun({ message: "hi" });
    assert.strictEqual(outcome.status, "completed");
    assert.ok(outcome.result, "宽限后必须拿到真实 result，不得返回 null");
    assert.strictEqual(outcome.result.answer, "real");
    assert.strictEqual(countGets(backend), 3); // 1 次终态 + 2 次宽限
  });

  await checkAsync("R4 shouldCancel：真实取消一次 → cancelled 信封 + 清句柄", async () => {
    const backend = createBackend();
    const { shell: sh } = makeShell(backend);
    const outcome = await sh.startRun({
      message: "hi",
      shouldCancel: () => true,
    });
    assert.deepStrictEqual(outcome, { status: "cancelled", events: [], result: null, cancelled: true });
    assert.strictEqual(countCancels(backend), 1); // 取消只发一次
    const cancelCall = backend.calls.find((call) => /\/cancel$/.test(call.path));
    assert.strictEqual(cancelCall.body.pollToken, "pt_1"); // 取消携带凭据
    assert.strictEqual(countGets(backend), 0); // 首 tick 即取消，未轮询
    assert.strictEqual(sh.getActiveRun(), null);
  });

  await checkAsync("R5 cancelActiveRun 网络失败：不伪造 cancelled、句柄保留", async () => {
    const backend = createBackend({
      cancel: () => { throw new Error("socket hang up"); },
    });
    const { shell: sh, storage } = makeShell(backend);
    storage.set(ACTIVE_RUN_STORAGE_KEY, {
      runId: "run_x",
      pollToken: "pt_x",
      conversationId: "conv-x",
      startedAt: 1,
      cursor: 0,
    });
    const outcome = await sh.cancelActiveRun();
    assert.strictEqual(outcome.ok, false);
    assert.strictEqual(outcome.failure.errorClass, "network");
    assert.ok(!("status" in outcome) || outcome.status !== "cancelled", "失败时不得携带 cancelled 状态");
    const handle = sh.getActiveRun();
    assert.ok(handle && handle.runId === "run_x", "失败时句柄必须保留");
    assert.strictEqual(countCancels(backend), 1);
    assert.strictEqual(countCreates(backend), 0); // 取消绝不触发重建
  });

  await checkAsync("R6 resumeActiveRun：无句柄 → null，且零网络调用", async () => {
    const backend = createBackend();
    const { shell: sh } = makeShell(backend);
    const outcome = await sh.resumeActiveRun();
    assert.strictEqual(outcome, null);
    assert.strictEqual(backend.calls.length, 0);
  });

  await checkAsync("R7 resumeActiveRun：页面重开后凭游标续跑，不重建 Run", async () => {
    let mode = "slow";
    const backend = createBackend({
      getRun: (req) => {
        const after = Number(req.query.afterSequence || 0);
        if (mode === "slow") {
          return {
            status: 200,
            json: {
              success: true,
              events: after < 1 ? [E1] : [],
              status: "running",
              eventCursor: 1,
              nextPollMs: 100,
            },
          };
        }
        // 服务端已终态：按 afterSequence 续发剩余事件。
        return {
          status: 200,
          json: {
            success: true,
            events: [E2, E3].filter((event) => event.sequence > after),
            status: "completed",
            eventCursor: 3,
            nextPollMs: 100,
            result: { answer: "恢复结果" },
          },
        };
      },
    });
    const storage = createMapStorage();
    const first = makeShell(backend, { storage, maxWaitMs: 400 });
    const timedOut = await first.shell.startRun({ message: "hi" });
    assert.strictEqual(timedOut.timeout, true); // 客户端先超时（模拟杀进程前）
    assert.ok(first.shell.getActiveRun(), "超时后句柄必须保留");
    assert.strictEqual(countCreates(backend), 1);
    // 模拟页面重开：新 shell 实例 + 同一 storage。
    mode = "finish";
    const second = makeShell(backend, { storage });
    const fanned = [];
    const outcome = await second.shell.resumeActiveRun({
      onRunEvents: (events) => fanned.push(...events),
    });
    assert.strictEqual(countCreates(backend), 1, "resume 绝不重建 Run");
    assert.strictEqual(outcome.recovered, true);
    assert.strictEqual(outcome.status, "completed");
    assert.strictEqual(outcome.result.answer, "恢复结果");
    assert.deepStrictEqual(outcome.events.map((event) => event.eventId), ["evt-2", "evt-3"]); // 仅新应用事件
    assert.strictEqual(new Set(fanned.map((event) => event.eventId)).size, fanned.length);
    // 续跑从已持久化游标开始（E1 之后），不回退重拉。
    const resumeGets = backend.calls.filter((call) => call.method === "GET").slice(2);
    assert.strictEqual(resumeGets[0].query.afterSequence, 1);
    assert.strictEqual(second.shell.getActiveRun(), null); // 终态后清句柄
    assert.strictEqual(storage.get(ACTIVE_RUN_STORAGE_KEY), null);
  });

  await checkAsync("R8 resumeActiveRun：服务端 404 → RUN_GONE + 清句柄", async () => {
    const backend = createBackend({
      getRun: () => ({ status: 404, json: { code: "RUN_NOT_FOUND" } }),
    });
    const { shell: sh, storage } = makeShell(backend);
    storage.set(ACTIVE_RUN_STORAGE_KEY, {
      runId: "run_ghost",
      pollToken: "pt_g",
      conversationId: "",
      startedAt: 1,
      cursor: 0,
    });
    const outcome = await sh.resumeActiveRun();
    assert.deepStrictEqual(outcome, { ok: false, reason: "RUN_GONE" });
    assert.strictEqual(sh.getActiveRun(), null);
    assert.strictEqual(countCreates(backend), 0);
  });

  await checkAsync("R9 轮询错误容忍：两次可重试失败后完成，不重建 Run", async () => {
    let polls = 0;
    const backend = createBackend({
      getRun: () => {
        polls += 1;
        if (polls <= 2) throw new Error("socket hang up");
        return {
          status: 200,
          json: {
            success: true,
            events: [E1, { type: "run.completed", sequence: 2, eventId: "evt-t2" }],
            status: "completed",
            eventCursor: 2,
            nextPollMs: 100,
            result: { answer: "ok" },
          },
        };
      },
    });
    const { shell: sh } = makeShell(backend);
    const outcome = await sh.startRun({ message: "hi" });
    assert.strictEqual(outcome.status, "completed");
    assert.strictEqual(outcome.result.answer, "ok");
    assert.strictEqual(countGets(backend), 3);
    assert.strictEqual(countCreates(backend), 1); // 失败容忍期内绝不重建
  });

  await checkAsync("R10 超时：永不终态 → timeout 信封且句柄保留", async () => {
    const backend = createBackend(); // 默认永远 running
    const { shell: sh } = makeShell(backend, { maxWaitMs: 300 });
    const outcome = await sh.startRun({ message: "hi" });
    assert.strictEqual(outcome.timeout, true);
    assert.strictEqual(outcome.status, "running");
    assert.deepStrictEqual(outcome.events, []);
    assert.strictEqual(outcome.result, null);
    assert.ok(sh.getActiveRun(), "超时保留句柄供后续 resume");
    assert.strictEqual(countCreates(backend), 1);
  });

  await checkAsync("R11 无 active run：cancelActiveRun → NO_ACTIVE_RUN", async () => {
    const backend = createBackend();
    const { shell: sh } = makeShell(backend);
    const outcome = await sh.cancelActiveRun();
    assert.deepStrictEqual(outcome, { ok: false, reason: "NO_ACTIVE_RUN" });
    assert.strictEqual(backend.calls.length, 0);
  });

  checks.forEach((line) => console.log(line));
  if (process.exitCode) {
    console.error("test-xiaofu-agent-run-shell: FAIL");
    process.exit(1);
  }
  console.log(`test-xiaofu-agent-run-shell: PASS (${checks.length} checks)`);
}

main().catch((error) => {
  console.error(`test-xiaofu-agent-run-shell: ERROR ${error && error.stack || error}`);
  process.exit(1);
});
