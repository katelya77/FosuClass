#!/usr/bin/env node
// M5-T3b：提醒 ActionReceipt 闭环验证。
// 1) 端点单测：提醒类命令接受 / 未知命令仍 400 / 目标达成态校验（create 落库、delete 不存在）。
// 2) commitActionReceipt 四重校验（command/runId/target/过期 + principal）对提醒命令逐项生效。
// 3) 全链闭环：提醒消息 → chat 派生 pendingAction + 确认卡 → 服务端写入 → 客户端执行 →
//    receipt 回传 → 端点接受 → cloud_sync 四重校验提交。
// 4) 客户端绑定：mock 页面执行提醒卡 → receipt 载荷符合契约；回传失败不标「已创建」。
const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "fosu-reminder-receipt-"));
process.env.NODE_ENV = "test";
process.env.AI_RUNTIME_MODE = "public";
process.env.AI_AGENT_ENABLED = "false";
process.env.FOSU_DATA_DIR = tempDir;
process.env.FOSU_AGENT_REMINDER_SECRET = "test-reminder-receipt-secret-32b";
process.env.FOSU_AGENT_MEMORY_SECRET = "test-reminder-receipt-memory-32b";

const mockEnv = require("./mock-env");
mockEnv.clearStorage();

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

function findRouteHandler(router, method, routePath) {
  const layer = (router.stack || []).find((item) => item && item.route
    && item.route.path === routePath
    && item.route.methods && item.route.methods[method]);
  assert.ok(layer, `route ${method} ${routePath} must exist`);
  const stack = layer.route.stack || [];
  return stack[stack.length - 1].handle;
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

const serverSession = {
  openidHash: "reminder-receipt-openid-hash",
  sessionIdHash: "reminder-receipt-session-hash",
  appid: "wx-test",
};

async function runChecks() {
  const actionCommandContract = require("../server/src/services/ai/actionCommandContract");
  const { MemoryController } = require("../server/src/services/ai/memory/memoryController");
  const wm = require("../server/src/services/ai/memory/workingMemory");
  const { defaultCourseReminderService } = require("../server/src/services/ai/reminders/courseReminderService");
  const { resolvePrincipal } = require("../server/src/services/ai/conversation/conversationPrincipalService");
  const aiRouter = require("../server/src/routes/ai");
  const receiptHandler = findRouteHandler(aiRouter, "post", "/agent/action-receipts");
  const principal = resolvePrincipal({ serverSession, runtimeMode: "public" });

  function postReceipt(body) {
    const req = { body, headers: {}, query: {}, fosuSession: serverSession };
    const res = makeMockRes();
    receiptHandler(req, res);
    return res;
  }

  function createReminderViaService(idempotencyKey) {
    const confirmation = defaultCourseReminderService.createConfirmation({
      principal,
      operation: "create",
      payload: {
        success: true,
        operation: "create",
        requiresConfirmation: true,
        scope: "all_courses",
        leadMinutes: 20,
        recurrence: "weekly",
        courseTemplates: [],
      },
      idempotencyKey,
    });
    return defaultCourseReminderService.create({
      principal,
      confirmationToken: confirmation.token,
      idempotencyKey,
      subscriptionStatus: "reject",
    });
  }

  // ---------- 契约对齐 ----------
  await check("契约：createCourseReminder/deleteReminder 已定义且 receiptRequired", () => {
    const createDef = actionCommandContract.getActionDefinition("createCourseReminder");
    const deleteDef = actionCommandContract.getActionDefinition("deleteReminder");
    assert.strictEqual(createDef && createDef.receiptRequired, true);
    assert.strictEqual(deleteDef && deleteDef.receiptRequired, true);
    assert.strictEqual(actionCommandContract.isCommandKnown("deleteAllData"), false);
  });

  // ---------- 端点单测 ----------
  await check("端点：未知 command 仍 400 COMMAND_UNKNOWN", () => {
    const res = postReceipt({
      command: "deleteAllData",
      status: "success",
      runId: "run-x",
      conversationId: "conv-x",
      appliedTarget: { type: "reminder", detailId: "k", name: "课程提醒" },
      memoryMode: "local_only",
    });
    assert.strictEqual(res.statusCode, 400);
    assert.strictEqual(res.payload.code, "COMMAND_UNKNOWN");
  });

  await check("端点：createCourseReminder 提醒已落库 → 接受（local_only）", () => {
    createReminderViaService("endpoint-key-accept-1");
    const res = postReceipt({
      command: "createCourseReminder",
      status: "success",
      runId: "run-endpoint-1",
      conversationId: "conv-endpoint-1",
      appliedTarget: { type: "reminder", detailId: "endpoint-key-accept-1", name: "课程提醒（提前20分钟）" },
      memoryMode: "local_only",
      cloudSyncEnabled: false,
    });
    assert.strictEqual(res.statusCode, 200);
    assert.strictEqual(res.payload.success, true);
    assert.strictEqual(res.payload.committed, false);
    assert.strictEqual(res.payload.reason, "LOCAL_ONLY_NO_PERSIST");
  });

  await check("端点：createCourseReminder 提醒未落库 → 409 REMINDER_TARGET_NOT_FOUND（防伪造）", () => {
    const res = postReceipt({
      command: "createCourseReminder",
      status: "success",
      runId: "run-endpoint-2",
      conversationId: "conv-endpoint-1",
      appliedTarget: { type: "reminder", detailId: "endpoint-key-missing", name: "课程提醒" },
      memoryMode: "local_only",
    });
    assert.strictEqual(res.statusCode, 409);
    assert.strictEqual(res.payload.code, "REMINDER_TARGET_NOT_FOUND");
  });

  await check("端点：deleteReminder 目标仍存在 → 409 REMINDER_TARGET_STILL_EXISTS", () => {
    const created = createReminderViaService("endpoint-key-delete-1");
    const res = postReceipt({
      command: "deleteReminder",
      status: "success",
      runId: "run-endpoint-3",
      conversationId: "conv-endpoint-1",
      appliedTarget: { type: "reminder", detailId: created.reminder.id, name: "课程提醒" },
      memoryMode: "local_only",
    });
    assert.strictEqual(res.statusCode, 409);
    assert.strictEqual(res.payload.code, "REMINDER_TARGET_STILL_EXISTS");
  });

  await check("端点：deleteReminder 目标已不存在 → 接受（幂等删除达成态）", () => {
    const res = postReceipt({
      command: "deleteReminder",
      status: "success",
      runId: "run-endpoint-4",
      conversationId: "conv-endpoint-1",
      appliedTarget: { type: "reminder", detailId: "rem_never_existed", name: "课程提醒" },
      memoryMode: "local_only",
    });
    assert.strictEqual(res.statusCode, 200);
    assert.strictEqual(res.payload.success, true);
  });

  await check("端点：提醒命令缺 detailId/name → 400 TARGET_MISSING", () => {
    const res = postReceipt({
      command: "createCourseReminder",
      status: "success",
      runId: "run-endpoint-5",
      conversationId: "conv-endpoint-1",
      appliedTarget: { type: "reminder", detailId: "", name: "" },
      memoryMode: "local_only",
    });
    assert.strictEqual(res.statusCode, 400);
    assert.strictEqual(res.payload.code, "TARGET_MISSING");
  });

  await check("端点：提醒命令 status=failed → 记录但不提交（ACTION_FAILED）", () => {
    const res = postReceipt({
      command: "createCourseReminder",
      status: "failed",
      errorCode: "CLIENT_EXCEPTION",
      runId: "run-endpoint-6",
      conversationId: "conv-endpoint-1",
      appliedTarget: { type: "reminder", detailId: "endpoint-key-accept-1", name: "课程提醒" },
      memoryMode: "local_only",
    });
    assert.strictEqual(res.statusCode, 200);
    assert.strictEqual(res.payload.success, true);
    assert.strictEqual(res.payload.committed, false);
    assert.strictEqual(res.payload.reason, "ACTION_FAILED");
  });

  // ---------- commitActionReceipt 四重校验对提醒命令逐项生效 ----------
  function makeCloudState(pendingAction) {
    return {
      memoryPolicy: { mode: "cloud_sync", cloudSyncEnabled: true },
      workingMemory: {
        currentScheduleTarget: { type: "class", detailId: "keep-class-1", name: "24动物医学1班", term: "2025-2026-2" },
        pendingAction,
      },
      contextSlots: {},
      recentTurns: [],
      conversationSummary: "旧摘要",
    };
  }
  const reminderPending = {
    command: "createCourseReminder",
    status: "awaiting_receipt",
    runId: "run-reminder-1",
    expiresAt: Date.now() + 60000,
    target: { type: "reminder", detailId: "key-chain-1", name: "课程提醒" },
  };

  await check("四重校验：createCourseReminder 合法回执提交且不改写 currentScheduleTarget", () => {
    const persisted = [];
    const controller = new MemoryController({
      conversationMemory: {
        persistAfterSuccess(input) { persisted.push(input); return { persisted: true, revision: 9 }; },
      },
    });
    const result = controller.commitActionReceipt({
      principal: { principalKey: "test", authenticated: true },
      state: makeCloudState(reminderPending),
      conversationId: "conv1",
      memoryMode: "cloud_sync",
      command: "createCourseReminder",
      runId: "run-reminder-1",
      appliedTarget: { type: "reminder", detailId: "key-chain-1", name: "课程提醒（提前20分钟）" },
    });
    assert.strictEqual(result.committed, true);
    assert.strictEqual(result.workingMemory.pendingAction, null, "成功回执后清除 pendingAction");
    assert.strictEqual(result.workingMemory.currentScheduleTarget.detailId, "keep-class-1", "提醒回执不得改写课表目标");
    assert.deepStrictEqual(result.workingMemory.lastResolvedEntity, {
      type: "reminder",
      id: "key-chain-1",
      name: "课程提醒（提前20分钟）",
    });
    assert.strictEqual(result.contextSlots.lastTargetType, "reminder");
    assert.strictEqual(result.contextSlots.preferredClassName, undefined, "提醒回执不得写课表槽位");
    assert.strictEqual(persisted.length, 1);
    assert.strictEqual(persisted[0].intentName, "manage_course_reminders");
    assert.strictEqual(persisted[0].conversationSummary, "旧摘要");
  });

  await check("四重校验：runId 不匹配 → ACTION_RECEIPT_RUN_MISMATCH", () => {
    const controller = new MemoryController({ conversationMemory: { persistAfterSuccess() { throw new Error("should not persist"); } } });
    const result = controller.commitActionReceipt({
      principal: { principalKey: "test", authenticated: true },
      state: makeCloudState(reminderPending),
      conversationId: "conv1",
      memoryMode: "cloud_sync",
      command: "createCourseReminder",
      runId: "run-forged",
      appliedTarget: { type: "reminder", detailId: "key-chain-1", name: "课程提醒" },
    });
    assert.strictEqual(result.reason, "ACTION_RECEIPT_RUN_MISMATCH");
  });

  await check("四重校验：target 不匹配 → ACTION_RECEIPT_TARGET_MISMATCH", () => {
    const controller = new MemoryController({ conversationMemory: { persistAfterSuccess() { throw new Error("should not persist"); } } });
    const result = controller.commitActionReceipt({
      principal: { principalKey: "test", authenticated: true },
      state: makeCloudState(reminderPending),
      conversationId: "conv1",
      memoryMode: "cloud_sync",
      command: "createCourseReminder",
      runId: "run-reminder-1",
      appliedTarget: { type: "reminder", detailId: "forged-key", name: "伪造提醒" },
    });
    assert.strictEqual(result.reason, "ACTION_RECEIPT_TARGET_MISMATCH");
  });

  await check("四重校验：pendingAction 过期 → ACTION_RECEIPT_EXPIRED", () => {
    const controller = new MemoryController({ conversationMemory: { persistAfterSuccess() { throw new Error("should not persist"); } } });
    const result = controller.commitActionReceipt({
      principal: { principalKey: "test", authenticated: true },
      state: makeCloudState(Object.assign({}, reminderPending, { expiresAt: Date.now() - 1 })),
      conversationId: "conv1",
      memoryMode: "cloud_sync",
      command: "createCourseReminder",
      runId: "run-reminder-1",
      appliedTarget: { type: "reminder", detailId: "key-chain-1", name: "课程提醒" },
    });
    assert.strictEqual(result.reason, "ACTION_RECEIPT_EXPIRED");
  });

  await check("四重校验：command 与 pending 不一致 → ACTION_RECEIPT_COMMAND_MISMATCH", () => {
    const controller = new MemoryController({ conversationMemory: { persistAfterSuccess() { throw new Error("should not persist"); } } });
    const result = controller.commitActionReceipt({
      principal: { principalKey: "test", authenticated: true },
      state: makeCloudState(reminderPending),
      conversationId: "conv1",
      memoryMode: "cloud_sync",
      command: "deleteReminder",
      runId: "run-reminder-1",
      appliedTarget: { type: "reminder", detailId: "key-chain-1", name: "课程提醒" },
    });
    assert.strictEqual(result.reason, "ACTION_RECEIPT_COMMAND_MISMATCH");
  });

  await check("四重校验：pending.command 非白名单 → ACTION_RECEIPT_COMMAND_MISMATCH", () => {
    const controller = new MemoryController({ conversationMemory: { persistAfterSuccess() { throw new Error("should not persist"); } } });
    const result = controller.commitActionReceipt({
      principal: { principalKey: "test", authenticated: true },
      state: makeCloudState(Object.assign({}, reminderPending, { command: "fillForm" })),
      conversationId: "conv1",
      memoryMode: "cloud_sync",
      command: "fillForm",
      runId: "run-reminder-1",
      appliedTarget: { type: "reminder", detailId: "key-chain-1", name: "课程提醒" },
    });
    assert.strictEqual(result.reason, "ACTION_RECEIPT_COMMAND_MISMATCH");
  });

  await check("四重校验：未授权 cloud_sync → CLOUD_SYNC_NOT_AUTHORIZED", () => {
    const controller = new MemoryController({ conversationMemory: { persistAfterSuccess() { throw new Error("should not persist"); } } });
    const result = controller.commitActionReceipt({
      principal: { principalKey: "test", authenticated: true },
      state: {
        memoryPolicy: { mode: "session_state", cloudSyncEnabled: false },
        workingMemory: { pendingAction: reminderPending },
      },
      conversationId: "conv1",
      memoryMode: "cloud_sync",
      command: "createCourseReminder",
      runId: "run-reminder-1",
      appliedTarget: { type: "reminder", detailId: "key-chain-1", name: "课程提醒" },
    });
    assert.strictEqual(result.reason, "CLOUD_SYNC_NOT_AUTHORIZED");
  });

  await check("四重校验：deleteReminder 合法回执同样提交", () => {
    const persisted = [];
    const controller = new MemoryController({
      conversationMemory: {
        persistAfterSuccess(input) { persisted.push(input); return { persisted: true }; },
      },
    });
    const result = controller.commitActionReceipt({
      principal: { principalKey: "test", authenticated: true },
      state: makeCloudState({
        command: "deleteReminder",
        status: "awaiting_receipt",
        runId: "run-del-1",
        expiresAt: Date.now() + 60000,
        target: { type: "reminder", detailId: "rem_target_1", name: "课程提醒" },
      }),
      conversationId: "conv1",
      memoryMode: "cloud_sync",
      command: "deleteReminder",
      runId: "run-del-1",
      appliedTarget: { type: "reminder", detailId: "rem_target_1", name: "课程提醒" },
    });
    assert.strictEqual(result.committed, true);
    assert.strictEqual(persisted[0].intentName, "manage_course_reminders");
  });

  await check("local_only：提醒回执规范化返回但不落盘", () => {
    const persisted = [];
    const controller = new MemoryController({
      conversationMemory: { persistAfterSuccess(input) { persisted.push(input); return { persisted: true }; } },
    });
    const result = controller.commitActionReceipt({
      principal: { principalKey: "test" },
      state: null,
      conversationId: "conv1",
      memoryMode: "local_only",
      command: "createCourseReminder",
      runId: "run-x",
      appliedTarget: { type: "reminder", detailId: "key-local-1", name: "课程提醒" },
    });
    assert.strictEqual(result.committed, false);
    assert.strictEqual(result.reason, "LOCAL_ONLY_NO_PERSIST");
    assert.strictEqual(persisted.length, 0);
  });

  // ---------- 全链闭环：提醒消息 → chat → 确认卡+pendingAction → 写入 → 回执 → 接受 ----------
  await check("全链：chat 派生提醒 pendingAction（detailId 与卡片 idempotencyKey 一致）", async () => {
    const agentService = require("../server/src/services/ai/agentService");
    const context = {
      timezone: "Asia/Shanghai",
      todayDate: "2026-07-22",
      todayWeekday: 3,
      currentTeachingWeek: 20,
      clientTimestampMs: Date.parse("2026-07-22T04:00:00.000Z"),
      currentScheduleSummary: {
        enabled: true,
        fingerprint: "schedule-receipt-fingerprint",
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
    const response = await agentService.chat({
      message: "以后上课前20分钟提醒我",
      conversationId: "conv-reminder-receipt-chain",
      protocolVersion: "agent.v2",
      runtimeMode: "public",
      context,
      serverSession,
    });
    assert.strictEqual(response.success, true);
    assert.ok(response.runId, "chat 必须返回 runId");
    const reminderCard = (response.cards || []).find((card) => card.type === "reminder");
    assert.ok(reminderCard, "提醒确认卡必须存在");
    const confirmAction = (reminderCard.actions || []).find((action) => action.type === "confirmReminder");
    assert.ok(confirmAction && confirmAction.payload, "confirmReminder action 必须存在");
    const cardKey = confirmAction.payload.idempotencyKey;
    assert.ok(cardKey, "卡片载荷必须携带 idempotencyKey");
    const pendingAction = response.workingMemory && response.workingMemory.pendingAction;
    assert.ok(pendingAction, "chat 必须派生提醒 pendingAction");
    assert.strictEqual(pendingAction.command, "createCourseReminder");
    assert.strictEqual(pendingAction.status, "awaiting_receipt");
    assert.strictEqual(pendingAction.runId, response.runId, "pendingAction 绑定本轮 runId");
    assert.strictEqual(pendingAction.target.detailId, cardKey, "pendingAction 目标与卡片 idempotencyKey 一致");
    assert.ok(pendingAction.expiresAt > pendingAction.createdAt, "pendingAction 必须有过期时间");

    // 服务端确认写入（与客户端 configure 链路同一幂等写入）。
    const created = defaultCourseReminderService.create({
      principal,
      confirmationToken: confirmAction.payload.confirmationProof,
      idempotencyKey: cardKey,
      subscriptionStatus: "reject",
    });
    assert.strictEqual(created.success, true);
    const applied = defaultCourseReminderService.findByIdempotencyKey({ principal, idempotencyKey: cardKey });
    assert.ok(applied && applied.id === created.reminder.id, "写入后可按 idempotencyKey 检索");

    // 客户端执行后回传回执 → 端点四重校验前置检查（command/target/principal）接受。
    const res = postReceipt({
      command: "createCourseReminder",
      status: "success",
      runId: response.runId,
      conversationId: "conv-reminder-receipt-chain",
      appliedTarget: { type: "reminder", detailId: cardKey, name: "课程提醒（提前20分钟）" },
      memoryMode: "local_only",
      cloudSyncEnabled: false,
    });
    assert.strictEqual(res.statusCode, 200);
    assert.strictEqual(res.payload.success, true);

    // cloud_sync 提交：pendingAction 来自 chat 真实派生，四重校验全过后提交。
    const persisted = [];
    const controller = new MemoryController({
      conversationMemory: {
        persistAfterSuccess(input) { persisted.push(input); return { persisted: true, revision: 11 }; },
      },
    });
    const commit = controller.commitActionReceipt({
      principal: { principalKey: "chain", authenticated: true },
      state: {
        memoryPolicy: { mode: "cloud_sync", cloudSyncEnabled: true },
        workingMemory: { pendingAction },
        contextSlots: {},
        recentTurns: [],
        conversationSummary: "",
      },
      conversationId: "conv-reminder-receipt-chain",
      memoryMode: "cloud_sync",
      command: "createCourseReminder",
      runId: response.runId,
      appliedTarget: { type: "reminder", detailId: cardKey, name: "课程提醒（提前20分钟）" },
    });
    assert.strictEqual(commit.committed, true, "四重校验接受并提交");
    assert.strictEqual(commit.workingMemory.pendingAction, null);
    assert.strictEqual(persisted.length, 1);
    assert.strictEqual(persisted[0].intentName, "manage_course_reminders");
  });

  // ---------- 客户端绑定：mock 页面执行提醒卡 ----------
  await check("客户端：执行提醒卡 → receipt 载荷符合契约且回传成功才标「已创建」", async () => {
    const agentRunClient = require("../miniprogram/services/agentRunClient");
    const captured = [];
    agentRunClient.postActionReceipt = async (payload) => {
      captured.push(payload);
      return { success: true, committed: false, reason: "LOCAL_ONLY_NO_PERSIST" };
    };
    require("../miniprogram/packageXiaofu/pages/ai-assistant/ai-assistant.js");
    const page = mockEnv.createPageInstance();
    const patches = [];
    page.setData = function setData(patch, cb) {
      patches.push(patch);
      Object.assign(this.data, patch);
      if (cb) cb();
    };
    page.scheduleStatusCapsuleReset = () => {};
    page.data.activeRunId = "run-client-1";
    page.data.activeConversationId = "conv-client-1";
    page.data.memoryMode = "local_only";
    page.performReminderCreateFromConfig = async () => ({
      success: true,
      duplicate: false,
      reminder: { id: "rem_client_1", channel: "app_only" },
    });
    const context = { messageIndex: 0, cardIndex: 0, actionIndex: 0, card: { badges: ["未执行写入"] } };
    await page.performReminderConfirmation(
      { operation: "create", leadMinutes: 20, scope: "all_courses", idempotencyKey: "key-card-1" },
      context
    );
    assert.strictEqual(captured.length, 1, "回执必须发出");
    const receipt = captured[0];
    assert.strictEqual(receipt.command, "createCourseReminder");
    assert.strictEqual(receipt.status, "success");
    assert.strictEqual(receipt.runId, "run-client-1");
    assert.strictEqual(receipt.conversationId, "conv-client-1");
    assert.strictEqual(receipt.memoryMode, "local_only");
    assert.strictEqual(receipt.cloudSyncEnabled, false);
    assert.deepStrictEqual(receipt.appliedTarget, {
      type: "reminder",
      detailId: "key-card-1",
      name: "课程提醒（提前20分钟）",
    });
    const badgePatch = patches.find((patch) => patch["messages[0].displayCards[0].badges"]);
    assert.ok(badgePatch, "卡片徽标必须更新");
    assert.strictEqual(badgePatch["messages[0].displayCards[0].badges"][0], "已创建");
    const capsulePatch = patches.find((patch) => typeof patch.statusCapsuleText === "string");
    assert.strictEqual(capsulePatch.statusCapsuleText, "完成 · 提醒已创建");
  });

  await check("客户端：回执被服务端拒绝 → 不标「已创建」，如实降级「已创建未回执」", async () => {
    const agentRunClient = require("../miniprogram/services/agentRunClient");
    const captured = [];
    agentRunClient.postActionReceipt = async (payload) => {
      captured.push(payload);
      return { success: false, code: "REMINDER_TARGET_NOT_FOUND" };
    };
    const page = mockEnv.createPageInstance();
    const patches = [];
    page.setData = function setData(patch, cb) {
      patches.push(patch);
      Object.assign(this.data, patch);
      if (cb) cb();
    };
    page.scheduleStatusCapsuleReset = () => {};
    page.data.activeRunId = "run-client-2";
    page.data.activeConversationId = "conv-client-1";
    page.data.memoryMode = "local_only";
    page.performReminderCreateFromConfig = async () => ({
      success: true,
      duplicate: false,
      reminder: { id: "rem_client_2", channel: "app_only" },
    });
    const context = { messageIndex: 0, cardIndex: 0, actionIndex: 0, card: { badges: ["未执行写入"] } };
    await page.performReminderConfirmation(
      { operation: "create", leadMinutes: 20, scope: "all_courses", idempotencyKey: "key-card-2" },
      context
    );
    assert.strictEqual(captured.length, 1, "回执必须发出");
    const badgePatch = patches.find((patch) => patch["messages[0].displayCards[0].badges"]);
    assert.ok(badgePatch, "卡片徽标必须更新");
    const badges = badgePatch["messages[0].displayCards[0].badges"];
    assert.strictEqual(badges.indexOf("已创建"), -1, "回执失败不得标「已创建」");
    assert.strictEqual(badges[0], "已创建未回执");
    const capsulePatch = patches.find((patch) => typeof patch.statusCapsuleText === "string");
    assert.ok(capsulePatch.statusCapsuleText.indexOf("回执未确认") >= 0, "胶囊必须如实降级");
  });

  await check("客户端：回执网络异常 → 同样不标「已创建」", async () => {
    const agentRunClient = require("../miniprogram/services/agentRunClient");
    agentRunClient.postActionReceipt = async () => { throw new Error("network down"); };
    const page = mockEnv.createPageInstance();
    const patches = [];
    page.setData = function setData(patch, cb) {
      patches.push(patch);
      Object.assign(this.data, patch);
      if (cb) cb();
    };
    page.scheduleStatusCapsuleReset = () => {};
    page.data.activeRunId = "run-client-3";
    page.data.activeConversationId = "conv-client-1";
    page.data.memoryMode = "local_only";
    page.performReminderCreateFromConfig = async () => ({
      success: true,
      duplicate: false,
      reminder: { id: "rem_client_3", channel: "app_only" },
    });
    const context = { messageIndex: 0, cardIndex: 0, actionIndex: 0, card: { badges: ["未执行写入"] } };
    await page.performReminderConfirmation(
      { operation: "create", leadMinutes: 20, scope: "all_courses", idempotencyKey: "key-card-3" },
      context
    );
    const badgePatch = patches.find((patch) => patch["messages[0].displayCards[0].badges"]);
    assert.ok(badgePatch, "卡片徽标必须更新");
    const badges = badgePatch["messages[0].displayCards[0].badges"];
    assert.strictEqual(badges.indexOf("已创建"), -1, "异常回执不得标「已创建」");
    assert.strictEqual(badges[0], "已创建未回执");
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
