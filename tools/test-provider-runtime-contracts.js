#!/usr/bin/env node
const assert = require("assert");

const {
  DECISION_SCHEMA_VERSION,
  EXECUTION_POLICIES,
  createDeadline,
  createMetricsStore,
  createProviderRuntime,
  normalizeDecisionContract,
  resolveExecutionPolicy,
} = require("../packages/provider-runtime");

function decision(overrides = {}) {
  return Object.assign({
    schemaVersion: DECISION_SCHEMA_VERSION,
    goal: {
      name: "get_today_courses",
      confidence: 0.97,
      requiresClarification: false,
    },
    entities: [],
    constraints: {},
    skillCandidates: [
      { skillId: "campus.schedule.today", confidence: 0.96 },
    ],
    plan: {
      steps: [
        { id: "read-schedule", skillId: "campus.schedule.today", purpose: "Read today's schedule" },
      ],
    },
    responseMode: "deterministic",
  }, overrides);
}

function assertCode(fn, code) {
  assert.throws(fn, (error) => error && error.code === code, code);
}

async function assertRejectCode(promise, code) {
  await assert.rejects(promise, (error) => error && error.code === code, code);
}

function testExecutionPolicies() {
  assert.strictEqual(resolveExecutionPolicy({ runtimeMode: "public", configuredPolicy: "adaptive" }), EXECUTION_POLICIES.DETERMINISTIC);
  assert.strictEqual(resolveExecutionPolicy({ runtimeMode: "trial" }), EXECUTION_POLICIES.STRICT_MODEL_FIRST);
  assert.strictEqual(resolveExecutionPolicy({ runtimeMode: "dev" }), EXECUTION_POLICIES.STRICT_MODEL_FIRST);
  assert.strictEqual(resolveExecutionPolicy({ runtimeMode: "competition" }), EXECUTION_POLICIES.STRICT_MODEL_FIRST);
  assert.strictEqual(resolveExecutionPolicy({ runtimeMode: "trial", configuredPolicy: "adaptive", trusted: true }), EXECUTION_POLICIES.ADAPTIVE);
  assert.strictEqual(resolveExecutionPolicy({ runtimeMode: "trial", configuredPolicy: "adaptive", trusted: false }), EXECUTION_POLICIES.STRICT_MODEL_FIRST);
  assert.strictEqual(resolveExecutionPolicy({ runtimeMode: "trial", configuredPolicy: "deterministic", trusted: true }), EXECUTION_POLICIES.STRICT_MODEL_FIRST);
  console.log("✓ execution policies fail closed and strict is the enhanced default");
}

function testDecisionContract() {
  const options = {
    allowedSkillIds: ["campus.schedule.today"],
    allowedGoalIds: ["get_today_courses"],
    skillGoalMap: { "campus.schedule.today": ["get_today_courses"] },
  };
  const normalized = normalizeDecisionContract(decision(), options);
  assert.deepStrictEqual(Object.keys(normalized), [
    "schemaVersion", "goal", "entities", "constraints", "skillCandidates", "plan", "responseMode",
  ]);
  assert.strictEqual(normalized.skillCandidates[0].skillId, "campus.schedule.today");
  assert.ok(Object.isFrozen(normalized));

  assertCode(() => normalizeDecisionContract(decision({ toolName: "get_today_courses" }), options), "DECISION_EXTRA_FIELD");
  assertCode(() => normalizeDecisionContract(decision({
    plan: { steps: [{ id: "x", skillId: "campus.schedule.today", purpose: "x", tool: "shell" }] },
  }), options), "DECISION_EXTRA_FIELD");
  assertCode(() => normalizeDecisionContract(decision({
    constraints: { nested: { apiKey: "secret" } },
  }), options), "DECISION_FORBIDDEN_FIELD");
  assertCode(() => normalizeDecisionContract(decision({
    skillCandidates: [{ skillId: "campus.schedule.today-prefix", confidence: 0.99 }],
  }), options), "DECISION_SKILL_NOT_ALLOWED");
  assertCode(() => normalizeDecisionContract(decision({
    goal: { name: "run_any_tool", confidence: 0.99, requiresClarification: false },
  }), options), "DECISION_GOAL_NOT_ALLOWED");
  assertCode(() => normalizeDecisionContract(decision({
    goal: { name: "get_today_courses", confidence: 0.99, requiresClarification: false },
    skillCandidates: [{ skillId: "campus.other", confidence: 0.99 }],
  }), Object.assign({}, options, {
    allowedSkillIds: ["campus.other"],
    skillGoalMap: { "campus.other": ["get_campus_weather"] },
  })), "DECISION_GOAL_SKILL_MISMATCH");
  console.log("✓ DecisionContract V2 is exact, constrained, and Tool-free");
}

function testDeadline() {
  let now = 1000;
  const deadline = createDeadline({ now: () => now, timeoutMs: 25000, hardLimitMs: 15000 });
  assert.strictEqual(deadline.deadlineAt, 16000);
  assert.strictEqual(deadline.lease("decision", 3500, 500).timeoutMs, 3500);
  now = 15400;
  assert.strictEqual(deadline.lease("response", 1500, 500).timeoutMs, 100);
  now = 15500;
  assertCode(() => deadline.lease("response", 1500, 500), "DEADLINE_EXCEEDED");
  console.log("✓ stage leases share an absolute 15 second deadline");
}

async function testProviderRuntime() {
  const attempts = [];
  const events = [];
  const metrics = createMetricsStore({ sampleLimit: 50 });
  const adapters = [
    {
      id: "primary",
      async generateStructured(input) {
        attempts.push({ provider: "primary", timeoutMs: input.timeoutMs, signal: input.signal });
        const error = new Error("rate limited");
        error.code = "PROVIDER_RATE_LIMITED";
        throw error;
      },
      async probe() { return { ok: true }; },
    },
    {
      id: "fallback",
      async generateStructured(input) {
        attempts.push({ provider: "fallback", timeoutMs: input.timeoutMs, signal: input.signal });
        return { content: JSON.stringify(decision()) };
      },
      async probe() { return { ok: true }; },
    },
    {
      id: "never-third",
      async generateStructured() {
        attempts.push({ provider: "never-third" });
        return { content: JSON.stringify(decision()) };
      },
    },
  ];
  const runtime = createProviderRuntime({ adapters, metrics });
  const validator = (value) => normalizeDecisionContract(value, {
    allowedSkillIds: ["campus.schedule.today"],
    allowedGoalIds: ["get_today_courses"],
    skillGoalMap: { "campus.schedule.today": ["get_today_courses"] },
  });
  const result = await runtime.generateStructured({
    stage: "decision",
    runtimeMode: "trial",
    executionPolicy: "strict_model_first",
    intendedProvider: "primary",
    fallbackProvider: "fallback",
    request: { messages: [{ role: "user", content: "safe" }] },
    validate: validator,
    deadline: createDeadline({ timeoutMs: 5000 }),
    stageCapMs: 3500,
    finishReserveMs: 500,
    onEvent: (event) => events.push(event),
  });
  assert.strictEqual(result.provider, "fallback");
  assert.strictEqual(result.actualFirstProvider, "primary");
  assert.deepStrictEqual(result.fallbackPath, ["primary:PROVIDER_RATE_LIMITED", "fallback:success"]);
  assert.strictEqual(attempts.length, 2, "only primary + one fallback may run");
  assert.ok(attempts.every((item) => item.signal && typeof item.timeoutMs === "number"));
  assert.deepStrictEqual(events.map((item) => item.type), [
    "provider.selected", "provider.started", "provider.failed",
    "provider.selected", "provider.started", "provider.completed",
  ]);
  const summary = metrics.summary("decision");
  assert.strictEqual(summary.count, 2);
  assert.strictEqual(typeof summary.p50Ms, "number");
  assert.strictEqual(typeof summary.p95Ms, "number");
  assert.ok(!JSON.stringify(summary).includes("safe"));

  const beforePublic = attempts.length;
  await assertRejectCode(runtime.generateStructured({
    stage: "decision",
    runtimeMode: "public",
    executionPolicy: "deterministic",
    intendedProvider: "primary",
    request: {},
    validate: validator,
  }), "PUBLIC_PROVIDER_FORBIDDEN");
  assert.strictEqual(attempts.length, beforePublic);

  const controller = new AbortController();
  controller.abort();
  await assertRejectCode(runtime.generateStructured({
    stage: "decision",
    runtimeMode: "trial",
    executionPolicy: "strict_model_first",
    intendedProvider: "fallback",
    request: {},
    validate: validator,
    signal: controller.signal,
  }), "ABORTED");

  assert.deepStrictEqual(await runtime.probe("primary", { timeoutMs: 100 }), {
    ok: true,
    provider: "primary",
  });
  console.log("✓ Provider Runtime owns attempts, fallback, abort, probe, and metrics");
}

async function run() {
  testExecutionPolicies();
  testDecisionContract();
  testDeadline();
  await testProviderRuntime();
  console.log("\ntest-provider-runtime-contracts: PASS");
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
