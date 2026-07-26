#!/usr/bin/env node
const assert = require("assert");
const deterministicPlanner = require("../server/src/services/ai/planner/deterministicPlanner");
const modelPlanner = require("../server/src/services/ai/planner/modelPlanner");
const { validatePlan } = require("../server/src/services/ai/planner/planValidator");
const { runObservationLoop, shouldReplan } = require("../server/src/services/ai/planner/observationLoop");
const { getPlannerPolicy } = require("../server/src/services/ai/planner/plannerPolicy");

async function run() {
  // public uses deterministic policy
  const publicPolicy = getPlannerPolicy("public");
  assert.strictEqual(publicPolicy.useModelPlanner, false);
  assert.strictEqual(publicPolicy.generalAssistantEnabled, false);
  assert.strictEqual(getPlannerPolicy("trial", { AI_AGENT_ENABLED: "false" }).useModelPlanner, false);
  assert.strictEqual(getPlannerPolicy("trial", { AI_AGENT_ENABLED: "true" }).useModelPlanner, true);

  // clarification for teacher query without name
  const clarify = deterministicPlanner.plan({
    message: "查老师课表",
    runtimeMode: "public",
    intent: { name: "search_school_index", slots: {}, confidence: 0.6 },
  });
  assert.strictEqual(clarify.needsClarification, true);
  assert.ok(clarify.clarification && clarify.clarification.slot);

  // multi-step study plan
  const multi = deterministicPlanner.plan({
    message: "明天下午仙溪校区哪里适合自习，顺便看看会不会下雨",
    runtimeMode: "public",
    intent: { name: "campus_multi_step_advice", slots: { campus: "仙溪" }, confidence: 0.8 },
    context: {},
  });
  assert.ok(multi.steps.length >= 2, "multi-step should plan 2+ tools");
  const tools = multi.steps.map((s) => s.toolName);
  assert.ok(tools.some((t) => /courses|schedule/.test(t) || t === "get_tomorrow_courses"));
  assert.ok(tools.some((t) => /empty_room/.test(t)));
  assert.ok(tools.some((t) => t === "get_campus_weather"));

  // invalid tool rejected
  try {
    validatePlan({
      intent: "x",
      steps: [{ toolName: "drop_database", reasonCode: "NEED_KNOWLEDGE" }],
    }, { runtimeMode: "public", allowedTools: ["rag_search"] });
    assert.fail("expected TOOL_NOT_ALLOWED_FOR_SKILL");
  } catch (error) {
    assert.strictEqual(error.code, "TOOL_NOT_ALLOWED_FOR_SKILL");
  }

  // step limit
  try {
    validatePlan({
      intent: "x",
      steps: Array.from({ length: 8 }).map((_, i) => ({
        toolName: "rag_search",
        reasonCode: "NEED_KNOWLEDGE",
        id: `s${i}`,
      })),
    }, { runtimeMode: "public", allowedTools: ["rag_search"] });
    assert.fail("expected PLAN_STEP_LIMIT_EXCEEDED");
  } catch (error) {
    assert.strictEqual(error.code, "PLAN_STEP_LIMIT_EXCEEDED");
  }

  // replan on empty empty-room
  const replan = deterministicPlanner.replan({
    runtimeMode: "public",
    previousPlan: {
      intent: "search_empty_rooms",
      replanCount: 0,
      steps: [{ toolName: "search_continuous_empty_rooms", args: { duration: 4 } }],
    },
    previousObservations: [{
      tool: "search_continuous_empty_rooms",
      status: "success",
      factCount: 0,
      summary: "EMPTY_RESULT",
    }],
  });
  assert.ok(replan.steps.length >= 1);
  assert.strictEqual(replan.replanCount, 1);

  // model planner falls back without provider
  const modelFallback = await modelPlanner.plan({
    message: "今天有什么课",
    runtimeMode: "trial",
    intent: { name: "get_today_courses", slots: {}, confidence: 0.9 },
  });
  assert.ok(modelFallback.plannerType === "deterministic" || modelFallback.plannerType === "deterministic_fallback" || modelFallback.steps);

  // observation loop with mock execute
  const loop = await runObservationLoop({
    message: "现在第几教学周",
    runtimeMode: "public",
    intent: { name: "get_teaching_week", slots: {}, confidence: 0.9 },
    skill: {
      id: "teaching_week",
      allowedTools: ["get_teaching_week"],
      planBuilder: () => [{ toolName: "get_teaching_week", args: {} }],
      resultVerifier: () => ({ ok: true, errors: [], evidenceComplete: true }),
    },
    executePlan: async (steps) => ({
      toolCalls: steps.map((s) => ({
        name: s.toolName,
        status: "success",
        summary: "week ok",
        result: { success: true, total: 1, week: 3 },
      })),
      steps: steps.map((s, i) => ({ id: `step-${i + 1}`, label: s.toolName, tool: s.toolName, status: "success", durationMs: 1 })),
    }),
  });
  assert.ok(loop.plan);
  assert.ok(loop.execution.toolCalls.length >= 1);

  assert.strictEqual(shouldReplan({ ok: true }, [{ tool: "search_empty_rooms", factCount: 0, status: "success" }], {
    replanCount: 0,
    steps: [{ toolName: "search_empty_rooms" }],
  }), true);

  console.log("test-agent-planner passed");
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
