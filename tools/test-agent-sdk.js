#!/usr/bin/env node
/**
 * P6a：packages/agent-sdk 环境无关客户端与状态机验收。
 *
 * 覆盖：状态机合法转换 / 终态吸收 / 四类幂等（duplicate_eventId、
 * stale_sequence、after_terminal、out_of_order_gap）/ 事件与 ID 窗口上限 /
 * classifyHttpFailure 矩阵 / createRun→poll→reconnect→recoverFinalResult→
 * cancelRun 全链 / waitForTerminal 成功·超时·中止 / storage·clock·sleep·
 * transport 依赖注入 / 静态边界扫描（禁 http/wx/DOM/服务端/校园耦合）。
 */
"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");

const SDK = require("../packages/agent-sdk");

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

/** 可编程假后端：路由到测试提供的 handler，记录全部调用。 */
function createBackend(routes = {}) {
  const calls = [];
  async function request(req) {
    calls.push(req);
    if (req.method === "POST" && req.path === "/api/agent/runs") {
      if (routes.createRun) return routes.createRun(req);
      return {
        status: 202,
        json: {
          runId: "run_1",
          pollToken: "pt_1",
          status: "queued",
          eventCursor: 1,
          nextPollMs: 100,
          protocolVersion: "run.v2",
          capabilities: { cursorResume: true },
          diagnostics: {},
        },
      };
    }
    const runMatch = String(req.path).match(/^\/api\/agent\/runs\/([^/]+)$/);
    if (req.method === "GET" && runMatch) {
      if (routes.getRun) return routes.getRun(req, decodeURIComponent(runMatch[1]));
      return { status: 200, json: { events: [], status: "running", eventCursor: 1, nextPollMs: 100 } };
    }
    const cancelMatch = String(req.path).match(/^\/api\/agent\/runs\/([^/]+)\/cancel$/);
    if (req.method === "POST" && cancelMatch) {
      if (routes.cancel) return routes.cancel(req, decodeURIComponent(cancelMatch[1]));
      return { status: 200, json: { status: "cancelled", alreadyFinished: false } };
    }
    return { status: 404, json: { code: "RUN_NOT_FOUND" } };
  }
  return { request, calls };
}

function makeClient(backend, extra = {}) {
  return SDK.createAgentRunClient(Object.assign({
    request: backend.request,
    sleep: () => Promise.resolve(),
  }, extra));
}

async function main() {
  // ---- S. 状态机与幂等 reducer ----
  check("S1 合法转换：queued→running→running→completed，终态吸收", () => {
    const state = SDK.createRunState({ runId: "r1" });
    assert.strictEqual(state.status, "queued");
    assert.strictEqual(SDK.reduceRunEvent(state, { type: "run.accepted", sequence: 1, eventId: "e1" }).applied, true);
    assert.strictEqual(state.status, "running");
    // 普通事件在 running 上保持 running（不得判 illegal_transition 丢事件）。
    assert.strictEqual(SDK.reduceRunEvent(state, { type: "stage.started", sequence: 2, eventId: "e2", stage: "context" }).applied, true);
    assert.strictEqual(state.status, "running");
    assert.strictEqual(SDK.reduceRunEvent(state, { type: "run.completed", sequence: 3, eventId: "e3", result: { answer: "ok" } }).applied, true);
    assert.strictEqual(state.status, "completed");
    assert.strictEqual(state.result.answer, "ok");
    assert.strictEqual(state.terminalEventId, "e3");
    // 终态为吸收态：后续普通/终态事件一律不应用、不改写。
    assert.strictEqual(SDK.reduceRunEvent(state, { type: "tool.started", sequence: 4, eventId: "e4" }).reason, "after_terminal");
    assert.strictEqual(SDK.reduceRunEvent(state, { type: "run.cancelled", sequence: 5, eventId: "e5" }).reason, "after_terminal");
    assert.strictEqual(state.status, "completed");
    // queued 直达终态合法。
    const direct = SDK.createRunState({ runId: "r2" });
    assert.strictEqual(SDK.reduceRunEvent(direct, { type: "run.failed", sequence: 1, eventId: "f1" }).applied, true);
    assert.strictEqual(direct.status, "failed");
  });
  check("S2 四类幂等：duplicate/stale/after_terminal/out_of_order + invalid", () => {
    const state = SDK.createRunState({ runId: "r3" });
    const first = { type: "stage.started", sequence: 1, eventId: "dup-1" };
    assert.strictEqual(SDK.reduceRunEvent(state, first).applied, true);
    assert.strictEqual(SDK.reduceRunEvent(state, first).reason, "duplicate_eventId"); // 同 eventId 不重放
    assert.strictEqual(
      SDK.reduceRunEvent(state, { type: "stage.completed", sequence: 1, eventId: "other-id" }).reason,
      "stale_sequence",
    ); // 旧 sequence 不倒退
    const gap = SDK.reduceRunEvent(state, { type: "stage.started", sequence: 5, eventId: "gap-5" });
    assert.strictEqual(gap.applied, true); // 跳跃仍推进 cursor
    assert.strictEqual(state.cursor, 5);
    assert.ok(state.diagnostics.some((d) => d.code === "out_of_order_gap")); // 如实记录缺口
    assert.strictEqual(SDK.reduceRunEvent(state, { type: "stage.started", sequence: 3, eventId: "late-3" }).reason, "stale_sequence");
    assert.strictEqual(SDK.reduceRunEvent(state, { sequence: 6, eventId: "no-type" }).reason, "invalid_event");
    assert.strictEqual(SDK.reduceRunEvent(state, { type: "stage.started", sequence: 0, eventId: "zero" }).reason, "invalid_sequence");
    assert.strictEqual(state.events.length, 2); // 只应用过 2 个事件
  });
  check("S3 窗口上限：events 200 / seenEventIds 500 / diagnostics 50", () => {
    const state = SDK.createRunState({ runId: "r4" });
    for (let i = 1; i <= 600; i += 1) {
      SDK.reduceRunEvent(state, { type: "stage.started", sequence: i, eventId: `cap-${i}` });
    }
    assert.strictEqual(state.events.length, 200); // 长会话内存不失控
    assert.strictEqual(state.seenEventIds.length, 500);
    assert.strictEqual(state.cursor, 600);
    assert.ok(state.diagnostics.length <= 50);
  });
  check("S4 classifyHttpFailure 矩阵", () => {
    const C = SDK.classifyHttpFailure;
    assert.deepStrictEqual([C(0, "", new Error("boom")).errorClass, C(0, "", new Error("boom")).retriable], ["network", true]);
    assert.deepStrictEqual([C(429).errorClass, C(429).retriable], ["rate_limited", true]);
    assert.deepStrictEqual([C(408).errorClass, C(408).retriable], ["internal", true]);
    assert.deepStrictEqual([C(503).errorClass, C(503).retriable], ["internal", true]);
    assert.deepStrictEqual([C(401).errorClass, C(401).retriable], ["auth", false]);
    assert.deepStrictEqual([C(403).errorClass, C(403).retriable], ["auth", false]);
    assert.deepStrictEqual([C(404).errorClass, C(404).retriable], ["not_found", false]);
    assert.deepStrictEqual([C(410).errorClass, C(410).retriable], ["expired", false]);
    assert.deepStrictEqual([C(409).errorClass, C(409).retriable], ["conflict", false]);
    assert.deepStrictEqual([C(400).errorClass, C(400).retriable], ["validation", false]);
    assert.strictEqual(C(400, "RUN_PROTOCOL_UNSUPPORTED").errorClass, "unsupported_protocol");
    assert.strictEqual(C(400, "RUN_PROTOCOL_UNSUPPORTED").retriable, false);
    assert.deepStrictEqual([C(418).errorClass, C(418).retriable], ["internal", false]);
  });

  // ---- C. 客户端全链（mock request，无真实网络）----
  await checkAsync("C1 createRun：协议版本/幂等键透传 + capabilities 返回", async () => {
    const backend = createBackend();
    const client = makeClient(backend);
    const created = await client.createRun("  今天有什么课  ", {
      conversationId: "conv-1",
      idempotencyKey: "idem-1",
      requestId: "req-1",
    });
    assert.strictEqual(created.runId, "run_1");
    assert.strictEqual(created.pollToken, "pt_1");
    assert.strictEqual(created.cursor, 1);
    assert.strictEqual(created.capabilities.cursorResume, true);
    const sent = backend.calls[0];
    assert.strictEqual(sent.method, "POST");
    assert.strictEqual(sent.body.message, "今天有什么课"); // trim
    assert.strictEqual(sent.body.protocolVersion, "run.v2");
    assert.strictEqual(sent.body.idempotencyKey, "idem-1");
    assert.strictEqual(sent.body.conversationId, "conv-1");
    assert.strictEqual(sent.body.requestId, "req-1");
    assert.strictEqual(client.protocolVersion, "run.v2");
  });
  await checkAsync("C2 poll：cursor 推进 + 至少一次重放下重复事件零应用", async () => {
    const events = [
      { type: "stage.started", sequence: 2, eventId: "evt_2", stage: "context" },
      { type: "run.completed", sequence: 3, eventId: "evt_3", result: { answer: "done" } },
    ];
    const backend = createBackend({
      // 服务端至少一次可重放：故意忽略 afterSequence 总是返回全量。
      getRun: () => ({ status: 200, json: { events, status: "completed", eventCursor: 3, nextPollMs: 0, result: { answer: "done" } } }),
    });
    const client = makeClient(backend);
    await client.createRun("hi");
    const first = await client.poll("run_1");
    assert.strictEqual(first.ok, true);
    assert.strictEqual(first.appliedEvents, 2);
    assert.strictEqual(first.terminal, true);
    assert.strictEqual(first.result.answer, "done");
    assert.strictEqual(backend.calls[1].query.afterSequence, 1);
    assert.strictEqual(backend.calls[1].query.pollToken, "pt_1");
    const second = await client.poll("run_1");
    assert.strictEqual(second.appliedEvents, 0); // 重复事件不重复更新状态
    assert.strictEqual(second.duplicateEvents, 2);
    assert.strictEqual(second.status, "completed"); // 状态不倒退
    assert.strictEqual(backend.calls[2].query.afterSequence, 3); // cursor 已推进
    const state = client.getState("run_1");
    assert.strictEqual(state.events.length, 2); // 未重复渲染
  });
  await checkAsync("C3 reconnect/resume：不建第二个 Run，跨客户端凭 storage 恢复 cursor", async () => {
    const backend = createBackend({
      getRun: (req) => {
        const after = Number(req.query.afterSequence || 0);
        const all = [
          { type: "stage.started", sequence: 2, eventId: "evt_2" },
          { type: "run.completed", sequence: 3, eventId: "evt_3", result: { answer: "done" } },
        ];
        return {
          status: 200,
          json: {
            events: all.filter((event) => event.sequence > after),
            status: after >= 3 ? "completed" : "running",
            eventCursor: 3,
            nextPollMs: 0,
            result: after >= 3 ? { answer: "done" } : null,
          },
        };
      },
    });
    const storage = SDK.createMemoryStorage();
    const client1 = makeClient(backend, { storage });
    await client1.createRun("hi");
    await client1.poll("run_1"); // 应用 seq2，cursor=2
    const createsBefore = backend.calls.filter((call) => call.method === "POST" && call.path === "/api/agent/runs").length;
    await client1.reconnect("run_1");
    const createsAfter = backend.calls.filter((call) => call.method === "POST" && call.path === "/api/agent/runs").length;
    assert.strictEqual(createsBefore, 1);
    assert.strictEqual(createsAfter, 1); // reconnect 绝不重建 Run
    // 模拟页面重开：新客户端 + 同一 storage，凭 cursor 续读。
    const client2 = makeClient(backend, { storage });
    const resumed = await client2.resumeFromCursor("run_1");
    assert.strictEqual(resumed.ok, true);
    const lastGet = backend.calls[backend.calls.length - 1];
    assert.strictEqual(lastGet.query.afterSequence, 3); // client1 reconnect 已推进到 3
    assert.strictEqual(lastGet.query.pollToken, "pt_1"); // 凭据随 storage 恢复
    assert.strictEqual(resumed.terminal, true);
    assert.strictEqual(resumed.result.answer, "done");
  });
  await checkAsync("C4 recoverFinalResult：终态恢复结果 / 非终态不伪造", async () => {
    let status = "running";
    const backend = createBackend({
      getRun: () => ({
        status: 200,
        json: {
          events: [],
          status,
          eventCursor: 1,
          nextPollMs: 0,
          result: status === "completed" ? { answer: "final" } : null,
        },
      }),
    });
    const client = makeClient(backend);
    await client.createRun("hi");
    const mid = await client.recoverFinalResult("run_1");
    assert.strictEqual(mid.ok, true);
    assert.strictEqual(mid.terminal, false);
    assert.strictEqual(mid.result, null); // 非终态如实无结果
    status = "completed";
    const final = await client.recoverFinalResult("run_1");
    assert.strictEqual(final.terminal, true);
    assert.strictEqual(final.result.answer, "final"); // 断线发生在终态前后都可恢复
  });
  await checkAsync("C5 cancelRun：端到端语义 + 网络失败不伪造 cancelled", async () => {
    let cancelBehavior = "ok";
    const backend = createBackend({
      cancel: () => {
        if (cancelBehavior === "throw") throw new Error("socket hang up");
        if (cancelBehavior === "finished") return { status: 200, json: { status: "completed", alreadyFinished: true } };
        return { status: 200, json: { status: "cancelled", alreadyFinished: false } };
      },
    });
    const client = makeClient(backend);
    await client.createRun("hi");
    const cancelled = await client.cancelRun("run_1");
    assert.strictEqual(cancelled.ok, true);
    assert.strictEqual(cancelled.status, "cancelled");
    assert.strictEqual(cancelled.alreadyFinished, false);
    assert.strictEqual(backend.calls[1].body.pollToken, "pt_1"); // 取消携带凭据
    // 网络失败：不得伪造 cancelled，本地运行中状态必须原样保持。
    cancelBehavior = "throw";
    const runningBackend = createBackend({
      cancel: () => { throw new Error("socket hang up"); },
    });
    const runningClient = makeClient(runningBackend);
    await runningClient.createRun("hi");
    const failed = await runningClient.cancelRun("run_1");
    assert.strictEqual(failed.ok, false);
    assert.strictEqual(failed.failure.errorClass, "network");
    assert.notStrictEqual(failed.status, "cancelled"); // 网络超时不等于用户取消
    const stateAfterFailure = runningClient.getState("run_1");
    assert.ok(!stateAfterFailure || stateAfterFailure.status !== "cancelled"); // 状态机未被伪造
    // 已完成 Run 的取消：服务端权威 alreadyFinished，终态不被改写。
    cancelBehavior = "finished";
    const done = await client.cancelRun("run_1");
    assert.strictEqual(done.ok, true);
    assert.strictEqual(done.alreadyFinished, true);
    assert.strictEqual(done.status, "completed");
  });
  await checkAsync("C6 waitForTerminal：成功 / 超时 / 中止三类出口", async () => {
    let pollCount = 0;
    const backend = createBackend({
      getRun: () => {
        pollCount += 1;
        const terminal = pollCount >= 3;
        return {
          status: 200,
          json: {
            events: [],
            status: terminal ? "completed" : "running",
            eventCursor: 1,
            nextPollMs: 100,
            result: terminal ? { answer: "ok" } : null,
          },
        };
      },
    });
    let now = 0;
    const clock = { now: () => now };
    const sleep = (ms) => { now += ms; return Promise.resolve(); };
    const client = makeClient(backend, { clock, sleep, maxWaitMs: 5000 });
    await client.createRun("hi");
    const done = await client.waitForTerminal("run_1", { timeoutMs: 5000 });
    assert.strictEqual(done.terminal, true);
    assert.strictEqual(done.result.answer, "ok");
    // 超时：永不终态 → AGENT_SDK_WAIT_TIMEOUT。
    pollCount = -1000; // 保持 running
    now = 0;
    let timeoutError = null;
    try {
      await client.waitForTerminal("run_1", { timeoutMs: 1000 });
    } catch (error) {
      timeoutError = error;
    }
    assert.ok(timeoutError && timeoutError.message === "AGENT_SDK_WAIT_TIMEOUT");
    assert.strictEqual(timeoutError.errorClass, "timeout");
    // 中止信号：AGENT_SDK_WAIT_ABORTED，errorClass cancelled。
    let abortError = null;
    try {
      await client.waitForTerminal("run_1", { signal: { aborted: true } });
    } catch (error) {
      abortError = error;
    }
    assert.ok(abortError && abortError.message === "AGENT_SDK_WAIT_ABORTED");
    assert.strictEqual(abortError.errorClass, "cancelled");
  });
  await checkAsync("C7 storage DI：句柄持久化 + createMemoryStorage 往返", async () => {
    const writes = new Map();
    const storage = {
      get: (key) => (writes.has(key) ? writes.get(key) : null),
      set: (key, value) => { writes.set(key, value); },
      remove: (key) => { writes.delete(key); },
    };
    const backend = createBackend();
    const client = makeClient(backend, { storage });
    await client.createRun("hi");
    const stored = writes.get("agent-run:run_1");
    assert.ok(stored, "createRun 必须持久化句柄");
    assert.strictEqual(stored.pollToken, "pt_1");
    assert.strictEqual(stored.cursor, 1);
    assert.strictEqual(stored.protocolVersion, "run.v2");
    const memory = SDK.createMemoryStorage();
    memory.set("k", { v: 1 });
    assert.deepStrictEqual(memory.get("k"), { v: 1 });
    memory.remove("k");
    assert.strictEqual(memory.get("k"), null);
  });
  check("C8 transport：默认 polling + 注入式流式 Adapter 接缝", () => {
    const backend = createBackend();
    const client = makeClient(backend);
    assert.strictEqual(client.transport.name, "polling");
    assert.strictEqual(client.transport.describe().streaming, false);
    assert.strictEqual(client.transport.start(), false); // polling 无长连接
    const sse = {
      name: "sse",
      start: () => true,
      stop: () => {},
      describe: () => ({ name: "sse", streaming: true }),
    };
    const withSse = makeClient(backend, { transport: sse });
    assert.strictEqual(withSse.transport, sse); // 注入优先，业务页不感知传输细节
  });
  await checkAsync("C9 createRun 失败分类：validation/rate_limited/unsupported_protocol/network/空消息", async () => {
    let mode = "validation";
    const backend = createBackend({
      createRun: () => {
        if (mode === "validation") return { status: 400, json: { code: "MESSAGE_REQUIRED" } };
        if (mode === "rate") return { status: 429, json: { code: "RATE_LIMITED" } };
        if (mode === "protocol") return { status: 400, json: { code: "RUN_PROTOCOL_UNSUPPORTED" } };
        throw new Error("connection reset");
      },
    });
    const client = makeClient(backend);
    const attempt = async () => {
      try {
        await client.createRun("hi");
        return null;
      } catch (error) {
        return error;
      }
    };
    let error = await attempt();
    assert.strictEqual(error.errorClass, "validation");
    assert.strictEqual(error.retriable, false);
    mode = "rate";
    error = await attempt();
    assert.strictEqual(error.errorClass, "rate_limited");
    assert.strictEqual(error.retriable, true);
    mode = "protocol";
    error = await attempt();
    assert.strictEqual(error.errorClass, "unsupported_protocol");
    assert.strictEqual(error.retriable, false);
    mode = "network";
    error = await attempt();
    assert.strictEqual(error.errorClass, "network");
    assert.strictEqual(error.retriable, true);
    await assert.rejects(() => client.createRun("   "), /AGENT_SDK_MESSAGE_REQUIRED/);
  });
  await checkAsync("C10 未知 Run：poll/cancel/reconnect 如实 not_found", async () => {
    const backend = createBackend();
    const client = makeClient(backend);
    for (const action of ["poll", "cancelRun", "reconnect"]) {
      let error = null;
      try {
        await client[action]("run_ghost");
      } catch (err) {
        error = err;
      }
      assert.ok(error && error.message === "AGENT_SDK_RUN_UNKNOWN", `${action} 必须抛未知 Run`);
      assert.strictEqual(error.errorClass, "not_found");
    }
    assert.strictEqual(client.getState("run_ghost"), null);
  });
  check("C11 静态边界：SDK 不依赖网络/wx/DOM/服务端/校园业务", () => {
    const root = path.join(__dirname, "..", "packages", "agent-sdk");
    const files = [];
    (function walk(dir) {
      fs.readdirSync(dir, { withFileTypes: true }).forEach((entry) => {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) walk(full);
        else if (entry.name.endsWith(".js")) files.push(full);
      });
    }(root));
    assert.ok(files.length >= 3, `SDK 源文件数量异常: ${files.length}`);
    const forbidden = [
      { pattern: /require\(\s*["'](?:node:)?(?:http|https|net|tls|dgram|fs|child_process)["']\s*\)/, label: "Node 网络/系统模块" },
      { pattern: /\bwx\s*\./, label: "wx API" },
      { pattern: /\bwindow\s*\.|\bdocument\s*\.|\bglobalThis\s*\.\s*wx/, label: "DOM/wx 全局" },
      { pattern: /\.\.\/server|server\/src/, label: "服务端模块" },
      { pattern: /fosu|佛山|佛大|release-pack|FOSU_/i, label: "校园业务耦合" },
    ];
    files.forEach((file) => {
      const source = fs.readFileSync(file, "utf8");
      forbidden.forEach(({ pattern, label }) => {
        assert.ok(!pattern.test(source), `${path.basename(file)} 命中禁用依赖: ${label}`);
      });
    });
  });

  checks.forEach((line) => console.log(line));
  if (process.exitCode) {
    console.error("test-agent-sdk: FAIL");
    process.exit(1);
  }
  console.log(`test-agent-sdk: PASS (${checks.length} checks)`);
}

main().catch((error) => {
  console.error(`test-agent-sdk: ERROR ${error && error.stack || error}`);
  process.exit(1);
});
