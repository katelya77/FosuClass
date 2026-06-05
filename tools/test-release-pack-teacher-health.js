const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");

const tempRoot = path.join(os.tmpdir(), `fosu-teacher-health-${process.pid}-${Date.now()}`);
process.env.FOSU_STORAGE_DIR = path.join(tempRoot, "storage");
process.env.FOSU_STATIC_RELEASE_BASE_URL = "https://class.katelya.eu.org/static/releases";
process.env.NODE_ENV = "test";

const releaseService = require("../server/src/services/releaseService");

const term = "2025-2026-2";
const version = "teacher-health-2026-06-05";

function cleanup() {
  const resolved = path.resolve(tempRoot);
  if (!path.basename(resolved).startsWith("fosu-teacher-health-")) {
    throw new Error(`refusing cleanup: ${resolved}`);
  }
  fs.rmSync(resolved, { recursive: true, force: true });
}

function snapshot() {
  const directCourse = {
    courseName: "Direct Teacher Course",
    teacherName: "陈芳",
    classroom: "C7-208",
    weekday: 1,
    startSection: 1,
    endSection: 2,
    sections: [1, 2],
    weeks: [1, 2],
  };
  const derivedCourse = {
    courseName: "Derived Teacher Course",
    teacherName: "安哲明",
    classroom: "B8-101",
    weekday: 2,
    startSection: 3,
    endSection: 4,
    sections: [3, 4],
    weeks: [1, 2],
  };
  return {
    schemaVersion: 1,
    version,
    releaseVersion: version,
    term,
    semester: term,
    termStartDate: "2026-03-09",
    generatedAt: "2026-06-05T00:00:00.000Z",
    updatedAt: "2026-06-05T00:00:00.000Z",
    meta: {
      resourceSource: "both",
    },
    catalog: { colleges: [{ code: "04", name: "测试学院" }], grades: ["2025"] },
    majors: [{ collegeCode: "04", code: "0401", name: "测试专业", grade: "2025" }],
    classSchedules: [
      { className: "25测试1班", courses: [derivedCourse] },
    ],
    resources: {
      teachers: [
        { teacherName: "陈芳", source: "direct", collegeName: "", titleCode: "" },
        { teacherName: "安哲明", source: "derived", collegeName: "测试学院", title: "讲师" },
      ],
      teacherSchedules: [
        { teacherName: "陈芳", source: "direct", courses: [directCourse] },
        { teacherName: "安哲明", source: "derived", courses: [derivedCourse] },
      ],
      classrooms: [{ roomName: "C7-208" }, { roomName: "B8-101" }],
      classroomSchedules: [
        { roomName: "C7-208", courses: [directCourse] },
        { roomName: "B8-101", courses: [derivedCourse] },
      ],
      courses: [{ courseName: "Direct Teacher Course" }, { courseName: "Derived Teacher Course" }],
      courseSchedules: [
        { courseName: "Direct Teacher Course", courses: [directCourse] },
        { courseName: "Derived Teacher Course", courses: [derivedCourse] },
      ],
    },
  };
}

try {
  releaseService.activateReleaseFromSnapshot(snapshot());
  const files = releaseService.getReleaseFiles(version);
  const manifest = JSON.parse(fs.readFileSync(files.manifestPath, "utf-8"));
  const teacherIndex = JSON.parse(fs.readFileSync(files.teacherIndexAllPath, "utf-8"));

  assert.strictEqual(manifest.packHealth.teacher.teacherIndexCount, 2);
  assert.strictEqual(manifest.packHealth.teacher.teacherDetailCount, 2);
  assert.strictEqual(manifest.packHealth.teacher.teacherSourceMode, "both");
  assert.strictEqual(manifest.packHealth.teacher.directTeacherScheduleCount, 1);
  assert.strictEqual(manifest.packHealth.teacher.derivedTeacherScheduleCount, 1);

  const chenfang = teacherIndex.items.find((item) => item.teacherName === "陈芳");
  assert(chenfang, "teacher index should include 陈芳");
  assert.strictEqual(chenfang.source, "direct");
  assert.strictEqual(chenfang.hasDetail, true);
  assert.strictEqual(chenfang.courseCount, 1);
  assert.strictEqual(chenfang.searchableName, "陈芳");
  assert(Array.isArray(chenfang.keywords) && chenfang.keywords.includes("陈芳"), "teacher index should include searchable keywords");

  cleanup();
  console.log("test-release-pack-teacher-health passed");
} catch (error) {
  try { cleanup(); } catch (cleanupError) {}
  console.error(error);
  process.exit(1);
}
