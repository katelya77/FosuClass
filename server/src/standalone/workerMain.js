/**
 * P5b WS-A：standalone worker 角色（异步任务消费循环）。
 *
 * 职责边界（tasks.md P5b）：只消费队列异步任务——RAG 摄取/索引等；主聊天 Run
 * 同步链在 server 角色，worker 不监听公网 HTTP（仅 localhost 健康探针）。
 *
 * 消费语义（taskQueue 契约，file/Redis parity 已证）：
 *   claim → runJob → ack | retry(MAX_ATTEMPTS=3) → dead-letter；
 *   启动时 reclaimPending 认领崩溃残留（minIdleMs 门控）并逐一执行闭环；
 *   未知 kind 立即 retry(maxAttempts:1) = 明确 reject 进 dead-letter
 *   （TASK_QUEUE_JOB_KIND_UNSUPPORTED），绝不执行任意 shell 或把用户上传
 *   内容当代码执行——kind 白名单是唯一执行入口；
 *   任务最终状态经队列 PG 镜像（agent_task_queue_mirror）落 PostgreSQL，
 *   Redis 永不做权威源。
 *
 * 取消传播：stop() 置停标 → 本轮 claim 返回后退出循环；在飞任务等待
 * graceMs 收敛，未 ack 的残留由下一次 reclaim 接管（崩溃可恢复语义）。
 *
 * 前置：仅服务 standalone postgres 拓扑（FOSU_AGENT_REPOSITORY_BACKEND=postgres
 * + AGENT_REDIS_URL）；file（integrated）模式无需 worker——integrated 的
 * ragIndexService 进程内即时消费不留队列残留，本角色在 file 模式下拒绝启动
 * （coded AGENT_WORKER_BACKEND_REQUIRED），防止多实例抹队列（M-6）。
 */

const path = require("path");

const { createConfigKernel, createConfigKernelPgRepository } = require("../../../packages/agent-runtime");
const { buildIndex, createRagPublicationAdapter } = require("../../../packages/rag-runtime");
const { createPgRagIndexStore } = require("../services/ai/ragIndexPgStore");
const { createRedisStreamsTaskQueue } = require("../services/ai/taskQueue/redisStreamsTaskQueue");
const { MAX_ATTEMPTS } = require("../services/ai/taskQueue/contract");
const { BACKEND_ENV, resolveRepositoryBackend } = require("../services/ai/persistence/repositoryBackend");
const pgPersistenceService = require("../services/ai/persistence/pgPersistenceService");
const { errorClassOf } = require("./standaloneLogger");
const { normalizeRuntimeMode } = require("./standalonePlugin");

const RAG_BUILD_KIND = "rag-index-build";

function codedError(code, message) {
  const error = new Error(message || code);
  error.code = code;
  return error;
}

function safeString(value, maxLength = 240) {
  return String(value == null ? "" : value).trim().slice(0, maxLength);
}

function intEnv(env, name, fallback, min, max) {
  const value = Number(env && env[name]);
  if (!Number.isFinite(value)) return fallback;
  return Math.max(min, Math.min(max, Math.floor(value)));
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function createWorkerRuntime(options = {}) {
  const env = options.env || process.env;
  const logger = typeof options.logger === "function" ? options.logger : () => {};

  const backend = resolveRepositoryBackend(env[BACKEND_ENV]);
  if (backend !== "postgres") {
    throw codedError(
      "AGENT_WORKER_BACKEND_REQUIRED",
      "standalone worker requires FOSU_AGENT_REPOSITORY_BACKEND=postgres (integrated file mode consumes in-process and needs no worker)"
    );
  }

  const lazyPool = {
    query: (text, params) => pgPersistenceService.getPool().query(text, params),
    connect: () => pgPersistenceService.getPool().connect(),
  };
  const stream = safeString(env.AGENT_REDIS_STREAM, 120) || "agent-platform-tasks";
  // 未配置 AGENT_REDIS_URL 时 createRedisStreamsTaskQueue 抛 coded
  // TASK_QUEUE_REDIS_CONFIG_REQUIRED（fail closed，不伪造可运行）。
  const queue = createRedisStreamsTaskQueue({
    url: safeString(env.AGENT_REDIS_URL, 400),
    stream,
    group: safeString(env.AGENT_REDIS_STREAM_GROUP, 60) || "workers",
    consumer: `worker-${process.pid}-${Date.now().toString(36)}`,
    pool: lazyPool,
    mirrorNamespace: stream,
  });

  const ragPublicationAdapter = createRagPublicationAdapter();
  const configKernel = createConfigKernel({
    repository: createConfigKernelPgRepository({ pool: lazyPool }),
    domainAdapters: { rag: ragPublicationAdapter },
    environments: ["public", "trial", "dev"],
    logger,
  });
  const indexStore = createPgRagIndexStore({ pool: lazyPool, logger });

  const claimBlockMs = intEnv(env, "AGENT_WORKER_CLAIM_BLOCK_MS", 5000, 100, 30000);
  const reclaimMinIdleMs = intEnv(env, "AGENT_WORKER_RECLAIM_MIN_IDLE_MS", 60000, 0, 3600000);
  const errorBackoffMs = intEnv(env, "AGENT_WORKER_ERROR_BACKOFF_MS", 1000, 50, 60000);
  const migrationWaitMs = intEnv(env, "AGENT_WORKER_MIGRATION_WAIT_MS", 120000, 0, 600000);

  const state = {
    stopped: false,
    inFlight: 0,
    lastJobAt: "",
    lastErrorClass: "",
    consumedCount: 0,
    deadLetteredCount: 0,
  };

  async function runRagIndexBuild(job) {
    const payload = job && job.payload || {};
    const environment = safeString(payload.environment, 40);
    const artifactId = safeString(payload.artifactId, 100);
    const kbId = safeString(payload.kbId, 64);
    const version = Number(payload.version);
    if (!environment || !artifactId || !kbId || !Number.isInteger(version) || version < 1) {
      throw codedError("RAG_INDEX_JOB_INVALID", `job ${safeString(job && job.jobId, 120)} payload is invalid`);
    }
    // 内容源唯一：按引用从内核重取发布物（队列不复制文档内容）。
    const versionDoc = await configKernel.getArtifactVersion({ domain: "rag", artifactId, environment, version });
    const artifact = ragPublicationAdapter.resolveRuntime(versionDoc);
    const index = await buildIndex({
      kbId,
      version,
      documents: artifact.documents,
      retrieval: artifact.retrieval,
    });
    // 版本产物写入含回读 digest 校验；写损坏立即失败，不推进 lkg。
    await indexStore.writeVersion(environment, kbId, version, index);
    await indexStore.writeLkg(environment, kbId, {
      kbId,
      version,
      environment,
      builtAt: new Date().toISOString(),
      digest: index.digest,
    });
    return { chunks: index.chunks.length, digest: index.digest.slice(0, 16) };
  }

  // kind 白名单：唯一执行入口；未知 kind 走 dead-letter，不进任何执行链。
  const jobHandlers = Object.freeze({
    [RAG_BUILD_KIND]: runRagIndexBuild,
  });

  async function runJob(job) {
    const handler = jobHandlers[safeString(job && job.kind, 80)];
    if (!handler) {
      // maxAttempts:1 → 首次即达预算上限，簿记 dead-letter（含 XACK 闭环）。
      await queue.retry(job, { errorClass: "TASK_QUEUE_JOB_KIND_UNSUPPORTED", maxAttempts: 1 });
      state.deadLetteredCount += 1;
      logger({ event: "worker-job-kind-unsupported", jobId: safeString(job && job.jobId, 160), kind: safeString(job && job.kind, 80) });
      return;
    }
    try {
      const outcome = await handler(job);
      await queue.ack(job);
      state.consumedCount += 1;
      state.lastJobAt = new Date().toISOString();
      logger({ event: "worker-job-done", jobId: safeString(job.jobId, 160), kind: safeString(job.kind, 80), outcome });
    } catch (error) {
      const errorClass = errorClassOf(error);
      state.lastErrorClass = errorClass;
      try {
        const result = await queue.retry(job, { errorClass, maxAttempts: MAX_ATTEMPTS });
        logger({ event: "worker-job-retry", jobId: safeString(job.jobId, 160), kind: safeString(job.kind, 80), errorClass, attempts: result.attempts, status: result.status });
      } catch (retryError) {
        // retry 记账失败：条目仍在 PEL，可经 reclaim 重投（执行幂等）——只留信号。
        logger({ event: "worker-job-retry-failed", jobId: safeString(job.jobId, 160), errorClass: errorClassOf(retryError) }, "warn");
      }
    }
  }

  async function waitForMigrations() {
    const deadline = Date.now() + migrationWaitMs;
    for (;;) {
      try {
        const status = await pgPersistenceService.getMigrationStatus();
        if (!status.pending.length) return status;
      } catch (error) {
        state.lastErrorClass = errorClassOf(error);
      }
      if (Date.now() >= deadline) {
        throw codedError("AGENT_WORKER_MIGRATION_PENDING", "migrations not complete within the wait budget");
      }
      await sleep(1000);
    }
  }

  const startupState = { started: false, failed: "", startedAt: "" };

  async function start() {
    try {
      await waitForMigrations();
      // 崩溃残留认领：返回即已归入本 consumer PEL，必须逐一 runJob 闭环。
      const reclaimed = await queue.reclaimPending({ minIdleMs: reclaimMinIdleMs });
      if (reclaimed.length) {
        logger({ event: "worker-reclaimed", count: reclaimed.length });
      }
      for (const job of reclaimed) {
        if (state.stopped) break;
        state.inFlight += 1;
        try {
          await runJob(job);
        } finally {
          state.inFlight -= 1;
        }
      }
      startupState.started = true;
      startupState.startedAt = new Date().toISOString();
      logger({ event: "worker-started", stream, claimBlockMs, reclaimMinIdleMs });
      while (!state.stopped) {
        let job = null;
        try {
          job = await queue.claim({ blockMs: claimBlockMs });
        } catch (error) {
          if (state.stopped) break;
          state.lastErrorClass = errorClassOf(error);
          logger({ event: "worker-claim-failed", errorClass: state.lastErrorClass }, "warn");
          await sleep(errorBackoffMs);
          continue;
        }
        if (!job) continue;
        state.inFlight += 1;
        try {
          await runJob(job);
        } finally {
          state.inFlight -= 1;
        }
      }
    } catch (error) {
      startupState.failed = errorClassOf(error);
      throw error;
    }
  }

  async function stop(graceMs = 10000) {
    state.stopped = true;
    const deadline = Date.now() + Math.max(0, Number(graceMs) || 0);
    while (state.inFlight > 0 && Date.now() < deadline) {
      await sleep(50);
    }
    try {
      await queue.close();
    } catch (_) {
      /* 尽力而为 */
    }
    logger({ event: "worker-stopped", consumedCount: state.consumedCount, deadLetteredCount: state.deadLetteredCount });
  }

  // worker 健康适配：复用 healthRoutes 九项形状；provider 项恒 unknown
  // （worker 无 Provider 链，该项对 worker 无意义且不阻断）。
  function defaultEnvironment() {
    return normalizeRuntimeMode(env.AGENT_PLATFORM_RUNTIME_MODE);
  }
  const readinessAdapter = Object.freeze({
    startupState,
    async readinessItems() {
      const items = {};
      try {
        await lazyPool.query("SELECT 1", []);
        items.postgres = { status: "ok", reason: "OK" };
      } catch (error) {
        items.postgres = { status: "not_ready", reason: errorClassOf(error) };
      }
      try {
        await queue.listDead();
        items.redis = { status: "ok", reason: "OK" };
        items.workerQueue = { status: "ok", reason: "OK", stream, consuming: !state.stopped };
      } catch (error) {
        items.redis = { status: "not_ready", reason: errorClassOf(error) };
        items.workerQueue = { status: "not_ready", reason: errorClassOf(error) };
      }
      try {
        const status = await pgPersistenceService.getMigrationStatus();
        items.migration = status.pending.length
          ? { status: "not_ready", reason: "MIGRATION_PENDING", pendingCount: status.pending.length }
          : { status: "ok", reason: "OK", schemaVersion: status.schemaVersion };
      } catch (error) {
        items.migration = { status: "not_ready", reason: errorClassOf(error) };
      }
      try {
        await configKernel.diagnostics(defaultEnvironment());
        items.artifactRepository = { status: "ok", reason: "OK" };
      } catch (error) {
        items.artifactRepository = { status: "not_ready", reason: errorClassOf(error) };
      }
      try {
        const snapshot = await configKernel.getCurrentSnapshot(defaultEnvironment());
        items.configSnapshot = snapshot
          ? { status: "ok", reason: "OK" }
          : { status: "not_ready", reason: "CONFIG_SNAPSHOT_MISSING" };
        const configVersion = snapshot && safeString(snapshot.configVersion, 128);
        items.publishedConfigVersion = configVersion && configVersion.indexOf("manifest:") !== 0
          ? { status: "ok", reason: "OK", configVersion }
          : { status: "not_ready", reason: "CONFIG_VERSION_NOT_PUBLISHED" };
      } catch (error) {
        items.configSnapshot = { status: "not_ready", reason: errorClassOf(error) };
        items.publishedConfigVersion = { status: "not_ready", reason: errorClassOf(error) };
      }
      try {
        await indexStore.readLkg(defaultEnvironment(), safeString(ragPublicationAdapter.seedPayload().kbId, 64));
        items.ragBackend = { status: "ok", reason: "OK", backend: indexStore.kind };
      } catch (error) {
        items.ragBackend = { status: "not_ready", reason: errorClassOf(error) };
      }
      items.provider = { status: "unknown", reason: "NOT_APPLICABLE", blocking: false };
      return Object.freeze(items);
    },
  });

  return Object.freeze({
    kind: "standalone-worker",
    stream,
    state,
    startupState,
    readinessAdapter,
    runJob,
    start,
    stop,
    getQueue: () => queue,
  });
}

module.exports = Object.freeze({
  createWorkerRuntime,
});
