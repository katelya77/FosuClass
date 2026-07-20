#!/usr/bin/env node
const assert = require("assert");
const responseComposer = require("../server/src/services/ai/responseComposer");
const deepseekProvider = require("../server/src/services/ai/providers/deepseekProvider");

function run() {
  // plain greeting
  const hi = responseComposer.compose({
    answer: "你好，我是小佛，可以帮你查课表和空教室。",
    cards: [{
      type: "generic",
      title: "小佛助手",
      subtitle: "来自智能体表达层，课程事实仍需工具核验",
      badges: ["自然对话"],
      items: [],
    }],
    suggestions: ["你能做什么", "怎么导入个人课表？", "现在有空教室吗？"],
    intentName: "conversational_help",
    runtimeMode: "public",
    toolCalls: [],
  });
  assert.strictEqual(hi.presentationMode, "plain");
  assert.strictEqual(hi.cards.length, 0);
  assert.strictEqual(hi.evidence, null);
  assert.ok(hi.suggestions.length <= 2, "plain chat suggestions capped");
  assert.strictEqual(hi.taskTrajectory, null);
  assert.ok(hi.runSummary == null);

  // deepseek wrap no generic card
  const wrapped = deepseekProvider.wrapTextResponse("这里是一段纯文本回答。");
  assert.strictEqual((wrapped.cards || []).length, 0);
  assert.ok(wrapped.answer.includes("纯文本"));

  // single fact card
  const fact = responseComposer.compose({
    answer: "当前是第 3 教学周。",
    cards: [{ type: "generic", title: "教学周", subtitle: "第 3 周", items: [{ title: "教学周", value: "3" }] }],
    intentName: "get_teaching_week",
    runtimeMode: "public",
    toolCalls: [{ name: "get_teaching_week", status: "success", summary: "week 3" }],
    context: { currentTeachingWeek: 3, term: "2025-2026-2" },
    steps: [{ id: "step-1", label: "查询教学周", status: "success", durationMs: 12 }],
    durationMs: 1200,
  });
  assert.strictEqual(fact.presentationMode, "single_card");
  assert.ok(fact.cards.length <= 1);
  assert.ok(fact.evidence);
  assert.ok(fact.evidence.defaultCollapsed === true);
  assert.ok(fact.runSummary);
  assert.ok(fact.taskTrajectory);
  assert.ok(fact.taskTrajectory.execution && fact.taskTrajectory.execution.length >= 1);

  // multi card max 2
  const multi = responseComposer.compose({
    answer: "综合建议如下。",
    cards: [
      { type: "schedule", title: "明日课表", items: [{ title: "高数" }] },
      { type: "empty_room", title: "空教室", items: [{ title: "C7-101" }] },
      { type: "weather", title: "天气", items: [{ title: "多云" }] },
      { type: "generic", title: "地点", items: [{ title: "教学楼" }] },
    ],
    intentName: "campus_multi_step_advice",
    runtimeMode: "public",
    toolCalls: [
      { name: "get_tomorrow_courses", status: "success" },
      { name: "search_empty_rooms", status: "success" },
      { name: "get_campus_weather", status: "success" },
    ],
  });
  assert.strictEqual(multi.presentationMode, "multi_card");
  assert.ok(multi.cards.length <= 2);

  // recovery
  const recovery = responseComposer.compose({
    answer: "",
    success: false,
    errors: [{ code: "RECOVERY", fatal: true }],
    intentName: "get_today_courses",
    runtimeMode: "public",
  });
  assert.strictEqual(recovery.presentationMode, "recovery");
  assert.ok(recovery.answer);

  console.log("test-response-composer passed");
}

run();
