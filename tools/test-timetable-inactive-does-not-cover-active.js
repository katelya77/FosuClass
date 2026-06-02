const assert = require("assert");
const { buildScheduleColumns } = require("../miniprogram/utils/course");

function overlaps(a, b) {
  return a.startSection <= b.endSection && b.startSection <= a.endSection;
}

const weekdays = [{ weekday: 3, label: "周三" }];
const courses = [
  {
    id: "active-span",
    courseName: "本周跨节课程",
    weekday: 3,
    startSection: 2,
    endSection: 5,
    weeks: [8],
  },
  {
    id: "inactive-partial-a",
    courseName: "非本周局部重叠A",
    weekday: 3,
    startSection: 1,
    endSection: 2,
    weeks: [9],
  },
  {
    id: "inactive-partial-b",
    courseName: "非本周局部重叠B",
    weekday: 3,
    startSection: 5,
    endSection: 6,
    weeks: [9],
  },
  {
    id: "inactive-separate",
    courseName: "非本周不重叠",
    weekday: 3,
    startSection: 8,
    endSection: 9,
    weeks: [9],
  },
];

const rendered = buildScheduleColumns(courses, weekdays, 8, {
  sectionHeight: 90,
  hideInactiveCourses: false,
})[0].courses;
const active = rendered.find((course) => course.id === "active-span");
assert(active, "active span course should render");
assert.strictEqual(active.inactiveConflictCount, 2, "partial overlaps should be attached to active course");
assert(!rendered.some((course) => course.active === false && overlaps(course, active)), "muted courses must not overlap active card geometry");
assert(rendered.some((course) => course.id === "inactive-separate" && course.active === false), "non-overlapping inactive course should still render");

console.log("test-timetable-inactive-does-not-cover-active passed");
