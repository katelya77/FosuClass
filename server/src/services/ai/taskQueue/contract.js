/**
 * P5a WS5：任务队列接口契约（file / Redis Streams 双实现共用）。
 *
 * 契约方法（全部 async，双实现 parity 由 tools/test-agent-p5a-task-queue.js 验证）：
 *   enqueue({jobId, kind, payload}) → {jobId, status, deduped}
 *     —— 稳定 jobId 幂等去重：已存在同 jobId 任务 → 返回现状且 deduped:true，
 *        不重复投递。这是「至少一次投递」下业务幂等的第一道锚（第二道是
 *        消费方的产物可读性检查，见 ragIndexService.requestBuild）。
 *   get(jobId) → job|null；list() → [job]
 *   claim({consumer, blockMs}) → job|null
 *     —— 原子地把一个 pending 任务转为 building 并归 consumer 所有；
 *        返回的 job 带不透明 receipt，ack/retry 凭它完成投递闭环。
 *   ack(job) → {jobId, status:"done"}
 *   retry(job, {errorClass, maxAttempts}) → {jobId, status:"pending"|"failed", attempts}
 *     —— attempts+1；达到重试预算上限（共享常量 MAX_ATTEMPTS=3）转入
 *        dead-letter（status failed），否则回到 pending 等待重新投递。
 *   requeue(jobId, {resetAttempts}) → job|null
 *     —— 任意状态重置回 pending（re-pin 即重试语义由消费方驱动）。
 *   reclaimPending({consumer, minIdleMs, count}) → [job]
 *     —— 把停滞（崩溃残留）的 building 任务收回并认领给 consumer；
 *        调用方必须逐一 runJob + ack/retry（Redis 侧条目已在 consumer PEL，
 *        不会再经 XREADGROUP ">" 投递）。
 *   deadLetter(jobId, {errorClass}) → bool —— 显式终态（预算外人工判死）。
 *   listDead() → [{jobId, kind, payload, attempts, errorClass, deadAt}]
 *   remove(jobId) → bool —— 出队（done 且产物已验证可读后的幂等清理）。
 *   close() → 释放连接（file 为 no-op）。
 *
 * 状态机：pending → building → done | (retry → pending)* → failed(=dead)。
 * 状态字面量沿用既有文件格式（pending/building/done/failed），failed 即
 * dead-letter 终态；deadAt 取任务进入终态的 updatedAt。
 *
 * 重试预算：MAX_ATTEMPTS=3 为全平台共享明确预算（Q11 七），双实现同一常量。
 */

const QUEUE_FORMAT = 1;
const MAX_ATTEMPTS = 3;

const JOB_STATUSES = Object.freeze(["pending", "building", "done", "failed"]);

function codedError(code, message) {
  const error = new Error(message || code);
  error.code = code;
  return error;
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function validateJobInput(input = {}) {
  const jobId = String(input.jobId || "");
  const kind = String(input.kind || "");
  if (!jobId || jobId.length > 512) throw codedError("TASK_QUEUE_JOB_INVALID", "jobId must be a non-empty string (<=512 chars)");
  if (!kind) throw codedError("TASK_QUEUE_JOB_INVALID", "kind must be a non-empty string");
  const payload = input.payload === undefined ? {} : input.payload;
  if (!isPlainObject(payload)) throw codedError("TASK_QUEUE_JOB_INVALID", "payload must be a plain object");
  return { jobId, kind, payload };
}

// 兼容既有 rag-index-queue.json 的扁平记录（environment/artifactId/kbId/version
// 在顶层、无 kind/payload）与新格式（kind + payload 嵌套）；非法记录返回 null。
function normalizeJobRecord(record) {
  if (!isPlainObject(record) || !record.jobId) return null;
  let kind = typeof record.kind === "string" && record.kind ? record.kind : "";
  let payload = isPlainObject(record.payload) ? Object.assign({}, record.payload) : null;
  if (!payload) {
    // 旧格式：扁平 RAG 字段折叠进 payload。
    payload = {
      environment: String(record.environment || ""),
      artifactId: String(record.artifactId || ""),
      kbId: String(record.kbId || ""),
      version: Number(record.version),
    };
    if (!kind) kind = "rag-index-build";
  }
  if (!kind) return null;
  const status = JOB_STATUSES.indexOf(record.status) >= 0 ? record.status : "pending";
  return {
    jobId: String(record.jobId),
    kind,
    payload,
    status,
    attempts: Number.isInteger(record.attempts) && record.attempts >= 0 ? record.attempts : 0,
    errorClass: typeof record.errorClass === "string" ? record.errorClass : "",
    createdAt: typeof record.createdAt === "string" && record.createdAt ? record.createdAt : new Date().toISOString(),
    updatedAt: typeof record.updatedAt === "string" && record.updatedAt ? record.updatedAt : new Date().toISOString(),
  };
}

function summarizeJob(job) {
  return Object.freeze({
    jobId: job.jobId,
    kind: job.kind,
    payload: Object.freeze(Object.assign({}, job.payload)),
    status: job.status,
    attempts: job.attempts,
    errorClass: job.errorClass,
    createdAt: job.createdAt,
    updatedAt: job.updatedAt,
  });
}

function deadRecordOf(job) {
  return Object.freeze({
    jobId: job.jobId,
    kind: job.kind,
    payload: Object.freeze(Object.assign({}, job.payload)),
    attempts: job.attempts,
    errorClass: job.errorClass,
    deadAt: job.updatedAt,
  });
}

module.exports = Object.freeze({
  QUEUE_FORMAT,
  MAX_ATTEMPTS,
  JOB_STATUSES,
  codedError,
  validateJobInput,
  normalizeJobRecord,
  summarizeJob,
  deadRecordOf,
});
