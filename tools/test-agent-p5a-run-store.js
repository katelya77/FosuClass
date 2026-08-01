#!/usr/bin/env node
// P5a WS3：Run/Event/Trace 持久化——内存 / journal / postgres 三后端验证。
//
// 覆盖：
//   1. 模块 surface：12 函数 repository surface 与 3 个常量逐字在场
//      （createRunEventService / bindDefaultStore 为 WS3 新增工厂导出）；
//   2. 三后端 parity：同一行为脚本（create→事件流→终态幂等→setResult 终态
//      不被覆盖→cancel 幂等→afterSequence 只返回后续事件→idempotency 唯一键
//      重放→trace 落存）在 memory / journal / pg 上可观测结果深度一致
//      （时间戳 / 随机 id / pollToken 已投影剔除）；
//   3. durable 恢复（journal + pg）：服务重启（重建 store/service 实例）后
//      保留窗口内数据仍在——completed Run 可继续轮询；崩溃时 accepted/running
//      Run 被恢复并如实追加 RUN_EXECUTOR_LOST 终态标记；幂等键跨重放生效；
//      trace 跨重放可读；store.listEventsAfter 支撑 cursor 续读；
//   4. journal 专属：append-only journal 落盘 → 重放恢复；compaction
//      （snapshot 原子写 + journal 截断）后重放仍正确；保留窗口外数据被
//      物理剔除；journal 尾部半行（崩溃截断）不阻断恢复；
//   5. pg 专属：migration 0006 三表与 (principal_key, idempotency_key) /
//      (run_id, sequence) 唯一键真实存在（重复键直插 → 23505）；
//      appendEvent 与 run.status 推进同事务（withTransaction 代码路径 +
//      落库状态一致）；保留窗口 hygiene DELETE。
//
// postgres 段：AGENT_TEST_PG_URL 优先，否则 docker 临时容器
// （test-helpers/pg-test-env）；不可用 → 打印 UNVERIFIED 与原因并 exit 0。

const assert = require("assert");
const crypto = require("crypto");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { ensurePg, redactUrl } = require("./test-helpers/pg-test-env");

const agentRunEventService = require("../server/src/services/ai/agentRunEventService");
const { createRunEventService } = agentRunEventService;
const agentTraceRecorder = require("../server/src/services/ai/agentTraceRecorder");
const { createAgentTraceRecorder } = agentTraceRecorder;
const { createMemoryRunStore } = require("../server/src/services/ai/persistence/memoryRunStore");
const { createJournalRunStore } = require("../server/src/services/ai/persistence/journalRunStore");
const { createPgRunStore } = require("../server/src/services/ai/persistence/pgRunStore");
const { closePool, createPgPool, query } = require("../packages/agent-runtime");

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ---------- 1. 模块 surface ----------
function testModuleSurface() {
  const EXPECTED_FUNCTIONS = [
    "appendEvent", "authorizeRunAccess", "cancelRun", "createEventEmitter",
    "createRun", "getRunRecord", "getRunView", "isCancelled",
    "principalFingerprint", "resetForTests", "setResult", "statusFromResult",
  ];
  EXPECTED_FUNCTIONS.forEach((name) => {
    assert.strictEqual(typeof agentRunEventService[name], "function", `repository surface 缺 ${name}`);
  });
  ["DEFAULT_TTL_MS", "DEFAULT_MAX_RUNS", "DEFAULT_TOTAL_TIMEOUT_MS"].forEach((name) => {
    assert.strictEqual(typeof agentRunEventService[name], "number", `常量缺 ${name}`);
  });
  assert.strictEqual(typeof agentRunEventService.createRunEventService, "function", "WS3 工厂导出缺失");
  assert.strictEqual(typeof agentRunEventService.bindDefaultStore, "function", "WS3 绑定导出缺失");
  // 模块级默认实例 = 内存后端（行为逐字保持）：建 Run → 轮询 → 重置。
  agentRunEventService.resetForTests();
  const created = agentRunEventService.createRun({ runtimeMode: "public", requestId: "req-surface" });
  assert.ok(created.runId && created.pollToken);
  const view = agentRunEventService.getRunView(created.runId, { pollToken: created.pollToken });
  assert.strictEqual(view.ok, true);
  assert.strictEqual(view.events[0].type, "run.accepted");
  agentRunEventService.resetForTests();
  console.log("✓ 模块 surface：12 函数 + 3 常量逐字在场，模块级内存默认实例行为不变");
}

// ---------- harness ----------
function createHarness(kind, makeStore) {
  const h = {
    kind,
    store: null,
    service: null,
    recorder: null,
    async flush() {
      if (h.service && h.service.persistenceReady) await h.service.persistenceReady;
      if (h.recorder && h.recorder.persistenceReady) await h.recorder.persistenceReady;
      if (h.store && typeof h.store.whenIdle === "function") await h.store.whenIdle();
    },
    // 模拟服务重启：丢弃 service/recorder/store 实例，在同一持久化介质上重建。
    async restart() {
      await h.flush();
      h.store = makeStore();
      h.service = createRunEventService({ store: h.store });
      h.recorder = createAgentTraceRecorder({ store: h.store });
      await h.flush();
    },
  };
  h.store = makeStore();
  h.service = createRunEventService({ store: h.store });
  h.recorder = createAgentTraceRecorder({ store: h.store });
  return h;
}

// ---------- 投影：剔除时间戳 / 随机 id / pollToken ----------
function projectCreated(created) {
  return {
    status: created.status,
    nextPollMs: created.nextPollMs,
    eventCursor: created.eventCursor,
    deduplicated: created.deduplicated === true,
    pollTokenIssued: typeof created.pollToken === "string" && created.pollToken.length > 0,
  };
}

function projectView(view) {
  if (!view || view.ok !== true) return { ok: false, code: view && view.code, status: view && view.status };
  return {
    ok: true,
    status: view.status,
    nextPollMs: view.nextPollMs,
    eventCursor: view.eventCursor,
    events: view.events.map((event) => {
      const clone = Object.assign({}, event);
      delete clone.at;
      delete clone.eventId; // 随机事件 id：跨后端不可比（稳定性/唯一性由协议测试覆盖）
      return clone;
    }),
    // P6a：eventId 存在性与形态仍纳入 parity（三后端必须一致地为每事件发 id）。
    eventIdsPresent: view.events.every((event) => /^evt_/.test(String(event.eventId || ""))),
    result: view.result,
  };
}

// ---------- 2. parity 行为脚本 ----------
async function parityScenario(h) {
  const out = {};
  const session = { openidHash: "parity-user-alpha", appid: "wx-test" };
  const created = h.service.createRun({
    serverSession: session,
    runtimeMode: "trial",
    requestId: "req-parity-1",
    conversationId: "conv-parity-1",
    idempotencyKey: "idem-parity-1",
  });
  out.created = projectCreated(created);

  // idempotency 唯一键：同 (principal, key) 重放既有 Run，不新建。
  const replay = h.service.createRun({ serverSession: session, runtimeMode: "trial", idempotencyKey: "idem-parity-1" });
  out.replay = projectCreated(replay);
  out.replaySameRunId = replay.runId === created.runId;

  const emitter = h.service.createEventEmitter(created.runId, "trial");
  emitter({ type: "intent.resolved", intentName: "get_today_courses" });
  emitter({ type: "tool.started", tool: "get_today_courses" });
  emitter({ type: "tool.completed", tool: "get_today_courses", durationMs: 7 });
  emitter({ type: "run.completed", status: "completed" });
  emitter({ type: "run.completed", status: "completed" }); // 终态事件幂等
  h.service.setResult(created.runId, { success: true, answer: "parity-answer", status: "completed" }, "completed");
  out.view = projectView(h.service.getRunView(created.runId, { pollToken: created.pollToken }));
  // 终态不被后续事件覆盖（状态保持 completed，事件仍可追加）。
  emitter({ type: "response.composing", providerUsed: false });
  const afterTerminal = h.service.getRunView(created.runId, { pollToken: created.pollToken });
  out.postTerminalStatus = afterTerminal.status;
  out.postTerminalLastType = afterTerminal.events[afterTerminal.events.length - 1].type;
  // afterSequence 只返回后续事件。
  out.after = projectView(h.service.getRunView(created.runId, { pollToken: created.pollToken, afterSequence: 2 }));
  // 外部 principal 无 pollToken 不可读。
  out.foreign = projectView(h.service.getRunView(created.runId, {
    serverSession: { openidHash: "parity-user-outsider", appid: "wx-test" },
  }));

  // cancel 幂等：第一次取消生效，第二次如实 alreadyFinished，事件流只有一条终态。
  const run2 = h.service.createRun({ serverSession: session, runtimeMode: "trial" });
  const cancel1 = h.service.cancelRun(run2.runId, { pollToken: run2.pollToken });
  const cancel2 = h.service.cancelRun(run2.runId, { pollToken: run2.pollToken });
  out.cancel = [cancel1, cancel2];
  out.cancelView = projectView(h.service.getRunView(run2.runId, { pollToken: run2.pollToken }));
  out.isCancelled = h.service.isCancelled(run2.runId);

  // trace 落存（脱敏链在写入前）。
  h.recorder.record({
    runId: created.runId,
    requestId: "req-parity-1",
    conversationId: "conv-parity-1",
    runtimeMode: "trial",
    intent: "get_today_courses",
    selectedSkill: "today_schedule",
    toolCalls: [{ name: "get_today_courses", status: "success" }],
    totalDurationMs: 12,
    evidenceComplete: true,
  });
  await h.flush();
  const recordedTraces = h.recorder.listForTest();
  out.traceRunIdMatches = recordedTraces.length === 1 && recordedTraces[0].runId === created.runId;
  assert.strictEqual(out.traceRunIdMatches, true, `${h.kind}: trace 必须归属创建它的 Run`);
  out.traces = recordedTraces.map((trace) => {
    const clone = Object.assign({}, trace);
    delete clone.traceId;
    delete clone.recordedAt;
    delete clone.runId; // 随机 run id：跨后端不可比（归属由 traceRunIdMatches 断言）
    return clone;
  });
  return out;
}

// ---------- 3. durable 恢复脚本（journal / pg 共用，out 跨后端可比） ----------
async function durableScenario(h) {
  const out = {};
  const session = { openidHash: "durable-user-beta", appid: "wx-test" };

  const done = h.service.createRun({ serverSession: session, runtimeMode: "trial", requestId: "req-durable-1", idempotencyKey: "idem-durable-1" });
  const doneEmitter = h.service.createEventEmitter(done.runId, "trial");
  doneEmitter({ type: "tool.started", tool: "get_teaching_week" });
  doneEmitter({ type: "run.completed", status: "completed" });
  h.service.setResult(done.runId, { success: true, answer: "durable-answer" }, "completed");

  const live = h.service.createRun({ serverSession: session, runtimeMode: "trial", requestId: "req-durable-2" });
  const liveEmitter = h.service.createEventEmitter(live.runId, "trial");
  liveEmitter({ type: "understanding.started" }); // 保持 running 直至「崩溃」

  h.recorder.record({
    runId: done.runId,
    requestId: "req-durable-1",
    conversationId: "conv-durable-1",
    runtimeMode: "trial",
    intent: "get_teaching_week",
    totalDurationMs: 5,
    evidenceComplete: true,
  });
  await h.flush();
  out.traceCountBefore = h.recorder.listForTest().length;

  await h.restart(); // 服务重启：重建 store/service/recorder 实例

  // completed Run：重启后仍可凭 pollToken 轮询（断线恢复窗口内）。
  const doneView = h.service.getRunView(done.runId, { pollToken: done.pollToken });
  out.doneAfterRestart = projectView(doneView);
  // 崩溃时 accepted/running 的 Run：恢复事件流 + 如实中断终态标记。
  const liveView = h.service.getRunView(live.runId, { pollToken: live.pollToken });
  out.liveOk = liveView.ok === true;
  out.liveStatus = liveView.status;
  const marker = (liveView.events || []).find((event) => event.type === "run.failed");
  out.markerReason = marker ? marker.reasonCode : "";
  out.liveEventsPreserved = (liveView.events || []).some((event) => event.type === "understanding.started");
  out.liveResultExposed = liveView.result === null; // failed 终态不暴露旧 result
  // 幂等键跨重放：同 (principal, key) 仍重放原 Run。
  const dup = h.service.createRun({ serverSession: session, runtimeMode: "trial", idempotencyKey: "idem-durable-1" });
  out.dupAfterRestart = dup.runId === done.runId && dup.deduplicated === true;
  // trace 跨重放可读（重启前后计数一致）。
  out.traceCountAfterRestart = h.recorder.listForTest().length;
  // cursor 续读（P6a 依赖）：store 级 afterSequence 查询。
  const storeEvents = await h.store.listEventsAfter(done.runId, 1);
  out.storeAfterTypes = storeEvents.map((event) => event.type);
  return {
    out,
    handles: {
      doneRunId: done.runId,
      donePollToken: done.pollToken,
      liveRunId: live.runId,
      livePollToken: live.pollToken,
    },
  };
}

function assertDurableOutcome(out, label) {
  assert.strictEqual(out.doneAfterRestart.ok, true, `${label}: completed Run 重启后必须可轮询`);
  assert.strictEqual(out.doneAfterRestart.status, "completed", `${label}: completed 状态必须跨重启保持`);
  assert.strictEqual(
    out.doneAfterRestart.events.filter((event) => event.type === "run.completed").length,
    1,
    `${label}: 终态事件重放后不得重复`
  );
  assert.deepStrictEqual(
    out.doneAfterRestart.events.map((event) => event.type),
    ["run.accepted", "tool.started", "run.completed"],
    `${label}: completed Run 事件流必须完整恢复`
  );
  assert.ok(out.doneAfterRestart.result && out.doneAfterRestart.result.answer === "durable-answer", `${label}: result 必须跨重启保持`);
  assert.strictEqual(out.liveOk, true, `${label}: 崩溃时 running 的 Run 必须可恢复`);
  assert.strictEqual(out.liveStatus, "failed", `${label}: 执行器丢失的 Run 必须如实终止为 failed`);
  assert.strictEqual(out.markerReason, "RUN_EXECUTOR_LOST", `${label}: 中断标记必须带 RUN_EXECUTOR_LOST`);
  assert.strictEqual(out.liveEventsPreserved, true, `${label}: 崩溃前事件流必须保留`);
  assert.strictEqual(out.liveResultExposed, true, `${label}: 中断 Run 不得伪造 result`);
  assert.strictEqual(out.dupAfterRestart, true, `${label}: 幂等键必须跨重放重放原 Run`);
  assert.ok(out.traceCountBefore > 0, `${label}: 重启前必须有 trace`);
  assert.strictEqual(out.traceCountAfterRestart, out.traceCountBefore, `${label}: trace 必须跨重放完整可读`);
  assert.deepStrictEqual(out.storeAfterTypes, ["tool.started", "run.completed"], `${label}: listEventsAfter 必须只返回 cursor 之后的事件`);
}

// ---------- 4. journal 专属 ----------
async function testJournalSpecific(baseDir) {
  const root = path.join(baseDir, "journal-main");
  const h = createHarness("journal", () => createJournalRunStore({ root }));
  const journalOut = await parityScenario(h);
  const { out: durableOut, handles } = await durableScenario(h);

  // journal 文件真实落盘。
  const stats = h.store.statsForTests();
  assert.ok(fs.existsSync(stats.journalPath), "journal.jsonl 必须存在");
  assert.ok(fs.readFileSync(stats.journalPath, "utf8").trim().length > 0, "journal 必须有记录");

  // compaction：原子 snapshot + journal 截断；重放仍正确。
  h.store.compactForTests();
  assert.ok(fs.existsSync(stats.snapshotPath), "compaction 必须产出 snapshot.json");
  const snapshot = JSON.parse(fs.readFileSync(stats.snapshotPath, "utf8"));
  assert.strictEqual(snapshot.version, 1);
  assert.ok(Array.isArray(snapshot.runs) && snapshot.runs.length >= 2, "snapshot 必须含窗口内 Run");
  assert.strictEqual(fs.readFileSync(stats.journalPath, "utf8").trim().length, 0, "compaction 后 journal 必须被截断");
  await h.restart();
  const compactedView = h.service.getRunView(handles.doneRunId, { pollToken: handles.donePollToken });
  assert.strictEqual(compactedView.ok, true, "compaction 后 completed Run 必须仍可轮询");
  assert.deepStrictEqual(
    compactedView.events.map((event) => event.type),
    ["run.accepted", "tool.started", "run.completed"],
    "compaction 后事件流必须完整"
  );

  // 尾部半行（崩溃截断）不阻断恢复。
  fs.appendFileSync(stats.journalPath, '{"v":1,"seq":99999,"kind":"run_created","run":{"runId":"broken', "utf8");
  await h.restart();
  const tailView = h.service.getRunView(handles.doneRunId, { pollToken: handles.donePollToken });
  assert.strictEqual(tailView.ok, true, "尾部半行不得阻断恢复");

  // 保留窗口：窗口外数据在 prune + compaction 后物理消失。
  const shortRoot = path.join(baseDir, "journal-short-retention");
  const short = createHarness("journal", () => createJournalRunStore({ root: shortRoot, retentionMs: 300, terminalRetentionMs: 300 }));
  const shortRun = short.service.createRun({ runtimeMode: "trial" });
  await sleep(400);
  assert.strictEqual(short.service.getRunRecord(shortRun.runId), null, "保留窗口外 Run 必须从内存投影淘汰");
  short.store.compactForTests();
  await short.restart();
  const shortView = short.service.getRunView(shortRun.runId, { pollToken: shortRun.pollToken });
  assert.strictEqual(shortView.ok, false, "保留窗口外 Run 重启后不得复活");

  // 持久化失败降级：root 指向一个已存在的文件（mkdir 必败）→ 写失败只记录，
  // 在线内存投影不受影响（与 pgRunStore 写失败降级同规）。
  const blockedRoot = path.join(baseDir, "journal-blocked-root");
  fs.writeFileSync(blockedRoot, "not-a-directory", "utf8");
  const blocked = createHarness("journal", () => createJournalRunStore({ root: blockedRoot }));
  const blockedRun = blocked.service.createRun({ runtimeMode: "trial" });
  const blockedEmitter = blocked.service.createEventEmitter(blockedRun.runId, "trial");
  blockedEmitter({ type: "run.completed", status: "completed" });
  const blockedView = blocked.service.getRunView(blockedRun.runId, { pollToken: blockedRun.pollToken });
  assert.strictEqual(blockedView.ok, true, "journal 写失败不得击落在线 Run 链");
  assert.strictEqual(blockedView.status, "completed");

  return { journalOut, durableOut, h };
}

// ---------- 5. postgres 段 ----------
async function withPgDatabase(env, fn) {
  const adminPool = createPgPool({ connectionString: env.url, max: 2 });
  const dbName = `agent_p5a_runstore_${crypto.randomBytes(5).toString("hex")}`;
  await query(adminPool, `CREATE DATABASE ${dbName}`);
  const url = new URL(env.url);
  url.pathname = `/${dbName}`;
  process.env.AGENT_PG_URL = url.toString();
  // 注意：必须在设置 AGENT_PG_URL 之后首次触达 pgPersistenceService。
  const pgPersistenceService = require("../server/src/services/ai/persistence/pgPersistenceService");
  try {
    const migrated = await pgPersistenceService.runMigrations();
    assert.ok(migrated.applied.includes(6), `空库迁移必须应用 0006，实际 [${migrated.applied.join(", ")}]`);
    await fn(pgPersistenceService.getPool(), adminPool);
  } finally {
    await pgPersistenceService.closeForTests();
    delete process.env.AGENT_PG_URL;
    await query(adminPool, `DROP DATABASE IF EXISTS ${dbName} WITH (FORCE)`);
    await closePool(adminPool);
  }
}

async function testPgSpecific(env, memoryOut, journalOut, journalDurableOut) {
  let pgOut = null;
  let pgDurableOut = null;
  await withPgDatabase(env, async (pool) => {
    // migration 0006 三表真实存在。
    for (const table of ["agent_runs", "agent_run_events", "agent_run_traces"]) {
      const reg = await query(pool, "SELECT to_regclass($1) AS reg", [table]);
      assert.ok(reg.rows[0].reg, `${table} 必须存在`);
    }

    const h = createHarness("pg", () => createPgRunStore({ pool }));
    pgOut = await parityScenario(h);
    pgDurableOut = (await durableScenario(h)).out;

    // (principal_key, idempotency_key) 唯一键：绕过服务层直插重复键 → 23505
    // （raw pool.query 保留 PG SQLSTATE；不断言陷阱：第二参用 code 谓词）。
    await pool.query(
      "INSERT INTO agent_runs (run_id, principal_key, idempotency_key, status, doc) VALUES ($1, $2, $3, $4, $5)",
      ["run-manual-1", "manual-principal", "manual-key", "queued", "{}"]
    );
    await assert.rejects(
      pool.query(
        "INSERT INTO agent_runs (run_id, principal_key, idempotency_key, status, doc) VALUES ($1, $2, $3, $4, $5)",
        ["run-manual-2", "manual-principal", "manual-key", "queued", "{}"]
      ),
      (error) => error && error.code === "23505",
      "(principal_key, idempotency_key) 唯一键必须拒绝重复"
    );
    // (run_id, sequence) 唯一键同理。
    await assert.rejects(
      pool.query(
        "INSERT INTO agent_run_events (event_id, run_id, sequence, type, public_payload) VALUES ($1, $2, $3, $4, $5)",
        ["evt-manual-dup", "run-manual-1", 1, "run.accepted", "{}"]
      ).then(() => pool.query(
        "INSERT INTO agent_run_events (event_id, run_id, sequence, type, public_payload) VALUES ($1, $2, $3, $4, $5)",
        ["evt-manual-dup-2", "run-manual-1", 1, "run.accepted", "{}"]
      )),
      (error) => error && error.code === "23505",
      "(run_id, sequence) 唯一键必须拒绝重复"
    );

    // appendEvent 与 run.status 推进同事务：落库状态必须一致（completed +
    // 全部事件行在场；同事务代码路径为 pgRunStore.onEvent 的 withTransaction）。
    const parityRunRow = await query(
      pool,
      "SELECT status, (SELECT count(*)::int FROM agent_run_events WHERE run_id = agent_runs.run_id) AS event_count " +
        "FROM agent_runs WHERE status = 'completed' ORDER BY created_at ASC LIMIT 1",
      []
    );
    assert.ok(parityRunRow.rows.length >= 1, "completed Run 必须落库");
    assert.ok(parityRunRow.rows[0].event_count >= 2, "事件行必须与 status 推进一致落库");

    // trace 落 agent_run_traces。
    const traceRows = await query(pool, "SELECT outcome, fallback FROM agent_run_traces", []);
    assert.ok(traceRows.rows.length >= 1, "trace 必须落 agent_run_traces");
    assert.strictEqual(traceRows.rows[0].outcome, "completed");

    // 保留窗口 hygiene：短窗口 store 的过期 Run 被物理删除。
    const shortStore = createPgRunStore({ pool, retentionMs: 300, terminalRetentionMs: 300 });
    const shortService = createRunEventService({ store: shortStore });
    if (shortService.persistenceReady) await shortService.persistenceReady;
    const shortRun = shortService.createRun({ runtimeMode: "trial" });
    await shortStore.whenIdle();
    await sleep(400);
    shortService.createRun({ runtimeMode: "trial" }); // 触发下一次 hygiene
    await shortStore.whenIdle();
    const expiredRows = await query(pool, "SELECT count(*)::int AS n FROM agent_runs WHERE run_id = $1", [shortRun.runId]);
    assert.strictEqual(expiredRows.rows[0].n, 0, "保留窗口外 Run 必须被 hygiene 物理删除");
    await shortStore.closeForTests();

    await h.store.closeForTests();
  });

  // 三后端 parity 深度一致。
  assert.deepStrictEqual(journalOut, memoryOut, "journal 与 memory 的 parity 结果必须一致");
  assert.deepStrictEqual(pgOut, memoryOut, "pg 与 memory 的 parity 结果必须一致");
  assert.deepStrictEqual(pgDurableOut, journalDurableOut, "pg 与 journal 的重启恢复结果必须一致");
  console.log("✓ 三后端 parity：可观测结果深度一致（含重启恢复投影）");
}

(async () => {
  testModuleSurface();

  const baseDir = fs.mkdtempSync(path.join(os.tmpdir(), "agent-p5a-run-store-"));
  let memoryOut;
  let journalOut;
  let journalDurableOut;
  try {
    // 内存后端：parity 全量；重启即丢（无持久化语义，如实验证）。
    const memoryHarness = createHarness("memory", () => createMemoryRunStore());
    memoryOut = await parityScenario(memoryHarness);
    await memoryHarness.restart();
    const gone = memoryHarness.service.getRunView("run-definitely-missing", {});
    assert.strictEqual(gone.ok, false);
    assert.strictEqual(gone.code, "RUN_NOT_FOUND", "内存后端重启即丢（逐字保持的内存语义）");
    console.log("✓ memory 后端：parity 脚本完成，重启即丢语义不变");

    // journal 后端：parity + 恢复 + compaction + 保留窗口。
    const journalResult = await testJournalSpecific(baseDir);
    journalOut = journalResult.journalOut;
    journalDurableOut = journalResult.durableOut;
    assertDurableOutcome(journalDurableOut, "journal");
    console.log("✓ journal 后端：重放恢复 / 中断标记 / compaction / 保留窗口 / 尾部半行容错");
  } finally {
    fs.rmSync(baseDir, { recursive: true, force: true });
  }

  // postgres 段（不可用则诚实标记）。
  let reason = "no PostgreSQL available";
  // P5a WS5：migration 0005 起基线镜像为 pgvector/pgvector:pg16（CREATE EXTENSION vector）。
  const env = await ensurePg({ image: "pgvector/pgvector:pg16", onReason: (text) => {
    reason = text;
  } });
  if (!env) {
    console.log(`\ntest-agent-p5a-run-store: memory+journal PASS; postgres UNVERIFIED (${reason})`);
    process.exit(0);
  }
  console.log(`pg-test-env: ${env.owned ? `docker container ${env.containerName}` : "external AGENT_TEST_PG_URL"} (${redactUrl(env.url)})`);
  try {
    await testPgSpecific(env, memoryOut, journalOut, journalDurableOut);
  } finally {
    await env.cleanup();
  }
  console.log("✓ postgres 后端：migration 0006 / 唯一键 / 同事务推进 / 恢复 / hygiene");

  console.log("\ntest-agent-p5a-run-store: PASS");
})().catch((error) => {
  console.error(error && error.stack || error);
  process.exit(1);
});
