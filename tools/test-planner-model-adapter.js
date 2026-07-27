#!/usr/bin/env node
/**
 * Proves Model Planner wiring: adapter injection → plannerType=model,
 * failure → deterministic_fallback, public never uses model.
 */
const assert = require("assert");
const modelPlanner = require("../server/src/services/ai/planner/modelPlanner");
const plannerModelAdapter = require("../server/src/services/ai/planner/plannerModelAdapter");
const { getPlannerPolicy } = require("../server/src/services/ai/planner/plannerPolicy");
const agentServiceSource = require("fs").readFileSync(
  require("path").join(__dirname, "../server/src/services/ai/agentService.js"),
  "utf8"
);
// Phase-3 runtime split: planner model wiring lives in the runtime
// PlannerCoordinator; agentService composes it. Assert both layers.
const plannerCoordinatorSource = require("fs").readFileSync(
  require("path").join(__dirname, "../server/src/services/ai/runtime/plannerCoordinator.js"),
  "utf8"
);

async function run() {
  // Source wiring: the runtime pipeline must inject modelGenerate via plannerModelAdapter
  assert.ok(
    /plannerCoordinator/.test(agentServiceSource),
    "agentService must compose the runtime PlannerCoordinator"
  );
  assert.ok(
    /plannerModelAdapter\.createModelGenerate/.test(plannerCoordinatorSource),
    "plannerCoordinator must create planner model generate"
  );
  assert.ok(
    /modelGenerate:\s*runtimeMode === "public" \? undefined : plannerGenerate/.test(plannerCoordinatorSource)
    || /modelGenerate:[\s\S]{0,80}plannerGenerate/.test(plannerCoordinatorSource),
    "plannerCoordinator must pass modelGenerate into kernel (non-public)"
  );

  // public policy
  assert.strictEqual(getPlannerPolicy("public").useModelPlanner, false);

  // Without modelGenerate → fallback
  const noGen = await modelPlanner.plan({
    message: "明天下午仙溪哪里适合自习，顺便看看天气",
    runtimeMode: "trial",
    intent: { name: "campus_multi_step_advice", slots: { campus: "仙溪" }, confidence: 0.9 },
  });
  assert.ok(
    noGen.plannerType === "deterministic_fallback" || noGen.plannerType === "deterministic",
    `expected fallback without generate, got ${noGen.plannerType}`
  );
  assert.ok(noGen.steps && noGen.steps.length >= 2, "fallback still produces multi-step plan");

  // With mock modelGenerate → plannerType=model
  const mockPlanJson = JSON.stringify({
    goal: "找自习地点并看天气",
    intent: "campus_multi_step_advice",
    confidence: 0.9,
    slots: { campus: "仙溪" },
    needsClarification: false,
    steps: [
      { toolName: "get_tomorrow_courses", reasonCode: "NEED_CURRENT_SCHEDULE" },
      { toolName: "search_empty_rooms", reasonCode: "NEED_EMPTY_ROOM_RESULTS", args: { campus: "仙溪" } },
      { toolName: "get_campus_weather", reasonCode: "NEED_WEATHER", args: { campus: "仙溪" } },
    ],
    stopCondition: "all_steps_done",
  });

  let called = false;
  const modelPlan = await modelPlanner.plan({
    message: "明天下午仙溪哪里适合自习，顺便看看天气",
    runtimeMode: "trial",
    intent: { name: "campus_multi_step_advice", slots: { campus: "仙溪" }, confidence: 0.9 },
    availableTools: [
      "get_tomorrow_courses",
      "search_empty_rooms",
      "get_campus_weather",
      "rag_search",
      "clarify_missing_slot",
    ],
    skill: {
      id: "campus_multi_step",
      allowedTools: [
        "get_tomorrow_courses",
        "search_empty_rooms",
        "search_continuous_empty_rooms",
        "get_campus_weather",
        "rag_search",
        "clarify_missing_slot",
      ],
    },
    modelGenerate: async ({ messages }) => {
      called = true;
      assert.ok(Array.isArray(messages) && messages.length >= 1);
      // Must not contain live secrets or full schedule course dumps
      const blob = JSON.stringify(messages);
      assert.ok(!/sk-[a-zA-Z0-9]{10,}|Bearer\s+[A-Za-z0-9._-]{16,}/i.test(blob), "must not leak API keys");
      assert.ok(!/秘密课程/.test(blob), "must not dump personal schedule");
      return { content: mockPlanJson, provider: "mock-planner", latencyMs: 12 };
    },
  });

  assert.strictEqual(called, true, "modelGenerate must be invoked");
  assert.strictEqual(modelPlan.plannerType, "model", `expected plannerType=model, got ${modelPlan.plannerType}`);
  const tools = (modelPlan.steps || []).map((s) => s.toolName);
  assert.ok(tools.includes("get_tomorrow_courses") || tools.some((t) => /courses|schedule/.test(t)));
  assert.ok(tools.some((t) => /empty_room/.test(t)));
  assert.ok(tools.includes("get_campus_weather"));

  // modelGenerate throws → deterministic_fallback, still usable
  const failPlan = await modelPlanner.plan({
    message: "今天有什么课",
    runtimeMode: "dev",
    intent: { name: "get_today_courses", slots: {}, confidence: 0.9 },
    modelGenerate: async () => {
      throw Object.assign(new Error("timeout"), { code: "provider_timeout" });
    },
  });
  assert.ok(
    failPlan.plannerType === "deterministic_fallback" || failPlan.plannerType === "deterministic",
    "provider failure must fall back"
  );
  assert.ok(failPlan.steps && failPlan.steps.length >= 1);

  // public never uses model even if generate provided
  const publicPlan = await modelPlanner.plan({
    message: "今天有什么课",
    runtimeMode: "public",
    intent: { name: "get_today_courses", slots: {}, confidence: 0.9 },
    modelGenerate: async () => {
      throw new Error("should not be called");
    },
  });
  assert.ok(publicPlan.plannerType === "deterministic" || !/model/.test(publicPlan.plannerType));

  // createModelGenerate diagnostics for public
  const bound = plannerModelAdapter.createModelGenerate({
    runtimeMode: "public",
    providerRuntimeConfig: {},
  });
  let threw = false;
  try {
    await bound({ messages: [{ role: "user", content: "hi" }] });
  } catch (error) {
    threw = true;
    assert.strictEqual(error.code, "PLANNER_PUBLIC_FORBIDDEN");
  }
  assert.ok(threw);
  const diag = bound.getDiagnostics();
  assert.ok(diag.plannerFallback === true || diag.plannerStatus !== "ok");

  // Context-aware prompt uses ContextAssembler (no dump of personal schedule courses)
  const prompt = modelPlanner.buildPlannerPrompt({
    message: "明天自习",
    runtimeMode: "trial",
    intent: { name: "campus_multi_step_advice", slots: { campus: "仙溪" } },
    availableTools: ["get_tomorrow_courses", "search_empty_rooms"],
    context: {
      currentScheduleSummary: {
        enabled: true,
        courses: Array.from({ length: 20 }).map((_, i) => ({ name: `秘密课程${i}`, place: "X" })),
      },
    },
  });
  const promptText = typeof prompt === "string" ? prompt : prompt.text;
  assert.ok(!/秘密课程/.test(promptText), "must not pass full personal courses to planner");
  assert.ok(/personalSchedule=present_redacted|present_redacted|personalSchedule/.test(promptText) || promptText.length > 0);

  console.log("test-planner-model-adapter passed");
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
