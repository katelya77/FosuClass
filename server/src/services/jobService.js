const fs = require("fs");
const path = require("path");

const STORAGE_DIR = path.resolve(process.env.FOSU_STORAGE_DIR || path.join(__dirname, "../../storage"));
const JOBS_DIR = path.join(STORAGE_DIR, "jobs");
const MAX_LOG_LINES = 300;

const runningJobs = new Map();

function ensureDir(dirPath) {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
  }
}

function ensureStorage() {
  ensureDir(JOBS_DIR);
}

function writeJsonAtomic(filePath, data) {
  ensureDir(path.dirname(filePath));
  const tempPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(tempPath, JSON.stringify(data, null, 2), "utf-8");
  try {
    fs.renameSync(tempPath, filePath);
  } catch (error) {
    try {
      fs.copyFileSync(tempPath, filePath);
    } catch (copyError) {
      fs.writeFileSync(filePath, JSON.stringify(data, null, 2), "utf-8");
    }
    try { fs.unlinkSync(tempPath); } catch (cleanupError) {}
  }
}

function jobPath(id) {
  const safeId = String(id || "").replace(/[^a-zA-Z0-9._-]/g, "");
  return path.join(JOBS_DIR, `${safeId}.json`);
}

function readJob(id) {
  ensureStorage();
  const filePath = jobPath(id);
  if (!fs.existsSync(filePath)) return null;
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf-8"));
  } catch (error) {
    return null;
  }
}

function saveJob(job) {
  const next = Object.assign({}, job, {
    updatedAt: new Date().toISOString(),
    logs: (job.logs || []).slice(-MAX_LOG_LINES),
  });
  writeJsonAtomic(jobPath(next.id), next);
  return next;
}

function appendLog(job, message, data) {
  const line = {
    at: new Date().toISOString(),
    message: String(message || ""),
    data: data || undefined,
  };
  job.logs = (job.logs || []).concat(line).slice(-MAX_LOG_LINES);
  return saveJob(job);
}

function listJobs(limit = 50) {
  ensureStorage();
  return fs.readdirSync(JOBS_DIR)
    .filter((name) => name.endsWith(".json"))
    .map((name) => {
      try {
        return JSON.parse(fs.readFileSync(path.join(JOBS_DIR, name), "utf-8"));
      } catch (error) {
        return null;
      }
    })
    .filter(Boolean)
    .sort((left, right) => String(right.createdAt || "").localeCompare(String(left.createdAt || "")))
    .slice(0, Math.max(1, Number(limit) || 50));
}

function latestJob(type) {
  return listJobs(100).find((job) => !type || job.type === type) || null;
}

function isActiveJobStatus(status) {
  return status === "queued" || status === "running";
}

function getRunningJob(type, options = {}) {
  const query = typeof type === "object" && type !== null ? type : Object.assign({ type }, options || {});
  const targetType = query.type || "";
  const targetLockGroup = query.lockGroup || "";
  const staleMs = Number(process.env.FOSU_JOB_LOCK_STALE_MS || 30 * 60 * 1000);
  const now = Date.now();
  const running = listJobs(100).find((job) => {
    if (targetLockGroup) {
      if (job.lockGroup !== targetLockGroup) return false;
    } else if (targetType && job.type !== targetType) {
      return false;
    }
    if (!isActiveJobStatus(job.status)) return false;
    const updatedAt = Date.parse(job.updatedAt || job.startedAt || job.createdAt || "");
    return !updatedAt || now - updatedAt <= staleMs;
  });
  return running || null;
}

function getRunningJobByLockGroup(lockGroup) {
  return getRunningJob({ lockGroup });
}

function publicJob(job) {
  if (!job) return null;
  return Object.assign({}, job, {
    logs: (job.logs || []).slice(-100),
  });
}

function createJobRecord(type, input, options = {}) {
  ensureStorage();
  const id = `${String(type || "job").replace(/[^a-zA-Z0-9_-]/g, "-")}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const job = saveJob({
    id,
    type,
    lockGroup: options.lockGroup || null,
    status: "queued",
    progress: 0,
    input: input || {},
    result: null,
    error: null,
    logs: [],
    worker: options.worker || null,
    workerPid: null,
    createdAt: new Date().toISOString(),
    startedAt: null,
    finishedAt: null,
  });
  return publicJob(job);
}

function createJobContext(id) {
  let job = readJob(id);
  if (!job) {
    throw new Error(`job ${id} not found`);
  }
  return {
    update: (patch) => {
      job = saveJob(Object.assign({}, readJob(id) || job, patch || {}));
      return job;
    },
    progress: (progress, message, data) => {
      job = saveJob(Object.assign({}, readJob(id) || job, {
        progress: Math.max(0, Math.min(100, Number(progress) || 0)),
      }));
      if (message) job = appendLog(job, message, data);
      return job;
    },
    log: (message, data) => {
      job = appendLog(readJob(id) || job, message, data);
      return job;
    },
    getJob: () => readJob(id) || job,
  };
}

function startJob(id, patch = {}) {
  let job = readJob(id);
  if (!job) {
    const error = new Error(`job ${id} not found`);
    error.code = "JOB_NOT_FOUND";
    throw error;
  }
  job = Object.assign({}, job, patch || {}, {
    status: "running",
    progress: Number(patch.progress) || Number(job.progress) || 5,
    startedAt: job.startedAt || new Date().toISOString(),
  });
  return appendLog(saveJob(job), "job started");
}

function finishJobSuccess(id, result, patch = {}) {
  const job = saveJob(Object.assign({}, readJob(id) || { id }, patch || {}, {
    status: "success",
    progress: 100,
    result: result || {},
    finishedAt: new Date().toISOString(),
  }));
  appendLog(job, "job success");
  return publicJob(readJob(id) || job);
}

function finishJobFailed(id, error, patch = {}) {
  const errorPayload = {
    message: error && error.message || "job failed",
    code: error && error.code || "",
  };
  [
    "blockers",
    "warnings",
    "blockerDetails",
    "blockerCodes",
    "warningDetails",
    "safetyReport",
    "safety",
  ].forEach((key) => {
    if (error && Object.prototype.hasOwnProperty.call(error, key)) {
      errorPayload[key] = error[key];
    }
  });
  const job = saveJob(Object.assign({}, readJob(id) || { id }, patch || {}, {
    status: "failed",
    error: errorPayload,
    finishedAt: new Date().toISOString(),
  }));
  appendLog(job, "job failed", {
    message: error && error.message,
    code: error && error.code || "",
    blockerCodes: errorPayload.blockerCodes || undefined,
  });
  return publicJob(readJob(id) || job);
}

function createJob(type, input, runner, options = {}) {
  let job = createJobRecord(type, input, options);

  const run = async () => {
    if (runningJobs.has(job.id)) return;
    runningJobs.set(job.id, true);
    startJob(job.id);
    const context = createJobContext(job.id);

    try {
      const result = await runner(context, input || {});
      finishJobSuccess(job.id, result);
    } catch (error) {
      finishJobFailed(job.id, error);
    } finally {
      runningJobs.delete(job.id);
    }
  };

  setTimeout(run, 0);
  return publicJob(job);
}

function createSingletonJob(type, input, runner, options = {}) {
  const running = options.lockGroup ? getRunningJobByLockGroup(options.lockGroup) : getRunningJob(type);
  if (running) {
    const error = new Error(`${options.lockGroup || type} job is already running`);
    error.code = "JOB_ALREADY_RUNNING";
    error.statusCode = 409;
    error.job = publicJob(running);
    throw error;
  }
  return createJob(type, input, runner, options);
}

function createExternalJob(type, input, options = {}) {
  const running = options.lockGroup
    ? getRunningJobByLockGroup(options.lockGroup)
    : (options.singleton ? getRunningJob(type) : null);
  if (running) {
    const error = new Error(`${options.lockGroup || type} job is already running`);
    error.code = "JOB_ALREADY_RUNNING";
    error.statusCode = 409;
    error.job = publicJob(running);
    throw error;
  }
  return createJobRecord(type, input, options);
}

module.exports = {
  JOBS_DIR,
  createExternalJob,
  createJob,
  createJobContext,
  createJobRecord,
  createSingletonJob,
  finishJobFailed,
  finishJobSuccess,
  getRunningJob,
  getRunningJobByLockGroup,
  latestJob,
  listJobs,
  publicJob,
  readJob,
  saveJob,
  startJob,
};
