const assert = require("assert");
const fs = require("fs");
const path = require("path");

const tempFile = path.join(__dirname, "..", ".tmp", "test-fosu-apaas-recent-imports.json");
fs.mkdirSync(path.dirname(tempFile), { recursive: true });
try { fs.unlinkSync(tempFile); } catch (error) {}

const {
  __resetForTest,
  __setStoreFileForTest,
  getRecentImportForSession,
  saveRecentImportForSession,
} = require("../server/src/services/fosuApaasRecentImportStore");
const {
  __resetForTest: resetPreviewStore,
  createPreviewToken,
} = require("../server/src/services/fosuApaasImportSessionStore");
const {
  confirmRecentStudentScheduleImport,
  confirmStudentScheduleImport,
} = require("../server/src/services/fosuApaasImportService");

__setStoreFileForTest(tempFile);
__resetForTest();
resetPreviewStore();

function makeSession(owner) {
  return {
    openidHash: owner,
    sessionIdHash: `session-${owner}`,
  };
}

function makeReq(owner) {
  return { fosuSession: makeSession(owner) };
}

function makeArrangement(patch = {}) {
  return Object.assign({
    arrangementId: "arr-auto",
    courseGroupId: "group-auto",
    courseName: "动物解剖学",
    displayCourseName: "动物解剖学",
    weekday: 1,
    sections: [1, 2],
    startSection: 1,
    endSection: 2,
    weeks: [1, 2, 3],
    weekText: "1-3",
    sectionText: "1-2",
    roomName: "C3-101",
    teacherName: "陈老师",
    classNameRaw: "25动物医学6班",
    importDecision: "auto_include",
    hasCompleteTime: true,
    selectedByDefault: true,
  }, patch);
}

function makePreviewRecord(ownerKey, patch = {}) {
  const auto = makeArrangement();
  const pending = makeArrangement({
    arrangementId: "arr-pending",
    courseName: "形势与政策",
    displayCourseName: "形势与政策",
    importDecision: "needs_confirm",
    selectedByDefault: false,
    password: "plain-secret-password",
    cookie: "JSESSIONID=secret-cookie",
    ticket: "ticket-secret",
    rawHtml: "<html>secret</html>",
  });
  return Object.assign({
    ownerKey,
    taskId: "task-recent",
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
      conflictCount: 1,
      recommendedArrangementCount: 1,
      pendingArrangementCount: 1,
      unplacedArrangementCount: 1,
      semester: "2025-2026-2",
    },
    defaultSelectedArrangementIds: ["arr-auto"],
    allArrangements: [auto, pending],
    scheduledCourses: [],
    unscheduledCourses: [],
  }, patch);
}

function confirmForOwner(owner, recordPatch = {}) {
  const ownerKey = owner;
  const record = makePreviewRecord(ownerKey, recordPatch);
  const token = createPreviewToken(record, { ttlSeconds: 600 }).token;
  return confirmStudentScheduleImport(makeReq(owner), {
    importPreviewToken: token,
    mode: "replace_fosu_source",
    selectedArrangementIds: ["arr-auto"],
  });
}

function testConfirmSavesReadableRecentImport() {
  const result = confirmForOwner("owner-a");
  assert.strictEqual(result.success, true);
  assert(result.recentImport, "confirm response should include recent import metadata");
  const recent = getRecentImportForSession(makeSession("owner-a"));
  assert(recent, "same owner should read recent import");
  assert.strictEqual(recent.studentName, "王同学");
  assert.strictEqual(recent.className, "25动物医学6班");
  assert.strictEqual(recent.source, "fosu_student_import");
  assert.strictEqual(recent.summary.recommendedCount, 1);
  assert.strictEqual(recent.summary.pendingCount, 2);
  assert.strictEqual(recent.summary.conflictCount, 1);
  assert.strictEqual(recent.courseCount, 1);
  assert(Array.isArray(recent.schedule.courses) && recent.schedule.courses.length === 1);
  assert(recent.editablePreview, "recent import should keep an editable preview snapshot");
  assert(Array.isArray(recent.editablePreview.allArrangements) && recent.editablePreview.allArrangements.length === 2,
    "editable preview should keep sanitized arrangements for cached editing");
  assert.deepStrictEqual(recent.editablePreview.selectedArrangementIds, ["arr-auto"]);
  assert(Array.isArray(recent.pending) && recent.pending.length === 1,
    "recent import should keep pending arrangements for cached adjustment");
  assert.strictEqual(recent.pending[0].classNameRaw, makeArrangement().classNameRaw);
  assert.deepStrictEqual(recent.pending[0].sections, [1, 2]);
  assert.deepStrictEqual(recent.pending[0].weeks, [1, 2, 3]);
  assert(Array.isArray(recent.unplaced) && recent.unplaced.length === 1,
    "recent import should keep unplaced arrangements for cached adjustment");
  assert.strictEqual(recent.unplaced[0].classNameRaw, makeArrangement().classNameRaw);
  assert.deepStrictEqual(recent.unplaced[0].sections, [1, 2]);
  assert.deepStrictEqual(recent.unplaced[0].weeks, [1, 2, 3]);
}

function testDifferentOwnerCannotRead() {
  assert.strictEqual(getRecentImportForSession(makeSession("owner-b")), null);
}

function testSensitiveFieldsAreNotSaved() {
  const recent = getRecentImportForSession(makeSession("owner-a"));
  const text = JSON.stringify(recent);
  assert(!/plain-secret-password|secret-cookie|ticket-secret|<html>secret<\/html>/i.test(text), "recent import must not contain sensitive values");
  assert(!/"password"|"cookie"|"ticket"|"rawHtml"/i.test(text), "recent import must not keep sensitive keys");
  assert(!/"studentId":"202512340303"/.test(text), "recent import should not keep raw student id in editable cache");
}

function testRecentConfirmUsesCachedPreviewWithoutSchoolRequest() {
  const result = confirmRecentStudentScheduleImport(makeReq("owner-a"), {
    mode: "replace_fosu_source",
    selectedArrangementIds: ["arr-auto", "arr-pending"],
    editedArrangements: [{
      arrangementId: "arr-pending",
      baseArrangementId: "arr-pending",
      weekday: 2,
      sections: [3, 4],
      weeks: [1, 2, 3],
      weekText: "1-3",
      roomName: "B1-201",
    }],
    existingCourses: [],
  });
  assert.strictEqual(result.success, true);
  assert.strictEqual(result.fromRecentImport, true);
  assert.strictEqual(result.importedCourseCount, 2);
  assert.strictEqual(result.schedule.courses.length, 2);
  const recent = getRecentImportForSession(makeSession("owner-a"));
  assert.deepStrictEqual(recent.editablePreview.selectedArrangementIds.sort(), ["arr-auto", "arr-pending"].sort());
  assert.strictEqual(recent.editablePreview.editedArrangements.length, 1);
}

function testResyncOverwritesOldRecord() {
  confirmForOwner("owner-a", {
    profile: {
      studentId: "202599990000",
      studentName: "李同学",
      className: "25动物科学1班",
      classNameConfidence: "high",
    },
  });
  const recent = getRecentImportForSession(makeSession("owner-a"));
  assert.strictEqual(recent.studentName, "李同学");
  assert.strictEqual(recent.className, "25动物科学1班");
}

function testStaleRecordKeepsDirectUseHint() {
  const oldDate = new Date(Date.now() - 31 * 24 * 60 * 60 * 1000).toISOString();
  saveRecentImportForSession(makeSession("owner-stale"), {
    record: makePreviewRecord("openid:owner-stale"),
    schedule: {
      type: "personal-apaas",
      name: "旧课表",
      title: "旧课表",
      importedAt: oldDate,
      updateTime: oldDate,
      courses: [{ courseName: "旧课程", weekday: 1, startSection: 1, endSection: 2 }],
      unplacedCourses: [],
      metadata: {
        studentName: "旧同学",
        className: "旧班级",
        studentIdMasked: "2025****0000",
      },
    },
    selection: { selectedArrangementIds: ["arr-auto"], unplacedCourses: [] },
    mode: "replace_fosu_source",
    importedCourseCount: 1,
  });
  const recent = getRecentImportForSession(makeSession("owner-stale"));
  assert.strictEqual(recent.isStale, true);
  assert(recent.staleText.includes("建议重新同步"));
  assert.strictEqual(recent.courseCount, 1);
}

function testImportedAtTextUsesBeijingTime() {
  saveRecentImportForSession(makeSession("owner-timezone"), {
    record: makePreviewRecord("openid:owner-timezone"),
    schedule: {
      type: "personal-apaas",
      name: "北京时间课表",
      title: "北京时间课表",
      importedAt: "2026-06-26T06:19:00.000Z",
      courses: [{ courseName: "时间校准", weekday: 1, startSection: 1, endSection: 2 }],
      unplacedCourses: [],
      metadata: {
        studentName: "时间同学",
        className: "时间班",
        studentIdMasked: "2026****0001",
      },
    },
    selection: { selectedArrangementIds: ["arr-auto"], unplacedCourses: [] },
    mode: "replace_fosu_source",
    importedCourseCount: 1,
  });
  const recent = getRecentImportForSession(makeSession("owner-timezone"));
  assert.strictEqual(recent.importedAtText, "2026-06-26 14:19");
}

testConfirmSavesReadableRecentImport();
testDifferentOwnerCannotRead();
testSensitiveFieldsAreNotSaved();
testRecentConfirmUsesCachedPreviewWithoutSchoolRequest();
testResyncOverwritesOldRecord();
testStaleRecordKeepsDirectUseHint();
testImportedAtTextUsesBeijingTime();

try { fs.unlinkSync(tempFile); } catch (error) {}

console.log("test-fosu-apaas-recent-import-cache passed");
