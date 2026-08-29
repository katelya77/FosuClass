"use strict";

function schedule(id, input) {
  return { id, tool: "query_schedule", input };
}

function classroom(id, input) {
  return { id, tool: "find_available_classrooms", input };
}

function conflict(id, input) {
  return { id, tool: "compare_schedules", input };
}

function dayPlan(id, date, extra = {}) {
  return { id, tool: "generate_day_plan", input: Object.assign({ visitorId: "visitor-demo-001", date }, extra) };
}

const GOLDEN_CASES = [
  schedule("schedule-teacher001-week1-mon", { entityType: "teacher", entityName: "教师001", week: 1, weekday: 1 }),
  schedule("schedule-teacher001-week1-wed", { entityType: "teacher", entityName: "教师001", week: 1, weekday: 3 }),
  schedule("schedule-class-a-week1-fri-pm", { entityType: "class", entityName: "2025级A班", week: 1, weekday: 5, periodStart: 5, periodEnd: 8 }),
  schedule("schedule-class-b-week1-fri", { entityType: "class", entityName: "2025级B班", week: 1, weekday: 5 }),
  schedule("schedule-room-a1-101-week1-mon", { entityType: "room", entityName: "A1-101", week: 1, weekday: 1 }),
  schedule("schedule-course-math-week1", { entityType: "course", entityName: "高等数学A", week: 1 }),
  schedule("schedule-teacher003-week1-mon", { entityType: "teacher", entityName: "教师003", week: 1, weekday: 1 }),
  schedule("schedule-class-c-week2-thu", { entityType: "class", entityName: "2025级C班", week: 2, weekday: 4 }),
  schedule("schedule-course-ideology-week10-empty", { entityType: "course", entityName: "思政通识", week: 10, weekday: 5 }),
  schedule("schedule-course-art-week1-empty", { entityType: "course", entityName: "通识选修·艺术鉴赏", week: 1, weekday: 5 }),
  schedule("schedule-course-art-week2", { entityType: "course", entityName: "通识选修·艺术鉴赏", week: 2, weekday: 5 }),
  schedule("schedule-room-b1-201-week3-mon", { entityType: "room", entityName: "B1-201", week: 3, weekday: 1 }),

  classroom("classroom-campus-a-week1-mon-1-2", { campus: "校区A", week: 1, weekday: 1, periodStart: 1, periodEnd: 2, capacity: 60 }),
  classroom("classroom-campus-b-week1-wed-7-8", { campus: "校区B", week: 1, weekday: 3, periodStart: 7, periodEnd: 8 }),
  classroom("classroom-campus-a-week2-fri-consecutive", { campus: "校区A", week: 2, weekday: 5, startPeriod: 5, consecutivePeriods: 2 }),
  classroom("classroom-campus-b-week3-wed-5-8", { campus: "校区B", week: 3, weekday: 3, periodStart: 5, periodEnd: 8 }),
  classroom("classroom-building-a1-capacity80", { campus: "校区A", week: 1, weekday: 2, periodStart: 1, periodEnd: 2, building: "教学楼A1", capacity: 80 }),
  classroom("classroom-building-b1-night", { campus: "校区B", week: 2, weekday: 5, periodStart: 9, periodEnd: 10, building: "教学楼B1" }),
  classroom("classroom-campus-a-all-day-capacity120", { campus: "校区A", week: 1, weekday: 1, periodStart: 1, periodEnd: 10, capacity: 120 }),
  classroom("classroom-campus-b-sunday-capacity200-empty", { campus: "校区B", week: 1, weekday: 7, periodStart: 1, periodEnd: 2, capacity: 200 }),

  conflict("conflict-class-a-b-week1-fri", { firstType: "class", firstName: "2025级A班", secondType: "class", secondName: "2025级B班", week: 1, weekday: 5, periodStart: 5, periodEnd: 8 }),
  conflict("conflict-teacher001-002-week1", { firstType: "teacher", firstName: "教师001", secondType: "teacher", secondName: "教师002", week: 1 }),
  conflict("conflict-teacher003-self-week1-mon", { firstType: "teacher", firstName: "教师003", secondType: "teacher", secondName: "教师003", week: 1, weekday: 1 }),
  conflict("conflict-class-c-d-week3", { firstType: "class", firstName: "2025级C班", secondType: "class", secondName: "2025级D班", week: 3 }),
  conflict("conflict-course-math-english-week1", { firstType: "course", firstName: "高等数学A", secondType: "course", secondName: "大学英语A", week: 1 }),
  conflict("conflict-room-a1-101-a1-102-week1", { firstType: "room", firstName: "A1-101", secondType: "room", secondName: "A1-102", week: 1 }),

  dayPlan("day-plan-week1-mon", "2026-08-31"),
  dayPlan("day-plan-week1-tue", "2026-09-01"),
  dayPlan("day-plan-week1-wed", "2026-09-02"),
  dayPlan("day-plan-week1-thu", "2026-09-03"),
  dayPlan("day-plan-week1-fri", "2026-09-04", { preferredCampus: "校区A", preferredStudyDuration: 2 }),
  dayPlan("day-plan-week1-sat-empty", "2026-09-05"),
  dayPlan("day-plan-week2-fri-even-elective", "2026-09-11"),
];

module.exports = { GOLDEN_CASES };
