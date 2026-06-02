const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");

const tempRoot = path.join(os.tmpdir(), `fosu-release-index-test-${process.pid}-${Date.now()}`);
process.env.FOSU_STORAGE_DIR = path.join(tempRoot, "storage");

const releaseService = require("../server/src/services/releaseService");

function buildSnapshot(version) {
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
    classSchedules: [{
      className: "25索引测试1班",
      semester: "2025-2026-2",
      courses: [{ courseName: "索引测试课程", weekday: 1, startSection: 1, endSection: 2 }],
    }],
    resources: {
      teachers: [{ teacherName: "索引教师" }],
      classrooms: [{ roomName: "C7-103" }],
      courses: [{ courseName: "索引测试课程" }],
      teacherSchedules: [{
        teacherName: "索引教师",
        courses: [{ courseName: "索引测试课程", weekday: 1, startSection: 1, endSection: 2 }],
      }],
      classroomSchedules: [{
        roomName: "C7-103",
        courses: [{ courseName: "索引测试课程", weekday: 1, startSection: 1, endSection: 2 }],
      }],
      courseSchedules: [{
        courseName: "索引测试课程",
        courses: [{ courseName: "索引测试课程", weekday: 1, startSection: 1, endSection: 2 }],
      }],
    },
  };
}

try {
  const version = "index-rebuild-2026-06-02";
  const written = releaseService.writeReleaseSnapshot(buildSnapshot(version));
  const files = releaseService.getReleaseFiles(version);

  fs.unlinkSync(files.classesIndexPath);
  fs.unlinkSync(files.teachersIndexPath);
  releaseService.clearDerivedCache();
  assert(!fs.existsSync(files.classesIndexPath), "test should remove class index before rebuild");

  const rebuilt = releaseService.writeDerivedIndexes(written.snapshot, files, true);
  assert(Array.isArray(rebuilt.classes) && rebuilt.classes.length === 1, "rebuild should recreate class index");
  assert(Array.isArray(rebuilt.teachers) && rebuilt.teachers.length === 1, "rebuild should recreate teacher index");
  assert(fs.existsSync(files.classesIndexPath), "class index file should exist after rebuild");
  assert(fs.existsSync(files.teachersIndexPath), "teacher index file should exist after rebuild");

  const index = releaseService.readActiveIndex("class", version);
  assert.strictEqual(index.success, true);
  assert.strictEqual(index.releaseVersion, version);
  assert.strictEqual(index.items.length, 1);

  const resolvedRoot = path.resolve(tempRoot);
  const relativeRoot = path.relative(os.tmpdir(), resolvedRoot);
  if (!relativeRoot || relativeRoot.startsWith("..") || path.isAbsolute(relativeRoot) || !path.basename(resolvedRoot).startsWith("fosu-release-index-test-")) {
    throw new Error(`refusing to remove unexpected temp directory: ${resolvedRoot}`);
  }
  fs.rmSync(resolvedRoot, { recursive: true, force: true });
  console.log("test-release-index-rebuild passed");
} catch (error) {
  console.error(error);
  process.exit(1);
}
