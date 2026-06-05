const assert = require("assert");
const { buildScheduleColumns } = require("../miniprogram/utils/course");

const weekdays = [{ weekday: 1, label: "周一" }];
const courses = [
  {
    id: "active-chemistry",
    courseName: "动物生物化学",
    teacherName: "赵老师",
    classroom: "C5-111",
    weekday: 1,
    startSection: 1,
    endSection: 2,
    weeks: [3],
    weekText: "第3周",
  },
  {
    id: "inactive-english",
    courseName: "大学英语",
    teacherName: "李老师",
    classroom: "C2-101",
    weekday: 1,
    startSection: 1,
    endSection: 2,
    weeks: [4],
    weekText: "第4周",
  },
];

const columns = buildScheduleColumns(courses, weekdays, 3, {
  sectionHeight: 90,
  hideInactiveCourses: false,
  targetType: "class",
});

assert.strictEqual(columns[0].courses.length, 2, "inactive overlap should stay visible when inactive courses are shown");
assert.strictEqual(columns[0].activeCourseCount, 1, "active course count should stay authoritative");
const active = columns[0].courses.find((course) => course.id === "active-chemistry");
const inactive = columns[0].courses.find((course) => course.id === "inactive-english");
assert(active && active.active === true, "active course should remain visible");
assert(inactive && inactive.active === false, "inactive overlapping course should remain visible but muted");
assert(!active.inactiveConflictLabel, "inactive week courses must not count as current-week conflicts");
assert(active.cardStyle.includes("z-index:30"), "active course should render above muted courses");

console.log("test-timetable-current-week-priority passed");
