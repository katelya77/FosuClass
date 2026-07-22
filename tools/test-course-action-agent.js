#!/usr/bin/env node
const assert = require("assert");

process.env.NODE_ENV = "test";
process.env.AI_RUNTIME_MODE = "public";
process.env.AI_AGENT_ENABLED = "false";
process.env.AI_WEATHER_ENABLED = "true";
process.env.FOSU_AGENT_MEMORY_SECRET = "test-action-memory-secret-32-bytes";

const weatherService = require("../server/src/services/ai/weatherService");
const toolRegistry = require("../server/src/services/ai/toolRegistry");
const agentService = require("../server/src/services/ai/agentService");

function weatherResponse() {
  const times = Array.from({ length: 30 }, (_, index) => `2026-07-22T${String(index).padStart(2, "0")}:00`);
  return {
    data: {
      current: { time: "2026-07-22T12:00", temperature_2m: 31, apparent_temperature: 34, relative_humidity_2m: 76, precipitation: 1.2, weather_code: 61, wind_speed_10m: 10 },
      hourly: { time: times, temperature_2m: times.map(() => 31), precipitation_probability: times.map(() => 70) },
      daily: { time: ["2026-07-22", "2026-07-23"], weather_code: [61, 61], temperature_2m_max: [34, 33], temperature_2m_min: [26, 25], precipitation_probability_max: [75, 80] },
    },
  };
}

const context = {
  timezone: "Asia/Shanghai",
  clientLocalTime: "2026-07-22 12:00:00",
  clientTimestampMs: Date.parse("2026-07-22T04:00:00.000Z"),
  todayDate: "2026-07-22",
  todayWeekday: 3,
  currentTeachingWeek: 20,
  currentScheduleSummary: {
    enabled: true,
    fingerprint: "current",
    courses: [
      { courseName: "动物解剖学", teacherName: "张老师", classroom: "B8-203", campus: "仙溪校区", weekday: 3, startSection: 6, endSection: 7, weeks: [20] },
      { courseName: "大学英语", teacherName: "李老师", classroom: "C7-101", campus: "仙溪校区", weekday: 3, startSection: 7, endSection: 8, weeks: [20] },
      { courseName: "明日课程", teacherName: "陈老师", classroom: "C7-202", campus: "仙溪校区", weekday: 4, startSection: 6, endSection: 7, weeks: [20] },
    ],
  },
  scheduleChangeBaseline: {
    enabled: true,
    fingerprint: "baseline",
    courses: [
      { courseName: "动物解剖学", teacherName: "张老师", classroom: "B8-201", campus: "仙溪校区", weekday: 3, startSection: 6, endSection: 7, weeks: [20] },
    ],
  },
};

async function chat(message) {
  return agentService.chat({
    message,
    protocolVersion: "agent.v2",
    runtimeMode: "public",
    context,
    serverSession: { openidHash: "course-action-user", sessionIdHash: "course-action-session", appid: "wx-test" },
  });
}

async function run() {
  weatherService.__resetForTest();
  weatherService.__setFetcherForTest(async () => weatherResponse());

  const departureIntent = toolRegistry.resolveIntent("我下一节课在哪，什么时候该出发？", context);
  assert.strictEqual(departureIntent.name, "course_action_advice");
  const departure = await chat("我下一节课在哪，什么时候该出发？");
  assert.strictEqual(departure.externalProviderUsed, false);
  assert.ok(departure.steps.some((step) => step.tool === "get_next_course"));
  assert.ok(departure.steps.some((step) => step.tool === "get_course_route"));
  assert.ok(departure.answer.includes("B8-203"));
  assert.ok(departure.answer.includes("13:10"));
  assert.ok(departure.cards.some((card) => card.type === "schedule"));

  const rainy = await chat("明天下雨的话，我几点从宿舍出发？");
  assert.strictEqual(rainy.externalProviderUsed, false);
  assert.ok(rainy.steps.some((step) => step.tool === "get_tomorrow_courses"));
  assert.ok(rainy.steps.some((step) => step.tool === "get_course_weather_advice"));
  assert.ok(rainy.answer.includes("13:00"), rainy.answer);
  assert.ok(rainy.cards.some((card) => card.type === "weather"));

  const health = await chat("检查我本周有没有时间冲突或连续赶课");
  assert.ok(health.steps.some((step) => step.tool === "inspect_schedule_conflicts"));
  assert.ok(health.cards.some((card) => card.type === "diagnosis"));
  assert.ok(health.answer.includes("冲突"));

  const changes = await chat("检测我的课表有没有变化");
  assert.ok(changes.steps.some((step) => step.tool === "detect_schedule_changes"));
  assert.ok(changes.answer.includes("变化"));
  assert.ok(changes.cards[0].items.some((item) => item.title.includes("动物解剖学")));

  const gap = await chat("两节课中间有一小时，帮我找附近空教室");
  assert.ok(gap.steps.some((step) => step.tool === "get_today_courses"));
  assert.ok(gap.steps.some((step) => step.tool === "search_empty_rooms"));
  assert.ok(gap.steps.some((step) => step.tool === "search_campus_place"));
  assert.ok(!gap.steps.some((step) => step.tool === "get_campus_weather"));

  const afternoon = await chat("帮我规划今天下午的上课和自习安排");
  assert.ok(afternoon.steps.some((step) => step.tool === "get_today_courses"));
  assert.ok(afternoon.steps.some((step) => step.tool === "search_empty_rooms"));

  const safeNav = toolRegistry.executeTool("navigate_miniprogram_page", { url: "/pages/today/today" }, context);
  const unsafeNav = toolRegistry.executeTool("navigate_miniprogram_page", { url: "javascript:alert(1)" }, context);
  assert.strictEqual(safeNav.success, true);
  assert.strictEqual(unsafeNav.code, "NAVIGATION_URL_NOT_ALLOWED");

  console.log("test-course-action-agent: PASS");
}

run().catch((error) => {
  console.error(error && error.stack || error);
  process.exit(1);
});
