#!/usr/bin/env node
const assert = require("assert");
const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
global.wx = {};

const aiAssistantService = require(path.join(root, "miniprogram/services/aiAssistantService"));

function read(relative) {
  return fs.readFileSync(path.join(root, relative), "utf8");
}

const noSchedule = aiAssistantService.buildProactiveWorkspace({
  currentScheduleSummary: { enabled: false, courses: [] },
});
assert.strictEqual(noSchedule.insight.kind, "import");
assert.ok(noSchedule.insight.actionUrl.includes("personal-sync"));
assert.ok(noSchedule.actions.length <= 3);

const nextCourse = aiAssistantService.buildProactiveWorkspace({
  clientLocalTime: "2026-07-22T13:00:00+08:00",
  todayWeekday: 3,
  currentTeachingWeek: 8,
  currentScheduleSummary: {
    enabled: true,
    courses: [{
      courseName: "动物解剖学",
      teacherName: "李老师",
      classroom: "B8-203",
      weekday: 3,
      startSection: 6,
      endSection: 7,
      weeks: [8],
    }],
  },
});
assert.strictEqual(nextCourse.insight.kind, "next_course");
assert.ok(nextCourse.insight.title.includes("动物解剖学 · 13:30 · B8-203"));
assert.ok(nextCourse.insight.detail.includes("13:10"));
assert.ok(nextCourse.insight.detail.includes("非精确路线"));
assert.ok(nextCourse.actions.length <= 3);

const changed = aiAssistantService.buildProactiveWorkspace({
  scheduleChangePending: true,
  scheduleChangeBaseline: { fingerprint: "v1" },
  currentScheduleSummary: {
    enabled: true,
    courses: [{ courseName: "课程", weekday: 3, startSection: 6, endSection: 7, weeks: [8] }],
  },
});
assert.strictEqual(changed.insight.kind, "schedule_change");
assert.strictEqual(changed.actions.length, 3);

const pageJs = read("miniprogram/packageXiaofu/pages/ai-assistant/ai-assistant.js");
const pageWxml = read("miniprogram/packageXiaofu/pages/ai-assistant/ai-assistant.wxml");
const pageWxss = read("miniprogram/packageXiaofu/pages/ai-assistant/ai-assistant.wxss");
const floatJs = read("miniprogram/components/xiaofu-float/index.js");
const floatWxml = read("miniprogram/components/xiaofu-float/index.wxml");
const floatWxss = read("miniprogram/components/xiaofu-float/index.wxss");

assert.ok(pageJs.includes("refreshProactiveWorkspace"));
assert.ok(pageJs.includes("reportScheduleChange"));
assert.ok(pageJs.includes("scheduleChangeTracker.acknowledge"));
assert.ok(pageJs.includes('status.type === "provider.started"'), "Thinking is driven only by provider.started");
assert.ok(pageWxml.includes("agent-status-capsule"));
assert.ok(pageWxml.includes("proactive-insight"));
assert.ok(pageWxml.includes("contextualActions"));
assert.ok(pageWxss.includes("prefers-color-scheme: dark"));
assert.ok(pageWxss.includes("prefers-reduced-motion: reduce"));
assert.ok(floatWxml.includes("xiaofu-float-hint"));
assert.ok(floatJs.includes("refreshInAppReminderHint"));
assert.ok(floatJs.includes("listInAppEvents(1)"));
assert.ok(floatJs.includes("应用内提醒"));
assert.ok(!floatWxss.includes("xiaofuFloatBreath"), "float must not run a decorative infinite animation");
assert.ok(!floatWxml.includes("xiaofu-float-online"), "float must not claim online without readiness");

console.log("test-xiaofu-proactive-workspace: PASS");
