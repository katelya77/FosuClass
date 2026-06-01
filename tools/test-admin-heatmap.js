const assert = require("assert");

process.env.NODE_ENV = "development";
process.env.ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || "test-admin-password";
process.env.ADMIN_API_TOKEN = process.env.ADMIN_API_TOKEN || "test-admin-token";

const adminRouter = require("../server/src/routes/admin");
const {
  buildClassroomHeatmap,
  normalizeCourseSlot,
} = adminRouter._test;

function assertOccupied(result, weekday, section, message) {
  assert(result.classroomHeatmap[weekday - 1][section - 1] > 0, message);
}

const startEnd = buildClassroomHeatmap({
  source: "test",
  classroomSchedules: [{
    roomName: "C7-301",
    courses: [{ weekday: 1, startSection: 3, endSection: 4 }],
  }],
});
assertOccupied(startEnd, 1, 3, "startSection/endSection should produce non-zero heatmap cells");
assertOccupied(startEnd, 1, 4, "endSection should be included");

const sectionArray = buildClassroomHeatmap({
  source: "test",
  classroomSchedules: [{
    roomName: "C7-302",
    courses: [{ dayOfWeek: 2, sections: [3, 4, 5] }],
  }],
});
assertOccupied(sectionArray, 2, 5, "sections array should be recognized");

const rawTextSlot = normalizeCourseSlot({
  weekDay: 3,
  rawText: "大学英语\nC7-305[03-04-05]节",
});
assert.deepStrictEqual(rawTextSlot.sections, [3, 4, 5], "rawText section string should parse [03-04-05]节");

const derived = buildClassroomHeatmap({
  source: "derived-from-classSchedules",
  classSchedules: [{
    className: "测试班",
    courses: [{ weekday: 4, startSection: 6, endSection: 7, classroom: "C7-306" }],
  }],
});
assert.strictEqual(derived.classroomHeatmapMeta.totalClassrooms, 1, "classSchedules should derive distinct classrooms");
assertOccupied(derived, 4, 6, "derived classroom schedule should produce heatmap cells");

const empty = buildClassroomHeatmap({ source: "empty" });
assert.strictEqual(empty.classroomHeatmapMeta.totalClassrooms, 0, "empty heatmap should keep totalClassrooms at 0");
assert.strictEqual(empty.classroomHeatmapMeta.emptyReason, "no-classroom-schedules", "empty heatmap should explain emptyReason");

console.log("Admin heatmap parser tests passed.");
