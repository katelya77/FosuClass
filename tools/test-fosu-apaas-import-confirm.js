const assert = require("assert");
const {
  __resetForTest,
  __setPreviewForTest,
  createPreviewToken,
} = require("../server/src/services/fosuApaasImportSessionStore");
const {
  applyImportMode,
  confirmStudentScheduleImport,
} = require("../server/src/services/fosuApaasImportService");

function makeCourse(patch) {
  return Object.assign({
    id: "course-1",
    courseName: "动物解剖学",
    weekText: "1-16",
    weekday: 3,
    sectionText: "3-4",
    roomName: "A101",
    classroom: "A101",
    className: "25动物医学6班",
    source: "fosu_apaas",
    sourceStudentId: "202512340303",
  }, patch || {});
}

function makeReq() {
  return {
    fosuSession: {
      openidHash: "openid-hash-for-test",
      sessionIdHash: "session-hash-for-test",
    },
  };
}

function makePreviewRecord(ownerKey) {
  return {
    ownerKey,
    taskId: "task-test",
    studentId: "202512340303",
    profile: {
      studentId: "202512340303",
      studentName: "王同学",
      className: "25动物医学6班",
      classNameConfidence: "high",
    },
    summary: {
      rawRowCount: 2,
      scheduledCourseCount: 1,
      unscheduledCourseCount: 1,
      conflictCount: 0,
      semester: "2025-2026-2",
    },
    preview: {
      scheduled: [],
      unscheduled: [],
    },
    scheduledCourses: [makeCourse()],
    unscheduledCourses: [makeCourse({
      id: "course-unplaced",
      courseName: "劳动教育",
      weekText: "",
      weekday: null,
      sectionText: "",
      sections: [],
      source: "fosu_apaas",
      reason: "缺少周次、星期或节次",
    })],
  };
}

function testApplyImportModeKeepsManualCourses() {
  const manual = makeCourse({ id: "manual-1", courseName: "手动课程", source: "custom" });
  const oldApaas = makeCourse({ id: "old-1", courseName: "旧 APaaS 课程", source: "fosu_apaas" });
  const next = makeCourse({ id: "new-1", courseName: "新 APaaS 课程", source: "fosu_apaas" });
  const result = applyImportMode([manual, oldApaas], [next], "replace_fosu_source");
  assert.strictEqual(result.length, 2);
  assert.strictEqual(result[0].courseName, "手动课程");
  assert.strictEqual(result[1].courseName, "新 APaaS 课程");
}

function testExpiredTokenCannotImport() {
  __resetForTest();
  __setPreviewForTest("expired-token", Object.assign(makePreviewRecord("openid-hash-for-test"), {
    expiresAtMs: Date.now() - 1000,
  }));
  assert.throws(
    () => confirmStudentScheduleImport(makeReq(), { importPreviewToken: "expired-token", mode: "replace_fosu_source" }),
    (error) => error && error.code === "IMPORT_TOKEN_EXPIRED"
  );
}

function testConfirmConsumesToken() {
  __resetForTest();
  const record = makePreviewRecord("openid-hash-for-test");
  const token = createPreviewToken(record, { ttlSeconds: 600 }).token;
  const first = confirmStudentScheduleImport(makeReq(), { importPreviewToken: token, mode: "replace_fosu_source" });
  assert.strictEqual(first.success, true);
  assert.strictEqual(first.importedCourseCount, 1);
  assert.strictEqual(first.totalCourseCount, 1);
  assert.strictEqual(first.schedule.type, "personal-apaas");
  assert.strictEqual(first.schedule.courses[0].source, "fosu_apaas");
  assert.throws(
    () => confirmStudentScheduleImport(makeReq(), { importPreviewToken: token, mode: "replace_fosu_source" }),
    (error) => error && error.code === "IMPORT_TOKEN_EXPIRED"
  );
}

function testConfirmKeepsExistingManualCourses() {
  __resetForTest();
  const record = makePreviewRecord("openid-hash-for-test");
  const token = createPreviewToken(record, { ttlSeconds: 600 }).token;
  const manual = makeCourse({ id: "manual-1", courseName: "手动课程", source: "custom" });
  const oldApaas = makeCourse({ id: "old-apaas", courseName: "旧 APaaS 课程", source: "fosu_apaas" });
  const result = confirmStudentScheduleImport(makeReq(), {
    importPreviewToken: token,
    mode: "replace_fosu_source",
    existingCourses: [manual, oldApaas],
  });
  assert.strictEqual(result.success, true);
  assert.strictEqual(result.importedCourseCount, 1);
  assert.strictEqual(result.totalCourseCount, 2);
  assert.deepStrictEqual(result.schedule.courses.map((course) => course.courseName), [
    manual.courseName,
    record.scheduledCourses[0].courseName,
  ]);
}

testApplyImportModeKeepsManualCourses();
testExpiredTokenCannotImport();
testConfirmConsumesToken();
testConfirmKeepsExistingManualCourses();

console.log("test-fosu-apaas-import-confirm passed");
