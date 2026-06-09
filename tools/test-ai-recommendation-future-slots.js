const assert = require("assert");

const recommendationService = require("../server/src/services/ai/recommendationService");

function buildContext() {
  return {
    timezone: "Asia/Shanghai",
    clientLocalTime: "2026-06-09T21:26:00+08:00",
    termStartDate: "2026-03-09",
    totalWeeks: 20,
    currentTeachingWeek: 14,
    todayTeachingInfo: { weekNo: 14, weekday: 2, date: "2026-06-09", termStartDate: "2026-03-09" },
    currentScheduleSummary: {
      enabled: true,
      courses: [{ courseName: "周三早课", weekday: 3, startSection: 1, endSection: 2, weeks: [14] }],
    },
  };
}

function fakeRooms(query) {
  return {
    success: true,
    actionUrl: `/pages/empty-room/empty-room?date=${query.date}&sections=${query.sections}`,
    total: 18,
    rooms: [{ roomName: "C7-203", freeText: `第${query.sections}节空闲` }],
  };
}

function run() {
  const result = recommendationService.buildRecommendations({
    message: "帮我推荐连续 2 节自习时间",
    durationSections: 2,
  }, buildContext(), { queryEmptyRooms: fakeRooms });

  assert(result.candidates.length > 0, "future candidates should exist");
  result.candidates.forEach((candidate) => {
    assert(candidate.date >= "2026-06-09", "candidate date must not be before today");
    assert.strictEqual(candidate.isPast, false, "candidate must not be past");
    assert(candidate.dateText && /月\d+日 周/.test(candidate.dateText), "candidate should include concrete dateText");
    if (candidate.date === "2026-06-09") {
      assert(candidate.startSection > 14, "late-night today should not include ended sections");
    }
  });
  assert(!result.candidates.some((candidate) => candidate.date === "2026-06-09"), "all sections have started at 21:26, so today should be excluded");
  assert(!result.summary.includes("今天第1-2节"), "summary must not mention past today 1-2");
  assert(result.summary.includes("6月10日 周三"), "summary should name the nearest future date");

  console.log("test-ai-recommendation-future-slots passed");
}

run();
