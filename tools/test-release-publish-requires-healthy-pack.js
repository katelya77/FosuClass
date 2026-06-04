const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");

const tempRoot = path.join(os.tmpdir(), `fosu-pack-health-${process.pid}-${Date.now()}`);
process.env.FOSU_STORAGE_DIR = path.join(tempRoot, "storage");

const releaseService = require("../server/src/services/releaseService");

function buildSnapshot(version) {
  const course = {
    courseName: "健康检查课程",
    teacherName: "健康教师",
    classroom: "C7-301",
    weekday: 1,
    startSection: 1,
    endSection: 2,
  };
  return {
    schemaVersion: 1,
    version,
    releaseVersion: version,
    term: "2025-2026-2",
    semester: "2025-2026-2",
    updatedAt: "2026-06-04T00:00:00.000Z",
    catalog: { colleges: [{ code: "04", name: "测试学院" }], grades: ["2025"] },
    majors: [{ collegeCode: "04", code: "0401", name: "测试专业", grade: "2025" }],
    classSchedules: [{
      className: "25健康1班",
      semester: "2025-2026-2",
      collegeCode: "04",
      collegeName: "测试学院",
      grade: "2025",
      majorCode: "0401",
      majorName: "测试专业",
      courses: [course],
    }],
    resources: {
      teachers: [{ teacherName: "健康教师" }],
      classrooms: [{ roomName: "C7-301" }],
      courses: [{ courseName: "健康检查课程" }],
      teacherSchedules: [{ teacherName: "健康教师", semester: "2025-2026-2", courses: [course] }],
      classroomSchedules: [{ roomName: "C7-301", semester: "2025-2026-2", courses: [course] }],
      courseSchedules: [{ courseName: "健康检查课程", semester: "2025-2026-2", courses: [course] }],
    },
  };
}

function cleanup() {
  const resolvedRoot = path.resolve(tempRoot);
  const relativeRoot = path.relative(os.tmpdir(), resolvedRoot);
  if (!relativeRoot || relativeRoot.startsWith("..") || path.isAbsolute(relativeRoot) || !path.basename(resolvedRoot).startsWith("fosu-pack-health-")) {
    throw new Error(`refusing to remove unexpected temp directory: ${resolvedRoot}`);
  }
  fs.rmSync(resolvedRoot, { recursive: true, force: true });
}

try {
  const version = "pack-health-2026-06-04";
  releaseService.writeReleaseSnapshot(buildSnapshot(version));
  const files = releaseService.getReleaseFiles(version);
  fs.unlinkSync(files.teachersIndexPath);

  let healthError = null;
  try {
    releaseService.assertHealthyReleasePack(version);
  } catch (error) {
    healthError = error;
  }
  assert(healthError, "broken pack should fail health check");
  assert.strictEqual(healthError.code, "RELEASE_PACK_UNHEALTHY");

  releaseService.activateReleaseVersion(version);
  const active = releaseService.getActiveReleaseInfo();
  assert.strictEqual(active.releaseVersion, version);
  assert(active.cacheEpoch, "active pointer should include cacheEpoch");
  assert(active.forceRefreshToken, "active pointer should include forceRefreshToken");
  assert.strictEqual(releaseService.assertHealthyReleasePack(version).healthy, true);

  cleanup();
  console.log("test-release-publish-requires-healthy-pack passed");
} catch (error) {
  console.error(error);
  try { cleanup(); } catch (cleanupError) {}
  process.exit(1);
}
