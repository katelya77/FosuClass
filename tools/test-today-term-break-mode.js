const assert = require("assert");
const mockEnv = require("./mock-env");

mockEnv.clearStorage();

global.getApp = () => ({
  globalData: {
    activeRelease: {
      term: "2026-2027-1",
      releaseVersion: "release-2026-fall",
    },
  },
});

const storage = require("../miniprogram/utils/storage");
const teachingCalendarService = require("../miniprogram/services/teachingCalendarService");
const todayReminder = require("../miniprogram/utils/todayReminder");

const originalImmediateCalendar = teachingCalendarService.getImmediateActiveCalendar;

function run() {
  storage.setCurrentScheduleTarget({
    type: "class",
    id: "class-25-vet-6",
    detailId: "class-25-vet-6",
    classId: "class-25-vet-6",
    name: "25动物医学6班",
    className: "25动物医学6班",
    term: "2026-2027-1",
    semester: "2026-2027-1",
    releaseVersion: "release-2026-fall",
    courses: [{
      id: "friday-week-1",
      courseName: "动物生物化学",
      className: "25动物医学6班",
      semester: "2026-2027-1",
      weekday: 5,
      startSection: 3,
      endSection: 5,
      weeks: [1],
    }],
  });

  teachingCalendarService.getImmediateActiveCalendar = () => ({
    term: "2026-2027-1",
    releaseVersion: "release-2026-fall",
    weeks: [],
    termConfig: {
      term: "2026-2027-1",
      semesterText: "2026-2027学年第一学期",
      termStartDate: "2026-09-07",
      totalWeeks: 19,
      weekStart: "monday",
      specialDates: [{
        date: "2026-09-25",
        type: "holiday",
        note: "中秋节放假",
      }],
    },
  });
  storage.saveSettings({ className: "旧缓存班级", classId: "stale-class-id" });

  try {
    const beforeTerm = todayReminder.getTodayCoursesData({ now: "2026-08-14T12:00:00+08:00" });
    assert.strictEqual(beforeTerm.hasSchedule, true, "bound schedule should remain available before term");
    assert.strictEqual(beforeTerm.className, "25动物医学6班", "current target must override stale settings cache");
    assert.strictEqual(beforeTerm.termPhase, "before-term", "2026-08-14 must be classified as before-term");
    assert.strictEqual(beforeTerm.courses.length, 0, "week-1 Friday courses must not render before 2026-09-07");
    assert.strictEqual(beforeTerm.state, "before-term", "Today page needs an explicit pre-term mode");
    assert.strictEqual(
      todayReminder.shouldShowTodayStartupReminder(beforeTerm),
      false,
      "the startup reminder must stay silent before the term starts"
    );

    const firstFriday = todayReminder.getTodayCoursesData({ now: "2026-09-11T12:00:00+08:00" });
    assert.strictEqual(firstFriday.termPhase, "in-term");
    assert.strictEqual(firstFriday.courses.length, 1, "week-1 Friday course should render after term starts");
    assert.strictEqual(todayReminder.shouldShowTodayStartupReminder(firstFriday), true);

    const holiday = todayReminder.getTodayCoursesData({ now: "2026-09-25T12:00:00+08:00" });
    assert.strictEqual(holiday.termPhase, "in-term");
    assert.strictEqual(holiday.courses.length, 0, "holiday must suppress recurring Friday courses");

    const afterTerm = todayReminder.getTodayCoursesData({ now: "2027-02-05T12:00:00+08:00" });
    assert.strictEqual(afterTerm.termPhase, "after-term");
    assert.strictEqual(afterTerm.courses.length, 0, "weekly courses must not render after the term ends");
    assert.strictEqual(afterTerm.state, "after-term", "Today page needs an explicit vacation mode");
  } finally {
    teachingCalendarService.getImmediateActiveCalendar = originalImmediateCalendar;
    storage.clearCurrentScheduleTarget();
  }

  console.log("test-today-term-break-mode passed");
}

try {
  run();
} catch (error) {
  teachingCalendarService.getImmediateActiveCalendar = originalImmediateCalendar;
  console.error(error);
  process.exit(1);
}
