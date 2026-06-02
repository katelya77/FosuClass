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
});

assert.strictEqual(columns[0].courses.length, 1, "inactive overlap should be folded into the active course");
assert.strictEqual(columns[0].activeCourseCount, 1, "active course count should stay authoritative");
assert.strictEqual(columns[0].courses[0].id, "active-chemistry");
assert.strictEqual(columns[0].courses[0].active, true);
assert.strictEqual(columns[0].courses[0].inactiveConflictCount, 1);
assert.strictEqual(columns[0].courses[0].inactiveConflictLabel, "另有 1 门非本周课程");
assert(columns[0].courses[0].cardStyle.includes("z-index:30"), "active course should render above muted courses");

console.log("test-timetable-current-week-priority passed");
