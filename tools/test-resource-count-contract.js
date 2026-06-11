const assert = require("assert");
const {
  buildResourceCountContract,
  compareResourceCountContracts,
  flattenLegacyCounts,
  formatResourceMetricValue,
} = require("../server/src/shared/resourceCountContract");

const snapshot = {
  term: "2025-2026-2",
  classSchedules: [
    { className: "脱敏班A", displayType: "class-schedule", courses: [{ id: "c1" }] },
    { className: "脱敏专业聚合", displayType: "major-aggregate", isAggregated: true, courses: [] },
  ],
  resources: {
    teacherSchedules: [{ teacherName: "张三", courses: [{}, {}] }],
    classroomSchedules: [{ classroomName: "A101", courses: [{}] }],
    courseSchedules: [{ courseName: "高等数学", courses: [{}, {}, {}] }],
  },
  catalog: { colleges: [{}], grades: [{}], majors: [{}, {}] },
};

const contract = buildResourceCountContract(snapshot);
assert.strictEqual(contract.countSchemaVersion, 2);
assert.strictEqual(contract.class.scheduleDocuments, 2);
assert.strictEqual(contract.class.administrativeClasses, 1);
assert.strictEqual(contract.class.aggregateSchedules, 1);
assert.strictEqual(contract.teacher.scheduleDocuments, 1);
assert.strictEqual(contract.teacher.courseEvents, 2);
assert.strictEqual(contract.teacher.directoryEntities, null);
assert.strictEqual(contract.teacher.directoryEntitiesStatus, "not-counted");
assert.strictEqual(contract.classroom.directoryEntitiesStatus, "not-counted");
assert.strictEqual(contract.course.directoryEntitiesStatus, "not-counted");
assert.strictEqual(formatResourceMetricValue(null), "未统计");

const flat = flattenLegacyCounts(contract);
assert.strictEqual(flat.teacherScheduleCount, 1);
assert.strictEqual(flat.teacherCount, 0, "directoryEntities must not fallback to scheduleDocuments");
assert.strictEqual(flat.classroomCount, 0, "classroom directory must not fallback to classroom schedules");
assert.strictEqual(flat.courseCount, 0, "course directory must not fallback to course schedules");

const active = buildResourceCountContract(Object.assign({}, snapshot, {
  resources: {
    teachers: [{ teacherName: "张三" }],
    teacherSchedules: [{ teacherName: "张三", courses: [{}] }],
  },
}), { teacherSourceMode: "legacy-derived" });
const staging = buildResourceCountContract(Object.assign({}, snapshot, {
  resources: {
    teachers: [{ teacherName: "张三" }],
    teacherSchedules: [{ teacherName: "张三", courses: [{}] }],
  },
}), { teacherSourceMode: "network-direct" });
const comparison = compareResourceCountContracts(active, staging);
assert(comparison.blockers.some((item) => item.code === "SOURCE_MODE_MISMATCH"));

console.log("test-resource-count-contract passed");
