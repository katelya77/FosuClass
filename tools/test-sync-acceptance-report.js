"use strict";

const assert = require("assert");
const { buildAcceptanceReport } = require("./fosu-sync-client/sync-acceptance-report");

function documents(kind) {
  return Array.from({ length: 10 }, (_, index) => ({
    id: `${kind}-${index}`,
    classId: kind === "class" ? `class-${index}` : "",
    className: kind === "class" ? `2025-class-${index}` : "",
    grade: kind === "class" ? "2025" : "",
    courses: [{ courseName: `course-${index}` }],
  }));
}
const report = buildAcceptanceReport({
  term: "2026-2027-1",
  termStartDate: "2026-09-07",
  totalWeeks: 20,
  releaseVersion: "staging-v1",
  catalog: { colleges: [{}], majors: [{}], grades: ["2025", "2026"], adminClasses: [
    ...documents("class").map((item) => ({ id: item.classId, name: item.className, grade: "2025" })),
    { id: "class-2026", name: "2026-class", grade: "2026" },
  ] },
  classSchedules: documents("class"),
  resources: {
    teacherSchedules: documents("teacher"),
    classroomSchedules: documents("classroom"),
    courseSchedules: documents("course"),
  },
}, { calendarStatus: "CALENDAR_SOURCE_INCOMPLETE" });
assert.strictEqual(report.sampleValidationComplete, true);
assert.deepStrictEqual(report.releasedGrades, ["2025"]);
assert.deepStrictEqual(report.pendingGrades, [{ grade: "2026", status: "pending_schedule_release" }]);
assert.strictEqual(report.counts.classSchedules, 10);
assert.strictEqual(report.counts.teacherSchedules, 10);
console.log("test-sync-acceptance-report passed");
