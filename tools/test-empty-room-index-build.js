const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");

const tempRoot = path.join(os.tmpdir(), `fosu-empty-room-index-test-${process.pid}-${Date.now()}`);
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
    updatedAt: "2026-06-02T00:00:00.000Z",
    catalog: { colleges: [{ code: "04", name: "测试学院" }], grades: ["2025"] },
    majors: [{ collegeCode: "04", code: "0401", name: "测试专业", grade: "2025" }],
    classSchedules: [{
      className: "25空教室测试1班",
      semester: "2025-2026-2",
      courses: [{ courseName: "班级课程", classroom: "B8-201", weekday: 2, startSection: 3, endSection: 4 }],
    }],
    resources: {
      teachers: [{ teacherName: "空教室教师" }],
      classrooms: [{ roomName: "C7-101" }, { roomName: "C7-102" }, { roomName: "B8-201" }],
      courses: [{ courseName: "空教室课程" }],
      teacherSchedules: [{
        teacherName: "空教室教师",
        courses: [{ courseName: "空教室课程", weekday: 2, startSection: 3, endSection: 4 }],
      }],
      classroomSchedules: [
        {
          roomName: "C7-101",
          courses: [{ courseName: "占用课程", teacherName: "教师A", weekday: 2, startSection: 3, endSection: 4, weeks: [13] }],
        },
        {
          roomName: "C7-102",
          courses: [{ courseName: "其他节课程", teacherName: "教师B", weekday: 2, startSection: 6, endSection: 7, weeks: [13] }],
        },
        {
          roomName: "B8-201",
          courses: [{ courseName: "其他楼课程", teacherName: "教师C", weekday: 2, startSection: 3, endSection: 4, weeks: [13] }],
        },
      ],
      courseSchedules: [{
        courseName: "空教室课程",
        courses: [{ courseName: "空教室课程", weekday: 2, startSection: 3, endSection: 4 }],
      }],
    },
  };
}

try {
  const version = "empty-room-index-2026-06-02";
  releaseService.activateReleaseFromSnapshot(buildSnapshot(version));
  const files = releaseService.getReleaseFiles(version);

  assert(fs.existsSync(files.emptyRoomIndexPath), "empty-room-index.json should be generated on release write");

  const index = releaseService.readEmptyRoomIndex(version);
  assert.strictEqual(index.success, true);
  assert.strictEqual(index.releaseVersion, version);
  assert(index.rooms.length >= 3, "index should include classroom schedules");
  assert(index.buildings.includes("C7"), "index should infer C7 building");

  const result = releaseService.queryEmptyClassrooms({
    releaseVersion: version,
    date: "2026-06-02",
    week: 13,
    weekday: 2,
    sections: "3-4",
    building: "C7",
  });
  assert.strictEqual(result.success, true);
  assert(result.rooms.some((room) => room.roomName === "C7-102"), "C7-102 should be free for sections 3-4");
  assert(!result.rooms.some((room) => room.roomName === "C7-101"), "C7-101 should be occupied for sections 3-4");
  assert(!result.rooms.some((room) => room.roomName === "B8-201"), "building filter should exclude B8");

  const resolvedRoot = path.resolve(tempRoot);
  const relativeRoot = path.relative(os.tmpdir(), resolvedRoot);
  if (!relativeRoot || relativeRoot.startsWith("..") || path.isAbsolute(relativeRoot) || !path.basename(resolvedRoot).startsWith("fosu-empty-room-index-test-")) {
    throw new Error(`refusing to remove unexpected temp directory: ${resolvedRoot}`);
  }
  fs.rmSync(resolvedRoot, { recursive: true, force: true });
  console.log("test-empty-room-index-build passed");
} catch (error) {
  console.error(error);
  process.exit(1);
}
