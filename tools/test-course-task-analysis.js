#!/usr/bin/env node
const assert = require("assert");

const {
  detectScheduleChanges,
  inspectScheduleConflicts,
  buildDepartureAdvice,
} = require("../server/src/services/ai/scheduleAnalysisService");

const current = {
  enabled: true,
  fingerprint: "current-v2",
  courses: [
    { courseName: "动物解剖学", teacherName: "张老师", classroom: "B8-203", campus: "仙溪校区", weekday: 3, startSection: 6, endSection: 7, weeks: [20, 21] },
    { courseName: "动物解剖学", teacherName: "张老师", classroom: "B8-203", campus: "仙溪校区", weekday: 3, startSection: 6, endSection: 7, weeks: [20, 21] },
    { courseName: "大学英语", teacherName: "李老师", classroom: "C7-101", campus: "仙溪校区", weekday: 3, startSection: 7, endSection: 8, weeks: [20, 21] },
    { courseName: "实验课", teacherName: "王老师", classroom: "", campus: "仙溪校区", weekday: 4, startSection: 1, endSection: 2, weeks: [0, 35] },
    { courseName: "生理学", teacherName: "陈老师", classroom: "C7-202", campus: "仙溪校区", weekday: 3, startSection: 8, endSection: 9, weeks: [20, 21] },
  ],
};

const previous = {
  enabled: true,
  fingerprint: "previous-v1",
  courses: [
    { courseName: "动物解剖学", teacherName: "周老师", classroom: "B8-201", campus: "仙溪校区", weekday: 3, startSection: 5, endSection: 6, weeks: [20, 21] },
    { courseName: "已取消课程", teacherName: "赵老师", classroom: "C7-301", weekday: 5, startSection: 3, endSection: 4, weeks: [20, 21] },
  ],
};

const inspected = inspectScheduleConflicts({ currentScheduleSummary: current, totalWeeks: 22, currentTeachingWeek: 20 });
assert.strictEqual(inspected.success, true);
assert.strictEqual(inspected.duplicateCourses.length, 1);
assert.ok(inspected.timeConflicts.some((item) => item.courseNames.includes("动物解剖学") && item.courseNames.includes("大学英语")));
assert.ok(inspected.missingClassrooms.some((item) => item.courseName === "实验课"));
assert.ok(inspected.abnormalWeeks.some((item) => item.courseName === "实验课"));
assert.ok(inspected.rushedTransfers.some((item) => item.fromBuilding === "B8" && item.toBuilding === "C7"));
assert.ok(inspected.summary.includes("冲突"));

const changed = detectScheduleChanges({
  currentScheduleSummary: current,
  baselineScheduleSummary: previous,
});
assert.strictEqual(changed.success, true);
assert.strictEqual(changed.changed, true);
const anatomy = changed.changes.find((item) => item.courseName === "动物解剖学" && item.type === "modified");
assert.ok(anatomy);
assert.ok(anatomy.fields.includes("teacherName"));
assert.ok(anatomy.fields.includes("classroom"));
assert.ok(anatomy.fields.includes("time"));
assert.ok(changed.changes.some((item) => item.type === "removed" && item.courseName === "已取消课程"));
assert.ok(changed.changes.some((item) => item.type === "added" && item.courseName === "大学英语"));

const departure = buildDepartureAdvice({
  course: {
    courseName: "动物解剖学",
    classroom: "B8-203",
    campus: "仙溪校区",
    date: "2026-07-23",
    timeText: "13:30-15:00",
  },
  from: "宿舍",
  walkingBufferMinutes: 20,
  weather: { success: true, rainProbabilityMax24h: 70 },
});
assert.strictEqual(departure.success, true);
assert.strictEqual(departure.departureTime, "13:00");
assert.strictEqual(departure.preciseRouteAvailable, false);
assert.strictEqual(departure.weatherBufferMinutes, 10);
assert.ok(departure.assumptions.some((item) => item.includes("非精确路线")));

console.log("test-course-task-analysis: PASS");
