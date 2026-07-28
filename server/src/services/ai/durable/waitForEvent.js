/**
 * M6-T4 轻量 Durable Execution：wait for event / receipt 登记。
 *
 * 把"等待某事件/回执/审批"登记为 durable 任务：
 * - resumeToken 由 crypto.randomBytes 生成（不可猜测），只存哈希，明文仅此处返回一次；
 * - expiresAt 必填（等待必须有界，过期任务只能转 expired）；
 * - principalKey 只存哈希，用于 resume 时的归属一致性校验。
 */

const { safeLog } = require("../../../utils/safeLogger");
const {
  defaultDurableTaskStore,
  createStoreError,
  generateResumeToken,
  hashToken,
  TASK_KINDS,
} = require("./taskStore");

function assertPrincipalKey(principal) {
  const principalKey = String(principal && principal.principalKey || "");
  if (!principal || principal.authenticated !== true || !principalKey) {
    throw createStoreError("需要有效小程序会话才能登记 durable 等待任务。", "PRINCIPAL_REQUIRED", 401);
  }
  return principalKey;
}

function assertFutureExpiry(expiresAt, now = Date.now()) {
  const value = Number(expiresAt);
  if (!Number.isFinite(value) || value <= now) {
    throw createStoreError("durable 等待任务必须携带未来过期时间（expiresAt）。", "DURABLE_EXPIRES_AT_INVALID", 400);
  }
  return value;
}

/**
 * 创建等待任务（status=pending，未武装）。
 * 返回 { task, resumeToken }；resumeToken 明文只在此返回一次，调用方不得落盘/入日志。
 */
function createWaitTask(input = {}, store = defaultDurableTaskStore) {
  const kind = String(input.kind || "");
  if (TASK_KINDS.indexOf(kind) < 0) {
    throw createStoreError(`未知的 durable 任务类型：${kind || "(空)"}`, "DURABLE_KIND_INVALID", 400);
  }
  const principalKey = assertPrincipalKey(input.principal);
  const expiresAt = assertFutureExpiry(input.expiresAt, input.now);
  const resumeToken = generateResumeToken();
  const task = store.create({
    kind,
    waitEvent: input.waitEvent,
    principalKey,
    context: input.context,
    expiresAt,
    resumeTokenHash: hashToken(resumeToken),
    note: input.note,
  });
  return { task, resumeToken };
}

/** 武装等待：pending → waiting（等待正式开始计时）。 */
function armWaitTask(taskId, store = defaultDurableTaskStore) {
  return store.markWaiting(taskId);
}

/**
 * 一步登记：创建并武装（pending → waiting）。
 * 等待方随后凭 resumeToken + Principal 走 resume 恢复。
 */
function registerWaitEvent(input = {}, store = defaultDurableTaskStore) {
  const created = createWaitTask(input, store);
  const task = armWaitTask(created.task.taskId, store);
  return { task, resumeToken: created.resumeToken };
}

/**
 * 提醒 receipt_wait 接线：chat 派生提醒 pendingAction 时登记 durable 兜底任务。
 * waitEvent 固定 action_receipt，上下文只携带 command/runId/detailId（无敏感信息）。
 * 返回 null 表示不适用（非提醒 pendingAction / 未认证 principal / 已过期）。
 */
function registerReminderReceiptWait(input = {}, store = defaultDurableTaskStore) {
  const pendingAction = input.pendingAction;
  const principal = input.principal;
  if (!pendingAction || pendingAction.status !== "awaiting_receipt") return null;
  if (!pendingAction.target || pendingAction.target.type !== "reminder") return null;
  if (!principal || principal.authenticated !== true || !principal.principalKey) return null;
  const expiresAt = Number(pendingAction.expiresAt);
  if (!Number.isFinite(expiresAt) || expiresAt <= Date.now()) return null;
  return registerWaitEvent({
    kind: "receipt_wait",
    waitEvent: "action_receipt",
    principal,
    expiresAt,
    context: {
      command: String(pendingAction.command || "").slice(0, 40),
      runId: String(pendingAction.runId || "").slice(0, 100),
      detailId: String(pendingAction.target.detailId || "").slice(0, 128),
      targetType: "reminder",
    },
  }, store);
}

/**
 * best-effort 包装：durable 层是持久化兜底，登记失败不得影响同步对话主链。
 * 失败只留脱敏日志（不含 token / principalKey）。
 */
function registerReminderReceiptWaitBestEffort(pendingAction, principal, store = defaultDurableTaskStore) {
  try {
    return registerReminderReceiptWait({ pendingAction, principal }, store);
  } catch (error) {
    safeLog("ai-agent-durable-register-failed", {
      code: String(error && error.code || "DURABLE_REGISTER_FAILED").slice(0, 60),
    });
    return null;
  }
}

module.exports = {
  armWaitTask,
  createWaitTask,
  registerReminderReceiptWait,
  registerReminderReceiptWaitBestEffort,
  registerWaitEvent,
};
