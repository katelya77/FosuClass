const fs = require("fs");
const path = require("path");

const jobService = require("../services/jobService");
const releaseService = require("../services/releaseService");
const stagingPublishService = require("../services/stagingPublishService");
const staticReleaseSyncService = require("../services/staticReleaseSyncService");
const storageLifecycleService = require("../services/storageLifecycleService");

const STORAGE_DIR = path.resolve(process.env.FOSU_STORAGE_DIR || path.join(__dirname, "../../storage"));
const SNAPSHOTS_DIR = path.join(STORAGE_DIR, "snapshots");

function isInside(baseDir, targetPath) {
  const base = path.resolve(baseDir);
  const target = path.resolve(targetPath || "");
  const relative = path.relative(base, target);
  return Boolean(relative && !relative.startsWith("..") && !path.isAbsolute(relative));
}

async function cleanupUploadFile(uploadPath) {
  if (!uploadPath || !isInside(SNAPSHOTS_DIR, uploadPath)) return;
  try {
    await fs.promises.rm(uploadPath, { force: true });
  } catch (error) {
    safeWorkerLog("release-upload-cleanup-failed", { uploadPath, error: error.message });
  }
}

function safeWorkerLog(message, data) {
  if (process.send) {
    process.send({ type: "log", message, data });
  }
}

async function runDeepHealth(input, job) {
  const version = input.version || "";
  job.progress(18, "deep validating", { version });
  const status = releaseService.getReleasePackStatus(version);
  job.progress(82, "deep health complete", {
    healthy: status.healthy,
    totalBytes: status.totalBytes,
  });
  return { version, status, workerPid: process.pid };
}

async function runRebuild(input, job) {
  const version = input.version || "";
  job.progress(10, "building indexes", { version });
  releaseService.clearDerivedCache();
  const rebuilt = await releaseService.rebuildReleasePackAsync(version, { job });
  job.progress(70, "syncing OpenResty", { version: rebuilt.version });
  const staticSync = await staticReleaseSyncService.syncIfEnabled(rebuilt.version, { job });
  job.progress(88, "release pack rebuilt", {
    version: rebuilt.version,
    staticSyncStatus: staticSync.status,
  });
  return {
    version: rebuilt.version,
    releaseVersion: rebuilt.releaseVersion,
    releasePack: rebuilt.status,
    manifest: rebuilt.manifest,
    staticSync,
    workerPid: process.pid,
  };
}

async function runUpload(input, job) {
  const uploadPath = input.uploadPath || "";
  if (!uploadPath || !isInside(SNAPSHOTS_DIR, uploadPath)) {
    const error = new Error("Invalid release upload path");
    error.code = "RELEASE_UPLOAD_INVALID_PATH";
    throw error;
  }
  try {
    job.progress(12, "loading snapshot", {
      uploadSize: input.uploadSize || 0,
    });
    const buffer = await fs.promises.readFile(uploadPath);
    const parsed = releaseService.parseSnapshotBuffer(buffer);
    const written = await releaseService.writeReleaseSnapshotAsync(parsed.snapshot, { job });
    job.progress(88, "release upload built", {
      version: written.version,
      size: parsed.size,
      isGzip: parsed.isGzip,
    });
    return {
      success: true,
      message: "release uploaded and validated",
      version: written.version,
      releaseVersion: written.version,
      semester: written.manifest.semester,
      counts: written.manifest.counts,
      size: parsed.size,
      isGzip: parsed.isGzip,
      workerPid: process.pid,
    };
  } finally {
    if (input.cleanupUpload !== false) {
      await cleanupUploadFile(uploadPath);
    }
  }
}

async function runVerify(input, job) {
  const version = input.version || "";
  job.progress(15, "reading quick health", { version });
  const quick = releaseService.getReleasePackQuickHealth(version);
  job.progress(40, "reading class index");
  const classIndex = releaseService.readReleasePackStaticIndex("class", version);
  job.progress(65, "reading empty-room index");
  const emptyRoom = releaseService.readReleasePackStaticEmptyRoom(version);
  const ok = Boolean(quick.healthy && classIndex && classIndex.success && emptyRoom && emptyRoom.success);
  job.progress(90, "static URL verification complete", { ok });
  if (!ok) {
    const error = new Error("Release Pack verify failed");
    error.code = "RELEASE_PACK_VERIFY_FAILED";
    throw error;
  }
  return {
    version,
    quick,
    classIndexCount: classIndex.items.length,
    emptyRoomCount: emptyRoom.rooms.length,
    workerPid: process.pid,
  };
}

async function runStaticSync(input, job) {
  const version = input.version || "";
  job.progress(12, input.force ? "force static sync queued" : "static sync queued", { version, force: input.force === true });
  const staticSync = await staticReleaseSyncService.syncIfEnabled(version, {
    job,
    force: input.force === true,
  });
  job.progress(90, "static release sync complete", {
    version: staticSync.releaseVersion || version,
    status: staticSync.status,
  });
  return { staticSync, force: input.force === true, workerPid: process.pid };
}

async function runStaticReconcile(input, job) {
  const version = input.version || "";
  job.progress(12, "static reconcile queued", { version, reason: input.reason || "" });
  const staticSync = await staticReleaseSyncService.reconcileStaticRelease(version, {
    job,
  });
  job.progress(90, "static reconcile complete", {
    version: staticSync.releaseVersion || version,
    status: staticSync.status,
  });
  return { staticSync, reason: input.reason || "", workerPid: process.pid };
}

async function runStorageMaintenance(input, job) {
  const dryRun = input.dryRun !== false;
  job.progress(15, dryRun ? "previewing storage maintenance" : "running storage maintenance", { dryRun });
  const report = storageLifecycleService.runMaintenance({ dryRun });
  job.progress(90, "storage maintenance complete", {
    dryRun,
    reclaimedBytes: report.reclaimedBytes || 0,
    deletedFiles: report.deletedFiles || 0,
    deletedDirs: report.deletedDirs || 0,
  });
  return { report, dryRun, workerPid: process.pid };
}

async function runActivate(input, job) {
  let version = input.version || "";
  let written = null;
  if (input.snapshot) {
    job.progress(15, "loading snapshot");
    written = await releaseService.writeReleaseSnapshotAsync(input.snapshot, { job });
    version = written.version || written.releaseVersion;
  }
  if (input.backupActive) {
    job.progress(66, "backup active release");
    stagingPublishService.backupActiveReleaseSnapshot();
  }
  job.progress(72, "activating release", { version });
  const activated = releaseService.activateReleaseVersion(version);
  const finalized = stagingPublishService.finalizeReleaseActivation({
    version,
    releaseNote: input.releaseNote || "全校课表数据已更新",
    auditAction: input.auditAction || "activate",
    auditReq: input.auditReq || {},
    auditSummary: input.auditSummary || `Activated release ${version}`,
  });
  job.progress(90, "release activated", { version });
  return Object.assign({}, written || {}, activated, {
    version,
    releaseVersion: version,
    counts: finalized.counts,
    semester: finalized.status.semester,
    workerPid: process.pid,
  });
}

async function runTask(type, input, job) {
  if (type === "release-pack-deep-health") return runDeepHealth(input, job);
  if (type === "release-pack-rebuild") return runRebuild(input, job);
  if (type === "release-upload") return runUpload(input, job);
  if (type === "release-pack-verify") return runVerify(input, job);
  if (type === "staging-publish") return stagingPublishService.runStagingPublish(input, job);
  if (type === "static-release-sync") return runStaticSync(input, job);
  if (type === "static-release-reconcile") return runStaticReconcile(input, job);
  if (type === "release-activate") return runActivate(input, job);
  if (type === "storage-maintenance") return runStorageMaintenance(input, job);
  const error = new Error(`Unknown release worker task: ${type}`);
  error.code = "UNKNOWN_RELEASE_WORKER_TASK";
  throw error;
}

async function main() {
  const jobId = process.argv[2];
  const type = process.argv[3];
  if (!jobId || !type) {
    throw new Error("release worker requires job id and task type");
  }
  jobService.startJob(jobId, {
    workerPid: process.pid,
    progress: 5,
  });
  const job = jobService.createJobContext(jobId);
  const current = job.getJob();
  const input = current.input || {};
  const startedAt = Date.now();
  job.progress(8, "queued", { workerPid: process.pid });
  const result = await runTask(type, input, job);
  const elapsedMs = Date.now() - startedAt;
  jobService.finishJobSuccess(jobId, Object.assign({}, result || {}, { elapsedMs, workerPid: process.pid }), {
    workerPid: process.pid,
  });
}

main().then(() => {
  process.exit(0);
}).catch((error) => {
  const jobId = process.argv[2];
  if (jobId) {
    try {
      jobService.finishJobFailed(jobId, error, { workerPid: process.pid });
    } catch (writeError) {}
  }
  process.exit(1);
});
