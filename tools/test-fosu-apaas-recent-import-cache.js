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
const { confirmStudentScheduleImport } = require("../server/src/services/fosuApaasImportService");

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
}

function testDifferentOwnerCannotRead() {
  assert.strictEqual(getRecentImportForSession(makeSession("owner-b")), null);
}

function testSensitiveFieldsAreNotSaved() {
  const recent = getRecentImportForSession(makeSession("owner-a"));
  const text = JSON.stringify(recent);
  assert(!/plain-secret-password|secret-cookie|ticket-secret|<html>secret<\/html>/i.test(text), "recent import must not contain sensitive values");
  assert(!/"password"|"cookie"|"ticket"|"rawHtml"/i.test(text), "recent import must not keep sensitive keys");
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

testConfirmSavesReadableRecentImport();
testDifferentOwnerCannotRead();
testSensitiveFieldsAreNotSaved();
testResyncOverwritesOldRecord();
testStaleRecordKeepsDirectUseHint();

try { fs.unlinkSync(tempFile); } catch (error) {}

console.log("test-fosu-apaas-recent-import-cache passed");
