const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");

const tempRoot = path.join(os.tmpdir(), `fosu-release-pack-build-${process.pid}-${Date.now()}`);
process.env.FOSU_STORAGE_DIR = path.join(tempRoot, "storage");

const releaseService = require("../server/src/services/releaseService");

function buildSnapshot(version) {
  const course = {
    courseName: "Release Pack 测试课程",
    teacherName: "Release Pack 教师",
    classroom: "C7-302",
    weekday: 2,
    startSection: 3,
    endSection: 4,
    sections: [3, 4],
    weeks: [1, 2, 3],
  };
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
      className: "25离线包1班",
      semester: "2025-2026-2",
      collegeCode: "04",
      collegeName: "测试学院",
      grade: "2025",
      majorCode: "0401",
      majorName: "测试专业",
      courses: [course],
    }],
    resources: {
      teachers: [{ teacherName: "Release Pack 教师", collegeName: "测试学院" }],
      classrooms: [{ roomName: "C7-302", campus: "仙溪" }],
      courses: [{ courseName: "Release Pack 测试课程" }],
      teacherSchedules: [{ teacherName: "Release Pack 教师", semester: "2025-2026-2", courses: [course] }],
      classroomSchedules: [{ roomName: "C7-302", semester: "2025-2026-2", courses: [course] }],
      courseSchedules: [{ courseName: "Release Pack 测试课程", semester: "2025-2026-2", courses: [course] }],
    },
  };
}

function cleanup() {
  const resolvedRoot = path.resolve(tempRoot);
  const relativeRoot = path.relative(os.tmpdir(), resolvedRoot);
  if (!relativeRoot || relativeRoot.startsWith("..") || path.isAbsolute(relativeRoot) || !path.basename(resolvedRoot).startsWith("fosu-release-pack-build-")) {
    throw new Error(`refusing to remove unexpected temp directory: ${resolvedRoot}`);
  }
  fs.rmSync(resolvedRoot, { recursive: true, force: true });
}

try {
  const version = "release-pack-build-2026-06-02";
  releaseService.writeReleaseSnapshot(buildSnapshot(version));
  const files = releaseService.getReleaseFiles(version);
  const manifest = releaseService.getReleasePackManifest(version);
  const status = releaseService.getReleasePackStatus(version);

  assert(fs.existsSync(path.join(files.releaseDir, "manifest.json")), "manifest.json should exist");
  assert(fs.existsSync(path.join(files.releaseDir, "index", "class.json")), "index/class.json should exist");
  assert(fs.existsSync(path.join(files.releaseDir, "index", "teacher.json")), "index/teacher.json should exist");
  assert(fs.existsSync(path.join(files.releaseDir, "index", "classroom.json")), "index/classroom.json should exist");
  assert(fs.existsSync(path.join(files.releaseDir, "index", "course.json")), "index/course.json should exist");
  assert(fs.existsSync(path.join(files.releaseDir, "empty-room", "index.json")), "empty-room/index.json should exist");
  assert(fs.existsSync(path.join(files.releaseDir, "calendar.json")), "calendar.json should exist");
  assert(fs.existsSync(path.join(files.releaseDir, "bootstrap.json")), "bootstrap.json should exist");
  const classDetailFile = fs.readdirSync(path.join(files.releaseDir, "detail", "class")).find((name) => name.endsWith(".json"));
  assert(classDetailFile, "detail/class should contain detail files");
  assert(fs.readdirSync(path.join(files.releaseDir, "detail", "teacher")).some((name) => name.endsWith(".json")), "detail/teacher should contain detail files");
  const classDetail = JSON.parse(fs.readFileSync(path.join(files.releaseDir, "detail", "class", classDetailFile), "utf-8"));
  assert(classDetail.compact && classDetail.compact.dictionaries.courseDict.length === 1, "detail should include compact course dictionary");
  assert(Array.isArray(classDetail.compact.courses) && classDetail.compact.courses.length === 1, "detail should include compact course records");
  assert.strictEqual(manifest.success, true);
  assert.strictEqual(manifest.term, "2025-2026-2");
  assert.strictEqual(manifest.releaseVersion, version);
  assert(manifest.cacheEpoch, "manifest should include cacheEpoch");
  assert(manifest.files["index/class.json"].hash, "manifest should hash index/class.json");
  assert(manifest.files["empty-room/index.json"].size > 0, "manifest should include empty-room size");
  assert(manifest.files["calendar.json"].hash, "manifest should hash calendar.json");
  assert(manifest.files["bootstrap.json"].hash, "manifest should hash bootstrap.json");
  assert(Object.keys(manifest.files).some((key) => key.startsWith("detail/class/")), "manifest should include detail hashes");
  assert(status.healthy, `release pack should be healthy: ${status.missing.concat(status.hashErrors).join("; ")}`);
  assert(status.totalBytes > 0, "status should expose totalBytes");

  cleanup();
  console.log("test-release-pack-build passed");
} catch (error) {
  console.error(error);
  try { cleanup(); } catch (cleanupError) {}
  process.exit(1);
}
