const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");

const repoRoot = path.resolve(__dirname, "..");
const sourceCalendar = require("../server/storage/terms/2025-2026-2/teaching-calendar.json");

sourceCalendar.weeks.forEach((week, index) => {
  assert.strictEqual(week.weekNo, index + 1);
  assert(week.startDate && week.endDate, `week ${week.weekNo} should include startDate/endDate`);
  assert(week.type, `week ${week.weekNo} should include type`);
  assert(week.title && /[\u4e00-\u9fa5]/.test(week.title), `week ${week.weekNo} should include Chinese title`);
});
assert(sourceCalendar.weeks.length >= 20, "2025-2026-2 calendar should include at least 20 weeks");

const tempRoot = path.join(os.tmpdir(), `fosu-teaching-calendar-${process.pid}-${Date.now()}`);
process.env.FOSU_STORAGE_DIR = path.join(tempRoot, "storage");
process.env.NODE_ENV = "test";

const releaseService = require("../server/src/services/releaseService");
const teachingCalendarService = require("../server/src/services/teachingCalendarService");
const termRegistryService = require("../server/src/services/termRegistryService");

function course() {
  return {
    courseName: "教学周历测试课程",
    teacherName: "教学周历教师",
    classroom: "C7-305",
    weekday: 1,
    startSection: 1,
    endSection: 2,
    sections: [1, 2],
    weeks: [1, 2, 3],
  };
}

function snapshot(version) {
  const item = course();
  return {
    version,
    releaseVersion: version,
    term: "2025-2026-2",
    semester: "2025-2026-2",
    semesterText: "2025-2026学年第二学期",
    termStartDate: "2026-03-09",
    updatedAt: "2026-06-05T12:39:28.000Z",
    catalog: { colleges: [{ code: "04", name: "测试学院" }], grades: ["2025"] },
    majors: [{ collegeCode: "04", code: "0401", name: "测试专业", grade: "2025" }],
    classSchedules: [{ className: "25周历1班", semester: "2025-2026-2", collegeCode: "04", grade: "2025", majorCode: "0401", courses: [item] }],
    resources: {
      teachers: [{ teacherName: "教学周历教师" }],
      classrooms: [{ roomName: "C7-305" }],
      courses: [{ courseName: "教学周历测试课程" }],
      teacherSchedules: [{ teacherName: "教学周历教师", semester: "2025-2026-2", courses: [item] }],
      classroomSchedules: [{ roomName: "C7-305", semester: "2025-2026-2", courses: [item] }],
      courseSchedules: [{ courseName: "教学周历测试课程", semester: "2025-2026-2", courses: [item] }],
    },
  };
}

function cleanup() {
  fs.rmSync(tempRoot, { recursive: true, force: true });
}

try {
  const version = "calendar-release-2026-06-05";
  termRegistryService.writeRegistry({
    activeTerm: "2025-2026-2",
    terms: [{
      term: "2025-2026-2",
      semesterText: "2025-2026学年第二学期",
      termStartDate: "2026-03-09",
      totalWeeks: 20,
      weekStart: "monday",
      status: "current",
      releaseVersion: version,
      dataAvailable: true,
      publishedAt: "2026-06-05T12:39:28.000Z",
    }],
  }, { backup: false });
  teachingCalendarService.writeTermCalendar("2025-2026-2", sourceCalendar);
  const normalized = teachingCalendarService.readTermCalendar("2025-2026-2");
  assert.strictEqual(normalized.weeks.length, 20);
  normalized.weeks.forEach((week) => {
    assert(week.startDate && week.endDate && week.type && week.title, `week ${week.weekNo} should be complete`);
    assert(week.typeText && /[\u4e00-\u9fa5]/.test(week.typeText), `week ${week.weekNo} should include Chinese typeText`);
  });

  releaseService.writeReleaseSnapshot(snapshot(version));
  const manifest = releaseService.getReleasePackManifest(version);
  const calendar = teachingCalendarService.readReleaseCalendar(version);
  const publicCalendarPath = teachingCalendarService.getReleaseCalendarPath(version, true);
  assert(fs.existsSync(publicCalendarPath), "public release calendar.json should be generated");
  assert.strictEqual(manifest.calendarUrl, `/static/releases/${version}/calendar.json`);
  assert.strictEqual(manifest.calendarCount, 20);
  assert.strictEqual(manifest.calendarHash, teachingCalendarService.getCalendarHash(calendar));
  assert(manifest.calendarUpdatedAt, "manifest should include calendarUpdatedAt");
  console.log("test-teaching-calendar passed");
} catch (error) {
  console.error(error);
  process.exitCode = 1;
} finally {
  cleanup();
}
