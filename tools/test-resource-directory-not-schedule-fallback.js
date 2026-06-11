const assert = require("assert");
const { deriveLegacyResourceCountContract } = require("../server/src/shared/resourceCountContract");

const contract = deriveLegacyResourceCountContract({
  classSchedules: [{ className: "A", courses: [{ courseName: "C" }] }],
  resources: {
    teacherSchedules: [{ teacherName: "T", courses: [{ courseName: "C" }] }],
    classroomSchedules: [{ roomName: "R", courses: [{ courseName: "C" }] }],
    courseSchedules: [{ courseName: "C", courses: [{ courseName: "C" }] }],
  },
}, {});

assert.strictEqual(contract.teacher.scheduleDocuments, 1);
assert.strictEqual(contract.teacher.directoryEntities, null);
assert.strictEqual(contract.teacher.directoryEntitiesStatus, "not-counted");
assert.strictEqual(contract.classroom.directoryEntities, null);
assert.strictEqual(contract.course.directoryEntities, null);

console.log("test-resource-directory-not-schedule-fallback passed");
