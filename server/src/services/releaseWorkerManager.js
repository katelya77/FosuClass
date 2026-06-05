const path = require("path");
const { fork } = require("child_process");

const jobService = require("./jobService");

const RELEASE_HEAVY_LOCK_GROUP = "release-heavy";
const RELEASE_HEAVY_TASKS = new Set([
  "release-upload",
  "staging-publish",
  "release-pack-rebuild",
  "release-pack-deep-health",
  "static-release-sync",
  "release-activate",
]);

function isReleaseWorkerEnabled() {
  return String(process.env.FOSU_RELEASE_WORKER_ENABLED || "true").toLowerCase() !== "false";
}

function getTaskLockGroup(type, options = {}) {
  if (Object.prototype.hasOwnProperty.call(options, "lockGroup")) {
    return options.lockGroup || null;
  }
  return RELEASE_HEAVY_TASKS.has(type) ? RELEASE_HEAVY_LOCK_GROUP : null;
}

function buildAlreadyRunningMessage(type) {
  if (type === "staging-publish") return "已有发布任务正在运行";
  if (type === "release-pack-rebuild") return "已有 Release Pack 重建任务正在运行";
  if (type === "release-pack-deep-health") return "已有 Release 重任务正在运行";
  return "已有 Release 重任务正在运行";
}

function startReleaseJob(type, input = {}, options = {}) {
  if (!isReleaseWorkerEnabled()) {
    const error = new Error("Release Worker is disabled. Set FOSU_RELEASE_WORKER_ENABLED=true to run release-heavy jobs outside the API process.");
    error.code = "RELEASE_WORKER_DISABLED";
    error.statusCode = 503;
    throw error;
  }

  const lockGroup = getTaskLockGroup(type, options);
  const job = jobService.createExternalJob(type, input, {
    lockGroup,
    singleton: !lockGroup,
    worker: {
      kind: "release-worker",
      task: type,
    },
  });

  const workerPath = path.join(__dirname, "../workers/releaseWorker.js");
  let child;
  try {
    child = fork(workerPath, [job.id, type], {
      cwd: path.resolve(__dirname, "../../.."),
      env: process.env,
      execArgv: [],
      stdio: ["ignore", "ignore", "ignore", "ipc"],
    });
  } catch (error) {
    jobService.finishJobFailed(job.id, error);
    throw error;
  }

  jobService.saveJob(Object.assign({}, jobService.readJob(job.id) || job, {
    workerPid: child.pid || null,
    worker: Object.assign({}, job.worker || {}, {
      pid: child.pid || null,
      startedByPid: process.pid,
    }),
  }));

  child.on("message", (message) => {
    if (!message || typeof message !== "object") return;
    if (message.type === "log") {
      const context = jobService.createJobContext(job.id);
      context.log(message.message || "worker log", message.data || undefined);
    }
  });

  child.on("error", (error) => {
    const latest = jobService.readJob(job.id);
    if (latest && (latest.status === "queued" || latest.status === "running")) {
      jobService.finishJobFailed(job.id, error, { workerPid: child.pid || null });
    }
  });

  child.on("exit", (code, signal) => {
    const latest = jobService.readJob(job.id);
    if (latest && (latest.status === "queued" || latest.status === "running")) {
      const error = new Error(`Release worker exited before finishing: code=${code == null ? "" : code} signal=${signal || ""}`);
      error.code = "RELEASE_WORKER_EXITED";
      jobService.finishJobFailed(job.id, error, {
        workerPid: child.pid || null,
        workerExitCode: code,
        workerSignal: signal || "",
      });
    }
  });

  if (child.unref) child.unref();
  return jobService.publicJob(jobService.readJob(job.id) || job);
}

function sendAlreadyRunning(res, error) {
  return res.status(error.statusCode || 409).json({
    success: false,
    code: error.code || "JOB_ALREADY_RUNNING",
    message: error.code === "JOB_ALREADY_RUNNING" ? buildAlreadyRunningMessage(error.job && error.job.type || "") : error.message,
    job: error.job || null,
  });
}

module.exports = {
  RELEASE_HEAVY_LOCK_GROUP,
  isReleaseWorkerEnabled,
  sendAlreadyRunning,
  startReleaseJob,
};
