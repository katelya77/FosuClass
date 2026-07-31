/**
 * P5a WS5：任务队列契约的 Redis Streams 实现（standalone 传输层，WS6 接线 worker）。
 *
 * 结构：
 *   - 主流 `${stream}`：待投递任务（XADD 追加；字段 jobId/kind/payload/attempts）；
 *   - consumer group：XREADGROUP 认领新任务，XACK 完成投递闭环；
 *   - 停滞 reclaim：XAUTOCLAIM 把崩溃 consumer 的 PEL 条目认领给当前 consumer
 *     （minIdleMs 门控），返回即已认领，调用方必须逐一 ack/retry；
 *   - dead-letter stream `${stream}:dead`：重试预算耗尽/显式判死的终态快照；
 *   - 状态簿记 hash `${stream}:job:{jobId}`：jobId 幂等去重与状态视图
 *     （传输层簿记，非权威源）。
 *
 * 权威源纪律（design.md §8.3）：Redis 永不作权威源。配置 pool 时任务状态
 * 镜像落 PostgreSQL `agent_durable_tasks`（migration 0003，task_id 为
 * `tq:<namespace>:<jobId>`）：
 *   - enqueue 先查镜像去重（跨重启幂等），PG 不可用 → 明确失败，不伪造已入队；
 *   - ack/retry/reclaim 同步镜像最终状态，镜像写失败 → coded error 传播
 *     （任务可经 reclaim 重投，消费方构建幂等，不会制造不一致）；
 *   - Redis 连接不可用 → 一律 TASK_QUEUE_REDIS_UNAVAILABLE coded error，
 *     任何入口都不返回伪造的入队/认领成功。
 */

const crypto = require("crypto");
const {
  MAX_ATTEMPTS,
  codedError,
  validateJobInput,
  summarizeJob,
  deadRecordOf,
} = require("./contract");

const REDIS_UNAVAILABLE_PATTERN = /ECONNREFUSED|ETIMEDOUT|ENOTFOUND|EAI_AGAIN|ECONNRESET|EPIPE|ENETUNREACH|EHOSTUNREACH|Connection is closed|stream is not writable|maxRetriesPerRequest|Socket closed/i;

function wrapQueueError(error) {
  const code = String((error && error.code) || "");
  if (code.startsWith("TASK_QUEUE_") || code.startsWith("PG_")) return error;
  const message = String((error && error.message) || error || "redis error").slice(0, 300);
  return codedError(
    REDIS_UNAVAILABLE_PATTERN.test(message) ? "TASK_QUEUE_REDIS_UNAVAILABLE" : "TASK_QUEUE_FAILED",
    message
  );
}

function fieldsToObject(fields) {
  const out = {};
  if (!Array.isArray(fields)) return out;
  for (let index = 0; index + 1 < fields.length; index += 2) {
    out[fields[index]] = fields[index + 1];
  }
  return out;
}

function entryToJob(entryId, fields) {
  const raw = fieldsToObject(fields);
  if (!raw.jobId) return null;
  let payload = {};
  try {
    payload = raw.payload ? JSON.parse(raw.payload) : {};
  } catch (_) {
    payload = {};
  }
  const attempts = Number.parseInt(raw.attempts || "0", 10);
  return {
    jobId: raw.jobId,
    kind: raw.kind || "",
    payload: payload && typeof payload === "object" && !Array.isArray(payload) ? payload : {},
    status: "pending",
    attempts: Number.isInteger(attempts) && attempts >= 0 ? attempts : 0,
    errorClass: "",
    createdAt: "",
    updatedAt: "",
    receipt: entryId,
  };
}

function hashToJob(raw) {
  if (!raw || !raw.jobId) return null;
  let payload = {};
  try {
    payload = raw.payload ? JSON.parse(raw.payload) : {};
  } catch (_) {
    payload = {};
  }
  const attempts = Number.parseInt(raw.attempts || "0", 10);
  return {
    jobId: raw.jobId,
    kind: raw.kind || "",
    payload: payload && typeof payload === "object" && !Array.isArray(payload) ? payload : {},
    status: raw.status || "pending",
    attempts: Number.isInteger(attempts) && attempts >= 0 ? attempts : 0,
    errorClass: raw.errorClass || "",
    createdAt: raw.createdAt || "",
    updatedAt: raw.updatedAt || "",
  };
}

function createRedisStreamsTaskQueue(options = {}) {
  const logger = typeof options.logger === "function" ? options.logger : () => {};
  const stream = String(options.stream || "");
  if (!stream) throw codedError("TASK_QUEUE_STREAM_REQUIRED");
  const deadStream = String(options.deadStream || `${stream}:dead`);
  const group = String(options.group || "workers");
  const consumer = String(options.consumer || `c-${process.pid}-${crypto.randomBytes(3).toString("hex")}`);
  const mirrorNamespace = String(options.mirrorNamespace || stream);
  const pool = options.pool || null;

  let redis = options.redis || null;
  let owned = false;
  if (!redis) {
    const url = String(options.url || process.env.AGENT_REDIS_URL || "");
    if (!url) throw codedError("TASK_QUEUE_REDIS_CONFIG_REQUIRED", "provide options.url/options.redis or AGENT_REDIS_URL");
    const Redis = require("ioredis");
    redis = new Redis(url, Object.assign({ lazyConnect: false }, options.redisOptions || {}));
    // EventEmitter 对无监听的 'error' 直接抛未处理异常击落宿主进程（与 pg Pool
    // 同纪律）：连接层错误一律经各调用的 coded error 传播，实例级错误事件挂空监听。
    redis.on("error", () => {});
    owned = true;
  }

  const hashKey = (jobId) => `${stream}:job:${jobId}`;
  let groupReady = null;

  async function guarded(fn) {
    try {
      return await fn();
    } catch (error) {
      throw wrapQueueError(error);
    }
  }

  function ensureGroup() {
    if (!groupReady) {
      groupReady = (async () => {
        try {
          // 起点 0（而非 $）：建组前已入队的消息必须可投递（先入队后建组的
          // 正常时序）；重复投递由 claim 的 done/failed 陈旧条目守卫吸收。
          await redis.xgroup("CREATE", stream, group, "0", "MKSTREAM");
        } catch (error) {
          if (!/BUSYGROUP/i.test(String((error && error.message) || ""))) throw error;
        }
      })().catch((error) => {
        groupReady = null; // 失败后下一次调用重试（含 NOGROUP 恢复路径）
        throw wrapQueueError(error);
      });
    }
    return groupReady;
  }

  // ---- PG 镜像（agent_durable_tasks，migration 0003）----
  const mirrorTaskId = (jobId) => `tq:${mirrorNamespace}:${jobId}`;

  async function mirrorGet(jobId) {
    if (!pool) return null;
    const { query } = require("../../../../../packages/agent-runtime");
    const result = await query(pool, "SELECT doc FROM agent_durable_tasks WHERE task_id = $1", [mirrorTaskId(jobId)]);
    const row = result.rows && result.rows[0];
    return row && row.doc && typeof row.doc === "object" ? row.doc : null;
  }

  async function mirrorUpsert(job, status) {
    if (!pool) return;
    const { query } = require("../../../../../packages/agent-runtime");
    const doc = {
      jobId: job.jobId,
      kind: job.kind,
      payload: job.payload,
      status,
      attempts: job.attempts || 0,
      errorClass: job.errorClass || "",
      queue: mirrorNamespace,
      updatedAt: job.updatedAt || new Date().toISOString(),
    };
    await query(
      pool,
      "INSERT INTO agent_durable_tasks (task_id, status, expires_at, doc, updated_at) VALUES ($1, $2, NULL, $3, now()) " +
        "ON CONFLICT (task_id) DO UPDATE SET status = EXCLUDED.status, doc = EXCLUDED.doc, updated_at = now()",
      [mirrorTaskId(job.jobId), status, JSON.stringify(doc)]
    );
  }

  async function mirrorDelete(jobId) {
    if (!pool) return;
    const { query } = require("../../../../../packages/agent-runtime");
    await query(pool, "DELETE FROM agent_durable_tasks WHERE task_id = $1", [mirrorTaskId(jobId)]);
  }

  async function writeHash(job, status) {
    const now = new Date().toISOString();
    const record = {
      jobId: job.jobId,
      kind: job.kind,
      payload: JSON.stringify(job.payload || {}),
      status,
      attempts: String(job.attempts || 0),
      errorClass: job.errorClass || "",
      createdAt: job.createdAt || now,
      updatedAt: now,
    };
    await redis.hset(hashKey(job.jobId), record);
    return record.updatedAt;
  }

  async function enqueue(input = {}) {
    const { jobId, kind, payload } = validateJobInput(input);
    return guarded(async () => {
      if (pool) {
        const mirrored = await mirrorGet(jobId);
        if (mirrored) {
          return Object.freeze({ jobId, status: String(mirrored.status || "pending"), deduped: true });
        }
      } else {
        const existing = await redis.hgetall(hashKey(jobId));
        const job = hashToJob(existing);
        if (job) return Object.freeze({ jobId, status: job.status, deduped: true });
      }
      const job = {
        jobId, kind, payload, attempts: 0, errorClass: "", createdAt: new Date().toISOString(),
      };
      const entryId = await redis.xadd(
        stream, "*",
        "jobId", jobId,
        "kind", kind,
        "payload", JSON.stringify(payload),
        "attempts", "0"
      );
      await writeHash(job, "pending");
      try {
        await mirrorUpsert(job, "pending");
      } catch (error) {
        // 镜像失败 → 尽力回收传输层痕迹后如实失败（不伪造已入队）。
        try { await redis.xdel(stream, entryId); } catch (_) { /* 尽力而为 */ }
        try { await redis.del(hashKey(jobId)); } catch (_) { /* 尽力而为 */ }
        throw error;
      }
      return Object.freeze({ jobId, status: "pending", deduped: false });
    });
  }

  async function get(jobId) {
    return guarded(async () => {
      const job = hashToJob(await redis.hgetall(hashKey(String(jobId || ""))));
      return job ? summarizeJob(job) : null;
    });
  }

  // 状态视图（SCAN 簿记 hash）：仅供管理/测试，非热路径。
  async function list() {
    return guarded(async () => {
      const jobs = [];
      let cursor = "0";
      do {
        const reply = await redis.scan(cursor, "MATCH", `${stream}:job:*`, "COUNT", 200);
        cursor = reply[0];
        for (const key of reply[1]) {
          const job = hashToJob(await redis.hgetall(key));
          if (job) jobs.push(summarizeJob(job));
        }
      } while (cursor !== "0");
      jobs.sort((a, b) => (a.jobId < b.jobId ? -1 : a.jobId > b.jobId ? 1 : 0));
      return jobs;
    });
  }

  // 认领一个从未投递过的任务；已过账为 done/failed 的陈旧副本（至少一次
  // 投递下的重复条目）直接 XACK 跳过，不二次交给执行器。
  async function claim(claimInput = {}) {
    const blockMs = Number.isInteger(claimInput.blockMs) && claimInput.blockMs > 0 ? claimInput.blockMs : 0;
    return guarded(async () => {
      await ensureGroup();
      for (;;) {
        const args = ["GROUP", group, consumer, "COUNT", 1];
        if (blockMs) args.push("BLOCK", blockMs);
        args.push("STREAMS", stream, ">");
        const reply = await redis.xreadgroup(...args);
        if (!reply) return null;
        const entries = (reply[0] && reply[0][1]) || [];
        if (!entries.length) return null;
        const [entryId, fields] = entries[0];
        const job = entryToJob(entryId, fields);
        if (!job) {
          await redis.xack(stream, group, entryId);
          continue;
        }
        const recorded = hashToJob(await redis.hgetall(hashKey(job.jobId)));
        if (recorded && (recorded.status === "done" || recorded.status === "failed")) {
          await redis.xack(stream, group, entryId);
          continue;
        }
        if (recorded) {
          job.attempts = recorded.attempts;
          job.createdAt = recorded.createdAt;
        }
        job.status = "building";
        job.updatedAt = await writeHash(job, "building");
        await mirrorUpsert(job, "building");
        return Object.freeze(job);
      }
    });
  }

  async function ack(claimed = {}) {
    return guarded(async () => {
      const jobId = String(claimed.jobId || "");
      const receipt = String(claimed.receipt || "");
      if (receipt) await redis.xack(stream, group, receipt);
      const recorded = hashToJob(await redis.hgetall(hashKey(jobId))) || { jobId, kind: claimed.kind || "", payload: claimed.payload || {}, attempts: claimed.attempts || 0 };
      recorded.errorClass = "";
      await writeHash(recorded, "done");
      await mirrorUpsert(recorded, "done");
      return Object.freeze({ jobId, status: "done" });
    });
  }

  async function retry(claimed = {}, retryInput = {}) {
    return guarded(async () => {
      const jobId = String(claimed.jobId || "");
      const receipt = String(claimed.receipt || "");
      const maxAttempts = Number.isInteger(retryInput.maxAttempts) && retryInput.maxAttempts >= 1
        ? retryInput.maxAttempts
        : MAX_ATTEMPTS;
      const recorded = hashToJob(await redis.hgetall(hashKey(jobId))) || {
        jobId, kind: claimed.kind || "", payload: claimed.payload || {}, attempts: claimed.attempts || 0, createdAt: "",
      };
      recorded.attempts = (recorded.attempts || 0) + 1;
      recorded.errorClass = String(retryInput.errorClass || "TASK_QUEUE_JOB_FAILED");
      const exhausted = recorded.attempts >= maxAttempts;
      if (receipt) await redis.xack(stream, group, receipt);
      if (exhausted) {
        const deadAt = new Date().toISOString();
        await redis.xadd(
          deadStream, "*",
          "jobId", recorded.jobId,
          "kind", recorded.kind,
          "payload", JSON.stringify(recorded.payload || {}),
          "attempts", String(recorded.attempts),
          "errorClass", recorded.errorClass,
          "deadAt", deadAt
        );
        await writeHash(recorded, "failed");
        await mirrorUpsert(recorded, "failed");
        return Object.freeze({ jobId, status: "failed", attempts: recorded.attempts });
      }
      await redis.xadd(
        stream, "*",
        "jobId", recorded.jobId,
        "kind", recorded.kind,
        "payload", JSON.stringify(recorded.payload || {}),
        "attempts", String(recorded.attempts)
      );
      await writeHash(recorded, "pending");
      await mirrorUpsert(recorded, "pending");
      return Object.freeze({ jobId, status: "pending", attempts: recorded.attempts });
    });
  }

  async function requeue(jobId, requeueInput = {}) {
    return guarded(async () => {
      const id = String(jobId || "");
      const recorded = hashToJob(await redis.hgetall(hashKey(id)));
      if (!recorded) return null;
      if (requeueInput.resetAttempts !== false) recorded.attempts = 0;
      recorded.errorClass = "";
      await redis.xadd(
        stream, "*",
        "jobId", recorded.jobId,
        "kind", recorded.kind,
        "payload", JSON.stringify(recorded.payload || {}),
        "attempts", String(recorded.attempts)
      );
      recorded.updatedAt = await writeHash(recorded, "pending");
      await mirrorUpsert(recorded, "pending");
      return summarizeJob(recorded);
    });
  }

  // XAUTOCLAIM 把停滞条目认领到当前 consumer 的 PEL：返回即已认领，
  // 调用方必须逐一 ack/retry 完成闭环。
  async function reclaimPending(reclaimInput = {}) {
    const minIdleMs = Number.isFinite(reclaimInput.minIdleMs) ? reclaimInput.minIdleMs : 0;
    const count = Number.isInteger(reclaimInput.count) && reclaimInput.count >= 1 ? reclaimInput.count : 100;
    return guarded(async () => {
      await ensureGroup();
      const reply = await redis.xautoclaim(stream, group, consumer, minIdleMs, "0", "COUNT", count);
      const entries = (reply && reply[1]) || [];
      const reclaimed = [];
      for (const [entryId, fields] of entries) {
        if (!Array.isArray(fields) || !fields.length) continue; // 已删除条目的墓碑
        const job = entryToJob(entryId, fields);
        if (!job) continue;
        const recorded = hashToJob(await redis.hgetall(hashKey(job.jobId)));
        if (recorded) {
          job.attempts = recorded.attempts;
          job.errorClass = recorded.errorClass;
          job.createdAt = recorded.createdAt;
        }
        job.status = "building";
        job.updatedAt = await writeHash(job, "building");
        await mirrorUpsert(job, "building");
        reclaimed.push(Object.freeze(job));
      }
      return reclaimed;
    });
  }

  async function deadLetter(jobId, deadInput = {}) {
    return guarded(async () => {
      const id = String(jobId || "");
      const recorded = hashToJob(await redis.hgetall(hashKey(id)));
      if (!recorded) return false;
      recorded.errorClass = String(deadInput.errorClass || recorded.errorClass || "TASK_QUEUE_DEAD_LETTER");
      const deadAt = new Date().toISOString();
      await redis.xadd(
        deadStream, "*",
        "jobId", recorded.jobId,
        "kind", recorded.kind,
        "payload", JSON.stringify(recorded.payload || {}),
        "attempts", String(recorded.attempts || 0),
        "errorClass", recorded.errorClass,
        "deadAt", deadAt
      );
      await writeHash(recorded, "failed");
      await mirrorUpsert(recorded, "failed");
      return true;
    });
  }

  async function listDead() {
    return guarded(async () => {
      const reply = await redis.xrange(deadStream, "-", "+");
      return (reply || [])
        .map(([entryId, fields]) => {
          const raw = fieldsToObject(fields);
          if (!raw.jobId) return null;
          let payload = {};
          try {
            payload = raw.payload ? JSON.parse(raw.payload) : {};
          } catch (_) {
            payload = {};
          }
          return deadRecordOf({
            jobId: raw.jobId,
            kind: raw.kind || "",
            payload,
            attempts: Number.parseInt(raw.attempts || "0", 10) || 0,
            errorClass: raw.errorClass || "",
            updatedAt: raw.deadAt || entryId,
          });
        })
        .filter(Boolean);
    });
  }

  async function remove(jobId) {
    return guarded(async () => {
      const id = String(jobId || "");
      const removed = await redis.del(hashKey(id));
      await mirrorDelete(id);
      return removed > 0;
    });
  }

  async function close() {
    if (owned && redis) {
      try {
        await redis.quit();
      } catch (_) {
        try { redis.disconnect(); } catch (_) { /* 尽力而为 */ }
      }
    }
  }

  return Object.freeze({
    kind: "redis-streams",
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

module.exports = Object.freeze({ createRedisStreamsTaskQueue });
