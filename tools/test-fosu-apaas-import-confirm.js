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

function makeArrangement(patch) {
  return Object.assign({
    arrangementId: "arr-1",
    courseGroupId: "group-1",
    courseName: "动物解剖学",
    displayCourseName: "动物解剖学",
    normalizedCourseName: "动物解剖学",
    weekday: 1,
    sections: [1, 2],
    startSection: 1,
    endSection: 2,
    weeks: [1, 2, 3],
    weekText: "1-3",
    sectionText: "1-2",
    roomName: "C3-101",
    teacherName: "",
    classNameRaw: "25动物医学6班",
    sourceHash: "hash-1",
    matchStatus: "exact_match",
    importDecision: "auto_include",
    confidence: "high",
    reason: "班级范围匹配，已加入推荐导入",
    category: "normal",
    hasCompleteTime: true,
    selectedByDefault: true,
  }, patch || {});
}

function makePreviewRecordWithArrangements(ownerKey) {
  const auto = makeArrangement({ arrangementId: "arr-auto", courseName: "推荐课程", displayCourseName: "推荐课程" });
  const optional = makeArrangement({
    arrangementId: "arr-optional",
    courseName: "自选课程",
    displayCourseName: "自选课程",
    weekday: 2,
    sections: [3, 4],
    startSection: 3,
    endSection: 4,
    importDecision: "needs_confirm",
    selectedByDefault: false,
  });
  const unplaced = makeArrangement({
    arrangementId: "arr-unplaced",
    courseName: "未排入课程",
    displayCourseName: "未排入课程",
    weekday: null,
    sections: [],
    startSection: null,
    endSection: null,
    weeks: [],
    weekText: "",
    sectionText: "",
    roomName: "",
    importDecision: "unscheduled",
    hasCompleteTime: false,
    selectedByDefault: false,
  });
  return Object.assign(makePreviewRecord(ownerKey), {
    defaultSelectedArrangementIds: ["arr-auto"],
    allArrangements: [auto, optional, unplaced],
    scheduledCourses: [],
    unscheduledCourses: [],
    summary: Object.assign({}, makePreviewRecord(ownerKey).summary, {
      scheduledCourseCount: 1,
      unscheduledCourseCount: 1,
    }),
  });
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
  assert.strictEqual(first.profile.studentId, "2025****0303");
  assert.strictEqual(first.schedule.metadata.studentId, "2025****0303");
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

function testConfirmSelectedArrangementIdsOnly() {
  __resetForTest();
  const record = makePreviewRecordWithArrangements("openid-hash-for-test");
  const token = createPreviewToken(record, { ttlSeconds: 600 }).token;
  const result = confirmStudentScheduleImport(makeReq(), {
    importPreviewToken: token,
    mode: "replace_fosu_source",
    selectedArrangementIds: ["arr-optional"],
  });
  assert.strictEqual(result.success, true);
  assert.strictEqual(result.importedCourseCount, 1);
  assert.strictEqual(result.schedule.courses[0].courseName, "自选课程");
  assert.deepStrictEqual(result.selectedArrangementIds, ["arr-optional"]);
}

function testConfirmRejectsForeignArrangementId() {
  __resetForTest();
  const record = makePreviewRecordWithArrangements("openid-hash-for-test");
  const token = createPreviewToken(record, { ttlSeconds: 600 }).token;
  assert.throws(
    () => confirmStudentScheduleImport(makeReq(), {
      importPreviewToken: token,
      mode: "replace_fosu_source",
      selectedArrangementIds: ["arr-auto", "arr-foreign"],
    }),
    (error) => error && error.code === "INVALID_SELECTED_ARRANGEMENT"
  );
}

function testConfirmEditedUnscheduledArrangement() {
  __resetForTest();
  const record = makePreviewRecordWithArrangements("openid-hash-for-test");
  const token = createPreviewToken(record, { ttlSeconds: 600 }).token;
  const result = confirmStudentScheduleImport(makeReq(), {
    importPreviewToken: token,
    mode: "replace_fosu_source",
    selectedArrangementIds: ["arr-unplaced"],
    editedArrangements: [{
      arrangementId: "arr-unplaced",
      weekday: 5,
      startSection: 11,
      endSection: 12,
      weekText: "8-9",
      roomName: "线上",
    }],
  });
  assert.strictEqual(result.success, true);
  assert.strictEqual(result.importedCourseCount, 1);
  assert.strictEqual(result.schedule.courses[0].courseName, "未排入课程");
  assert.strictEqual(result.schedule.courses[0].weekday, 5);
  assert.deepStrictEqual(result.schedule.courses[0].sections, [11, 12]);
}

testApplyImportModeKeepsManualCourses();
testExpiredTokenCannotImport();
testConfirmConsumesToken();
testConfirmKeepsExistingManualCourses();
testConfirmSelectedArrangementIdsOnly();
testConfirmRejectsForeignArrangementId();
testConfirmEditedUnscheduledArrangement();

console.log("test-fosu-apaas-import-confirm passed");
