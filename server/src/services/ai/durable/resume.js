/**
 * M6-T4 轻量 Durable Execution：resume（凭 resumeToken + Principal 恢复任务）。
 *
 * 恢复链校验顺序：任务存在 → token 哈希匹配 → principal 归属一致 →
 * 未过期（惰性过期落盘，过期任务只能转 expired，不得复活）→ 状态可恢复（waiting）。
 * 通过后 waiting → resumed，返回任务上下文供调用方续跑。
 * 日志不得输出 token 全文；对外只返回 publicTaskView（剥离哈希）。
 */

const { safeLog } = require("../../../utils/safeLogger");
const {
  defaultDurableTaskStore,
  createStoreError,
  hashPrincipalKey,
  hashToken,
  publicTaskView,
} = require("./taskStore");

function assertResumePrincipal(principal) {
  const principalKey = String(principal && principal.principalKey || "");
  if (!principal || principal.authenticated !== true || !principalKey) {
    throw createStoreError("需要有效小程序会话才能恢复 durable 任务。", "PRINCIPAL_REQUIRED", 401);
  }
  return principalKey;
}

function assertTaskPrincipal(task, principalKey) {
  if (task.principalKeyHash !== hashPrincipalKey(principalKey)) {
    throw createStoreError("durable 任务不属于当前会话主体。", "DURABLE_PRINCIPAL_MISMATCH", 403);
  }
}

function findTaskByToken(store, taskId, resumeToken) {
  const tokenHash = hashToken(resumeToken);
  if (taskId) {
    const task = store.get(taskId);
    if (!task) {
      throw createStoreError("durable 任务不存在。", "DURABLE_TASK_NOT_FOUND", 404);
    }
    if (task.resumeTokenHash !== tokenHash) {
      throw createStoreError("resumeToken 校验失败。", "DURABLE_TOKEN_INVALID", 403);
    }
    return task;
  }
  const matched = store.list().find((task) => task.resumeTokenHash === tokenHash);
  if (!matched) {
    throw createStoreError("resumeToken 校验失败。", "DURABLE_TOKEN_INVALID", 403);
  }
  return matched;
}

/**
 * 恢复任务：token 匹配 + principal 归属一致 + 未过期 → status resumed。
 * @returns {{ task: object, context: object }} 对外视图（无哈希、无 token）。
 */
function resumeDurableTask(input = {}, store = defaultDurableTaskStore) {
  const resumeToken = String(input.resumeToken || "");
  if (!resumeToken || resumeToken.length < 16 || resumeToken.length > 256) {
    throw createStoreError("resumeToken 缺失或形态非法。", "DURABLE_TOKEN_INVALID", 403);
  }
  const principalKey = assertResumePrincipal(input.principal);
  const taskId = String(input.taskId || "").slice(0, 64);
  const task = findTaskByToken(store, taskId, resumeToken);
  assertTaskPrincipal(task, principalKey);
  const resumed = store.markResumed(task.taskId); // 惰性过期/状态冲突在此收口
  safeLog("ai-agent-durable-resume", {
    kind: resumed.kind,
    waitEvent: resumed.waitEvent,
  });
  return {
    task: publicTaskView(resumed),
    context: resumed.context && typeof resumed.context === "object" ? resumed.context : {},
  };
}

/** 完成任务：pending/waiting/resumed → done（回执达成、审批结论落地时调用）。 */
function completeDurableTask(input = {}, store = defaultDurableTaskStore) {
  const principalKey = assertResumePrincipal(input.principal);
  const taskId = String(input.taskId || "").slice(0, 64);
  const task = store.get(taskId);
  if (!task) {
    throw createStoreError("durable 任务不存在。", "DURABLE_TASK_NOT_FOUND", 404);
  }
  assertTaskPrincipal(task, principalKey);
  const done = store.markDone(taskId, input.note);
  return publicTaskView(done);
}

/**
 * 提醒 receipt_wait 接线：M5 回执被接受后，把对应等待任务置 done。
 * 找不到对应任务不是错误（回执先于 durable 层存在，或任务已过期清理），
 * 回执端点语义不受影响。
 */
function completeReminderReceiptWait(input = {}, store = defaultDurableTaskStore) {
  const principal = input.principal;
  if (!principal || principal.authenticated !== true || !principal.principalKey) {
    return { completed: false, reason: "PRINCIPAL_REQUIRED" };
  }
  const task = store.findWaitingByEvent({
    kind: "receipt_wait",
    waitEvent: "action_receipt",
    principalKey: principal.principalKey,
    contextMatch: {
      command: String(input.command || "").slice(0, 40),
      runId: String(input.runId || "").slice(0, 100),
      detailId: String(input.detailId || "").slice(0, 128),
    },
  });
  if (!task) return { completed: false, reason: "DURABLE_TASK_NOT_FOUND" };
  const done = store.markDone(task.taskId, "action_receipt");
  return { completed: true, taskId: done.taskId };
}

/** 批量过期标记（供定期清扫或端点懒触发）。 */
function sweepExpiredTasks(store = defaultDurableTaskStore) {
  return store.sweepExpired();
}

module.exports = {
  completeDurableTask,
  completeReminderReceiptWait,
  resumeDurableTask,
  sweepExpiredTasks,
};
