const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");

const tempRoot = path.join(os.tmpdir(), `fosu-building-normalizer-${process.pid}-${Date.now()}`);
process.env.FOSU_STORAGE_DIR = path.join(tempRoot, "storage");

const { normalizeBuilding, UNKNOWN_BUILDING_CODE } = require("../server/src/utils/buildingNormalizer");
const releaseService = require("../server/src/services/releaseService");

function cleanup() {
  const resolvedRoot = path.resolve(tempRoot);
  const relativeRoot = path.relative(os.tmpdir(), resolvedRoot);
  if (!relativeRoot || relativeRoot.startsWith("..") || path.isAbsolute(relativeRoot) || !path.basename(resolvedRoot).startsWith("fosu-building-normalizer-")) {
    throw new Error(`refusing to remove unexpected temp directory: ${resolvedRoot}`);
  }
  fs.rmSync(resolvedRoot, { recursive: true, force: true });
}

function course(roomName) {
  return {
    courseName: `课程-${roomName}`,
    teacherName: "教师",
    classroom: roomName,
    location: roomName,
    weekday: 1,
    startSection: 1,
    endSection: 2,
    sections: [1, 2],
    weeks: [1, 2],
  };
}

function snapshot(version) {
  return {
    version,
    releaseVersion: version,
    term: "2025-2026-2",
    semester: "2025-2026-2",
    updatedAt: "2026-06-04T00:00:00.000Z",
    catalog: { colleges: [{ code: "04", name: "测试学院" }], grades: ["2025"] },
    majors: [{ collegeCode: "04", code: "0401", name: "测试专业", grade: "2025" }],
    classSchedules: [{
      className: "25楼栋1班",
      collegeCode: "04",
      grade: "2025",
      majorCode: "0401",
      courses: [
        course("C7-305"),
        course("B8-209"),
        course("B5-304"),
        course("C7-120报告厅"),
        course("会通楼203"),
        course("致用楼418"),
        course("神秘空间"),
      ],
    }],
    resources: {
      teachers: [{ teacherName: "教师" }],
      classrooms: [{ roomName: "C7-305" }],
      courses: [{ courseName: "课程-C7-305" }],
      teacherSchedules: [{ teacherName: "教师", courses: [course("C7-305")] }],
      classroomSchedules: [{ roomName: "C7-305", courses: [course("C7-305")] }],
      courseSchedules: [{ courseName: "课程-C7-305", courses: [course("C7-305")] }],
    },
  };
}

try {
  assert.strictEqual(normalizeBuilding("C7-305").buildingCode, "C7");
  assert.strictEqual(normalizeBuilding("B8-209").buildingCode, "B8");
  assert.strictEqual(normalizeBuilding("B5-304").buildingCode, "B5");
  assert.strictEqual(normalizeBuilding("C7-120报告厅").buildingCode, "C7");
  assert.strictEqual(normalizeBuilding("会通楼203").buildingCode, "会通楼");
  assert.strictEqual(normalizeBuilding("致用楼418").buildingCode, "致用楼");
  assert.strictEqual(normalizeBuilding("神秘空间").buildingCode, UNKNOWN_BUILDING_CODE);

  const version = "building-normalizer-2026-06-04";
  releaseService.writeReleaseSnapshot(snapshot(version));
  const empty = releaseService.readEmptyRoomIndex(version);
  const names = new Set(empty.rooms.map((room) => room.roomName));
  assert(names.has("C7-305"), "classroomSchedules room should exist");
  assert(names.has("B8-209"), "room derived from classSchedules should exist");
  assert(names.has("神秘空间"), "unknown room should not be discarded");
  const derived = empty.rooms.find((room) => room.roomName === "B8-209");
  assert.strictEqual(derived.source, "classSchedules-derived");
  assert.strictEqual(derived.buildingCode, "B8");
  assert(empty.health.unknownRoomCount >= 1, "empty-room health should count unknown rooms");
  assert(empty.health.unknownRoomSamples.includes("神秘空间"), "health should expose unknown samples");

  cleanup();
  console.log("test-building-normalizer passed");
} catch (error) {
  console.error(error);
  try { cleanup(); } catch (cleanupError) {}
  process.exit(1);
}
