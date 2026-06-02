const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");

const tempRoot = path.join(os.tmpdir(), `fosu-release-safety-test-${process.pid}-${Date.now()}`);
process.env.FOSU_STORAGE_DIR = path.join(tempRoot, "storage");

const releaseService = require("../server/src/services/releaseService");

function buildSnapshot(version, classCount) {
  const schedules = Array.from({ length: classCount }, (_, index) => ({
    className: `25安全测试${index + 1}班`,
    semester: "2025-2026-2",
    courses: [{
      courseName: `安全测试课程${index + 1}`,
      teacherName: "安全教师",
      classroom: "C7-104",
      weekday: 1,
      startSection: 1,
      endSection: 2,
    }],
  }));
  return {
    schemaVersion: 1,
    version,
    releaseVersion: version,
    term: "2025-2026-2",
    semester: "2025-2026-2",
    termStartDate: "2026-03-09",
    generatedAt: "2026-06-02T00:00:00.000Z",
    updatedAt: "2026-06-02T00:00:00.000Z",
    catalog: { colleges: [{ code: "04", name: "测试学院" }], grades: ["2025"] },
    majors: [{ collegeCode: "04", code: "0401", name: "测试专业", grade: "2025" }],
    classSchedules: schedules,
    resources: {
      teachers: [{ teacherName: "安全教师" }],
      classrooms: [{ roomName: "C7-104" }],
      courses: [{ courseName: "安全测试课程" }],
      teacherSchedules: [{
        teacherName: "安全教师",
        courses: [{ courseName: "安全测试课程", weekday: 1, startSection: 1, endSection: 2 }],
      }],
      classroomSchedules: [{
        roomName: "C7-104",
        courses: [{ courseName: "安全测试课程", weekday: 1, startSection: 1, endSection: 2 }],
      }],
      courseSchedules: [{
        courseName: "安全测试课程",
        courses: [{ courseName: "安全测试课程", weekday: 1, startSection: 1, endSection: 2 }],
      }],
    },
  };
}

function assertThrowsMessage(fn, pattern, label) {
  let thrown = null;
  try {
    fn();
  } catch (error) {
    thrown = error;
  }
  assert(thrown, label);
  assert(pattern.test(thrown.message), `${label}: ${thrown.message}`);
  return thrown;
}

try {
  const activeVersion = "safety-active-2026-06-02";
  releaseService.activateReleaseFromSnapshot(buildSnapshot(activeVersion, 3));

  const activeInfo = releaseService.getActiveReleaseInfo();
  assert.strictEqual(activeInfo.releaseVersion, activeVersion);
  assert.strictEqual(activeInfo.counts.classScheduleCount, 3);

  const deleteError = assertThrowsMessage(
    () => releaseService.deleteReleaseVersion(activeVersion),
    /不能删除当前 active release/,
    "active release deletion should be blocked"
  );
  assert.strictEqual(deleteError.statusCode, 400);

  const invalid = buildSnapshot("safety-invalid-2026-06-02", 0);
  invalid.classSchedules = [];
  const validation = releaseService.validateReleaseSnapshot(invalid);
  assert.strictEqual(validation.valid, false, "empty classSchedules should fail release validation");
  assert(validation.errors.some((item) => item.includes("classScheduleCount")), "validation should mention missing classSchedules");

  const nextVersion = "safety-next-2026-06-02";
  releaseService.writeReleaseSnapshot(buildSnapshot(nextVersion, 1));
  const deleted = releaseService.deleteReleaseVersion(nextVersion);
  assert.strictEqual(deleted.deleted, true, "non-active release may be deleted");
  assert.strictEqual(releaseService.getActiveReleaseInfo().releaseVersion, activeVersion, "active release pointer should remain unchanged");

  const resolvedRoot = path.resolve(tempRoot);
  const relativeRoot = path.relative(os.tmpdir(), resolvedRoot);
  if (!relativeRoot || relativeRoot.startsWith("..") || path.isAbsolute(relativeRoot) || !path.basename(resolvedRoot).startsWith("fosu-release-safety-test-")) {
    throw new Error(`refusing to remove unexpected temp directory: ${resolvedRoot}`);
  }
  fs.rmSync(resolvedRoot, { recursive: true, force: true });
  console.log("test-release-publish-safety passed");
} catch (error) {
  console.error(error);
  process.exit(1);
}
