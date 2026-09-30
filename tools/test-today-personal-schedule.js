const assert = require("assert");
const mockEnv = require("./mock-env");

mockEnv.clearStorage();
global.getApp = () => ({ globalData: { activeRelease: { term: "2026-2027-1" } } });

const storage = require("../miniprogram/utils/storage");
const calendar = require("../miniprogram/services/teachingCalendarService");
const { getTodayCoursesData } = require("../miniprogram/utils/todayReminder");
const originalCalendar = calendar.getImmediateActiveCalendar;

calendar.getImmediateActiveCalendar = () => ({
  term: "2026-2027-1",
  weeks: [],
  termConfig: { term: "2026-2027-1", termStartDate: "2026-09-07", totalWeeks: 19, weekStart: "monday" },
});

const course = {
  id: "personal-tuesday",
  courseName: "动物生物化学",
  className: "25动物医学6班",
  semester: "2026-2027-1",
  weekday: 2,
  startSection: 1,
  endSection: 2,
  weeks: [4],
};

try {
  storage.setCurrentScheduleTarget({
    type: "class", name: "25动物医学6班", className: "25动物医学6班",
    term: "2026-2027-1", courses: [course],
  });
  const school = getTodayCoursesData({ now: "2026-09-29T09:00:00+08:00" });
  assert.strictEqual(school.courses.length, 1, "the school schedule control must show today's course");

  storage.setCurrentScheduleTarget({
    type: "personal-apaas", name: "个人课表", metadata: { className: "25动物医学6班" },
    term: "2026-2027-1", courses: [course],
  });
  const personal = getTodayCoursesData({ now: "2026-09-29T09:00:00+08:00" });
  assert.strictEqual(personal.hasSchedule, true, "the personal schedule is bound");
  assert.strictEqual(personal.courses.length, 1, "today must show the active personal course");
  assert.strictEqual(personal.courses[0].courseName, "动物生物化学");

  storage.setCurrentScheduleTarget({
    type: "personal-xls", name: "我的导入课表", term: "2026-2027-1",
    courses: [
      course,
      Object.assign({}, course, { id: "cross-class", courseName: "大学英语", className: "跨班选修", startSection: 3, endSection: 4 }),
      Object.assign({}, course, { id: "next-week", courseName: "下周课程", weeks: [5] }),
      Object.assign({}, course, { id: "tomorrow", courseName: "明天课程", weekday: 3 }),
    ],
  });
  const imported = getTodayCoursesData({ now: "2026-09-29T09:00:00+08:00" });
  assert.deepStrictEqual(imported.courses.map((item) => item.courseName), ["动物生物化学", "大学英语"],
    "personal XLS must include selected cross-class courses while respecting week and weekday");

  require("../miniprogram/pages/today/today");
  const page = mockEnv.createPageInstance();
  const RealDate = global.Date;
  global.Date = class extends RealDate {
    constructor(...args) {
      super(...(args.length ? args : ["2026-09-29T09:00:00+08:00"]));
    }
    static now() { return new RealDate("2026-09-29T09:00:00+08:00").getTime(); }
  };
  try {
    page.loadToday();
  } finally {
    global.Date = RealDate;
  }
  assert.strictEqual(page.data.courses.length, 2, "the Today page must render the personal schedule courses");

  storage.setCurrentScheduleTarget({
    type: "class", name: "25动物医学6班", className: "25动物医学6班",
    term: "2026-2027-1", courses: [Object.assign({}, course, { className: "其他班" })],
  });
  assert.strictEqual(getTodayCoursesData({ now: "2026-09-29T09:00:00+08:00" }).courses.length, 0,
    "school class schedules must keep their class filter");
  console.log("test-today-personal-schedule passed");
} finally {
  calendar.getImmediateActiveCalendar = originalCalendar;
  storage.clearCurrentScheduleTarget();
}
