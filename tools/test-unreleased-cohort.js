"use strict";

const assert = require("assert");
const { assessCohortAvailability } = require("../shared/cohortAvailability");
const result = assessCohortAvailability({
  catalog: {
    grades: ["2024", "2025", "2026"],
    adminClasses: [
      { id: "c25", grade: "2025", name: "2025-class" },
      { id: "c26", grade: "2026", name: "2026-class" },
    ],
  },
  classSchedules: [
    { classId: "c25", className: "2025-class", grade: "2025", courses: [{ courseName: "A" }] },
  ],
});
assert.deepStrictEqual(result.releasedGrades, ["2025"]);
assert.deepStrictEqual(result.pendingGrades, ["2024", "2026"]);
assert.strictEqual(result.byGrade["2026"].status, "pending_schedule_release");
assert.strictEqual(result.byGrade["2026"].dataAvailable, false);
assert.deepStrictEqual(result.visibleAdminClasses.map((item) => item.id), ["c25"]);
console.log("test-unreleased-cohort passed");
