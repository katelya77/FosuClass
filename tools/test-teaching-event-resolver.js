const assert = require("assert");
const { buildScheduleColumns } = require("../miniprogram/utils/course");
const { resolveTeachingEvents } = require("../miniprogram/utils/teachingEventResolver");

function baseCourse(overrides) {
  return Object.assign({
    courseName: "分子生物学",
    teacherName: "覃丽梅",
    classroom: "C7-307",
    weekday: 2,
    startSection: 3,
    endSection: 5,
    weeks: [8],
    weekText: "第8周",
  }, overrides || {});
}

function resolve(courses, targetType) {
  return resolveTeachingEvents({
    courses,
    targetType,
    targetId: `${targetType}-target`,
    targetName: "测试目标",
    selectedWeek: 8,
    semester: "2025-2026-2",
  });
}

{
  const result = resolve([
    baseCourse({ id: "m1", className: "24动物医学1班" }),
    baseCourse({ id: "m2", className: "24动物医学2班" }),
  ], "teacher");
  assert.strictEqual(result.events.length, 1, "teacher same course/room/time should merge");
  assert.strictEqual(result.events[0].eventKind, "shared-session");
  assert.strictEqual(result.events[0].audienceClasses.length, 2);
  assert.strictEqual(result.events[0].badgeText, "2个班同堂");
}

{
  const result = resolve([
    baseCourse({ id: "t1", courseName: "分子生物学" }),
    baseCourse({ id: "t2", courseName: "动物生理学" }),
  ], "teacher");
  assert.strictEqual(result.events.length, 1, "teacher different courses at same time should combine into one conflict card");
  assert.strictEqual(result.events[0].eventKind, "true-conflict");
  assert.strictEqual(result.events[0].conflictEvents.length, 2);
}

{
  const peCourses = Array.from({ length: 7 }, (_, index) => baseCourse({
    id: `pe-${index}`,
    courseName: "大学体育2",
    teacherName: `体育教师${index + 1}`,
    classroom: `运动场${index + 1}`,
    className: "25动物科学3班",
  }));
  const result = resolve(peCourses, "class");
  assert.strictEqual(result.events.length, 1, "class PE offerings should render as one parallel group");
  assert.strictEqual(result.events[0].eventKind, "parallel-group");
  assert.strictEqual(result.events[0].groupedCount, 7);
  assert.strictEqual(result.events[0].badgeText, "7个教学分组");
  assert.strictEqual(result.trueConflictGroups.length, 0);
}

{
  const result = resolve([
    baseCourse({ id: "c1", courseName: "大学英语" }),
    baseCourse({ id: "c2", courseName: "高等数学" }),
  ], "class");
  assert.strictEqual(result.events.length, 1, "class different courses at same time should be one true-conflict card");
  assert.strictEqual(result.events[0].eventKind, "true-conflict");
}

{
  const result = resolve([
    baseCourse({ id: "r1", teacherName: "教师A", className: "24动物医学1班" }),
    baseCourse({ id: "r2", teacherName: "教师B", className: "24动物医学2班" }),
  ], "classroom");
  assert.strictEqual(result.events.length, 1, "classroom same course/time should merge as shared session");
  assert.strictEqual(result.events[0].eventKind, "shared-session");
  assert.strictEqual(result.events[0].audienceClasses.length, 2);
}

{
  const result = resolve([
    baseCourse({ id: "course-1", teacherName: "教师A", classroom: "C1-101" }),
    baseCourse({ id: "course-2", teacherName: "教师B", classroom: "C2-202" }),
  ], "course");
  assert.strictEqual(result.events.length, 1, "course target parallel offerings should not be conflicts");
  assert.strictEqual(result.events[0].eventKind, "parallel-group");
  assert.strictEqual(result.trueConflictGroups.length, 0);
}

{
  const columns = buildScheduleColumns([
    baseCourse({ id: "layout-a", courseName: "大学英语" }),
    baseCourse({ id: "layout-b", courseName: "高等数学" }),
  ], [{ weekday: 2, label: "周二" }], 8, {
    sectionHeight: 90,
    hideInactiveCourses: true,
    targetType: "class",
    targetId: "25-test",
  });
  const card = columns[0].courses[0];
  assert.strictEqual(columns[0].courses.length, 1, "true conflict should render as one full-width card");
  assert.strictEqual(card.eventKind, "true-conflict");
  assert.strictEqual(card.laneCount, 1);
  assert(!card.cardStyle.includes("width:50.0000%"), "true conflict card must not use old side-by-side lane width");
}

console.log("test-teaching-event-resolver passed");
