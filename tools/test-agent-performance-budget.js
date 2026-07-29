#!/usr/bin/env node
const assert = require("assert");

const { createAgentRuntime } = require("../packages/agent-runtime");
const { percentile } = require("../packages/provider-runtime");
const { createRunHandlers } = require("../apps/agent-server");
const runRepository = require("../server/src/services/ai/agentRunEventService");

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function benchmarkStages(complexity) {
  const factor = complexity === "multi" ? 2 : 1;
  return {
    async context() { await sleep(1); return { messageCount: 1, memoryCount: 0 }; },
    async decision() {
      await sleep(2 * factor);
      return {
        goal: { name: "benchmark" },
        selectedSkillId: "benchmark",
        decisionSource: "mock_provider",
        executionPolicy: "strict_model_first",
        taskComplexity: complexity,
      };
    },
    async skillTool() { await sleep(2 * factor); return { toolCalls: complexity === "multi" ? [{ name: "one" }, { name: "two" }] : [{ name: "one" }] }; },
    async verification() { await sleep(1); return { ok: true }; },
    async response() { await sleep(1); return { answer: "ok", cards: [], suggestions: [], responseMode: "deterministic" }; },
  };
}

async function testBenchmarks() {
  const runtime = createAgentRuntime();
  const simple = [];
  const multi = [];
  for (let index = 0; index < 25; index += 1) {
    const result = await runtime.executeTurn({
      request: { runId: `perf-simple-${index}`, deadlineAt: Date.now() + 15000, createRunDurationMs: 1 },
      configSnapshot: { configVersion: "perf", pluginIds: ["benchmark"] },
      stages: benchmarkStages("simple"),
    });
    simple.push(result.platformTrace.timings.total);
    assert.ok(result.platformTrace.timings.total <= 15000);
  }
  for (let index = 0; index < 15; index += 1) {
    const result = await runtime.executeTurn({
      request: { runId: `perf-multi-${index}`, deadlineAt: Date.now() + 15000, createRunDurationMs: 1 },
      configSnapshot: { configVersion: "perf", pluginIds: ["benchmark"] },
      stages: benchmarkStages("multi"),
    });
    multi.push(result.platformTrace.timings.total);
    assert.ok(result.platformTrace.timings.total <= 15000);
  }
  assert.ok(percentile(simple, 95) <= 6000, `simple mock P95 exceeded: ${percentile(simple, 95)}ms`);
  assert.ok(percentile(multi, 95) <= 12000, `multi mock P95 exceeded: ${percentile(multi, 95)}ms`);
  const metrics = runtime.diagnostics().stageMetrics;
  ["createRun", "decision", "tool", "verification", "response", "total"].forEach((stage) => {
    assert.ok(metrics[stage] && metrics[stage].count === 40, `missing ${stage} metrics`);
    assert.strictEqual(typeof metrics[stage].p50Ms, "number");
    assert.strictEqual(typeof metrics[stage].p95Ms, "number");
  });
  console.log(`✓ controlled mock P95 simple=${percentile(simple, 95)}ms multi=${percentile(multi, 95)}ms`);
}

function responseRecorder() {
  return {
    statusCode: 0,
    body: null,
    headers: {},
    setHeader(name, value) { this.headers[name] = value; },
    status(code) { this.statusCode = code; return this; },
    json(value) { this.body = value; return this; },
  };
}

function testImmediateRunAcceptance() {
  runRepository.resetForTests();
  let scheduled = null;
  const handlers = createRunHandlers({
    platform: { async executeTurn() { return { success: true, status: "completed" }; } },
    runRepository,
    protocol: { createRequestId: () => "request-perf" },
    agui: { mapRunToAguiEvents: () => [], serializeSse: () => "" },
    buildFailureResponse: () => ({ success: false }),
    schedule(fn) { scheduled = fn; },
  });
  const req = {
    body: { message: "hello", idempotencyKey: "perf-idempotency" },
    query: {},
    headers: {},
    agentRuntimeDecision: { runtimeMode: "public" },
  };
  const res = responseRecorder();
  const startedAt = Date.now();
  handlers.createRun(req, res);
  const elapsedMs = Date.now() - startedAt;
  assert.strictEqual(res.statusCode, 202);
  assert.ok(res.body.runId);
  assert.strictEqual(res.body.eventCursor, 1);
  assert.ok(res.body.firstEventLatencyMs <= 500, `first persisted event took ${res.body.firstEventLatencyMs}ms`);
  assert.ok(elapsedMs <= 500, `createRun response took ${elapsedMs}ms`);
  assert.ok(Date.parse(res.body.deadlineAt) - Date.now() <= 15000);
  const view = runRepository.getRunView(res.body.runId, { pollToken: res.body.pollToken });
  assert.strictEqual(view.events[0].type, "run.accepted");
  assert.strictEqual(typeof scheduled, "function");
  console.log(`✓ Run API accepted and persisted its first real event in ${res.body.firstEventLatencyMs}ms`);
}

async function run() {
  await testBenchmarks();
  testImmediateRunAcceptance();
  console.log("\ntest-agent-performance-budget: PASS (mock benchmark; not staging-live latency)");
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
