const assert = require("assert");
const { buildScheduleColumns } = require("../miniprogram/utils/course");

const weekdays = [{ weekday: 2, label: "周二" }];
const courses = [
  {
    id: "active-course",
    courseName: "本周课程",
    weekday: 2,
    startSection: 3,
    endSection: 4,
    weeks: [5],
  },
  {
    id: "inactive-overlap",
    courseName: "非本周重叠课程",
    weekday: 2,
    startSection: 3,
    endSection: 4,
    weeks: [6],
  },
  {
    id: "inactive-only",
    courseName: "非本周独立课程",
    weekday: 2,
    startSection: 7,
    endSection: 8,
    weeks: [6],
  },
];

const visible = buildScheduleColumns(courses, weekdays, 5, {
  sectionHeight: 90,
  hideInactiveCourses: false,
  targetType: "class",
})[0].courses;
assert.strictEqual(visible.length, 3, "inactive courses should remain visible when not hidden");
assert(visible.some((course) => course.id === "inactive-only" && course.active === false), "inactive-only course should be gray-visible");
assert(visible.some((course) => course.id === "inactive-overlap" && course.active === false), "overlapping inactive course should not be folded into a conflict");

const hidden = buildScheduleColumns(courses, weekdays, 5, {
  sectionHeight: 90,
  hideInactiveCourses: true,
  targetType: "class",
})[0].courses;
assert.deepStrictEqual(hidden.map((course) => course.id), ["active-course"], "hide switch should remove all inactive courses");

console.log("test-timetable-hide-inactive-courses passed");
