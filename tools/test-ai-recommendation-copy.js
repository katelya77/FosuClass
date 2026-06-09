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

function failedRooms() {
  return {
    success: false,
    code: "EMPTY_ROOM_INDEX_NOT_FOUND",
    rooms: [],
  };
}

function run() {
  const result = recommendationService.buildRecommendations({
    message: "帮我推荐连续 2 节自习时间",
    durationSections: 2,
  }, buildContext(), { queryEmptyRooms: failedRooms });

  assert(result.summary.includes("6月10日 周三"), "copy should include concrete date and weekday");
  assert(/第\d+-\d+节/.test(result.summary), "copy should include concrete section range");
  assert(result.summary.includes("第14教学周"), "copy should include teaching week");
  assert(!result.summary.includes("每周一至周五"), "copy must not over-generalize weekdays");
  assert(result.summary.includes("尚未核验教室"), "failed empty-room lookup must be marked unverified");
  assert(!/显示有 \d+ 间候选/.test(result.summary), "unverified rooms must not include a room count");
  assert(!result.summary.includes("今天第1-2节"), "late-night copy must not recommend past time");

  console.log("test-ai-recommendation-copy passed");
}

run();
