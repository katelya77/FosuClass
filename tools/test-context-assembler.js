#!/usr/bin/env node
const assert = require("assert");
const { assemble, estimateTokens, getBudget, buildToolCatalog } = require("../server/src/services/ai/context");
const { buildPlannerContext } = require("../server/src/services/ai/context/plannerContextBuilder");
const { TOOL_DESCRIPTIONS } = require("../server/src/services/ai/context/toolContextBuilder");

function run() {
  const budget = getBudget("planner");
  assert.ok(budget.total > 0);
  assert.ok(estimateTokens("你好世界 hello") > 0);

  const planner = assemble("planner", {
    message: "明天下午仙溪适合自习吗",
    runtimeMode: "trial",
    intent: { name: "campus_multi_step_advice", slots: { campus: "仙溪" } },
    availableTools: ["get_tomorrow_courses", "search_empty_rooms", "get_campus_weather"],
  });
  assert.strictEqual(planner.kind, "planner");
  assert.ok(planner.contextTokenEstimate > 0);
  assert.ok(Array.isArray(planner.sections));
  assert.ok(planner.userContent.includes("仙溪") || planner.userContent.includes("自习"));

  const catalog = buildToolCatalog(["rag_search", "get_today_courses"]);
  assert.strictEqual(catalog.length, 2);
  assert.ok(/use when/i.test(catalog[0].description));
  assert.ok(TOOL_DESCRIPTIONS.rag_search);

  // Budget truncation
  const huge = buildPlannerContext({
    message: "x".repeat(5000),
    runtimeMode: "dev",
    availableTools: Array.from({ length: 30 }).map((_, i) => `tool_${i}`),
  });
  assert.ok(huge.contextTokenEstimate <= getBudget("planner").total + 50);

  const response = assemble("response", {
    message: "谢谢",
    runtimeMode: "public",
    toolResults: [{ name: "get_teaching_week", status: "success", summary: "第 3 周" }],
  });
  assert.strictEqual(response.kind, "response");
  assert.ok(response.contextTokenEstimate >= 0);

  console.log("test-context-assembler passed");
}

run();
