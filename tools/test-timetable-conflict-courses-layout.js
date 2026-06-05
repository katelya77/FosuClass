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
  targetType: "class",
  targetId: "25-test",
  targetName: "25测试班",
})[0].courses;

assert.strictEqual(rendered.length, 2, "active conflict should be one combined card and inactive course remains visible");
const conflict = rendered.find((course) => course.eventKind === "true-conflict");
assert(conflict, "different active courses in the same slot should render as a true-conflict event");
assert.strictEqual(conflict.laneCount, 1, "conflict event should be full-width");
assert(!conflict.cardStyle.includes("width:50.0000%"), "conflict event must not render as a narrow lane");
assert.strictEqual(conflict.conflictEvents.length, 2, "conflict event should preserve both conflicting courses");
assert.strictEqual(conflict.badgeText, "冲突 · 2门");
const inactive = rendered.find((course) => course.id === "inactive-overlap");
assert(inactive && inactive.active === false, "inactive overlap should remain visible without being counted as conflict");
assert(!inactive.inactiveConflictLabel, "inactive course should not create current-week conflict labels");

console.log("test-timetable-conflict-courses-layout passed");
