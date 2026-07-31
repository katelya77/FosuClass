// P4d：RAG 索引服务（server 侧）。职责：
// - 索引 blob 持久化：`<root>/rag-indexes/<env>/<kbId>/v<N>.json`（不可变版本索引）
//   + `lkg.json`（最近成功构建，last-known-good）；
// - 受控构建队列（integrated 模式的最小 worker）：稳定 jobId、持久化队列文件、
//   进程内异步顺序执行（不阻塞在线 Run）、崩溃重启 reclaim、失败有界重试、
//   幂等（已存在且可校验的版本索引跳过重建）；P5b 以 Redis Streams 替换传输，
//   业务语义（jobId/幂等/reclaim/有界重试）保持不变；
// - 查询路径：快照钉住版本 → 读版本索引 → 失败回退 lkg（仅当 lkg 更旧，
//   永不提供比钉住版本更新的索引）→ 双失败 fail closed。
//
// 草稿不可见性：索引只从「已发布且被快照钉住」的版本构建（requestBuild 的
// 唯一调用方是快照解析钩子），draft 永远没有索引文件。
//
// 索引是派生物：权威内容在 config kernel 版本文档；索引可从发布物确定性
// 重建，损坏即 fail closed（digest 校验），可删除后重建，不构成第二事实源。

const fs = require("fs");
const path = require("path");
const { buildIndex, queryIndex, serializeIndex, parseIndex, checkIndexCompatibility } = require("../../../../packages/rag-runtime");

const QUEUE_FORMAT = 1;
const MAX_ATTEMPTS = 3;

function codedError(code, message) {
  const error = new Error(message || code);
  error.code = code;
  return error;
}

function jobIdOf(input) {
  return `rag:${input.environment}:${input.kbId}:v${input.version}`;
}

function atomicWriteJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(value));
  fs.renameSync(tmp, file);
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

function createRagIndexService(options = {}) {
  const root = options.root;
  if (!root) throw codedError("RAG_INDEX_ROOT_REQUIRED");
  const logger = typeof options.logger === "function" ? options.logger : () => {};
  const fetcher = options.fetcher; // undefined = rag-runtime 默认受控 fetch
  // 队列 reclaim 时按引用重取发布物（队列不复制文档内容，内核是唯一内容源）。
  const resolveArtifact = options.resolveArtifact;

  const indexDir = (environment, kbId) => path.join(root, "rag-indexes", environment, kbId);
  const versionFile = (environment, kbId, version) => path.join(indexDir(environment, kbId), `v${version}.json`);
  const lkgFile = (environment, kbId) => path.join(indexDir(environment, kbId), "lkg.json");
  const queueFile = path.join(root, "rag-index-queue.json");

  const queue = { jobs: [] };
  let running = false;

  function persistQueue() {
    atomicWriteJson(queueFile, { format: QUEUE_FORMAT, jobs: queue.jobs });
  }

  // 启动恢复：building 状态是崩溃残留，reclaim 为 pending 重跑（构建幂等）；
  // done 但索引不可读（外部删除/损坏）→ 重新排队；done 且可读 → 出队（幂等完成）。
  (function reclaim() {
    let loaded = null;
    try {
      loaded = readJson(queueFile);
    } catch (_) {
      loaded = null;
    }
    if (loaded && Array.isArray(loaded.jobs)) {
      loaded.jobs.forEach((job) => {
        if (!job || !job.jobId) return;
        queue.jobs.push(Object.assign({}, job, {
          status: job.status === "building" ? "pending" : job.status,
        }));
      });
    }
    queue.jobs = queue.jobs.filter((job) => job.status !== "done" || !isIndexReadable(job));
    let reclaimed = 0;
    queue.jobs.forEach((job) => {
      if (job.status === "done") {
        job.status = "pending";
        job.attempts = 0;
      }
      reclaimed += 1;
      logger({ event: "rag-index-job-reclaimed", jobId: job.jobId, status: job.status });
    });
    if (queue.jobs.length) persistQueue();
    if (reclaimed) kick();
  })();

  function isIndexReadable(job) {
    try {
      parseIndex(fs.readFileSync(versionFile(job.environment, job.kbId, job.version), "utf8"));
      return true;
    } catch (_) {
      return false;
    }
  }

  function findJob(jobId) {
    return queue.jobs.find((job) => job.jobId === jobId) || null;
  }

  async function runJob(job) {
    job.status = "building";
    job.updatedAt = new Date().toISOString();
    persistQueue();
    try {
      if (typeof resolveArtifact !== "function") throw codedError("RAG_INDEX_RESOLVER_REQUIRED");
      const artifact = resolveArtifact({
        environment: job.environment,
        artifactId: job.artifactId,
        version: job.version,
      });
      const index = await buildIndex({
        kbId: job.kbId,
        version: job.version,
        documents: artifact.documents,
        retrieval: artifact.retrieval,
      }, fetcher ? { fetcher } : {});
      const file = versionFile(job.environment, job.kbId, job.version);
      atomicWriteJson(file, JSON.parse(serializeIndex(index)));
      // 回读校验（digest）：写损坏立即失败，不推进 lkg。
      parseIndex(fs.readFileSync(file, "utf8"));
      atomicWriteJson(lkgFile(job.environment, job.kbId), {
        kbId: job.kbId,
        version: job.version,
        environment: job.environment,
        builtAt: new Date().toISOString(),
        digest: index.digest,
      });
      job.status = "done";
      job.errorClass = "";
      logger({ event: "rag-index-built", jobId: job.jobId, chunks: index.chunks.length, digest: index.digest.slice(0, 16) });
    } catch (error) {
      job.attempts = (job.attempts || 0) + 1;
      job.errorClass = String(error && error.code || "RAG_INDEX_BUILD_FAILED");
      job.status = job.attempts >= MAX_ATTEMPTS ? "failed" : "pending";
      logger({ event: "rag-index-build-failed", jobId: job.jobId, attempts: job.attempts, code: job.errorClass });
    }
    job.updatedAt = new Date().toISOString();
    persistQueue();
  }

  function kick() {
    if (running) return;
    running = true;
    setImmediate(async () => {
      try {
        for (;;) {
          const next = queue.jobs.find((job) => job.status === "pending");
          if (!next) break;
          await runJob(next);
        }
      } finally {
        running = false;
      }
    });
  }

  function requestBuild(input = {}) {
    const environment = String(input.environment || "");
    const kbId = String(input.kbId || "");
    const version = Number(input.version);
    if (!environment || !kbId || !Number.isInteger(version) || version < 1) {
      throw codedError("RAG_INDEX_JOB_INVALID");
    }
    const jobId = jobIdOf({ environment, kbId, version });
    let job = findJob(jobId);
    // 幂等：版本索引已存在且可校验 → 直接视为完成，不重复构建
    // （done 任务出队后仍不触发重建）。
    if (!job && isIndexReadable({ environment, kbId, version })) {
      return Object.freeze({ jobId, status: "done", deduped: true });
    }
    if (job) {
      if (job.status === "failed" && input.retry === true) {
        job.status = "pending";
        job.attempts = 0;
        persistQueue();
        kick();
      }
      return Object.freeze({ jobId, status: job.status, deduped: true });
    }
    job = {
      jobId,
      environment,
      artifactId: String(input.artifactId || ""),
      kbId,
      version,
      status: "pending",
      attempts: 0,
      errorClass: "",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    queue.jobs.push(job);
    persistQueue();
    kick();
    return Object.freeze({ jobId, status: job.status, deduped: false });
  }

  // 钉住版本优先；失败仅回退「更旧」的已验证 lkg（新版本加载失败用语义，
  // 永不提供比钉住版本更新的索引，rollback 语义不被 lkg 破坏）。
  function loadIndex(input = {}) {
    const environment = String(input.environment || "");
    const kbId = String(input.kbId || "");
    const version = Number(input.version);
    try {
      const index = parseIndex(fs.readFileSync(versionFile(environment, kbId, version), "utf8"));
      return Object.freeze({ index, source: "version", requestedVersion: version, servedVersion: index.version });
    } catch (_) {
      // 继续尝试 lkg
    }
    try {
      const pointer = readJson(lkgFile(environment, kbId));
      const lkgVersion = Number(pointer.version);
      if (Number.isInteger(lkgVersion) && lkgVersion < version) {
        const index = parseIndex(fs.readFileSync(versionFile(environment, kbId, lkgVersion), "utf8"));
        return Object.freeze({ index, source: "lkg", requestedVersion: version, servedVersion: index.version });
      }
    } catch (_) {
      // lkg 同样不可用
    }
    throw codedError("RAG_INDEX_UNAVAILABLE", `no readable index for ${environment}/${kbId} at v${version}`);
  }

  function getIndexStatus(input = {}) {
    const environment = String(input.environment || "");
    const kbId = String(input.kbId || "");
    let lkg = null;
    try {
      lkg = readJson(lkgFile(environment, kbId));
    } catch (_) {
      lkg = null;
    }
    return Object.freeze({
      environment,
      kbId,
      lkgVersion: lkg ? lkg.version : null,
      jobs: queue.jobs
        .filter((job) => job.environment === environment && job.kbId === kbId)
        .map((job) => Object.freeze({
          jobId: job.jobId, version: job.version, status: job.status, attempts: job.attempts, errorClass: job.errorClass,
        })),
    });
  }

  function listJobs() {
    return queue.jobs.map((job) => Object.freeze({
      jobId: job.jobId,
      environment: job.environment,
      kbId: job.kbId,
      version: job.version,
      status: job.status,
      attempts: job.attempts,
      errorClass: job.errorClass,
      updatedAt: job.updatedAt,
    }));
  }

  async function query(input = {}) {
    const loaded = loadIndex(input);
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
  async function drainQueueForTest(timeoutMs = 15000) {
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      if (!queue.jobs.some((job) => job.status === "pending" || job.status === "building")) return true;
      if (Date.now() > deadline) return false;
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
  }

  return Object.freeze({
    requestBuild,
    loadIndex,
    query,
    getIndexStatus,
    listJobs,
    drainQueueForTest,
  });
}

module.exports = Object.freeze({ createRagIndexService });
