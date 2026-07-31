/**
 * P5a WS5：任务队列契约的文件实现（integrated 默认）。
 *
 * 由 ragIndexService 原 `rag-index-queue.json` 内嵌实现原样抽取，行为保持：
 *   - 整文件原子覆写（tmp + rename），QUEUE_FORMAT=1；
 *   - 持久化故障 containment（I-5）：只降级「崩溃后恢复排队」的持久性，
 *     不击落进程——任何调用方都不需要自行捕获持久化错误；
 *   - 兼容读取旧版扁平任务记录（见 contract.normalizeJobRecord）；
 *   - 单进程语义（M-6）：同一文件不允许多实例运行——多实例会互相抹掉
 *     pending 任务；standalone 多实例由 Redis Streams 实现解决（WS6 接线）。
 *
 * 本模块只做任务状态存储与状态机，不执行任务（执行器在消费方，如
 * ragIndexService 的进程内最小 worker）。
 */

const fs = require("fs");
const path = require("path");
const {
  QUEUE_FORMAT,
  MAX_ATTEMPTS,
  codedError,
  validateJobInput,
  normalizeJobRecord,
  summarizeJob,
  deadRecordOf,
} = require("./contract");

function atomicWriteJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(value));
  fs.renameSync(tmp, file);
}

function createFileTaskQueue(options = {}) {
  const file = String(options.file || "");
  if (!file) throw codedError("TASK_QUEUE_FILE_REQUIRED");
  const logger = typeof options.logger === "function" ? options.logger : () => {};
  const state = { jobs: [] };
  let loaded = false;

  function persist() {
    try {
      atomicWriteJson(file, { format: QUEUE_FORMAT, jobs: state.jobs });
    } catch (error) {
      logger({
        event: "queue-persist-failed",
        code: String((error && error.code) || "TASK_QUEUE_PERSIST_FAILED"),
        message: String((error && error.message) || "").slice(0, 200),
      });
    }
  }

  function load() {
    if (loaded) return;
    loaded = true;
    let raw = null;
    try {
      raw = JSON.parse(fs.readFileSync(file, "utf8"));
    } catch (_) {
      raw = null;
    }
    if (raw && Array.isArray(raw.jobs)) {
      raw.jobs.forEach((record) => {
        const job = normalizeJobRecord(record);
        if (job) state.jobs.push(job);
      });
    }
  }

  function findJob(jobId) {
    return state.jobs.find((job) => job.jobId === jobId) || null;
  }

  function touch(job) {
    job.updatedAt = new Date().toISOString();
  }

  async function enqueue(input = {}) {
    load();
    const { jobId, kind, payload } = validateJobInput(input);
    const existing = findJob(jobId);
    if (existing) {
      return Object.freeze({ jobId, status: existing.status, deduped: true });
    }
    const now = new Date().toISOString();
    const job = {
      jobId,
      kind,
      payload: Object.assign({}, payload),
      status: "pending",
      attempts: 0,
      errorClass: "",
      createdAt: now,
      updatedAt: now,
    };
    state.jobs.push(job);
    persist();
    return Object.freeze({ jobId, status: job.status, deduped: false });
  }

  async function get(jobId) {
    load();
    const job = findJob(String(jobId || ""));
    return job ? summarizeJob(job) : null;
  }

  async function list() {
    load();
    return state.jobs.map(summarizeJob);
  }

  async function claim(claimInput = {}) {
    load();
    const job = state.jobs.find((item) => item.status === "pending");
    if (!job) return null;
    job.status = "building";
    touch(job);
    persist();
    return Object.freeze(Object.assign({}, summarizeJob(job), { receipt: job.jobId }));
  }

  async function ack(claimed = {}) {
    load();
    const job = findJob(String(claimed.jobId || ""));
    if (!job) throw codedError("TASK_QUEUE_JOB_UNKNOWN", String(claimed.jobId || ""));
    job.status = "done";
    job.errorClass = "";
    touch(job);
    persist();
    return Object.freeze({ jobId: job.jobId, status: job.status });
  }

  async function retry(claimed = {}, retryInput = {}) {
    load();
    const job = findJob(String(claimed.jobId || ""));
    if (!job) throw codedError("TASK_QUEUE_JOB_UNKNOWN", String(claimed.jobId || ""));
    const maxAttempts = Number.isInteger(retryInput.maxAttempts) && retryInput.maxAttempts >= 1
      ? retryInput.maxAttempts
      : MAX_ATTEMPTS;
    job.attempts = (job.attempts || 0) + 1;
    job.errorClass = String(retryInput.errorClass || "TASK_QUEUE_JOB_FAILED");
    job.status = job.attempts >= maxAttempts ? "failed" : "pending";
    touch(job);
    persist();
    return Object.freeze({ jobId: job.jobId, status: job.status, attempts: job.attempts });
  }

  async function requeue(jobId, requeueInput = {}) {
    load();
    const job = findJob(String(jobId || ""));
    if (!job) return null;
    job.status = "pending";
    if (requeueInput.resetAttempts !== false) job.attempts = 0;
    touch(job);
    persist();
    return summarizeJob(job);
  }

  // 崩溃 reclaim：building 是执行器崩溃残留（单进程语义：进程在跑就不存在
  // 合法的滞留 building），按 minIdleMs 过滤后认领给调用方逐一重跑。
  async function reclaimPending(reclaimInput = {}) {
    load();
    const minIdleMs = Number.isFinite(reclaimInput.minIdleMs) ? reclaimInput.minIdleMs : 0;
    const now = Date.now();
    const reclaimed = [];
    state.jobs.forEach((job) => {
      if (job.status !== "building") return;
      const idleMs = now - (Date.parse(job.updatedAt || "") || 0);
      if (idleMs < minIdleMs) return;
      touch(job);
      reclaimed.push(Object.freeze(Object.assign({}, summarizeJob(job), { receipt: job.jobId })));
    });
    if (reclaimed.length) persist();
    return reclaimed;
  }

  async function deadLetter(jobId, deadInput = {}) {
    load();
    const job = findJob(String(jobId || ""));
    if (!job) return false;
    job.status = "failed";
    job.errorClass = String(deadInput.errorClass || job.errorClass || "TASK_QUEUE_DEAD_LETTER");
    touch(job);
    persist();
    return true;
  }

  async function listDead() {
    load();
    return state.jobs.filter((job) => job.status === "failed").map(deadRecordOf);
  }

  async function remove(jobId) {
    load();
    const index = state.jobs.findIndex((job) => job.jobId === String(jobId || ""));
    if (index < 0) return false;
    state.jobs.splice(index, 1);
    persist();
    return true;
  }

  async function close() {
    // 文件实现无连接资源；每次 mutation 已即时 persist，无需追加 flush。
  }

  return Object.freeze({
    kind: "file",
    enqueue,
    get,
    list,
    claim,
    ack,
    retry,
    requeue,
    reclaimPending,
    deadLetter,
    listDead,
    remove,
    close,
  });
}

module.exports = Object.freeze({ createFileTaskQueue });
