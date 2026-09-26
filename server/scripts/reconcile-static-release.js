#!/usr/bin/env node

const jobService = require("../src/services/jobService");
const releaseWorkerManager = require("../src/services/releaseWorkerManager");
const staticReleaseSyncService = require("../src/services/staticReleaseSyncService");

function parseArgs(argv) {
  const args = {};
  argv.forEach((item) => {
    if (!item.startsWith("--")) return;
    const body = item.slice(2);
    const eqIndex = body.indexOf("=");
    if (eqIndex >= 0) {
      args[body.slice(0, eqIndex)] = body.slice(eqIndex + 1);
    } else {
      args[body] = true;
    }
  });
  return args;
}

function compactStatus(status) {
  return {
    success: status && status.success !== false,
    status: status && status.status || "",
    releaseVersion: status && status.releaseVersion || "",
    syncedReleaseVersion: status && status.syncedReleaseVersion || "",
    filesCopied: status && (status.filesCopied || status.copiedFiles || 0) || 0,
    bytesCopied: status && (status.bytesCopied || status.copiedBytes || 0) || 0,
    retainedReleases: status && (status.keptReleases || status.retainedReleaseVersions || []) || [],
    prunedReleases: status && status.prunedReleases || [],
    phase: status && status.phase || "",
    manifestStatus: status && status.manifestStatus || "",
    classIndexStatus: status && status.classIndexStatus || "",
    emptyRoomStatus: status && status.emptyRoomStatus || "",
    message: status && status.message || "",
  };
}

function releaseKey(job) {
  const input = job && job.input || {};
  return String(input.version || input.releaseVersion || "");
}

function isSameReleaseReconcile(running, version) {
  return Boolean(running)
    && running.type === "static-release-reconcile"
    && releaseKey(running) === String(version || "");
}

function waitMs() {
  const parsed = Number(process.env.FOSU_RECONCILE_WAIT_MS);
  if (Number.isFinite(parsed) && parsed >= 1000) return Math.min(parsed, 180000);
  return 180000;
}

function pollMs() {
  const parsed = Number(process.env.FOSU_RECONCILE_POLL_MS);
  if (Number.isFinite(parsed) && parsed >= 200) return Math.min(parsed, 10000);
  return 8000;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForReconcile(jobId) {
  const deadline = Date.now() + waitMs();
  while (Date.now() <= deadline) {
    const job = jobService.readJob(jobId);
    if (!job) {
      const error = new Error("running reconcile disappeared");
      error.code = "STATIC_RECONCILE_LOST";
      throw error;
    }
    if (job.status === "success") return job;
    if (job.status === "failed" || job.status === "cancelled") {
      const error = new Error(job.error && job.error.message || "reconcile failed");
      error.code = job.error && job.error.code || "STATIC_RECONCILE_FAILED";
      throw error;
    }
    await sleep(pollMs());
  }
  const error = new Error("timed out waiting for the running reconcile");
  error.code = "STATIC_RECONCILE_WAIT_TIMEOUT";
  throw error;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help || args.h) {
    console.log([
      "Usage: node scripts/reconcile-static-release.js [--version=<releaseVersion>]",
      "",
      "Runs an idempotent OpenResty static release reconcile inside the API container.",
    ].join("\n"));
    return;
  }

  const version = args.version || args.releaseVersion || "";
  let job;
  try {
    job = jobService.createExternalJob("static-release-reconcile", {
      version,
      reason: args.reason || "postdeploy",
    }, {
      lockGroup: releaseWorkerManager.RELEASE_HEAVY_LOCK_GROUP,
      worker: {
        kind: "inline-script",
        task: "static-release-reconcile",
      },
    });
  } catch (error) {
    if (!error || error.code !== "JOB_ALREADY_RUNNING") throw error;
    const running = error.job;
    if (!isSameReleaseReconcile(running, version)) {
      console.error(JSON.stringify({
        success: false,
        code: "JOB_ALREADY_RUNNING",
        message: "a different release job is already running",
      }, null, 2));
      process.exit(1);
      return;
    }
    const joined = await waitForReconcile(running.id);
    console.log(JSON.stringify({
      success: true,
      joined: true,
      jobId: joined.id,
      staticSync: joined.result && joined.result.staticSync || {},
    }, null, 2));
    return;
  }

  jobService.startJob(job.id, {
    workerPid: process.pid,
    progress: 5,
  });
  const context = jobService.createJobContext(job.id);

  try {
    const status = await staticReleaseSyncService.reconcileStaticRelease(version, { job: context });
    const finished = jobService.finishJobSuccess(job.id, {
      staticSync: compactStatus(status),
      workerPid: process.pid,
    }, {
      workerPid: process.pid,
    });
    console.log(JSON.stringify({
      success: true,
      jobId: finished.id,
      staticSync: compactStatus(status),
    }, null, 2));
  } catch (error) {
    jobService.finishJobFailed(job.id, error, { workerPid: process.pid });
    console.error(JSON.stringify({
      success: false,
      jobId: job.id,
      code: error.code || "STATIC_RECONCILE_FAILED",
      message: error.message,
    }, null, 2));
    process.exit(1);
  }
}

main().catch((error) => {
  console.error(JSON.stringify({
    success: false,
    code: error.code || "STATIC_RECONCILE_FAILED",
    message: error.message,
  }, null, 2));
  process.exit(1);
});
