const assert = require("assert");

const recommendationService = require("../server/src/services/ai/recommendationService");

function course(weekday, startSection, endSection, extra = {}) {
  return Object.assign({
    courseName: `课${weekday}-${startSection}`,
    weekday,
    startSection,
    endSection,
  }, extra);
}

function allDayBusyCourses(week) {
  const courses = [];
  for (let weekday = 2; weekday <= 7; weekday += 1) {
    courses.push(course(weekday, 1, 14, { weeks: [week] }));
  }
  return courses;
}

function fakeRooms(query) {
  return {
    success: true,
    actionUrl: `/pages/empty-room/empty-room?date=${query.date}&sections=${query.sections}`,
    total: 3,
    rooms: [{ roomName: "C7-203" }],
  };
}

function run() {
  const matrix = recommendationService.buildBusyMatrixForDate([
    course(3, 3, 4, { weeks: [14] }),
    course(4, 1, 2, { rawWeek: "1-16周(双)" }),
    course(4, 3, 4, { rawWeek: "1-16周(单)" }),
    course(5, 1, 2),
  ], "2026-06-11", 14);

  assert(matrix.busySections.has(1), "double-week course should block week 14");
  assert(matrix.busySections.has(2), "double-week course should block week 14");
  assert(!matrix.busySections.has(3), "odd-week course should not block week 14");
  assert(!matrix.busySections.has(4), "odd-week course should not block week 14");
  assert(matrix.uncertainWeekCoursesCount >= 0, "matrix should track uncertain courses");

  const result = recommendationService.buildRecommendations({
    message: "帮我推荐连续 2 节自习时间",
    durationSections: 2,
  }, {
    timezone: "Asia/Shanghai",
    clientLocalTime: "2026-06-09T21:26:00+08:00",
    termStartDate: "2026-03-09",
    totalWeeks: 20,
    currentTeachingWeek: 14,
    todayTeachingInfo: { weekNo: 14, weekday: 2, date: "2026-06-09", termStartDate: "2026-03-09" },
    currentScheduleSummary: {
      enabled: true,
      courses: allDayBusyCourses(14),
    },
  }, { queryEmptyRooms: fakeRooms });

  assert(result.candidates.length > 0, "next week candidates should exist when current week is busy");
  assert.strictEqual(result.candidates[0].scope, "next_week", "should fall back to next teaching week");
  assert(result.candidates.every((candidate) => candidate.teachingWeek >= 1), "week must never be 0");
  assert(result.candidates.some((candidate) => candidate.teachingWeek === 15), "next week should advance teaching week");

  const noWeekMatrix = recommendationService.buildBusyMatrixForDate([
    course(5, 1, 2),
  ], "2026-06-12", 14);
  assert(!noWeekMatrix.busySections.has(1), "course without week info must not default active");
  assert(noWeekMatrix.uncertainWeekCoursesCount >= 1, "missing week info should be tracked as uncertain");

  console.log("test-ai-recommendation-week-aware passed");
}

run();
