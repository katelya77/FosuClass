// P4d：RAG 索引服务（server 侧）。P5a WS5 起拆分为三条 seam：
// - 索引产物存储（indexStore）：file（integrated 默认，ragIndexFileStore）
//   | postgres（standalone，ragIndexPgStore + migration 0005，索引元数据、
//   序列化索引与分块向量全部落 PG，不再依赖容器文件系统）。后端由
//   FOSU_AGENT_REPOSITORY_BACKEND 经 persistence/repositoryBackend 判定，
//   领域规则（钉住版本 → lkg 只回退更旧 → 扫描兜底 → fail closed）双实现共用。
// - 构建队列（taskQueue 契约）：file 实现（integrated 默认，进程内最小 worker
//   即时消费，不留无法消费的队列任务）| Redis Streams 实现（已交付
//   taskQueue/redisStreamsTaskQueue，worker 启动角色接线属 WS6/P5b——
//   本服务不主动连 Redis）。业务语义（稳定 jobId/幂等/reclaim/有界重试）
//   与传输无关，由契约常量共享（MAX_ATTEMPTS=3）。
// - 内容源： reclaim 时经 resolveArtifact 从内核重取发布物（队列不复制
//   文档内容，内核是唯一内容源；索引是可重建派生物，不构成第二事实源）。
//
// 部署约束（M-6）：file 队列同一 root 不允许多实例运行——队列文件是整文件
// 覆写，多实例会互相抹掉 pending 任务；standalone 多实例由 WS6 接线
// Redis Streams 解决。
//
// 故障 containment（I-5）：队列文件持久化失败只降级「崩溃后恢复排队」的
// 持久性，不击落进程——索引是可重建派生物，下一次 requestBuild/reclaim 自愈。
//
// 失败自愈（I-1）：re-pin 一个构建失败过的版本本身就是重试信号
// （requestBuild 自动重排队 failed 任务，冷却期防抖，attempts 仍有界）；
// 扫描兜底保证 rollback 越过失败版本后查询永远有 ≤ 钉住版本的可服务索引。
//
// 草稿不可见性：索引只从「已发布且被快照钉住」的版本构建（requestBuild 的
// 唯一调用方是快照解析钩子），draft 永远没有索引产物。
//
// 接口异步化（P5a）：PG 存储是异步 I/O，loadIndex/getIndexStatus/listJobs
// 与既有 async 的 requestBuild/query/drainQueueForTest 统一为 async。

const path = require("path");
const { buildIndex, queryIndex, checkIndexCompatibility } = require("../../../../packages/rag-runtime");
const { createFileRagIndexStore } = require("./ragIndexFileStore");
const { createFileTaskQueue } = require("./taskQueue/fileTaskQueue");
const { MAX_ATTEMPTS, codedError } = require("./taskQueue/contract");
const { resolveRepositoryBackend } = require("./persistence/repositoryBackend");

// failed 任务被 re-pin 时自动重排队的冷却（防抖；测试可注入 0）。
const FAILED_RETRY_COOLDOWN_MS = 60 * 1000;
const INDEX_MEMO_TTL_MS = 30 * 1000;
const BUILD_JOB_KIND = "rag-index-build";

function jobIdOf(input) {
  return `rag:${input.environment}:${input.kbId}:v${input.version}`;
}

function createRagIndexService(options = {}) {
  const root = options.root;
  const logger = typeof options.logger === "function" ? options.logger : () => {};
  const fetcher = options.fetcher; // undefined = rag-runtime 默认受控 fetch
  // 队列 reclaim 时按引用重取发布物（队列不复制文档内容，内核是唯一内容源）。
  const resolveArtifact = options.resolveArtifact;
  const failedRetryCooldownMs = Number.isFinite(options.failedRetryCooldownMs)
    ? options.failedRetryCooldownMs
    : FAILED_RETRY_COOLDOWN_MS;
  const indexMemoTtlMs = Number.isFinite(options.indexMemoTtlMs)
    ? options.indexMemoTtlMs
    : INDEX_MEMO_TTL_MS;
  const backend = typeof options.backend === "string" && options.backend
    ? options.backend
    : resolveRepositoryBackend();

  // 索引产物存储：postgres 分支懒加载 PG 模块（file 默认模式不触达 PG 连接路径）。
  let indexStore = options.indexStore || null;
  if (!indexStore) {
    if (backend === "postgres") {
      const { getPool } = require("./persistence/pgPersistenceService");
      const { createPgRagIndexStore } = require("./ragIndexPgStore");
      indexStore = createPgRagIndexStore({ pool: getPool(), logger, memoTtlMs: indexMemoTtlMs });
    } else {
      if (!root) throw codedError("RAG_INDEX_ROOT_REQUIRED");
      indexStore = createFileRagIndexStore({ root, logger, memoTtlMs: indexMemoTtlMs });
    }
  }

  // 构建队列：默认文件实现（行为与 P4d 内嵌队列一致）；可注入契约实现。
  if (!root && !options.queue) throw codedError("RAG_INDEX_ROOT_REQUIRED");
  const queue = options.queue || createFileTaskQueue({
    file: path.join(root, "rag-index-queue.json"),
    logger,
  });
  const consumer = `rag-index-${process.pid}`;
  let running = false;
  let initPromise = null;
  const reclaimedBacklog = []; // 启动 reclaim 认领的崩溃残留（kick 优先处理）

  async function isIndexReadable(ref) {
    return (await indexStore.readVersion(ref.environment, ref.kbId, ref.version)) !== null;
  }

  // 启动恢复（异步一次性）：building 崩溃残留 → reclaim 认领后由 kick 重跑
  // （构建幂等）；done 但索引不可读（外部删除/损坏）→ 重新排队；
  // done 且可读 → 出队（幂等完成）。失败可重试（下一次调用重新 init）。
  function ensureInit() {
    if (!initPromise) {
      initPromise = (async () => {
        const reclaimed = await queue.reclaimPending({ consumer, minIdleMs: 0 });
        reclaimed.forEach((job) => {
          logger({ event: "rag-index-job-reclaimed", jobId: job.jobId, status: job.status });
          reclaimedBacklog.push(job);
        });
        const jobs = await queue.list();
        for (const job of jobs) {
          if (job.status !== "done") continue;
          if (await isIndexReadable(job.payload)) {
            await queue.remove(job.jobId);
          } else {
            await queue.requeue(job.jobId, { resetAttempts: true });
            logger({ event: "rag-index-job-reclaimed", jobId: job.jobId, status: "pending" });
          }
        }
        kick();
      })().catch((error) => {
        initPromise = null;
        throw error;
      });
    }
    return initPromise;
  }

  // 构造即发恢复流程（fire-and-forget）：故障只记日志不击落进程（I-5）。
  Promise.resolve()
    .then(() => ensureInit())
    .catch((error) => {
      logger({
        event: "rag-index-init-failed",
        code: String((error && error.code) || "RAG_INDEX_INIT_FAILED"),
        message: String((error && error.message) || "").slice(0, 200),
      });
    });

  async function runJob(job) {
    const environment = String(job.payload.environment || "");
    const artifactId = String(job.payload.artifactId || "");
    const kbId = String(job.payload.kbId || "");
    const version = Number(job.payload.version);
    try {
      if (typeof resolveArtifact !== "function") throw codedError("RAG_INDEX_RESOLVER_REQUIRED");
      // P5a：内核 async 化后 resolveArtifact 可返回 Promise（同步返回被
      // await 透明容忍，既有测试注入的同步 mock 不受影响）。
      const artifact = await resolveArtifact({ environment, artifactId, version });
      const index = await buildIndex({
        kbId,
        version,
        documents: artifact.documents,
        retrieval: artifact.retrieval,
      }, fetcher ? { fetcher } : {});
      // 版本产物写入含回读 digest 校验（PG 侧同事务落分块向量）；
      // 写损坏立即失败，不推进 lkg。
      await indexStore.writeVersion(environment, kbId, version, index);
      await indexStore.writeLkg(environment, kbId, {
        kbId,
        version,
        environment,
        builtAt: new Date().toISOString(),
        digest: index.digest,
      });
      await queue.ack(job);
      logger({ event: "rag-index-built", jobId: job.jobId, chunks: index.chunks.length, digest: index.digest.slice(0, 16) });
    } catch (error) {
      const errorClass = String((error && error.code) || "RAG_INDEX_BUILD_FAILED");
      try {
        const result = await queue.retry(job, { errorClass, maxAttempts: MAX_ATTEMPTS });
        logger({ event: "rag-index-build-failed", jobId: job.jobId, attempts: result.attempts, code: errorClass });
      } catch (retryError) {
        // retry 记账自身失败（如队列后端故障）：任务仍在队列中可被 reclaim，
        // 构建幂等——只留信号，不击落 worker（I-5）。
        logger({
          event: "rag-index-queue-error",
          code: String((retryError && retryError.code) || "RAG_INDEX_QUEUE_FAILED"),
          message: String((retryError && retryError.message) || "").slice(0, 200),
        });
      }
    }
  }

  function kick() {
    if (running) return;
    running = true;
    setImmediate(async () => {
      try {
        await ensureInit();
        for (;;) {
          let next = null;
          if (reclaimedBacklog.length) {
            next = reclaimedBacklog.shift();
          } else {
            next = await queue.claim({ consumer });
          }
          if (!next) break;
          await runJob(next);
        }
      } catch (error) {
        // backstop（I-5）：构建子系统的任何逃逸故障不得击落进程；
        // running 复位后下一次 requestBuild/reclaim 会重新 kick。
        logger({
          event: "rag-index-queue-error",
          code: String((error && error.code) || "RAG_INDEX_QUEUE_FAILED"),
          message: String((error && error.message) || "").slice(0, 200),
        });
      } finally {
        running = false;
      }
    });
  }

  // 语义不变（P4d）：幂等去重、失败重排队冷却、入队后 kick 异步构建。
  async function requestBuild(input = {}) {
    await ensureInit();
    const environment = String(input.environment || "");
    const kbId = String(input.kbId || "");
    const version = Number(input.version);
    if (!environment || !kbId || !Number.isInteger(version) || version < 1) {
      throw codedError("RAG_INDEX_JOB_INVALID");
    }
    const jobId = jobIdOf({ environment, kbId, version });
    let job = await queue.get(jobId);
    // 幂等：版本索引已存在且可校验 → 直接视为完成，不重复构建
    // （done 任务出队后仍不触发重建）。这是至少一次投递下业务幂等的
    // 第二道锚（第一道是队列 jobId 去重）。
    if (!job && (await isIndexReadable({ environment, kbId, version }))) {
      return Object.freeze({ jobId, status: "done", deduped: true });
    }
    if (job) {
      if (job.status === "done" && !(await isIndexReadable({ environment, kbId, version }))) {
        // 索引产物被外部删除/损坏：进程内自愈（M-7，与启动 reclaim 同语义）。
        job = await queue.requeue(jobId, { resetAttempts: true });
        kick();
      } else if (job.status === "failed"
        && (input.retry === true
          || Date.now() - (Date.parse(job.updatedAt || "") || 0) >= failedRetryCooldownMs)) {
        // re-pin 即重试（I-1）：rollback 到构建失败过的版本后系统自愈；
        // 冷却防抖，attempts 重新计数仍有界。
        job = await queue.requeue(jobId, { resetAttempts: true });
        kick();
      }
      return Object.freeze({ jobId, status: job.status, deduped: true });
    }
    await queue.enqueue({
      jobId,
      kind: BUILD_JOB_KIND,
      payload: {
        environment,
        artifactId: String(input.artifactId || ""),
        kbId,
        version,
      },
    });
    kick();
    return Object.freeze({ jobId, status: "pending", deduped: false });
  }

  // 扫描兜底（I-1）：lkg 是单指针优化，可能越过失败版本、缺失或损坏；
  // 扫描版本存储取「< 钉住版本的最大可读索引」，rollback 后查询永远有
  // 自愈路径，且永不提供比钉住版本更新的索引。
  async function loadScannedIndex(environment, kbId, version) {
    const versions = await indexStore.listVersions(environment, kbId);
    for (const candidate of versions) {
      if (!Number.isInteger(candidate) || candidate >= version) continue;
      const index = await indexStore.readVersion(environment, kbId, candidate);
      if (index) return index;
    }
    return null;
  }

  // 钉住版本优先；失败仅回退「更旧」的已验证索引（lkg 快路径 → 扫描兜底），
  // 永不提供比钉住版本更新的索引（rollback 语义不被 lkg/扫描破坏）。
  async function loadIndex(input = {}) {
    await ensureInit();
    const environment = String(input.environment || "");
    const kbId = String(input.kbId || "");
    const version = Number(input.version);
    const exact = await indexStore.readVersion(environment, kbId, version);
    if (exact) {
      return Object.freeze({ index: exact, source: "version", requestedVersion: version, servedVersion: exact.version });
    }
    const pointer = await indexStore.readLkg(environment, kbId);
    if (pointer) {
      const lkgVersion = Number(pointer.version);
      if (Number.isInteger(lkgVersion) && lkgVersion < version) {
        const index = await indexStore.readVersion(environment, kbId, lkgVersion);
        if (index) {
          return Object.freeze({ index, source: "lkg", requestedVersion: version, servedVersion: index.version });
        }
      }
    }
    const scanned = await loadScannedIndex(environment, kbId, version);
    if (scanned) {
      return Object.freeze({ index: scanned, source: "scan", requestedVersion: version, servedVersion: scanned.version });
    }
    throw codedError("RAG_INDEX_UNAVAILABLE", `no readable index for ${environment}/${kbId} at v${version}`);
  }

  async function getIndexStatus(input = {}) {
    await ensureInit();
    const environment = String(input.environment || "");
    const kbId = String(input.kbId || "");
    const pointer = await indexStore.readLkg(environment, kbId);
    const jobs = (await queue.list())
      .filter((job) => job.payload.environment === environment && job.payload.kbId === kbId)
      .map((job) => Object.freeze({
        jobId: job.jobId,
        version: job.payload.version,
        status: job.status,
        attempts: job.attempts,
        errorClass: job.errorClass,
      }));
    return Object.freeze({
      environment,
      kbId,
      lkgVersion: pointer ? pointer.version : null,
      jobs,
    });
  }

  async function listJobs() {
    await ensureInit();
    return (await queue.list()).map((job) => Object.freeze({
      jobId: job.jobId,
      environment: job.payload.environment,
      kbId: job.payload.kbId,
      version: job.payload.version,
      status: job.status,
      attempts: job.attempts,
      errorClass: job.errorClass,
      updatedAt: job.updatedAt,
    }));
  }

  async function query(input = {}) {
    const loaded = await loadIndex(input);
    const compatibility = checkIndexCompatibility(loaded.index);
    if (!compatibility.compatible) {
      throw codedError("RAG_ENCODER_MISMATCH", String(compatibility.reason || "encoder mismatch"));
    }
    const result = queryIndex(loaded.index, String(input.query || ""), {
      mode: input.mode,
      topK: input.topK,
      minScore: input.minScore,
      weights: input.weights,
    });
    return Object.freeze(Object.assign({}, result, {
      kbId: loaded.index.kbId,
      servedVersion: loaded.servedVersion,
      requestedVersion: loaded.requestedVersion,
      indexSource: loaded.source,
    }));
  }

  // 测试/运维辅助：等待队列排空（有界）。生产请求路径不调用。
  async function waitForIdle(timeoutMs = 15000) {
    await ensureInit();
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      const jobs = await queue.list();
      const busy = jobs.some((job) => job.status === "pending" || job.status === "building");
      if (!busy && !running && !reclaimedBacklog.length) return true;
      if (Date.now() > deadline) return false;
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
  }

  return Object.freeze({
    backend: indexStore.kind,
    requestBuild,
    loadIndex,
    query,
    getIndexStatus,
    listJobs,
    waitForIdle,
    drainQueueForTest: waitForIdle,
  });
}

module.exports = Object.freeze({ createRagIndexService });
