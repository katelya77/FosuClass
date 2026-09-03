const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");

const tempRoot = path.join(os.tmpdir(), `fosu-release-lifecycle-${process.pid}-${Date.now()}`);
process.env.FOSU_STORAGE_DIR = path.join(tempRoot, "storage");
process.env.FOSU_DATA_DIR = path.join(tempRoot, "data");
process.env.STAGING_DIR = path.join(tempRoot, "storage", "staging-uploads");
process.env.NODE_ENV = "test";

const releaseService = require("../server/src/services/releaseService");
const stagingUploadService = require("../server/src/services/stagingUploadService");
const releaseLifecycleService = require("../server/src/services/releaseLifecycleService");
const stagingFingerprint = require("../server/src/utils/stagingFingerprint");

function snapshot(version, className) {
  const course = {
    courseName: "Lifecycle Course",
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
    classSchedules: [{ className, courses: [course] }],
    resources: {
      teachers: [{ teacherName: "Teacher A" }],
      classrooms: [{ roomName: "C7-101" }],
      courses: [{ courseName: "Lifecycle Course" }],
      teacherSchedules: [{ teacherName: "Teacher A", courses: [course] }],
      classroomSchedules: [{ roomName: "C7-101", courses: [course] }],
      courseSchedules: [{ courseName: "Lifecycle Course", courses: [course] }],
    },
  };
}

function initPendingUpload(label, canonicalHash, releaseVersion) {
  const upload = stagingUploadService.initUpload({
    fileName: `${label}.json.gz`,
    term: "2025-2026-2",
    releaseVersion,
    contentEncoding: "gzip",
    chunkSize: 10,
    totalChunks: 1,
    uploadSize: 10,
    originalSize: 20,
  }, { type: "admin", id: "test" });
  return stagingUploadService.markUploadPendingReview(upload.uploadId, {
    term: "2025-2026-2",
    releaseVersion,
    canonicalHash,
    counts: {
      classScheduleCount: 1,
      teacherScheduleCount: 1,
      classroomScheduleCount: 1,
      courseScheduleCount: 1,
    },
  });
}

function cleanup() {
  const resolved = path.resolve(tempRoot);
  if (!path.basename(resolved).startsWith("fosu-release-lifecycle-")) {
    throw new Error(`refusing cleanup: ${resolved}`);
  }
  fs.rmSync(resolved, { recursive: true, force: true });
}

try {
  const activeSnapshot = snapshot("2026-06-05T12-39-28", "25 Lifecycle 1");
  const activated = releaseService.activateReleaseFromSnapshot(activeSnapshot);
  // Activation coerces canonical termConfig/coverage before hashing. Lifecycle
  // fixtures must use the persisted active hash rather than re-hashing the raw
  // pre-normalization input.
  const activeHash = activated.active.canonicalHash;

  const older = initPendingUpload("older", activeHash, "older-upload-version");
  const latest = initPendingUpload("latest", activeHash, "latest-upload-version");

  const stagingLatestPath = path.join(process.env.FOSU_STORAGE_DIR, "staging-latest.json");
  fs.writeFileSync(stagingLatestPath, JSON.stringify(Object.assign({}, activeSnapshot, {
    stagingUploadId: latest.uploadId,
    canonicalHash: activeHash,
    meta: { canonicalHash: activeHash },
  }), null, 2), "utf-8");

  const first = releaseLifecycleService.reconcileLifecycle({ reason: "test" });
  assert.strictEqual(first.stagingSameAsActive, true, "active and staging hashes should match");
  assert(first.uploadReconcile.changed >= 1, "first reconcile should update upload records");

  const uploads = stagingUploadService.listUploads(10);
  const latestAfter = uploads.find((item) => item.uploadId === latest.uploadId);
  const olderAfter = uploads.find((item) => item.uploadId === older.uploadId);
  assert.strictEqual(latestAfter.status, "published", "latest matching upload should be published");
  assert.strictEqual(latestAfter.active, true, "latest matching upload should be active");
  assert.strictEqual(latestAfter.publishedReleaseVersion, "2026-06-05T12-39-28");
  assert(["duplicate", "superseded"].includes(olderAfter.status), "older matching upload should be duplicate or superseded");

  const staleSticky = initPendingUpload("stale-sticky", "f".repeat(64), "old-release-version");
  stagingUploadService.markUploadPublished(staleSticky.uploadId, "old-release-version", { active: true });
  const truthRecords = stagingUploadService.listUploadRecords({ limit: 20 }).records;
  const staleTruth = truthRecords.find((item) => item.uploadId === staleSticky.uploadId);
  const activeTruth = truthRecords.filter((item) => item.active === true);
  assert(staleTruth, "stale sticky upload should remain visible before cleanup");
  assert.strictEqual(staleTruth.active, false, "runtime pointer must override a stale persisted active flag");
  assert.strictEqual(staleTruth.runtimeState, "inactive", "stale active runtime state must be normalized on read");
  assert.strictEqual(activeTruth.length, 1, "exactly one published upload may be Active");
  assert.strictEqual(activeTruth[0].uploadId, latest.uploadId, "Active upload must match the runtime release source");
  assert.doesNotThrow(
    () => stagingUploadService.deleteUpload(staleSticky.uploadId, { type: "admin", id: "test" }),
    "stale active flags must not block authorized cleanup once a runtime pointer exists"
  );

  const status = releaseLifecycleService.buildLifecycleStatus({ reason: "test-status" });
  assert.strictEqual(status.stagingSameAsActive, true);
  assert.strictEqual(status.stagingNeedsPublish, false);
  assert.strictEqual(status.nextAction.type, "verify");

  const second = releaseLifecycleService.reconcileLifecycle({ reason: "test-idempotent" });
  assert.strictEqual(second.uploadReconcile.changed, 0, "reconcile should be idempotent");

  const pageSource = fs.readFileSync(path.join(__dirname, "..", "server", "src", "routes", "adminPages.js"), "utf-8");
  assert(pageSource.includes("upload.status === \"pending-review\" && !isActiveUpload"), "published upload cannot render publish action");

  cleanup();
  console.log("test-release-lifecycle passed");
} catch (error) {
  console.error(error);
  try { cleanup(); } catch (cleanupError) {}
  process.exit(1);
}
