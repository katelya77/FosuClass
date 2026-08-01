#!/usr/bin/env node
/**
 * P2R acceptance §1: model Decision plan.steps skeleton genuinely constrains the
 * resolved plan under strict_model_first, inside Manifest/Schema/Guardrail limits.
 *
 * Covers:
 *  1. strict 下合规 plan.steps 影响 resolvedPlan（skillId 顺序/选择真实反映模型骨架）
 *  2. 不允许的工具名被拒绝（五因子 allowedToolIds 过滤并记录改写原因）
 *  3. Schema 不匹配步骤被拒绝或安全降级（未知 Skill / 非候选 Skill / 空骨架）
 *  4. planBuilder 不无条件丢弃合规模型计划
 *  5. public 不调外部 Provider 且 trace 无新字段
 *  6. adaptive 真实记录本 Turn 实际路径
 *  7. 模型计划失效只进受控降级且记录原因（planner 层 / kernel 层 / decision 层）
 *  8. 执行计划与 RunEvent/Trace 一致
 */
const assert = require("node:assert");
const http = require("http");

const deterministicPlanner = require("../server/src/services/ai/planner/deterministicPlanner");
const { normalizePlan, PLAN_SOURCES, ADJUSTMENT_REASON_CODES } = require("../server/src/services/ai/planner/planSchema");
const plannerModule = require("../server/src/services/ai/planner");
const { AgentKernel } = require("../server/src/services/ai/agentKernel");

const MULTI_MESSAGE = "明天下午仙溪哪里适合自习，顺便看看天气";
const MULTI_INTENT = { name: "campus_multi_step_advice", slots: { campus: "仙溪" }, confidence: 0.9 };
const MULTI_TOOLS = ["get_today_courses", "get_tomorrow_courses", "search_empty_rooms", "get_campus_weather", "search_campus_place"];

function modelContract(steps, overrides = {}) {
  return Object.assign({
    schemaVersion: "decision.v2",
    goal: { name: "campus_multi_step_advice", confidence: 0.95, requiresClarification: false },
    entities: [],
    constraints: {},
    skillCandidates: [{ skillId: "campus_multi_step_advice", confidence: 0.95 }],
    plan: { steps },
    responseMode: "deterministic",
  }, overrides);
}

function skeletonPlanInput(steps, overrides = {}) {
  return Object.assign({
    message: MULTI_MESSAGE,
    runtimeMode: "trial",
    intent: MULTI_INTENT,
    context: {},
    availableTools: MULTI_TOOLS,
    decisionSource: "model",
    decisionContract: modelContract(steps),
  }, overrides);
}

function unitTests() {
  // --- schema 归一：planSource/planAdjustments 低基数、枚举约束 ---
  const schemaNormalized = normalizePlan({
    plannerType: "deterministic",
    planSource: "not_a_real_source",
    planAdjustments: [
      { stepId: "s1", reasonCode: "自由文本不允许" },
    ].concat(Array.from({ length: 10 }).map((_, index) => ({
      stepId: `pad-${index}`,
      reasonCode: "MODEL_SKELETON_EMPTY",
    }))),
  });
  assert.strictEqual(schemaNormalized.planSource, "deterministic", "invalid planSource must fall back to deterministic");
  assert.strictEqual(schemaNormalized.planAdjustments.length, 8, "planAdjustments capped at 8");
  assert.ok(schemaNormalized.planAdjustments.every((item) => ADJUSTMENT_REASON_CODES.includes(item.reasonCode)));
  assert.ok(PLAN_SOURCES.includes("model_skeleton"));
  assert.strictEqual(normalizePlan({ plannerType: "model" }).planSource, "model_skeleton");
  assert.strictEqual(normalizePlan({ plannerType: "deterministic_fallback" }).planSource, "deterministic_fallback");

  // --- (1)(4) 合规骨架真实约束 resolvedPlan：顺序与选择都跟随模型骨架 ---
  const skeletonResolved = deterministicPlanner.plan(skeletonPlanInput([
    { id: "s1", skillId: "campus_multi_step_advice", purpose: "查询校区天气情况" },
    { id: "s2", skillId: "campus_multi_step_advice", purpose: "找空闲教室自习" },
  ]));
  assert.strictEqual(skeletonResolved.planSource, "model_skeleton");
  assert.deepStrictEqual(skeletonResolved.steps.map((step) => step.toolName), [
    "get_campus_weather",
    "search_empty_rooms",
  ], "resolved tools must follow the skeleton order and purpose-driven selection");
  assert.deepStrictEqual(skeletonResolved.steps.map((step) => step.skillId), [
    "campus_multi_step_advice",
    "campus_multi_step_advice",
  ]);
  assert.deepStrictEqual(skeletonResolved.planAdjustments, []);

  const deterministicBaseline = deterministicPlanner.plan({
    message: MULTI_MESSAGE,
    runtimeMode: "trial",
    intent: MULTI_INTENT,
    context: {},
    availableTools: MULTI_TOOLS,
  });
  assert.strictEqual(deterministicBaseline.planSource, "deterministic");
  assert.ok(deterministicBaseline.steps.length > skeletonResolved.steps.length,
    "planBuilder must NOT unconditionally discard the compliant model plan: skeleton narrowed the tool set");
  assert.strictEqual(deterministicBaseline.steps[0].toolName, "get_tomorrow_courses",
    "deterministic baseline keeps its own ordering; skeleton order differs and wins under model Decision");

  // --- (2) 不允许的工具名被拒绝：五因子过滤剔除并记录改写原因 ---
  const toolFiltered = deterministicPlanner.plan(skeletonPlanInput(
    [
      { id: "s1", skillId: "campus_multi_step_advice", purpose: "查询校区天气情况" },
      { id: "s2", skillId: "campus_multi_step_advice", purpose: "找空闲教室自习" },
    ],
    { availableTools: ["search_empty_rooms", "get_campus_weather"] },
  ));
  assert.strictEqual(toolFiltered.planSource, "model_skeleton");
  assert.deepStrictEqual(toolFiltered.steps.map((step) => step.toolName), [
    "get_campus_weather",
    "search_empty_rooms",
  ]);
  assert.ok(!toolFiltered.steps.some((step) => !["search_empty_rooms", "get_campus_weather"].includes(step.toolName)),
    "tools outside the five-factor allowed set must never survive");

  const toolRejected = deterministicPlanner.plan(skeletonPlanInput(
    [{ id: "s1", skillId: "campus_multi_step_advice", purpose: "查询校区天气情况" }],
    { availableTools: ["search_empty_rooms"] },
  ));
  assert.ok(!toolRejected.steps.some((step) => step.toolName === "get_campus_weather"),
    "filtered tool must be rejected from the resolved plan");
  assert.ok(toolRejected.planAdjustments.some((item) => item.reasonCode === "MODEL_STEP_TOOL_FILTERED" && item.stepId === "s1"),
    "tool rejection must be recorded as an enum adjustment");

  // --- MAX_STEPS(6) vs contract steps(8)：确定性截断并记录 ---
  const truncated = deterministicPlanner.plan(skeletonPlanInput([
    { id: "s1", skillId: "campus_multi_step_advice", purpose: "查询校区天气情况" },
    { id: "s2", skillId: "campus_multi_step_advice", purpose: "找空闲教室自习" },
    { id: "s3", skillId: "campus_multi_step_advice", purpose: "读取明天课程安排" },
    { id: "s4", skillId: "campus_multi_step_advice", purpose: "查询自习地点位置" },
    { id: "s5", skillId: "campus_multi_step_advice", purpose: "查询校区天气情况" },
    { id: "s6", skillId: "campus_multi_step_advice", purpose: "找空闲教室自习" },
    { id: "s7", skillId: "campus_multi_step_advice", purpose: "读取明天课程安排" },
    { id: "s8", skillId: "campus_multi_step_advice", purpose: "查询自习地点位置" },
  ]));
  assert.ok(truncated.steps.length <= 6, "resolved plan must respect MAX_STEPS");
  assert.deepStrictEqual(truncated.planAdjustments, [
    { stepId: "s7", reasonCode: "MODEL_STEP_TRUNCATED" },
    { stepId: "s8", reasonCode: "MODEL_STEP_TRUNCATED" },
  ], "contract steps beyond MAX_STEPS must be truncated deterministically and recorded");

  // --- (3)(7) Schema 不匹配步骤：未知 Skill 被拒绝，其余步骤保留 ---
  const mixed = deterministicPlanner.plan(skeletonPlanInput([
    { id: "bad", skillId: "no_such_skill", purpose: "不存在的技能" },
    { id: "good", skillId: "campus_multi_step_advice", purpose: "查询校区天气情况" },
  ]));
  assert.strictEqual(mixed.planSource, "model_skeleton");
  assert.deepStrictEqual(mixed.steps.map((step) => step.toolName), ["get_campus_weather"]);
  assert.deepStrictEqual(mixed.planAdjustments, [{ stepId: "bad", reasonCode: "MODEL_STEP_SKILL_UNKNOWN" }]);

  // --- (3)(7) 骨架全部不可用：只进受控降级且记录原因 ---
  const allUnknown = deterministicPlanner.plan(skeletonPlanInput([
    { id: "bad-1", skillId: "no_such_skill", purpose: "不存在的技能" },
    { id: "bad-2", skillId: "ghost_skill", purpose: "另一个不存在的技能" },
  ]));
  assert.strictEqual(allUnknown.planSource, "deterministic_fallback");
  assert.deepStrictEqual(allUnknown.planAdjustments, [
    { stepId: "bad-1", reasonCode: "MODEL_STEP_SKILL_UNKNOWN" },
    { stepId: "bad-2", reasonCode: "MODEL_STEP_SKILL_UNKNOWN" },
  ]);
  assert.deepStrictEqual(allUnknown.steps.map((step) => step.toolName), deterministicBaseline.steps.map((step) => step.toolName),
    "unusable skeleton must degrade into the regular deterministic plan");

  const emptySkeleton = deterministicPlanner.plan(skeletonPlanInput([]));
  assert.strictEqual(emptySkeleton.planSource, "deterministic_fallback");
  assert.deepStrictEqual(emptySkeleton.planAdjustments, [{ stepId: "plan", reasonCode: "MODEL_SKELETON_EMPTY" }]);
  assert.ok(emptySkeleton.steps.length >= 1, "empty skeleton must degrade into the deterministic plan");

  // --- (6) public / deterministic 合成 contract 不触发骨架消费（零行为变化） ---
  const publicWithContract = deterministicPlanner.plan({
    message: MULTI_MESSAGE,
    runtimeMode: "public",
    intent: MULTI_INTENT,
    context: {},
    availableTools: MULTI_TOOLS,
    decisionSource: "deterministic_policy",
    decisionContract: modelContract([{ id: "s1", skillId: "campus_multi_step_advice", purpose: "查询校区天气情况" }]),
  });
  assert.strictEqual(publicWithContract.planSource, "deterministic_public");
  assert.deepStrictEqual(publicWithContract.planAdjustments, []);
  assert.deepStrictEqual(
    publicWithContract.steps.map((step) => step.toolName),
    deterministicBaseline.steps.map((step) => step.toolName),
    "public deterministic must ignore the synthetic contract skeleton bit-for-bit",
  );
}

async function kernelFallbackTest() {
  // --- (7) kernel 兜底：仅 planner 软失败时重建，记录 PLANNER_SOFT_FALLBACK ---
  const registry = {
    getSkillForIntent() {
      return {
        id: "test_skill",
        version: "1.0.0",
        supportedIntents: ["test_intent"],
        requiredSlots: [],
        optionalSlots: [],
        allowedTools: ["allowed_tool"],
        runtimeModes: ["public", "trial", "dev"],
        providerPolicy: "never",
        planBuilder: () => [{ toolName: "allowed_tool", args: {} }],
        resultVerifier: () => ({ ok: true, errors: [] }),
        fallbackPolicy: "deterministic",
        outputCardTypes: ["generic"],
      };
    },
  };
  const kernel = new AgentKernel({
    skillRegistry: registry,
    toolExecutor: async () => ({ success: true }),
  });
  const originalPlan = plannerModule.plan;
  plannerModule.plan = async () => {
    throw Object.assign(new Error("unexpected planner crash"), { code: "PLANNER_UNEXPECTED" });
  };
  try {
    const events = [];
    const result = await kernel.execute({
      message: "test",
      context: {},
      runtimeMode: "trial",
      intent: { name: "test_intent", confidence: 0.9, slots: {} },
      onEvent: (event) => events.push(event),
    });
    assert.strictEqual(result.structuredPlan.plannerType, "deterministic_fallback");
    assert.strictEqual(result.structuredPlan.planSource, "deterministic_fallback");
    assert.deepStrictEqual(result.structuredPlan.planAdjustments, [
      { stepId: "plan", reasonCode: "PLANNER_SOFT_FALLBACK" },
    ]);
    assert.deepStrictEqual(result.structuredPlan.steps.map((step) => step.toolName), ["allowed_tool"]);
    assert.ok(events.some((event) => event.type === "planner.failed" && event.reasonCode === "PLANNER_UNEXPECTED"),
      "kernel fallback must emit planner.failed with the real reason code");
  } finally {
    plannerModule.plan = originalPlan;
  }
}

function strictDecisionContract(overrides = {}) {
  return Object.assign({
    schemaVersion: "decision.v2",
    goal: { name: "next_course_location", confidence: 0.96, requiresClarification: false },
    entities: [],
    constraints: {},
    skillCandidates: [{ skillId: "next_course_location", confidence: 0.96 }],
    plan: { steps: [{ id: "locate-room", skillId: "next_course_location", purpose: "查询教室楼栋位置" }] },
    responseMode: "deterministic",
  }, overrides);
}

async function e2eTests() {
  const requests = [];
  let responseContract = strictDecisionContract();
  const server = http.createServer((req, res) => {
    let raw = "";
    req.on("data", (chunk) => { raw += chunk; });
    req.on("end", () => {
      requests.push(JSON.parse(raw || "{}"));
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ choices: [{ message: { content: JSON.stringify(responseContract) } }] }));
    });
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const baseUrl = `http://127.0.0.1:${server.address().port}`;

  const keys = [
    "AI_RUNTIME_MODE", "AI_PROVIDER_ACTIVE_ENV", "AI_COMPETITION_ALLOW_ALL_SESSIONS",
    "AI_PROVIDER_IGNORE_ENV_FILE", "AI_EXECUTION_POLICY", "NODE_ENV",
  ];
  const previous = Object.fromEntries(keys.map((key) => [key, process.env[key]]));
  process.env.AI_RUNTIME_MODE = "trial";
  process.env.AI_PROVIDER_ACTIVE_ENV = "trial";
  process.env.AI_COMPETITION_ALLOW_ALL_SESSIONS = "true";
  process.env.AI_PROVIDER_IGNORE_ENV_FILE = "true";
  process.env.NODE_ENV = "test";

  const providerConfigService = require("../server/src/services/ai/providerConfigService");
  const originalResolve = providerConfigService.resolveRuntimeProviderConfig;
  let configuredPolicy = "strict_model_first";
  providerConfigService.resolveRuntimeProviderConfig = () => ({
    AI_AGENT_ENABLED: "true",
    AI_RUNTIME_MODE: "trial",
    AI_EXECUTION_POLICY: configuredPolicy,
    AI_PROVIDER: "deepseek",
    AI_PROVIDER_CHAIN: "deepseek,mock",
    AI_DECISION_PROVIDER: "deepseek",
    AI_PROVIDER_POLICY: "tool-only",
    AI_BASE_URL: baseUrl,
    AI_DECISION_MODEL: "plan-skeleton-test",
    AI_MODEL: "plan-skeleton-test",
    AI_STRUCTURED_TIMEOUT_MS: "3000",
    DEEPSEEK_API_KEY: "unit-test-placeholder-not-real",
    AI_UNDERSTANDING_RULE_FIRST: "1",
    AI_MODEL_PLANNER_ENABLED: "true",
  });

  const chatInput = () => ({
    message: "下一节课在哪个教室上",
    runtimeMode: "trial",
    protocolVersion: "agent.v2",
    serverSession: { openidHash: "plan-skeleton-test-user" },
    context: { envVersion: "trial", memoryMode: "local_only" },
  });

  // agent.v2 线上计划步骤形状为 { id, label, tool, status }（stableV2Plan）。
  const responsePlanTools = (plan) => (Array.isArray(plan) ? plan : [])
    .map((step) => String(step && (step.tool || step.toolName) || ""));

  try {
    const agentService = require("../server/src/services/ai/agentService");

    // --- (1)(8) strict：骨架收窄 resolvedPlan，且执行计划与 RunEvent/Trace 一致 ---
    const events = [];
    const strict = await agentService.chat(Object.assign(chatInput(), {
      onEvent: (event) => events.push(event),
    }));
    assert.strictEqual(requests.length, 1, "strict Turn must use exactly one Decision call");

    const decisionStage = strict.platformTrace.stages.find((stage) => stage.stage === "decision");
    assert.deepStrictEqual(decisionStage.details.proposedPlan, {
      stepCount: 1,
      skillIds: ["next_course_location"],
    }, "decision trace must summarize the model-proposed skeleton (no purpose text)");
    assert.ok(!JSON.stringify(decisionStage.details).includes("查询教室楼栋位置"),
      "trace must not expose the skeleton purpose text");

    const skillToolStage = strict.platformTrace.stages.find((stage) => stage.stage === "skill_tool");
    assert.strictEqual(skillToolStage.details.planSource, "model_skeleton");
    assert.deepStrictEqual(skillToolStage.details.resolvedPlan, {
      stepCount: 1,
      skillIds: ["next_course_location"],
    }, "resolved plan must reflect the model skeleton narrowing (deterministic would plan 2 tools)");

    assert.deepStrictEqual(responsePlanTools(strict.plan), ["get_classroom_location"],
      "response plan must be the skeleton-narrowed plan");
    assert.strictEqual(skillToolStage.details.resolvedPlan.stepCount, strict.plan.length,
      "trace resolvedPlan must match the executed plan");
    assert.deepStrictEqual(skillToolStage.details.toolIds, responsePlanTools(strict.plan),
      "trace toolIds must match the executed plan tools");

    const planCreated = events.filter((event) => event.type === "plan.created");
    assert.strictEqual(planCreated.length, 1);
    assert.strictEqual(planCreated[0].stepCount, strict.plan.length,
      "plan.created RunEvent must match the executed plan");
    const startedTools = events.filter((event) => event.type === "tool.started").map((event) => event.tool);
    assert.deepStrictEqual(startedTools, responsePlanTools(strict.plan),
      "tool.started RunEvents must match the executed plan order");
    const skillToolCompleted = events.filter((event) => event.type === "stage.completed"
      && event.stage === "skill_tool");
    assert.strictEqual(skillToolCompleted.length, 1);
    assert.deepStrictEqual(
      skillToolCompleted[0].details,
      skillToolStage.details,
      "stage.completed RunEvent details must equal the platformTrace skill_tool details",
    );

    // --- (3)(7) 非候选 Skill 的骨架步骤：contract 校验拒绝 → 受控降级并记录 ---
    responseContract = strictDecisionContract({
      plan: { steps: [{ id: "bad", skillId: "campus_weather", purpose: "非候选 Skill" }] },
    });
    const invalid = await agentService.chat(chatInput());
    assert.strictEqual(requests.length, 2);
    const invalidDecision = invalid.platformTrace.stages.find((stage) => stage.stage === "decision");
    assert.strictEqual(invalidDecision.details.decisionSource, "deterministic_fallback");
    assert.ok(invalidDecision.details.fallbackPath[0].includes("DECISION_PLAN_SKILL_INVALID"),
      "fallbackPath must record the real schema rejection code");
    assert.strictEqual(Object.prototype.hasOwnProperty.call(invalidDecision.details, "proposedPlan"), false,
      "rejected model contract must not surface a proposedPlan");
    const invalidSkillTool = invalid.platformTrace.stages.find((stage) => stage.stage === "skill_tool");
    assert.strictEqual(invalidSkillTool.details.planSource, "deterministic_fallback",
      "controlled degradation must be recorded honestly");
    assert.deepStrictEqual(invalidSkillTool.details.resolvedPlan, {
      stepCount: invalid.plan.length,
      skillIds: invalid.plan.map(() => "next_course_location"),
    });

    // --- (6) adaptive 快路径：真实记录 deterministic_adaptive，无模型骨架字段 ---
    responseContract = strictDecisionContract();
    configuredPolicy = "adaptive";
    const callsBeforeAdaptive = requests.length;
    const adaptive = await agentService.chat({
      message: "现在第几教学周",
      runtimeMode: "trial",
      protocolVersion: "agent.v2",
      serverSession: { openidHash: "plan-skeleton-test-user" },
      context: { envVersion: "trial", memoryMode: "local_only" },
    });
    assert.strictEqual(requests.length, callsBeforeAdaptive, "adaptive fast path must not call the Provider");
    const adaptiveDecision = adaptive.platformTrace.stages.find((stage) => stage.stage === "decision");
    assert.strictEqual(adaptiveDecision.details.decisionSource, "deterministic_adaptive");
    assert.strictEqual(Object.prototype.hasOwnProperty.call(adaptiveDecision.details, "proposedPlan"), false);
    const adaptiveSkillTool = adaptive.platformTrace.stages.find((stage) => stage.stage === "skill_tool");
    assert.strictEqual(adaptiveSkillTool.details.planSource, "deterministic_adaptive");
    assert.deepStrictEqual(adaptiveSkillTool.details.resolvedPlan, { stepCount: 1, skillIds: ["teaching_week"] });

    // --- (5) public：零外部调用且 trace 无新字段 ---
    configuredPolicy = "strict_model_first";
    const callsBeforePublic = requests.length;
    const publicResponse = await agentService.chat({
      message: "现在第几教学周",
      runtimeMode: "public",
      protocolVersion: "agent.v2",
      context: { envVersion: "release", memoryMode: "local_only" },
    });
    assert.strictEqual(requests.length, callsBeforePublic, "public must keep zero external Provider calls");
    const publicDecision = publicResponse.platformTrace.stages.find((stage) => stage.stage === "decision");
    assert.strictEqual(Object.prototype.hasOwnProperty.call(publicDecision.details, "proposedPlan"), false);
    const publicSkillTool = publicResponse.platformTrace.stages.find((stage) => stage.stage === "skill_tool");
    ["resolvedPlan", "planSource", "planAdjustmentReasons"].forEach((field) => {
      assert.strictEqual(Object.prototype.hasOwnProperty.call(publicSkillTool.details, field), false,
        `public trace must not expose ${field}`);
    });
  } finally {
    providerConfigService.resolveRuntimeProviderConfig = originalResolve;
    keys.forEach((key) => {
      if (previous[key] === undefined) delete process.env[key];
      else process.env[key] = previous[key];
    });
    await new Promise((resolve) => server.close(resolve));
  }
}

async function run() {
  unitTests();
  await kernelFallbackTest();
  await e2eTests();
  console.log("test-agent-plan-skeleton: PASS");
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
