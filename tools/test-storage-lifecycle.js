const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");

const tempRoot = path.join(os.tmpdir(), `fosu-storage-lifecycle-${process.pid}-${Date.now()}`);
process.env.FOSU_STORAGE_DIR = path.join(tempRoot, "storage");
process.env.FOSU_DATA_DIR = path.join(tempRoot, "data");
process.env.FOSU_RELEASE_RETENTION_COUNT = "3";
process.env.FOSU_RELEASE_RETENTION_DAYS = "1";
process.env.FOSU_JOB_SUCCESS_RETENTION_DAYS = "1";
process.env.FOSU_JOB_FAILED_RETENTION_DAYS = "2";
process.env.FOSU_TEMP_RETENTION_HOURS = "1";
process.env.FOSU_MIN_FREE_DISK_GB = "0";
process.env.NODE_ENV = "test";

const releaseService = require("../server/src/services/releaseService");
const jobService = require("../server/src/services/jobService");
const storageLifecycleService = require("../server/src/services/storageLifecycleService");

function snapshot(version) {
  const course = {
    courseName: "Storage Course",
    teacherName: "Teacher A",
    classroom: "C7-101",
    weekday: 1,
    startSection: 1,
    endSection: 2,
    sections: [1, 2],
    weeks: [1, 2],
  };
  return {
    schemaVersion: "1.0",
    version,
    releaseVersion: version,
    term: "2025-2026-2",
    semester: "2025-2026-2",
    termStartDate: "2026-03-09",
    generatedAt: "2026-06-05T00:00:00.000Z",
    updatedAt: "2026-06-05T00:00:00.000Z",
    catalog: { colleges: [{ code: "04", name: "Test College" }], grades: ["2025"] },
    majors: [{ collegeCode: "04", code: "0401", name: "Test Major", grade: "2025" }],
    classSchedules: [{ className: "25 Storage 1", courses: [course] }],
    resources: {
      teachers: [{ teacherName: "Teacher A" }],
      classrooms: [{ roomName: "C7-101" }],
      courses: [{ courseName: "Storage Course" }],
      teacherSchedules: [{ teacherName: "Teacher A", courses: [course] }],
      classroomSchedules: [{ roomName: "C7-101", courses: [course] }],
      courseSchedules: [{ courseName: "Storage Course", courses: [course] }],
    },
  };
}

function touchOld(targetPath, ageMs) {
  const time = new Date(Date.now() - ageMs);
  fs.utimesSync(targetPath, time, time);
}

function cleanup() {
  const resolved = path.resolve(tempRoot);
  if (!path.basename(resolved).startsWith("fosu-storage-lifecycle-")) {
    throw new Error(`refusing cleanup: ${resolved}`);
  }
  fs.rmSync(resolved, { recursive: true, force: true });
}

try {
  const activeVersion = "storage-active-2026-06-05";
  releaseService.activateReleaseFromSnapshot(snapshot(activeVersion));
  const activeDir = releaseService.getReleaseFiles(activeVersion).releaseDir;

  const staleBuildingDir = path.join(releaseService.RELEASES_DIR, "stale.building-test");
  fs.mkdirSync(staleBuildingDir, { recursive: true });
  fs.writeFileSync(path.join(staleBuildingDir, "tmp.json"), "{}", "utf-8");
  touchOld(staleBuildingDir, 8 * 3600000);

  const stalePublicDir = path.join(releaseService.PUBLIC_RELEASES_DIR, "orphan-public-release");
  fs.mkdirSync(stalePublicDir, { recursive: true });
  fs.writeFileSync(path.join(stalePublicDir, "manifest.json"), "{}", "utf-8");
  touchOld(stalePublicDir, 3 * 86400000);

  const oldJob = jobService.createJobRecord("test-success", {});
  jobService.finishJobSuccess(oldJob.id, { ok: true });
  const oldJobPath = path.join(jobService.JOBS_DIR, `${oldJob.id}.json`);
  touchOld(oldJobPath, 3 * 86400000);

  const dryRun = storageLifecycleService.runMaintenance({ dryRun: true });
  assert(fs.existsSync(staleBuildingDir), "dry-run should not delete stale building dir");
  assert(fs.existsSync(stalePublicDir), "dry-run should not delete orphan public dir");
  assert(fs.existsSync(oldJobPath), "dry-run should not delete old job");
  assert(fs.existsSync(activeDir), "dry-run should preserve active release");
  assert(dryRun.reclaimedBytes > 0, "dry-run should report reclaimable bytes");
  assert(dryRun.skippedActive >= 1, "dry-run should report skipped active release");

  const run = storageLifecycleService.runMaintenance({ dryRun: false });
  assert(!fs.existsSync(staleBuildingDir), "maintenance should clean stale building dir");
  assert(!fs.existsSync(stalePublicDir), "maintenance should clean old orphan public release");
  assert(!fs.existsSync(oldJobPath), "maintenance should prune old success job");
  assert(fs.existsSync(activeDir), "maintenance must preserve active release");
  assert(run.reclaimedBytes > 0, "maintenance should report reclaimed bytes");

  const scan = storageLifecycleService.scanStorageSizes();
  assert(scan.releaseBytes > 0, "storage scan should cache release bytes");
  const status = storageLifecycleService.getStorageStatus({ force: true });
  assert.strictEqual(status.success, true);
  assert(status.lastMaintenanceAt, "status should expose last maintenance time");

  cleanup();
  console.log("test-storage-lifecycle passed");
} catch (error) {
  console.error(error);
  try { cleanup(); } catch (cleanupError) {}
  process.exit(1);
}
