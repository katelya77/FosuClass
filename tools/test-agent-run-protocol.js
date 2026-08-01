#!/usr/bin/env node
/**
 * P6a：可恢复 Run 协议 + 服务端可恢复能力验收。
 *
 * 覆盖：协议协商矩阵 / 错误分类 / 稳定 eventId / 严格递增 sequence /
 * cursor 深重放（store 兜底合并）/ 终态不可覆盖 / cancel 端到端幂等 /
 * 重启恢复（eventId 稳定 + RUN_EXECUTOR_LOST）/ Handler 层协商与幂等键 /
 * 事件无敏感键 / integrated↔standalone 契约同形。
 */
"use strict";

const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");

const AGENT_PROTOCOL = require("../packages/agent-protocol");
const { UI_BLOCK_TYPES } = require("../packages/ui-schema");
const RUN_EVENT_SERVICE_MODULE = require("../server/src/services/ai/agentRunEventService");
const { createRunEventService } = RUN_EVENT_SERVICE_MODULE;
const { createMemoryRunStore } = require("../server/src/services/ai/persistence/memoryRunStore");
const { createJournalRunStore } = require("../server/src/services/ai/persistence/journalRunStore");
const { createRunHandlers } = require("../apps/agent-server");

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

function mockRes() {
  return {
    statusCode: 0,
    body: null,
    headers: {},
    setHeader(key, value) { this.headers[key] = value; },
    status(code) { this.statusCode = code; return this; },
    // Express 语义：未显式 status 时 json/send 默认 200。
    json(payload) { if (!this.statusCode) this.statusCode = 200; this.body = payload; return this; },
    send(payload) { if (!this.statusCode) this.statusCode = 200; this.body = payload; return this; },
  };
}

async function main() {
  // ---- A. 协议协商与错误分类 ----
  check("A1 默认协商 native run.v2 + 12 类 UI Block 与 ui-schema 一致", () => {
    const result = AGENT_PROTOCOL.negotiateProtocol(undefined);
    assert.strictEqual(result.ok, true);
    assert.strictEqual(result.compatibilityMode, "native");
    assert.strictEqual(result.protocolVersion, "run.v2");
    assert.deepStrictEqual(
      AGENT_PROTOCOL.PROTOCOL_CAPABILITIES.supportedUiBlocks.slice().sort(),
      UI_BLOCK_TYPES.slice().sort(),
    );
    assert.strictEqual(AGENT_PROTOCOL.PROTOCOL_CAPABILITIES.cursorResume, true);
    assert.strictEqual(AGENT_PROTOCOL.PROTOCOL_CAPABILITIES.cancellation, true);
    assert.strictEqual(AGENT_PROTOCOL.PROTOCOL_CAPABILITIES.finalResultRecovery, true);
    assert.strictEqual(AGENT_PROTOCOL.PROTOCOL_CAPABILITIES.minimumCompatibleVersion, "run.v1");
  });
  check("A2 显式 run.v2 native；run.v1 与现网信封版本 legacy 受控兼容", () => {
    assert.strictEqual(AGENT_PROTOCOL.negotiateProtocol("run.v2").compatibilityMode, "native");
    ["run.v1", "agent.v1", "agent.v2"].forEach((version) => {
      const legacy = AGENT_PROTOCOL.negotiateProtocol(version);
      assert.strictEqual(legacy.ok, true, `${version} 现网客户端必须受控兼容`);
      assert.strictEqual(legacy.compatibilityMode, "legacy");
      assert.strictEqual(legacy.protocolVersion, "run.v2"); // 服务端仍按 run.v2 应答
    });
  });
  check("A3 未知版本 fail clearly（不白屏不无限重试）", () => {
    const result = AGENT_PROTOCOL.negotiateProtocol("run.v9");
    assert.strictEqual(result.ok, false);
    assert.strictEqual(result.code, "RUN_PROTOCOL_UNSUPPORTED");
    assert.strictEqual(result.errorClass, "unsupported_protocol");
    assert.strictEqual(result.compatibilityMode, "unsupported");
  });
  check("A4 错误分类映射", () => {
    assert.strictEqual(AGENT_PROTOCOL.classifyRunError("RUN_EXPIRED"), "expired");
    assert.strictEqual(AGENT_PROTOCOL.classifyRunError("RUN_FORBIDDEN"), "auth");
    assert.strictEqual(AGENT_PROTOCOL.classifyRunError("RUN_POLL_TOKEN_REQUIRED"), "auth");
    assert.strictEqual(AGENT_PROTOCOL.classifyRunError("RUN_NOT_FOUND"), "not_found");
    assert.strictEqual(AGENT_PROTOCOL.classifyRunError("PROVIDER_TIMEOUT"), "provider");
    assert.strictEqual(AGENT_PROTOCOL.classifyRunError("ABORTED"), "cancelled");
    assert.strictEqual(AGENT_PROTOCOL.classifyRunError("SOMETHING_ELSE"), "internal");
    assert.ok(AGENT_PROTOCOL.RUN_ERROR_CLASSES.includes("unsupported_protocol"));
  });
  check("A5 direct chat 兼容契约标记", () => {
    assert.strictEqual(AGENT_PROTOCOL.DIRECT_CHAT_COMPAT.mode, "compatibility-only");
    assert.strictEqual(AGENT_PROTOCOL.DIRECT_CHAT_COMPAT.deprecated, true);
    ["plan", "tool_progress", "verification", "action_receipt"].forEach((forged) => {
      assert.ok(AGENT_PROTOCOL.DIRECT_CHAT_COMPAT.forgedEventsForbidden.includes(forged));
    });
  });

  // ---- B. 服务层：稳定 eventId / 递增 sequence / 终态语义 ----
  const service = createRunEventService({ store: createMemoryRunStore() });
  const created = service.createRun({ runtimeMode: "public", requestId: "p6a-test", conversationId: "p6a-conv" });
  check("B1 createRun 返回协议版本与能力", () => {
    assert.strictEqual(created.protocolVersion, "run.v2");
    assert.ok(created.capabilities && created.capabilities.cursorResume === true);
    assert.ok(created.runId && created.pollToken);
    assert.strictEqual(created.eventCursor, 1); // run.accepted
  });
  check("B2 事件带稳定 eventId 与 protocolVersion；sequence 严格递增", () => {
    service.appendEvent(created.runId, { type: "stage.started", stage: "context" });
    service.appendEvent(created.runId, { type: "stage.completed", stage: "context" });
    service.appendEvent(created.runId, { type: "tool.started", tool: "demo" });
    const view1 = service.getRunView(created.runId, { pollToken: created.pollToken });
    const sequences = view1.events.map((event) => event.sequence);
    assert.deepStrictEqual(sequences, [1, 2, 3, 4]);
    view1.events.forEach((event) => {
      assert.ok(/^evt_/.test(event.eventId), `eventId 形态: ${event.eventId}`);
      assert.strictEqual(event.protocolVersion, "run.v2");
    });
    const view2 = service.getRunView(created.runId, { pollToken: created.pollToken });
    assert.deepStrictEqual(
      view1.events.map((event) => event.eventId),
      view2.events.map((event) => event.eventId),
    ); // 同一事件 eventId 稳定
    const ids = new Set(view1.events.map((event) => event.eventId));
    assert.strictEqual(ids.size, view1.events.length); // 唯一
  });
  check("B3 终态不可被后续事件覆盖", () => {
    const terminal = service.appendEvent(created.runId, { type: "run.completed" });
    const again = service.appendEvent(created.runId, { type: "run.cancelled" });
    assert.strictEqual(again.eventId, terminal.eventId); // 返回既有终态
    assert.strictEqual(service.getRunRecord(created.runId).status, "completed");
    const lateTool = service.appendEvent(created.runId, { type: "tool.started", tool: "late" });
    assert.ok(lateTool); // 追加允许但不得改写终态
    assert.strictEqual(service.getRunRecord(created.runId).status, "completed");
  });
  check("B4 cancel 端到端 + 重复取消幂等 + completed 不被 cancelled 覆盖", () => {
    const runB = service.createRun({ runtimeMode: "public", requestId: "p6a-cancel" });
    const first = service.cancelRun(runB.runId, { pollToken: runB.pollToken });
    assert.strictEqual(first.ok, true);
    assert.strictEqual(first.status, "cancelled");
    const view = service.getRunView(runB.runId, { pollToken: runB.pollToken });
    assert.ok(view.events.some((event) => event.type === "run.cancelled" && /^evt_/.test(event.eventId)));
    const second = service.cancelRun(runB.runId, { pollToken: runB.pollToken });
    assert.strictEqual(second.alreadyFinished, true);
    const done = service.cancelRun(created.runId, { pollToken: created.pollToken });
    assert.strictEqual(done.alreadyFinished, true);
    assert.strictEqual(service.getRunRecord(created.runId).status, "completed");
  });
  check("B5 事件摘要不带敏感键", () => {
    service.appendEvent(created.runId, {
      type: "stage.started",
      stage: "sensitive",
      apiKey: "sk-should-not-leak",
      authorization: "Bearer should-not-leak",
      systemPrompt: "hidden",
    });
    const view = service.getRunView(created.runId, { pollToken: created.pollToken });
    view.events.forEach((event) => {
      ["apiKey", "authorization", "systemPrompt", "cookie", "password", "token"].forEach((key) => {
        assert.ok(!(key in event), `事件泄露敏感键 ${key}`);
      });
    });
  });

  // ---- C. 深重放与重启恢复（journal 后端）----
  const journalRoot = fs.mkdtempSync(path.join(os.tmpdir(), "p6a-journal-"));
  const journalServiceA = createRunEventService({
    store: createJournalRunStore({ root: journalRoot, retentionMs: 60000 }),
  });
  await checkAsync("C1 投影窗口外 cursor 经 store 兜底合并（不去重不倒退）", async () => {
    const run = journalServiceA.createRun({ runtimeMode: "public", requestId: "p6a-deep" });
    for (let i = 0; i < 45; i += 1) {
      journalServiceA.appendEvent(run.runId, { type: "stage.started", stage: `s${i}` });
      journalServiceA.appendEvent(run.runId, { type: "stage.completed", stage: `s${i}` });
    }
    // 共 91 个事件（1 accepted + 90 stage），投影与 journal 同窗口截断到 80 条
    // （如实下界 91-80+1=12；pg 后端保留全量流，契约由 store+memory 合并路径承载）。
    const deep = await journalServiceA.getRunViewDeep(run.runId, { pollToken: run.pollToken, afterSequence: 5 });
    assert.strictEqual(deep.ok, true);
    assert.strictEqual(deep.eventSource, "store+memory");
    const sequences = deep.events.map((event) => event.sequence);
    assert.strictEqual(new Set(sequences).size, sequences.length); // 无重复
    assert.strictEqual(sequences[0], 12); // journal 与投影同窗口（80 条）如实下界
    assert.strictEqual(sequences[sequences.length - 1], 91);
    for (let i = 1; i < sequences.length; i += 1) {
      assert.ok(sequences[i] > sequences[i - 1], "sequence 不倒退");
    }
    const shallow = await journalServiceA.getRunViewDeep(run.runId, { pollToken: run.pollToken, afterSequence: 88 });
    assert.strictEqual(shallow.eventSource, undefined); // 投影完整覆盖，无需 store
    assert.deepStrictEqual(shallow.events.map((event) => event.sequence), [89, 90, 91]);
  });
  await checkAsync("C2 重启恢复：eventId 稳定 + 非终态如实 RUN_EXECUTOR_LOST", async () => {
    // trial 模式：public 摘要按目录契约抹除 reasonCode（防泄露），中断标记语义经
    // reasonCode 断言必须落在非 public 运行模式（p5a 证据同口径）。
    const run = journalServiceA.createRun({ runtimeMode: "trial", requestId: "p6a-restart" });
    journalServiceA.appendEvent(run.runId, { type: "stage.started", stage: "before-restart" });
    const beforeIds = journalServiceA.getRunView(run.runId, { pollToken: run.pollToken }).events
      .map((event) => event.eventId);
    // 同 root 新 store + 新服务 = 进程重启语义。
    const journalServiceB = createRunEventService({
      store: createJournalRunStore({ root: journalRoot, retentionMs: 60000 }),
    });
    const recovered = journalServiceB.getRunView(run.runId, { pollToken: run.pollToken });
    assert.strictEqual(recovered.ok, true);
    assert.strictEqual(recovered.status, "failed"); // 执行器随进程消亡，如实终止
    const recoveredIds = recovered.events.map((event) => event.eventId);
    beforeIds.forEach((id) => assert.ok(recoveredIds.includes(id), `重启后 eventId 丢失: ${id}`));
    const lostMarker = recovered.events.find((event) => event.type === "run.failed");
    assert.ok(lostMarker && lostMarker.reasonCode === "RUN_EXECUTOR_LOST");
    assert.ok(/^evt_/.test(lostMarker.eventId));
  });
  check("C3 integrated/standalone 契约同形（store listEventsAfter 字段一致）", () => {
    const run = journalServiceA.createRun({ runtimeMode: "public", requestId: "p6a-contract" });
    journalServiceA.appendEvent(run.runId, { type: "stage.started", stage: "contract" });
    const fromStore = journalServiceA.store.listEventsAfter(run.runId, 0);
    assert.ok(Array.isArray(fromStore) && fromStore.length >= 2);
    fromStore.forEach((event) => {
      ["type", "sequence", "eventId", "protocolVersion", "at", "label"].forEach((field) => {
        assert.ok(field in event, `store 事件缺字段 ${field}`);
      });
    });
  });

  // ---- D. Handler 层：协商 / 幂等键 / cursor 透传 ----
  // 生产组合根注入的是模块级 surface（含 statusFromResult 等静态方法，见
  // platformComposition.js），经 bindDefaultStore 落到同一实例——测试同口径接线。
  const scheduled = [];
  let executeTurnCalls = 0;
  const handlerService = RUN_EVENT_SERVICE_MODULE.bindDefaultStore(createMemoryRunStore());
  const handlers = createRunHandlers({
    platform: {
      executeTurn: async (input) => {
        executeTurnCalls += 1;
        if (input.onEvent) input.onEvent({ type: "stage.started", stage: "turn" });
        return { answer: "ok", runtimeMode: "public", status: "completed", success: true };
      },
    },
    runRepository: RUN_EVENT_SERVICE_MODULE,
    protocol: { createRequestId: () => "req_p6a_test" },
    agui: { mapRunToAguiEvents: () => [], serializeSse: () => "" },
    buildFailureResponse: () => ({ answer: "fail", success: false, status: "failed" }),
    schedule: (fn) => { scheduled.push(fn); },
  });
  function mockReq(body, extra = {}) {
    return Object.assign({
      body,
      query: {},
      params: {},
      headers: {},
      agentRuntimeDecision: { runtimeMode: "public" },
    }, extra);
  }
  check("D1 未知协议版本 → 400 RUN_PROTOCOL_UNSUPPORTED", () => {
    const res = mockRes();
    handlers.createRun(mockReq({ message: "hi", protocolVersion: "run.v9" }), res);
    assert.strictEqual(res.statusCode, 400);
    assert.strictEqual(res.body.code, "RUN_PROTOCOL_UNSUPPORTED");
    assert.strictEqual(res.body.errorClass, "unsupported_protocol");
    assert.ok(res.body.capabilities && res.body.capabilities.protocolVersion === "run.v2");
  });
  await checkAsync("D2 run.v1 受控兼容 + 响应带协议与能力", async () => {
    const res = mockRes();
    handlers.createRun(mockReq({ message: "hi", protocolVersion: "run.v1" }), res);
    assert.strictEqual(res.statusCode, 202);
    assert.strictEqual(res.body.protocolVersion, "run.v2");
    assert.strictEqual(res.body.diagnostics.compatibilityMode, "legacy");
    assert.ok(res.body.capabilities && res.body.capabilities.cursorResume === true);
    assert.ok(res.body.runId && res.body.pollToken);
    await scheduled.shift()(); // 执行异步 turn，避免悬挂
  });
  await checkAsync("D3 idempotencyKey 真实转发：重复提交重放同一 Run 且不二次执行", async () => {
    const before = executeTurnCalls;
    const res1 = mockRes();
    handlers.createRun(mockReq({ message: "同一任务", idempotencyKey: "p6a-idem-1" }), res1);
    assert.strictEqual(res1.statusCode, 202);
    assert.strictEqual(res1.body.diagnostics.idempotencyKeyAccepted, true);
    await scheduled.shift()();
    const res2 = mockRes();
    handlers.createRun(mockReq({ message: "同一任务", idempotencyKey: "p6a-idem-1" }), res2);
    assert.strictEqual(res2.statusCode, 202);
    assert.strictEqual(res2.body.runId, res1.body.runId);
    assert.strictEqual(res2.body.diagnostics.deduplicated, true);
    assert.strictEqual(res2.body.pollToken, null); // 明文不补发
    assert.strictEqual(executeTurnCalls, before + 1); // 不重复执行
  });
  await checkAsync("D4 getRun 透传 eventCursor/protocolVersion + 深重放入口", async () => {
    const res = mockRes();
    handlers.createRun(mockReq({ message: "cursor 任务" }), res);
    const runId = res.body.runId;
    const pollToken = res.body.pollToken;
    await scheduled.shift()();
    const getRes = mockRes();
    await handlers.getRun(mockReq({}, { params: { runId }, query: { pollToken, afterSequence: "0" } }), getRes);
    assert.strictEqual(getRes.statusCode, 200);
    assert.ok(Number.isInteger(getRes.body.eventCursor) && getRes.body.eventCursor >= 1);
    assert.strictEqual(getRes.body.protocolVersion, "run.v2");
    assert.ok(getRes.body.events.every((event) => /^evt_/.test(event.eventId)));
    const cursor = getRes.body.eventCursor;
    const incRes = mockRes();
    await handlers.getRun(mockReq({}, { params: { runId }, query: { pollToken, afterSequence: String(cursor) } }), incRes);
    assert.strictEqual(incRes.body.events.length, 0); // cursor 之后无新事件
    assert.strictEqual(incRes.body.status, "completed");
    assert.ok(incRes.body.result && incRes.body.result.answer === "ok"); // 终态结果可恢复
  });
  await checkAsync("D5 cancel 端点幂等且 completed 不被改写", async () => {
    const res = mockRes();
    handlers.createRun(mockReq({ message: "cancel 任务" }), res);
    const runId = res.body.runId;
    const pollToken = res.body.pollToken;
    await scheduled.shift()();
    const cancelRes = mockRes();
    handlers.cancelRun(mockReq({}, { params: { runId }, query: { pollToken } }), cancelRes);
    assert.strictEqual(cancelRes.body.alreadyFinished, true); // 已 completed
    assert.strictEqual(cancelRes.body.status, "completed");
    const view = handlerService.getRunView(runId, { pollToken });
    assert.strictEqual(view.status, "completed");
  });

  checks.forEach((line) => console.log(line));
  if (process.exitCode) {
    console.error("test-agent-run-protocol: FAIL");
    process.exit(1);
  }
  console.log(`test-agent-run-protocol: PASS (${checks.length} checks)`);
}

main().catch((error) => {
  console.error(`test-agent-run-protocol: ERROR ${error && error.stack || error}`);
  process.exit(1);
});
