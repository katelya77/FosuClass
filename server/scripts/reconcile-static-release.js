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
  const job = jobService.createExternalJob("static-release-reconcile", {
    version,
    reason: args.reason || "postdeploy",
  }, {
    lockGroup: releaseWorkerManager.RELEASE_HEAVY_LOCK_GROUP,
    worker: {
      kind: "inline-script",
      task: "static-release-reconcile",
    },
  });

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
