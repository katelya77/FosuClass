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
    if (fs.existsSync(filePath) && process.platform === "win32") {
      try { fs.unlinkSync(filePath); } catch (error) {}
    }
    fs.renameSync(tempPath, filePath);
  } catch (error) {
    fs.writeFileSync(filePath, JSON.stringify(data, null, 2), "utf-8");
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

function publicJob(job) {
  if (!job) return null;
  return Object.assign({}, job, {
    logs: (job.logs || []).slice(-100),
  });
}

function createJob(type, input, runner) {
  ensureStorage();
  const id = `${String(type || "job").replace(/[^a-zA-Z0-9_-]/g, "-")}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  let job = saveJob({
    id,
    type,
    status: "queued",
    progress: 0,
    input: input || {},
    result: null,
    error: null,
    logs: [],
    createdAt: new Date().toISOString(),
    startedAt: null,
    finishedAt: null,
  });

  const run = async () => {
    if (runningJobs.has(id)) return;
    runningJobs.set(id, true);
    job = Object.assign({}, readJob(id) || job, {
      status: "running",
      progress: 5,
      startedAt: new Date().toISOString(),
    });
    job = appendLog(saveJob(job), "job started");
    const context = {
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

    try {
      const result = await runner(context, input || {});
      job = saveJob(Object.assign({}, readJob(id) || job, {
        status: "success",
        progress: 100,
        result: result || {},
        finishedAt: new Date().toISOString(),
      }));
      appendLog(job, "job success");
    } catch (error) {
      job = saveJob(Object.assign({}, readJob(id) || job, {
        status: "failed",
        error: {
          message: error && error.message || "job failed",
          code: error && error.code || "",
        },
        finishedAt: new Date().toISOString(),
      }));
      appendLog(job, "job failed", { message: error && error.message });
    } finally {
      runningJobs.delete(id);
    }
  };

  setTimeout(run, 0);
  return publicJob(job);
}

module.exports = {
  JOBS_DIR,
  createJob,
  latestJob,
  listJobs,
  publicJob,
  readJob,
};
