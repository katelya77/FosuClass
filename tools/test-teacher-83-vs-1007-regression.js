const assert = require("assert");
const {
  compareResourceCountContracts,
  sourceModeLabel,
} = require("../server/src/shared/resourceCountContract");

const active = {
  countSchemaVersion: 2,
  term: "2025-2026-2",
  class: { scheduleDocuments: 430, administrativeClasses: 268, aggregateSchedules: 162, courseEvents: 0 },
  teacher: { directoryEntities: 1007, directoryEntitiesStatus: "derived-from-legacy-index", scheduleDocuments: 1007, courseEvents: 14743, sourceMode: "legacy-derived" },
  classroom: { directoryEntities: 423, directoryEntitiesStatus: "derived-from-legacy-index", scheduleDocuments: 423, courseEvents: 19056, sourceMode: "legacy-derived" },
  course: { directoryEntities: 1014, directoryEntitiesStatus: "derived-from-legacy-index", scheduleDocuments: 1014, courseEvents: 19638, sourceMode: "legacy-derived" },
  catalog: { colleges: 23, grades: 0, majors: 536 },
  scopeFilters: {},
  coverage: {},
  diagnostics: [],
  derivedFromLegacy: true,
};

const staging = {
  countSchemaVersion: 2,
  term: "2025-2026-2",
  class: { scheduleDocuments: 430, administrativeClasses: 268, aggregateSchedules: 162, courseEvents: 0 },
  teacher: { directoryEntities: 83, directoryEntitiesStatus: "counted", scheduleDocuments: 83, courseEvents: 6282, sourceMode: "network-direct" },
  classroom: { directoryEntities: 373, directoryEntitiesStatus: "counted", scheduleDocuments: 373, courseEvents: 4945, sourceMode: "network-direct" },
  course: { directoryEntities: 1290, directoryEntitiesStatus: "counted", scheduleDocuments: 1290, courseEvents: 8246, sourceMode: "network-direct" },
  catalog: { colleges: 23, grades: 27, majors: 536 },
  scopeFilters: {},
  coverage: { teacher: { coverageStatus: "invalid", publishable: false } },
  diagnostics: [{
    code: "ENTITY_NAME_CONTAMINATED",
    resource: "teacher",
    publishable: false,
    coverageStatus: "invalid",
    invalidTeacherNameSamples: ["23示例专业班", "临班0"],
  }],
  derivedFromLegacy: false,
};

const result = compareResourceCountContracts(active, staging);
const teacher = result.comparisons.find((item) => item.path === "teacher.scheduleDocuments");
assert.strictEqual(teacher.active, 1007);
assert.strictEqual(teacher.staging, 83);
assert.strictEqual(teacher.delta, -924);
assert.strictEqual(teacher.percent, -91.76);
assert.strictEqual(sourceModeLabel(active.teacher.sourceMode), "历史派生口径");
assert.strictEqual(sourceModeLabel(staging.teacher.sourceMode), "100网直接抓取");
assert(result.blockers.some((item) => item.code === "SOURCE_MODE_MISMATCH"));
assert(result.blockers.some((item) => item.code === "ENTITY_NAME_CONTAMINATED"));
assert.strictEqual(result.allowPublish, false);

console.log("test-teacher-83-vs-1007-regression passed");
