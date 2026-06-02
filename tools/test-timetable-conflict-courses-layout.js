const assert = require("assert");
const { buildScheduleColumns } = require("../miniprogram/utils/course");

const weekdays = [{ weekday: 4, label: "周四" }];
const courses = [
  {
    id: "active-a",
    courseName: "本周冲突课程A",
    weekday: 4,
    startSection: 1,
    endSection: 2,
    weeks: [10],
  },
  {
    id: "active-b",
    courseName: "本周冲突课程B",
    weekday: 4,
    startSection: 1,
    endSection: 2,
    weeks: [10],
  },
  {
    id: "inactive-overlap",
    courseName: "非本周重叠课程",
    weekday: 4,
    startSection: 1,
    endSection: 2,
    weeks: [11],
  },
];

const rendered = buildScheduleColumns(courses, weekdays, 10, {
  sectionHeight: 90,
  hideInactiveCourses: false,
})[0].courses;

assert.strictEqual(rendered.length, 2, "two active conflicts should both remain visible");
rendered.forEach((course) => {
  assert.strictEqual(course.active, true);
  assert.strictEqual(course.laneCount, 2, "active conflicts should use side-by-side lanes");
  assert(course.cardStyle.includes("width:50.0000%"), "conflict lane should constrain card width");
  assert.strictEqual(course.activeConflictCount, 1, "active conflict should be explicit in data");
  assert.strictEqual(course.inactiveConflictCount, 1, "inactive conflict should fold into each active primary");
});
assert.notStrictEqual(rendered[0].lane, rendered[1].lane, "conflicting active cards must use different lanes");

console.log("test-timetable-conflict-courses-layout passed");
