// 第三章行为验证：workingMemory 新字段 / commitActionReceipt / action 归一化过滤 / explicitCommand 透传
process.env.AI_AGENT_ENABLED = process.env.AI_AGENT_ENABLED || "false";
const assert = require("assert");

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

async function runChecks() {
  const wm = require("../server/src/services/ai/memory/workingMemory");

  await check("emptyWorkingMemory 含 currentScheduleTarget=null / namedRelations=[]", () => {
    const empty = wm.emptyWorkingMemory();
    assert.strictEqual(empty.currentScheduleTarget, null);
    assert.deepStrictEqual(empty.namedRelations, []);
  });

  await check("normalizeWorkingMemory 规范化 currentScheduleTarget 并拒绝缺字段目标", () => {
    const good = wm.normalizeWorkingMemory({
      currentScheduleTarget: { type: "class", detailId: "abc123", name: "24动物医学1班", term: "2025-2026-2" },
    });
    assert.strictEqual(good.currentScheduleTarget.detailId, "abc123");
    const bad = wm.normalizeWorkingMemory({
      currentScheduleTarget: { type: "class", detailId: "", name: "24动物医学1班" },
    });
    assert.strictEqual(bad.currentScheduleTarget, null);
  });

  await check("updateWorkingMemory 默认继承 prev.currentScheduleTarget，显式给定才更新", () => {
    const prev = wm.normalizeWorkingMemory({
      currentScheduleTarget: { type: "class", detailId: "old1", name: "旧班级", term: "2025-2026-2" },
    });
    const inherit = wm.updateWorkingMemory(prev, { message: "今天有什么课" });
    assert.strictEqual(inherit.currentScheduleTarget.detailId, "old1");
    const updated = wm.updateWorkingMemory(prev, {
      message: "",
      currentScheduleTarget: { type: "class", detailId: "new2", name: "24动物医学1班", term: "2025-2026-2" },
    });
    assert.strictEqual(updated.currentScheduleTarget.detailId, "new2");
    assert.strictEqual(updated.currentScheduleTarget.name, "24动物医学1班");
  });

  await check("normalizeWorkingMemory 规范化 namedRelations 并过滤缺项", () => {
    const out = wm.normalizeWorkingMemory({
      namedRelations: [
        { relation: "mother", displayRelation: "妈妈", name: "刘秀英" },
        { relation: "", displayRelation: "爸爸", name: "某人" },
      ],
    });
    assert.strictEqual(out.namedRelations.length, 1);
    assert.strictEqual(out.namedRelations[0].relation, "mother");
  });

  const { MemoryController } = require("../server/src/services/ai/memory/memoryController");

  await check("pendingAction 绑定 runId、目标与过期时间", () => {
    const { derivePendingAction } = require("../server/src/services/ai/agentService");
    const pending = derivePendingAction([{
      command: "setCurrentSchedule",
      input: { type: "class", detailId: "d123", name: "24动物医学1班", term: "2025-2026-2" },
      confirmationRequest: { title: "确认" },
    }], { runId: "run-bound", ttlMs: 60000 });
    assert.strictEqual(pending.runId, "run-bound");
    assert.strictEqual(pending.target.detailId, "d123");
    assert.ok(pending.expiresAt > pending.createdAt);
  });

  await check("commitActionReceipt: cloud_sync 提交 workingMemory + contextSlots（preferredClassName）", () => {
    const persisted = [];
    const controller = new MemoryController({
      conversationMemory: {
        persistAfterSuccess(input) {
          persisted.push(input);
          return { persisted: true, revision: 7 };
        },
      },
    });
    const result = controller.commitActionReceipt({
      principal: { principalKey: "test", authenticated: true },
      state: {
        memoryPolicy: { mode: "cloud_sync", cloudSyncEnabled: true },
        workingMemory: wm.updateWorkingMemory(wm.emptyWorkingMemory(), {
          pendingAction: {
            command: "setCurrentSchedule",
            status: "awaiting_receipt",
            runId: "run1",
            expiresAt: Date.now() + 60000,
            target: { type: "class", detailId: "d123", name: "24动物医学1班" },
          },
        }),
        contextSlots: {}, recentTurns: [], conversationSummary: "旧摘要",
      },
      conversationId: "conv1",
      memoryMode: "cloud_sync",
      command: "setCurrentSchedule",
      runId: "run1",
      appliedTarget: { type: "class", detailId: "d123", name: "24动物医学1班", term: "2025-2026-2" },
    });
    assert.strictEqual(result.committed, true);
    assert.strictEqual(result.workingMemory.currentScheduleTarget.detailId, "d123");
    assert.strictEqual(result.workingMemory.pendingAction, null, "成功 Receipt 后才清除 pendingAction");
    assert.deepStrictEqual(result.workingMemory.lastResolvedEntity, {
      type: "class",
      id: "d123",
      name: "24动物医学1班",
    });
    assert.strictEqual(result.contextSlots.preferredClassName, "24动物医学1班");
    assert.strictEqual(result.contextSlots.lastTargetType, "class");
    assert.strictEqual(persisted.length, 1);
    assert.strictEqual(persisted[0].conversationSummary, "旧摘要");
    assert.strictEqual(persisted[0].message, "");
  });

  await check("commitActionReceipt: local_only 不持久化", () => {
    const persisted = [];
    const controller = new MemoryController({
      conversationMemory: {
        persistAfterSuccess(input) {
          persisted.push(input);
          return { persisted: true };
        },
      },
    });
    const result = controller.commitActionReceipt({
      principal: { principalKey: "test" },
      state: null,
      conversationId: "conv1",
      memoryMode: "local_only",
      appliedTarget: { type: "class", detailId: "d123", name: "24动物医学1班" },
    });
    assert.strictEqual(result.committed, false);
    assert.strictEqual(result.reason, "LOCAL_ONLY_NO_PERSIST");
    assert.strictEqual(persisted.length, 0);
  });

  await check("commitActionReceipt: 客户端不得把未授权会话提升为 cloud_sync", () => {
    const controller = new MemoryController({ conversationMemory: { persistAfterSuccess() { throw new Error("should not persist"); } } });
    const result = controller.commitActionReceipt({
      principal: { principalKey: "test", authenticated: true },
      state: {
        memoryPolicy: { mode: "session_state", cloudSyncEnabled: false },
        workingMemory: {
          pendingAction: {
            command: "setCurrentSchedule",
            status: "awaiting_receipt",
            runId: "run1",
            expiresAt: Date.now() + 60000,
            target: { type: "class", detailId: "d123", name: "24动物医学1班" },
          },
        },
      },
      conversationId: "conv1",
      memoryMode: "cloud_sync",
      runId: "run1",
      appliedTarget: { type: "class", detailId: "d123", name: "24动物医学1班" },
    });
    assert.strictEqual(result.committed, false);
    assert.strictEqual(result.reason, "CLOUD_SYNC_NOT_AUTHORIZED");
  });

  await check("commitActionReceipt: Receipt 必须绑定 pendingAction 的 run/command/target", () => {
    const controller = new MemoryController({ conversationMemory: { persistAfterSuccess() { throw new Error("should not persist"); } } });
    const state = {
      memoryPolicy: { mode: "cloud_sync", cloudSyncEnabled: true },
      workingMemory: {
        pendingAction: {
          command: "setCurrentSchedule",
          status: "awaiting_receipt",
          runId: "run-authorized",
          expiresAt: Date.now() + 60000,
          target: { type: "class", detailId: "d123", name: "24动物医学1班" },
        },
      },
    };
    const wrongRun = controller.commitActionReceipt({
      principal: { principalKey: "test", authenticated: true }, state, conversationId: "conv1", memoryMode: "cloud_sync",
      command: "setCurrentSchedule", runId: "run-forged", appliedTarget: { type: "class", detailId: "d123", name: "24动物医学1班" },
    });
    assert.strictEqual(wrongRun.reason, "ACTION_RECEIPT_RUN_MISMATCH");
    const wrongTarget = controller.commitActionReceipt({
      principal: { principalKey: "test", authenticated: true }, state, conversationId: "conv1", memoryMode: "cloud_sync",
      command: "setCurrentSchedule", runId: "run-authorized", appliedTarget: { type: "class", detailId: "forged", name: "伪造班级" },
    });
    assert.strictEqual(wrongTarget.reason, "ACTION_RECEIPT_TARGET_MISMATCH");
    const expiredState = JSON.parse(JSON.stringify(state));
    expiredState.workingMemory.pendingAction.expiresAt = Date.now() - 1;
    const expired = controller.commitActionReceipt({
      principal: { principalKey: "test", authenticated: true }, state: expiredState, conversationId: "conv1", memoryMode: "cloud_sync",
      command: "setCurrentSchedule", runId: "run-authorized", appliedTarget: { type: "class", detailId: "d123", name: "24动物医学1班" },
    });
    assert.strictEqual(expired.reason, "ACTION_RECEIPT_EXPIRED");
  });

  await check("commitActionReceipt: 缺 detailId/name 拒绝", () => {
    const controller = new MemoryController({ conversationMemory: { persistAfterSuccess() { throw new Error("should not persist"); } } });
    const result = controller.commitActionReceipt({ memoryMode: "cloud_sync", appliedTarget: { type: "class", detailId: "", name: "" } });
    assert.strictEqual(result.committed, false);
    assert.strictEqual(result.reason, "TARGET_MISSING");
  });

  const contract = require("../server/src/services/ai/actionCommandContract");

  await check("stableActionCommands 放行 deriveActionCommands 风格的合法 action", () => {
    const actions = contract.stableActionCommands([{
      command: "setCurrentSchedule",
      label: "设为首页课表",
      input: { type: "class", detailId: "d123", name: "24动物医学1班", term: "2025-2026-2", releaseVersion: "26.05.29.22" },
      confirmationRequest: { title: "设置首页课表", summary: "将首页课表切换为「24动物医学1班」？", confirmText: "确认设置", cancelText: "取消" },
    }], "public");
    assert.strictEqual(actions.length, 1);
    assert.strictEqual(actions[0].command, "setCurrentSchedule");
    assert.strictEqual(actions[0].input.detailId, "d123");
  });

  await check("stableActionCommands 拒绝载荷含 courses 的 action（additionalProperties:false）", () => {
    const actions = contract.stableActionCommands([{
      command: "setCurrentSchedule",
      label: "设为首页课表",
      input: { type: "class", detailId: "d123", name: "24动物医学1班", courses: [{ name: "x" }] },
      confirmationRequest: { title: "t", summary: "s", confirmText: "ok", cancelText: "no" },
    }], "public");
    assert.strictEqual(actions.length, 0);
  });

  await check("stableActionCommands 拒绝缺 confirmationRequest 的 action", () => {
    const actions = contract.stableActionCommands([{
      command: "setCurrentSchedule",
      label: "设为首页课表",
      input: { type: "class", detailId: "d123", name: "24动物医学1班" },
    }], "public");
    assert.strictEqual(actions.length, 0);
  });

  await check("stableActionCommands 拒绝非 manifest action（防 LLM 伪造注入）", () => {
    const actions = contract.stableActionCommands([{
      command: "deleteAllData",
      label: "删库",
      input: {},
      confirmationRequest: { title: "t", summary: "s", confirmText: "ok", cancelText: "no" },
    }], "public");
    assert.strictEqual(actions.length, 0);
  });

  await check("set_current_schedule 工具透传 explicitCommand 并做索引校验", () => {
    const toolRegistry = require("../server/src/services/ai/toolRegistry");
    assert.strictEqual(typeof toolRegistry.executeTool, "function", "executeTool 导出");
    const run = (input) => toolRegistry.executeTool("set_current_schedule", input, {});
    // 24动物医学1班 在当前索引中的实证 detailId
    const base = { detailId: "1045ffd6099deb6284d407539a26f389", name: "24动物医学1班" };
    const withExplicit = run(Object.assign({}, base, { explicitCommand: true }));
    assert.ok(withExplicit && typeof withExplicit === "object", "返回对象");
    assert.strictEqual(withExplicit.success, true, "目标在索引中");
    assert.strictEqual(withExplicit.explicitCommand, true);
    assert.strictEqual(withExplicit.actionRequired, "setCurrentSchedule");
    assert.ok(withExplicit.target && withExplicit.target.detailId, "目标含 detailId");
    const withoutExplicit = run(Object.assign({}, base));
    assert.strictEqual(withoutExplicit.explicitCommand, false);
    const missing = run({ detailId: "", name: "" });
    assert.strictEqual(missing.success, false);
    assert.strictEqual(missing.code, "SCHEDULE_TARGET_MISSING");
    const notFound = run({ detailId: "0000000000000000000000000000dead", name: "不存在班级" });
    assert.strictEqual(notFound.success, false);
    assert.strictEqual(notFound.code, "SCHEDULE_TARGET_NOT_FOUND");
  });
}

async function main() {
  await runChecks();
  console.log("---");
  console.log("pass=" + pass + " fail=" + fail);
  process.exit(fail ? 1 : 0);
}

main();
