const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");

const tempRoot = path.join(os.tmpdir(), `fosu-readiness-explain-${process.pid}-${Date.now()}`);
process.env.FOSU_STORAGE_DIR = path.join(tempRoot, "storage");
process.env.NODE_ENV = "test";

const releaseService = require("../server/src/services/releaseService");
const runtimePointerService = require("../server/src/services/runtimePointerService");
const teachingCalendarService = require("../server/src/services/teachingCalendarService");
const termReadinessService = require("../server/src/services/termReadinessService");
const { writeJsonAtomic } = require("../server/src/utils/jsonFileStore");

function course() {
  return {
    courseName: "Readiness 课程",
    teacherName: "Readiness 教师",
    classroom: "C7-306",
    weekday: 1,
    startSection: 1,
    endSection: 2,
    sections: [1, 2],
    weeks: [1, 2, 3],
  };
}

function snapshot(version, term = "2025-2026-2") {
  const item = course();
  return {
    version,
    releaseVersion: version,
    term,
    semester: term,
    semesterText: term === "2025-2026-2" ? "2025-2026学年第二学期" : "2026-2027学年第一学期",
    termStartDate: term === "2025-2026-2" ? "2026-03-09" : "2026-09-07",
    updatedAt: "2026-06-05T12:39:28.000Z",
    catalog: { colleges: [{ code: "04", name: "测试学院" }], grades: ["2025"] },
    majors: [{ collegeCode: "04", code: "0401", name: "测试专业", grade: "2025" }],
    classSchedules: [{ className: "25检查1班", semester: term, collegeCode: "04", grade: "2025", majorCode: "0401", courses: [item] }],
    resources: {
      teachers: [{ teacherName: "Readiness 教师" }],
      classrooms: [{ roomName: "C7-306" }],
      courses: [{ courseName: "Readiness 课程" }],
      teacherSchedules: [{ teacherName: "Readiness 教师", semester: term, courses: [item] }],
      classroomSchedules: [{ roomName: "C7-306", semester: term, courses: [item] }],
      courseSchedules: [{ courseName: "Readiness 课程", semester: term, courses: [item] }],
    },
  };
}

function byKey(readiness, key) {
  return readiness.checks.find((item) => item.key === key);
}

function assertStructuredFailure(readiness, key) {
  const item = byKey(readiness, key);
  assert(item, `${key} should be present`);
  assert.strictEqual(item.status, "fail", `${key} should fail`);
  assert(item.message && item.expected !== undefined && item.actual !== undefined && item.fixHint, `${key} should be structured`);
}

function cleanup() {
  fs.rmSync(tempRoot, { recursive: true, force: true });
}

try {
  const version = "readiness-2026-06-05";
  releaseService.activateReleaseFromSnapshot(snapshot(version));
  fs.rmSync(runtimePointerService.ACTIVE_RUNTIME_PATH, { force: true });
  runtimePointerService.clearCache();
  const missingPointer = termReadinessService.buildTermReadiness("2025-2026-2", version, {
    autoRepairRuntimePointer: false,
  });
  assert(Array.isArray(missingPointer.checks), "readiness should expose checks");
  assertStructuredFailure(missingPointer, "runtime-active-pointer");

  const files = releaseService.getReleaseFiles(version);
  fs.rmSync(teachingCalendarService.getReleaseCalendarPath(version, true), { force: true });
  fs.rmSync(teachingCalendarService.getReleaseCalendarPath(version, false), { force: true });
  teachingCalendarService.clearCache();
  const missingCalendar = termReadinessService.buildTermReadiness("2025-2026-2", version, {
    autoRepairRuntimePointer: false,
  });
  assertStructuredFailure(missingCalendar, "calendar-json-exists");

  const legacyManifest = Object.assign({}, missingCalendar.manifest || {});
  const legacyFiles = releaseService.getReleaseFiles(version);
  const legacyRaw = JSON.parse(fs.readFileSync(legacyFiles.manifestPath, "utf-8"));
  delete legacyRaw.termConfig;
  delete legacyRaw.calendarUrl;
  delete legacyRaw.calendarHash;
  delete legacyRaw.calendarCount;
  delete legacyRaw.calendarUpdatedAt;
  writeJsonAtomic(legacyFiles.manifestPath, legacyRaw);
  writeJsonAtomic(path.join(legacyFiles.publicReleaseDir, "manifest.json"), legacyRaw);
  const legacyReadiness = termReadinessService.buildTermReadiness("2025-2026-2", version, {
    autoRepairRuntimePointer: false,
  });
  const termMatch = byKey(legacyReadiness, "manifest-term-match");
  assert(termMatch, "manifest-term-match should be present");
  assert.strictEqual(termMatch.status, "pass", "term match should not fail because termConfig is incomplete");
  assertStructuredFailure(legacyReadiness, "manifest-term-config");
  assertStructuredFailure(legacyReadiness, "manifest-calendar-metadata");
  assert(legacyReadiness.repairAction && legacyReadiness.repairAction.type === "current-term-release-repair", "legacy release should advertise repair action");

  const mismatchVersion = "readiness-mismatch-2026-06-05";
  const mismatchFiles = releaseService.getReleaseFiles(mismatchVersion);
  writeJsonAtomic(mismatchFiles.manifestPath, {
    success: true,
    releaseVersion: mismatchVersion,
    version: mismatchVersion,
    term: "2026-2027-1",
    semester: "2026-2027-1",
    termConfig: {
      term: "2026-2027-1",
      semesterText: "2026-2027学年第一学期",
      termStartDate: "2026-09-07",
      totalWeeks: 20,
      weekStart: "monday",
      releaseVersion: mismatchVersion,
    },
    counts: {},
  });
  writeJsonAtomic(path.join(mismatchFiles.publicReleaseDir, "manifest.json"), {
    success: true,
    releaseVersion: mismatchVersion,
    term: "2026-2027-1",
  });
  const mismatch = termReadinessService.buildTermReadiness("2025-2026-2", mismatchVersion, {
    autoRepairRuntimePointer: false,
  });
  assertStructuredFailure(mismatch, "manifest-term-match");
  console.log("test-semester-readiness-explain passed");
} catch (error) {
  console.error(error);
  process.exitCode = 1;
} finally {
  cleanup();
}
