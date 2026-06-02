const assert = require("assert");
const crypto = require("crypto");
const fs = require("fs");
const os = require("os");
const path = require("path");
const zlib = require("zlib");

const tempRoot = path.join(os.tmpdir(), `fosu-staging-upload-test-${process.pid}-${Date.now()}`);
process.env.STAGING_DIR = path.join(tempRoot, "staging-uploads");
process.env.FOSU_STORAGE_DIR = path.join(tempRoot, "storage");

const stagingUploadService = require("../server/src/services/stagingUploadService");
const releaseService = require("../server/src/services/releaseService");

function sha256(buffer) {
  return crypto.createHash("sha256").update(buffer).digest("hex");
}

function buildSnapshot() {
  return {
    schemaVersion: 1,
    releaseVersion: "test-2026-06-02",
    term: "2025-2026-2",
    termStartDate: "2026-03-09",
    generatedAt: "2026-06-02T00:00:00.000Z",
    catalog: {
      colleges: [{ code: "04", name: "测试学院" }],
      grades: ["2025"],
    },
    majors: [{ collegeCode: "04", code: "0401", name: "测试专业", grade: "2025" }],
    classSchedules: [{
      className: "25测试1班",
      collegeCode: "04",
      collegeName: "测试学院",
      grade: "2025",
      majorCode: "0401",
      majorName: "测试专业",
      courses: [{
        courseName: "测试课程",
        teacherName: "测试教师",
        weekday: 1,
        startSection: 1,
        endSection: 2,
        classroom: "C7-101",
      }],
    }],
    resources: {
      teachers: [{ teacherName: "测试教师", collegeName: "测试学院" }],
      classrooms: [{ roomName: "C7-101", campus: "仙溪校区" }],
      courses: [{ courseName: "测试课程" }],
      teacherSchedules: [{
        teacherName: "测试教师",
        courses: [{
          courseName: "测试课程",
          weekday: 1,
          startSection: 1,
          endSection: 2,
        }],
      }],
      classroomSchedules: [{
        roomName: "C7-101",
        courses: [{
          courseName: "测试课程",
          weekday: 1,
          startSection: 1,
          endSection: 2,
        }],
      }],
      courseSchedules: [{
        courseName: "测试课程",
        courses: [{
          courseName: "测试课程",
          weekday: 1,
          startSection: 1,
          endSection: 2,
        }],
      }],
    },
  };
}

function assertReleasePublishRegression() {
  assert.strictEqual(
    typeof releaseService.getActiveReleaseInfo,
    "function",
    "releaseService should export getActiveReleaseInfo for staging publish"
  );
  assert.strictEqual(
    typeof releaseService.getReleaseFiles,
    "function",
    "releaseService should export getReleaseFiles for active release backup"
  );

  const snapshot = buildSnapshot();
  snapshot.releaseVersion = "test-publish-regression-2026-06-02";
  snapshot.version = snapshot.releaseVersion;

  const published = releaseService.activateReleaseFromSnapshot(snapshot);
  assert.strictEqual(published.active.version, snapshot.releaseVersion, "activation should update active pointer");

  const active = releaseService.getActiveReleaseInfo();
  assert(active, "getActiveReleaseInfo should return active release metadata");
  assert.strictEqual(active.version, snapshot.releaseVersion, "active version should match published staging");
  assert.strictEqual(active.releaseVersion, snapshot.releaseVersion, "active releaseVersion alias should be populated");
  assert.strictEqual(active.term, snapshot.term, "active term alias should be populated");
  assert.strictEqual(active.status, "active", "active release status should be active");
  assert.strictEqual(active.source, "release", "active release source should identify release storage");
  assert.strictEqual(active.counts.classScheduleCount, 1, "active counts should be available");
  assert(active.publishedAt, "active publishedAt should be populated");
  assert(active.paths && active.paths.snapshotPath, "active release paths should include snapshotPath");
  assert(active.snapshot && active.snapshot.releaseVersion === snapshot.releaseVersion, "active snapshot summary should be available");

  const status = releaseService.getReleaseStatus();
  assert.strictEqual(status.activeReleaseVersion, snapshot.releaseVersion, "release status should point at active version");

  const activeSnapshot = releaseService.readActiveReleaseSnapshot();
  assert(activeSnapshot, "active release snapshot should be readable after publish");
  assert.strictEqual(activeSnapshot.version, snapshot.releaseVersion, "active snapshot version should match published staging");

  const files = releaseService.getReleaseFiles(snapshot.releaseVersion);
  assert(fs.existsSync(files.snapshotPath), "published release snapshot should exist");
  assert(fs.existsSync(files.classesIndexPath), "published release should build class search index");
}

async function main() {
  const snapshotBuffer = Buffer.from(JSON.stringify(buildSnapshot()), "utf-8");
  const uploadBuffer = zlib.gzipSync(snapshotBuffer);
  const chunkSize = 64;
  const totalChunks = Math.ceil(uploadBuffer.length / chunkSize);
  const actor = { type: "admin", id: "smoke-test" };

  const upload = stagingUploadService.initUpload({
    fileName: "../../2025-2026-2-full.json",
    term: "2025-2026-2",
    releaseVersion: "test-2026-06-02",
    contentEncoding: "gzip",
    chunkSize,
    totalChunks,
    uploadSize: uploadBuffer.length,
    uploadSha256: sha256(uploadBuffer),
    originalSize: snapshotBuffer.length,
    originalSha256: sha256(snapshotBuffer),
  }, actor);

  assert(upload.uploadId, "initUpload should return uploadId");
  assert.strictEqual(upload.fileName, "2025-2026-2-full.json", "filename should be sanitized to basename");

  for (let index = 0; index < totalChunks; index += 1) {
    const chunk = uploadBuffer.subarray(index * chunkSize, Math.min(uploadBuffer.length, (index + 1) * chunkSize));
    const result = stagingUploadService.writeChunk(upload.uploadId, index, chunk, actor, {
      chunkSha256: sha256(chunk),
    });
    assert.strictEqual(result.receivedCount, index + 1, "receivedCount should advance");
  }

  const finalized = await stagingUploadService.finalizeUpload(upload.uploadId, actor, {
    uploadSize: uploadBuffer.length,
    uploadSha256: sha256(uploadBuffer),
    originalSize: snapshotBuffer.length,
    originalSha256: sha256(snapshotBuffer),
  });
  assert.strictEqual(finalized.stagingData.term, "2025-2026-2", "finalize should parse JSON payload");

  const pending = stagingUploadService.markUploadPendingReview(upload.uploadId, {
    term: finalized.stagingData.term,
    releaseVersion: finalized.stagingData.releaseVersion,
    counts: {
      classScheduleCount: finalized.stagingData.classSchedules.length,
      teacherScheduleCount: finalized.stagingData.resources.teacherSchedules.length,
      classroomScheduleCount: finalized.stagingData.resources.classroomSchedules.length,
      courseScheduleCount: finalized.stagingData.resources.courseSchedules.length,
    },
  });
  assert.strictEqual(pending.status, "pending-review", "upload should move to pending-review");
  assert.strictEqual(pending.sourceSize, snapshotBuffer.length, "public status should expose sourceSize");
  assert.strictEqual(pending.gzipSize, uploadBuffer.length, "public status should expose gzipSize");
  assert.strictEqual(pending.chunkCount, totalChunks, "public status should expose chunkCount");
  assert.strictEqual(pending.uploadedChunks, totalChunks, "public status should expose uploadedChunks");
  assert.strictEqual(pending.counts.classScheduleCount, 1, "public status should expose counts");

  const published = stagingUploadService.markUploadPublished(upload.uploadId, "test-2026-06-02");
  assert.strictEqual(published.status, "published", "upload should move to published");
  assert(stagingUploadService.listUploads(10).some((item) => item.uploadId === upload.uploadId), "upload should be listed");

  const deleted = stagingUploadService.deleteUpload(upload.uploadId, actor);
  assert.strictEqual(deleted.uploadId, upload.uploadId, "deleteUpload should return deleted upload id");
  assert(!stagingUploadService.listUploads(10).some((item) => item.uploadId === upload.uploadId), "deleted upload should be removed from list");

  assertReleasePublishRegression();
  console.log("Staging publish regression smoke test passed.");

  const resolvedRoot = path.resolve(tempRoot);
  const relativeRoot = path.relative(os.tmpdir(), resolvedRoot);
  if (!relativeRoot || relativeRoot.startsWith("..") || path.isAbsolute(relativeRoot) || !path.basename(resolvedRoot).startsWith("fosu-staging-upload-test-")) {
    throw new Error(`refusing to remove unexpected temp directory: ${resolvedRoot}`);
  }
  fs.rmSync(resolvedRoot, { recursive: true, force: true });
  console.log("Staging upload chunk smoke test passed.");
}

main().catch((error) => {
  console.error(error.stack || error.message);
  process.exit(1);
});
