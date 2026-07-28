#!/usr/bin/env node
// M6-T4：轻量 Durable Execution 层契约测试。
// 1) 生命周期全态：pending → waiting → resumed → done / expired（含非法流转拒绝、过期不得复活）。
// 2) 跨进程重启可 resume：子进程登记 → 本进程新 store 实例 resume → 另一子进程读回状态。
// 3) resume 鉴权链：token 错误 / 过期 / principal 不符 / 无 principal 逐项拒绝。
// 4) 端点：POST /api/ai/agent/durable/resume 链上挂 requireSessionGuard，无会话拒绝。
// 5) 提醒 receipt_wait 接线红绿：chat 派生 pendingAction 自动登记 → 回执接受置 done；
//    伪造回执（M5 拒绝）任务保持 waiting；durable 存储故障不影响 chat 主链。
const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawnSync } = require("child_process");

const ROOT = path.resolve(__dirname, "..");
const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "fosu-durable-exec-"));
process.env.NODE_ENV = "test";
process.env.AI_RUNTIME_MODE = "public";
process.env.AI_AGENT_ENABLED = "false";
process.env.FOSU_DATA_DIR = path.join(tempDir, "data");
process.env.FOSU_AI_DURABLE_STORE_PATH = path.join(tempDir, "durable-tasks.json");
process.env.FOSU_AGENT_REMINDER_SECRET = "test-durable-reminder-secret-32b";
process.env.FOSU_AGENT_MEMORY_SECRET = "test-durable-memory-secret-32b";

let pass = 0;
let fail = 0;
async function check(name, fn) {
  try {
    await fn();
    pass++;
    console.log("PASS " + name);
  } catch (e) {
    fail++;
    console.log("FAIL " + name + " :: " + e.message);
  }
}

function findRouteLayer(router, method, routePath) {
  const layer = (router.stack || []).find((item) => item && item.route
    && item.route.path === routePath
    && item.route.methods && item.route.methods[method]);
  assert.ok(layer, `route ${method} ${routePath} must exist`);
  return layer;
}

function makeMockRes() {
  return {
    statusCode: 200,
    payload: null,
    headers: {},
    setHeader(key, value) { this.headers[key] = value; },
    status(code) { this.statusCode = code; return this; },
    json(payload) { this.payload = payload; return this; },
    send(payload) { this.payload = payload; return this; },
  };
}

function expectErrorCode(fn, code) {
  try {
    fn();
  } catch (error) {
    assert.strictEqual(error.code, code, `期望错误码 ${code}，实际 ${error.code}（${error.message}）`);
    return error;
  }
  assert.fail(`期望抛出 ${code}，实际未抛错`);
}

const principalA = { principalType: "wechat", principalKey: "test-durable-principal-a", authenticated: true };
const principalB = { principalType: "wechat", principalKey: "test-durable-principal-b", authenticated: true };
const anonymousPrincipal = { principalType: "anonymous", principalKey: "", authenticated: false };

const serverSession = {
  openidHash: "durable-exec-openid-hash",
  sessionIdHash: "durable-exec-session-hash",
  appid: "wx-test",
};

async function runChecks() {
  const {
    DurableTaskStore,
    defaultDurableTaskStore,
    hashToken,
    publicTaskView,
  } = require("../server/src/services/ai/durable/taskStore");
  const {
    armWaitTask,
    createWaitTask,
    registerWaitEvent,
  } = require("../server/src/services/ai/durable/waitForEvent");
  const {
    completeDurableTask,
    completeReminderReceiptWait,
    resumeDurableTask,
    sweepExpiredTasks,
  } = require("../server/src/services/ai/durable/resume");

  defaultDurableTaskStore.clearAll();

  // ---------- A. 生命周期全态 ----------
  await check("生命周期：create → pending，token 只存哈希不落明文", () => {
    const created = createWaitTask({
      kind: "approval",
      waitEvent: "approval_decision",
      principal: principalA,
      expiresAt: Date.now() + 60000,
      context: { approvalId: "appr-1", scope: "kb_publish" },
    });
    assert.ok(created.task.taskId.startsWith("dt_"), "taskId 需带 dt_ 前缀");
    assert.strictEqual(created.task.status, "pending");
    assert.ok(/^[A-Za-z0-9_-]{32}$/.test(created.resumeToken), "resumeToken 需为 32 位 base64url（crypto.randomBytes）");
    const raw = fs.readFileSync(process.env.FOSU_AI_DURABLE_STORE_PATH, "utf8");
    assert.ok(raw.indexOf(created.resumeToken) < 0, "存储文件不得出现 resumeToken 明文");
    assert.ok(raw.indexOf(hashToken(created.resumeToken)) >= 0, "存储文件应只出现 token 哈希");
    assert.ok(raw.indexOf(principalA.principalKey) < 0, "存储文件不得出现 principalKey 明文");
    const view = publicTaskView(created.task);
    assert.strictEqual(view.resumeTokenHash, undefined, "对外视图不得携带 token 哈希");
    assert.strictEqual(view.principalKeyHash, undefined, "对外视图不得携带 principal 哈希");
  });

  await check("生命周期：pending 不可直接 resume（STATUS_CONFLICT），arm 后 waiting", () => {
    const created = createWaitTask({
      kind: "approval",
      waitEvent: "approval_decision",
      principal: principalA,
      expiresAt: Date.now() + 60000,
      context: { approvalId: "appr-2" },
    });
    expectErrorCode(
      () => resumeDurableTask({ resumeToken: created.resumeToken, principal: principalA }),
      "DURABLE_STATUS_CONFLICT"
    );
    const armed = armWaitTask(created.task.taskId);
    assert.strictEqual(armed.status, "waiting");
  });

  await check("生命周期：waiting → resumed → done 全链路，resumeCount 递增", () => {
    const registered = registerWaitEvent({
      kind: "receipt_wait",
      waitEvent: "generic_event",
      principal: principalA,
      expiresAt: Date.now() + 60000,
      context: { eventKey: "evt-1", step: 2 },
    });
    assert.strictEqual(registered.task.status, "waiting");
    const resumed = resumeDurableTask({ resumeToken: registered.resumeToken, principal: principalA });
    assert.strictEqual(resumed.task.status, "resumed");
    assert.deepStrictEqual(resumed.context, { eventKey: "evt-1", step: 2 }, "resume 须返回任务上下文供续跑");
    assert.strictEqual(defaultDurableTaskStore.get(resumed.task.taskId).resumeCount, 1);
    const done = completeDurableTask({ taskId: resumed.task.taskId, principal: principalA, note: "event-observed" });
    assert.strictEqual(done.status, "done");
    assert.ok(done.completedAt, "done 须记录 completedAt");
  });

  await check("生命周期：终态不可逆（resumed/done 不得重复 resume 或重复 done）", () => {
    const registered = registerWaitEvent({
      kind: "approval",
      waitEvent: "approval_decision",
      principal: principalA,
      expiresAt: Date.now() + 60000,
      context: { approvalId: "appr-3" },
    });
    resumeDurableTask({ resumeToken: registered.resumeToken, principal: principalA });
    expectErrorCode(
      () => resumeDurableTask({ resumeToken: registered.resumeToken, principal: principalA }),
      "DURABLE_STATUS_CONFLICT"
    );
    const done = completeDurableTask({ taskId: registered.task.taskId, principal: principalA });
    expectErrorCode(
      () => completeDurableTask({ taskId: done.taskId, principal: principalA }),
      "DURABLE_STATUS_CONFLICT"
    );
    expectErrorCode(() => armWaitTask(done.taskId), "DURABLE_STATUS_CONFLICT");
  });

  await check("生命周期：过期任务只能转 expired，不得复活", () => {
    expectErrorCode(() => registerWaitEvent({
      kind: "approval",
      waitEvent: "approval_decision",
      principal: principalA,
      expiresAt: Date.now() - 1000,
      context: {},
    }), "DURABLE_EXPIRES_AT_INVALID");
    const tokenHashOwner = createWaitTask({
      kind: "approval",
      waitEvent: "approval_decision",
      principal: principalA,
      expiresAt: Date.now() + 60000,
      context: { approvalId: "appr-exp" },
    });
    // 直接把 expiresAt 改到过去（等价于等待期间超时），随后任何流转只能落 expired。
    const storePath = process.env.FOSU_AI_DURABLE_STORE_PATH;
    const data = JSON.parse(fs.readFileSync(storePath, "utf8"));
    data.tasks[tokenHashOwner.task.taskId].expiresAt = Date.now() - 10;
    fs.writeFileSync(storePath, JSON.stringify(data));
    expectErrorCode(
      () => resumeDurableTask({ resumeToken: tokenHashOwner.resumeToken, principal: principalA }),
      "DURABLE_TASK_EXPIRED"
    );
    assert.strictEqual(defaultDurableTaskStore.get(tokenHashOwner.task.taskId).status, "expired", "过期翻转必须落盘");
    expectErrorCode(
      () => resumeDurableTask({ resumeToken: tokenHashOwner.resumeToken, principal: principalA }),
      "DURABLE_TASK_EXPIRED"
    );
    expectErrorCode(
      () => completeDurableTask({ taskId: tokenHashOwner.task.taskId, principal: principalA }),
      "DURABLE_TASK_EXPIRED"
    );
  });

  await check("生命周期：sweepExpired 只翻转已过期非终态任务", () => {
    const store = new DurableTaskStore({ storePath: path.join(tempDir, "sweep.json") });
    store.create({
      kind: "reminder", waitEvent: "reminder_fire", principalKey: principalA.principalKey,
      expiresAt: Date.now() - 5, resumeTokenHash: "a".repeat(64), context: {},
    });
    store.create({
      kind: "reminder", waitEvent: "reminder_fire", principalKey: principalA.principalKey,
      expiresAt: Date.now() + 60000, resumeTokenHash: "b".repeat(64), context: {},
    });
    assert.strictEqual(store.sweepExpired(), 1);
    const tasks = store.list();
    assert.strictEqual(tasks.filter((task) => task.status === "expired").length, 1);
    assert.strictEqual(tasks.filter((task) => task.status === "pending").length, 1);
  });

  // ---------- B. 鉴权链拒绝项 ----------
  await check("鉴权：token 错误 / 形态非法 / 未知 taskId 逐项拒绝", () => {
    const registered = registerWaitEvent({
      kind: "approval",
      waitEvent: "approval_decision",
      principal: principalA,
      expiresAt: Date.now() + 60000,
      context: { approvalId: "appr-auth" },
    });
    expectErrorCode(
      () => resumeDurableTask({ resumeToken: "forged-token-forged-token-12", principal: principalA }),
      "DURABLE_TOKEN_INVALID"
    );
    expectErrorCode(
      () => resumeDurableTask({ resumeToken: "short", principal: principalA }),
      "DURABLE_TOKEN_INVALID"
    );
    expectErrorCode(
      () => resumeDurableTask({ taskId: "dt_never_existed", resumeToken: registered.resumeToken, principal: principalA }),
      "DURABLE_TASK_NOT_FOUND"
    );
    expectErrorCode(
      () => resumeDurableTask({ taskId: registered.task.taskId, resumeToken: "forged-token-forged-token-12", principal: principalA }),
      "DURABLE_TOKEN_INVALID"
    );
  });

  await check("鉴权：principal 不符拒绝，匿名 principal 拒绝", () => {
    const registered = registerWaitEvent({
      kind: "approval",
      waitEvent: "approval_decision",
      principal: principalA,
      expiresAt: Date.now() + 60000,
      context: { approvalId: "appr-principal" },
    });
    expectErrorCode(
      () => resumeDurableTask({ resumeToken: registered.resumeToken, principal: principalB }),
      "DURABLE_PRINCIPAL_MISMATCH"
    );
    expectErrorCode(
      () => resumeDurableTask({ resumeToken: registered.resumeToken, principal: anonymousPrincipal }),
      "PRINCIPAL_REQUIRED"
    );
    expectErrorCode(
      () => resumeDurableTask({ resumeToken: registered.resumeToken, principal: null }),
      "PRINCIPAL_REQUIRED"
    );
  });

  await check("登记：kind/waitEvent/expiresAt/principal 非法逐项拒绝", () => {
    expectErrorCode(() => registerWaitEvent({
      kind: "workflow", waitEvent: "x", principal: principalA, expiresAt: Date.now() + 1000,
    }), "DURABLE_KIND_INVALID");
    expectErrorCode(() => registerWaitEvent({
      kind: "approval", waitEvent: "", principal: principalA, expiresAt: Date.now() + 1000,
    }), "DURABLE_WAIT_EVENT_REQUIRED");
    expectErrorCode(() => registerWaitEvent({
      kind: "approval", waitEvent: "x", principal: principalA,
    }), "DURABLE_EXPIRES_AT_INVALID");
    expectErrorCode(() => registerWaitEvent({
      kind: "approval", waitEvent: "x", principal: anonymousPrincipal, expiresAt: Date.now() + 1000,
    }), "PRINCIPAL_REQUIRED");
    const first = registerWaitEvent({
      kind: "approval", waitEvent: "approval_decision", principal: principalA, expiresAt: Date.now() + 60000,
    });
    const second = registerWaitEvent({
      kind: "approval", waitEvent: "approval_decision", principal: principalA, expiresAt: Date.now() + 60000,
    });
    assert.notStrictEqual(first.resumeToken, second.resumeToken, "resumeToken 必须每次随机不可猜测");
  });

  // ---------- C. 跨进程重启可 resume ----------
  await check("跨进程：子进程登记 → 新 store 实例 resume → 另一子进程读回 resumed", () => {
    const crossPath = path.join(tempDir, "cross-process.json");
    const registerChild = path.join(tempDir, "durable-register-child.js");
    const statusChild = path.join(tempDir, "durable-status-child.js");
    fs.writeFileSync(registerChild, `
const path = require("path");
const root = process.env.FOSU_TEST_ROOT;
const { registerWaitEvent } = require(path.join(root, "server/src/services/ai/durable/waitForEvent.js"));
const result = registerWaitEvent({
  kind: "receipt_wait",
  waitEvent: "action_receipt",
  principal: { principalType: "wechat", principalKey: process.env.FOSU_TEST_PRINCIPAL_KEY, authenticated: true },
  expiresAt: Date.now() + 60000,
  context: { command: "createCourseReminder", runId: "run-cross-1", detailId: "cross-detail-1" },
});
process.stdout.write(JSON.stringify({ taskId: result.task.taskId, status: result.task.status, resumeToken: result.resumeToken }));
`);
    fs.writeFileSync(statusChild, `
const path = require("path");
const root = process.env.FOSU_TEST_ROOT;
const { DurableTaskStore } = require(path.join(root, "server/src/services/ai/durable/taskStore.js"));
const store = new DurableTaskStore({ storePath: process.env.FOSU_TEST_STORE });
const task = store.get(process.env.FOSU_TEST_TASK_ID);
process.stdout.write(JSON.stringify({ status: task && task.status, resumeCount: task && task.resumeCount }));
`);
    const childEnv = Object.assign({}, process.env, {
      FOSU_TEST_ROOT: ROOT,
      FOSU_TEST_STORE: crossPath,
      FOSU_AI_DURABLE_STORE_PATH: crossPath,
      FOSU_TEST_PRINCIPAL_KEY: principalA.principalKey,
    });
    const registerResult = spawnSync(process.execPath, [registerChild], { cwd: ROOT, encoding: "utf8", env: childEnv });
    assert.strictEqual(registerResult.status, 0, `登记子进程失败：${registerResult.stderr}`);
    const registered = JSON.parse(registerResult.stdout);
    assert.strictEqual(registered.status, "waiting");

    // 模拟进程重启后的恢复方：本进程内全新 store 实例（同一存储文件）。
    const crossStore = new DurableTaskStore({ storePath: crossPath });
    const resumed = resumeDurableTask({ resumeToken: registered.resumeToken, principal: principalA }, crossStore);
    assert.strictEqual(resumed.task.status, "resumed", "跨进程凭 token+principal 必须可 resume");
    assert.deepStrictEqual(resumed.context, {
      command: "createCourseReminder", runId: "run-cross-1", detailId: "cross-detail-1",
    });

    const statusResult = spawnSync(process.execPath, [statusChild], {
      cwd: ROOT,
      encoding: "utf8",
      env: Object.assign({}, childEnv, { FOSU_TEST_TASK_ID: registered.taskId }),
    });
    assert.strictEqual(statusResult.status, 0, `状态子进程失败：${statusResult.stderr}`);
    const observed = JSON.parse(statusResult.stdout);
    assert.strictEqual(observed.status, "resumed", "resumed 状态必须跨进程持久");
    assert.strictEqual(observed.resumeCount, 1);
    const raw = fs.readFileSync(crossPath, "utf8");
    assert.ok(raw.indexOf(registered.resumeToken) < 0, "跨进程存储同样不得落 token 明文");
  });

  // ---------- D. resume 端点 ----------
  const aiRouter = require("../server/src/routes/ai");
  const runtimeModeService = require("../server/src/services/ai/runtimeModeService");
  const { resolvePrincipal } = require("../server/src/services/ai/conversation/conversationPrincipalService");

  function endpointPrincipal(req) {
    const decision = runtimeModeService.resolveRuntimeMode({
      context: { envVersion: "", miniprogramVersion: "" },
      serverSession: req.fosuSession || null,
    });
    return resolvePrincipal({ serverSession: req.fosuSession, runtimeMode: decision.runtimeMode });
  }

  await check("端点：POST /agent/durable/resume 存在且链上挂 requireSessionGuard", () => {
    const layer = findRouteLayer(aiRouter, "post", "/agent/durable/resume");
    const stack = layer.route.stack || [];
    const guardIndex = stack.findIndex((entry) => entry && entry.handle && entry.handle.name === "requireSessionGuard");
    assert.ok(guardIndex >= 0 && guardIndex < stack.length - 1, "requireSessionGuard 必须在最终 handler 之前");
  });

  await check("端点：无有效会话不得 resume（PRINCIPAL_REQUIRED 401）", () => {
    const layer = findRouteLayer(aiRouter, "post", "/agent/durable/resume");
    const handler = layer.route.stack[layer.route.stack.length - 1].handle;
    const req = { body: { resumeToken: "any-token-any-token-any-12" }, headers: {}, query: {}, fosuSession: null };
    const res = makeMockRes();
    handler(req, res);
    assert.strictEqual(res.statusCode, 401);
    assert.strictEqual(res.payload.code, "PRINCIPAL_REQUIRED");
  });

  await check("端点：合法 token+会话 resume 成功，响应不含 token/哈希", () => {
    const req = { body: {}, headers: {}, query: {}, fosuSession: serverSession };
    const principal = endpointPrincipal(req);
    assert.strictEqual(principal.authenticated, true, "测试会话必须可派生已认证 principal");
    const registered = registerWaitEvent({
      kind: "approval",
      waitEvent: "approval_decision",
      principal,
      expiresAt: Date.now() + 60000,
      context: { approvalId: "appr-endpoint", scope: "kb_publish" },
    });
    const layer = findRouteLayer(aiRouter, "post", "/agent/durable/resume");
    const handler = layer.route.stack[layer.route.stack.length - 1].handle;
    const resumeReq = {
      body: { taskId: registered.task.taskId, resumeToken: registered.resumeToken },
      headers: {},
      query: {},
      fosuSession: serverSession,
    };
    const res = makeMockRes();
    handler(resumeReq, res);
    assert.strictEqual(res.statusCode, 200, JSON.stringify(res.payload));
    assert.strictEqual(res.payload.success, true);
    assert.strictEqual(res.payload.task.status, "resumed");
    assert.strictEqual(res.payload.task.kind, "approval");
    const serialized = JSON.stringify(res.payload);
    assert.ok(serialized.indexOf(registered.resumeToken) < 0, "端点响应不得回传 resumeToken");
    assert.ok(serialized.indexOf("resumeTokenHash") < 0 && serialized.indexOf("principalKeyHash") < 0, "端点响应不得回传哈希");
  });

  await check("端点：token 错误经 handleDurableError 映射 403", () => {
    const layer = findRouteLayer(aiRouter, "post", "/agent/durable/resume");
    const handler = layer.route.stack[layer.route.stack.length - 1].handle;
    const req = {
      body: { resumeToken: "forged-token-forged-token-12" },
      headers: {},
      query: {},
      fosuSession: serverSession,
    };
    const res = makeMockRes();
    handler(req, res);
    assert.strictEqual(res.statusCode, 403);
    assert.strictEqual(res.payload.code, "DURABLE_TOKEN_INVALID");
  });

  // ---------- E. 提醒 receipt_wait 接线（红绿） ----------
  const { defaultCourseReminderService } = require("../server/src/services/ai/reminders/courseReminderService");
  const receiptLayer = findRouteLayer(aiRouter, "post", "/agent/action-receipts");
  const receiptHandler = receiptLayer.route.stack[receiptLayer.route.stack.length - 1].handle;
  const reminderPrincipal = resolvePrincipal({ serverSession, runtimeMode: "public" });

  function postReceipt(body) {
    const req = { body, headers: {}, query: {}, fosuSession: serverSession };
    const res = makeMockRes();
    receiptHandler(req, res);
    return res;
  }

  function chatContext() {
    return {
      timezone: "Asia/Shanghai",
      todayDate: "2026-07-22",
      todayWeekday: 3,
      currentTeachingWeek: 20,
      clientTimestampMs: Date.parse("2026-07-22T04:00:00.000Z"),
      currentScheduleSummary: {
        enabled: true,
        fingerprint: "durable-receipt-fingerprint",
        courses: [{
          courseName: "动物解剖学",
          teacherName: "张老师",
          classroom: "B8-203",
          campus: "仙溪校区",
          weekday: 4,
          startSection: 6,
          endSection: 7,
          weeks: [20, 21],
        }],
      },
      userPreferences: { defaultReminderLeadMinutes: 20 },
    };
  }

  function findReminderWaitTask(runId) {
    return defaultDurableTaskStore.list({ kind: "receipt_wait", waitEvent: "action_receipt" })
      .find((task) => task.context && task.context.runId === runId) || null;
  }

  await check("接线绿：chat 派生提醒 pendingAction → 自动登记 receipt_wait durable 任务", async () => {
    defaultDurableTaskStore.clearAll();
    const agentService = require("../server/src/services/ai/agentService");
    const response = await agentService.chat({
      message: "以后上课前20分钟提醒我",
      conversationId: "conv-durable-wiring-green",
      protocolVersion: "agent.v2",
      runtimeMode: "public",
      context: chatContext(),
      serverSession,
    });
    assert.strictEqual(response.success, true);
    const pendingAction = response.workingMemory && response.workingMemory.pendingAction;
    assert.ok(pendingAction, "M5 派生 pendingAction 必须仍在（接线不改写语义）");
    assert.strictEqual(pendingAction.command, "createCourseReminder");
    assert.ok(JSON.stringify(response).indexOf("resumeToken") < 0, "chat 响应不得携带 resumeToken");
    const task = findReminderWaitTask(response.runId);
    assert.ok(task, "chat 必须登记对应 receipt_wait durable 任务");
    assert.strictEqual(task.status, "waiting");
    assert.strictEqual(task.context.command, "createCourseReminder");
    assert.strictEqual(task.context.detailId, pendingAction.target.detailId);
    assert.strictEqual(task.expiresAt, pendingAction.expiresAt, "durable 任务过期时间与 pendingAction 一致");

    // 红：伪造回执被 M5 拒绝（目标未落库）→ durable 任务保持 waiting。
    const forged = postReceipt({
      command: "createCourseReminder",
      status: "success",
      runId: response.runId,
      conversationId: "conv-durable-wiring-green",
      appliedTarget: { type: "reminder", detailId: "forged-detail-never-created", name: "课程提醒" },
      memoryMode: "local_only",
    });
    assert.strictEqual(forged.statusCode, 409, "M5 防伪造语义必须保持不变");
    assert.strictEqual(findReminderWaitTask(response.runId).status, "waiting", "伪造回执不得置 done");

    // 绿：服务端真实写入 + 合法回执 → 任务置 done。
    const reminderCard = (response.cards || []).find((card) => card.type === "reminder");
    const confirmAction = (reminderCard.actions || []).find((action) => action.type === "confirmReminder");
    const cardKey = confirmAction.payload.idempotencyKey;
    const created = defaultCourseReminderService.create({
      principal: reminderPrincipal,
      confirmationToken: confirmAction.payload.confirmationProof,
      idempotencyKey: cardKey,
      subscriptionStatus: "reject",
    });
    assert.strictEqual(created.success, true);
    const accepted = postReceipt({
      command: "createCourseReminder",
      status: "success",
      runId: response.runId,
      conversationId: "conv-durable-wiring-green",
      appliedTarget: { type: "reminder", detailId: cardKey, name: "课程提醒（提前20分钟）" },
      memoryMode: "local_only",
      cloudSyncEnabled: false,
    });
    assert.strictEqual(accepted.statusCode, 200);
    assert.strictEqual(accepted.payload.success, true);
    const doneTask = findReminderWaitTask(response.runId);
    assert.strictEqual(doneTask.status, "done", "回执被接受后 durable 任务必须置 done");
    assert.ok(doneTask.completedAt, "done 必须记录完成时间");
  });

  await check("接线：回执失败（status=failed）不置 done，任务等待至过期", async () => {
    const agentService = require("../server/src/services/ai/agentService");
    const response = await agentService.chat({
      message: "以后上课前20分钟提醒我",
      conversationId: "conv-durable-wiring-failed",
      protocolVersion: "agent.v2",
      runtimeMode: "public",
      context: chatContext(),
      serverSession,
    });
    assert.strictEqual(response.success, true);
    const task = findReminderWaitTask(response.runId);
    assert.ok(task && task.status === "waiting");
    const failed = postReceipt({
      command: "createCourseReminder",
      status: "failed",
      errorCode: "CLIENT_EXCEPTION",
      runId: response.runId,
      conversationId: "conv-durable-wiring-failed",
      appliedTarget: { type: "reminder", detailId: task.context.detailId, name: "课程提醒" },
      memoryMode: "local_only",
    });
    assert.strictEqual(failed.statusCode, 200);
    assert.strictEqual(failed.payload.reason, "ACTION_FAILED", "M5 失败回执语义不变");
    assert.strictEqual(findReminderWaitTask(response.runId).status, "waiting", "失败回执不得置 done");
  });

  await check("接线：durable 存储故障不影响 chat 主链（best-effort 兜底）", async () => {
    const blockerFile = path.join(tempDir, "blocker-file");
    fs.writeFileSync(blockerFile, "not-a-directory");
    const originalPath = process.env.FOSU_AI_DURABLE_STORE_PATH;
    process.env.FOSU_AI_DURABLE_STORE_PATH = path.join(blockerFile, "child.json");
    try {
      const agentService = require("../server/src/services/ai/agentService");
      const response = await agentService.chat({
        message: "以后上课前20分钟提醒我",
        conversationId: "conv-durable-wiring-broken",
        protocolVersion: "agent.v2",
        runtimeMode: "public",
        context: chatContext(),
        serverSession,
      });
      assert.strictEqual(response.success, true, "durable 存储故障时 chat 必须仍成功");
      const pendingAction = response.workingMemory && response.workingMemory.pendingAction;
      assert.ok(pendingAction && pendingAction.command === "createCourseReminder", "pendingAction 派生不受 durable 故障影响");
    } finally {
      process.env.FOSU_AI_DURABLE_STORE_PATH = originalPath;
    }
  });

  await check("接线：completeReminderReceiptWait 找不到任务时静默返回（不破坏回执链）", () => {
    const result = completeReminderReceiptWait({
      principal: reminderPrincipal,
      command: "createCourseReminder",
      runId: "run-never-registered",
      detailId: "detail-never-registered",
    });
    assert.strictEqual(result.completed, false);
    assert.strictEqual(result.reason, "DURABLE_TASK_NOT_FOUND");
    const noPrincipal = completeReminderReceiptWait({
      principal: anonymousPrincipal, command: "createCourseReminder", runId: "r", detailId: "d",
    });
    assert.strictEqual(noPrincipal.completed, false);
    sweepExpiredTasks();
  });
}

async function main() {
  try {
    await runChecks();
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
  console.log("---");
  console.log("pass=" + pass + " fail=" + fail);
  process.exit(fail ? 1 : 0);
}

main().catch((error) => {
  fs.rmSync(tempDir, { recursive: true, force: true });
  console.error(error && error.stack || error);
  process.exit(1);
});
