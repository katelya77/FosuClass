#!/usr/bin/env node
const assert = require("assert");

const { createAgentRuntime } = require("../packages/agent-runtime");
const { createMetricsStore, percentile } = require("../packages/provider-runtime");
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
    // 全部成功时 success-only 与 all-runs 双序列必须一致，且无 fallback 样本。
    assert.strictEqual(metrics[stage].success.count, 40, `${stage} success series`);
    assert.strictEqual(metrics[stage].allRuns.count, 40, `${stage} all-runs series`);
    assert.strictEqual(metrics[stage].fallbackCount, 0, `${stage} fallback count`);
    assert.strictEqual(metrics[stage].nonFallback.count, 40, `${stage} non-fallback series`);
    assert.strictEqual(metrics[stage].degradedCount, 0, `${stage} degraded count`);
  });
  // simple / multi_tool 分离：decision 产物打标进入 byLabel 组合桶。
  const simpleDecision = metrics.decision.byLabel.find((entry) => entry.labels.taskComplexity === "simple");
  const multiDecision = metrics.decision.byLabel.find((entry) => entry.labels.taskComplexity === "multi_tool");
  assert.ok(simpleDecision && multiDecision, "decision metrics must separate simple from multi_tool");
  assert.strictEqual(simpleDecision.count, 25);
  assert.strictEqual(multiDecision.count, 15);
  assert.strictEqual(simpleDecision.labels.executionPolicy, "strict_model_first");
  assert.strictEqual(simpleDecision.labels.providerClass, "none");
  assert.strictEqual(simpleDecision.labels.outcome, "ok");
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

// P2R R3.7：outcome-aware 指标的受控 Mock 基线（固定 duration，无网络、无 sleep）。
function testOutcomeAwareMetricsStore() {
  const store = createMetricsStore({ sampleLimit: 50 });
  [100, 200, 300].forEach((durationMs) => store.record("decision", { durationMs, outcome: "ok" }));
  store.record("decision", { durationMs: 5000, outcome: "failed" });
  store.record("decision", { durationMs: 9000, outcome: "cancelled" });
  store.record("decision", { durationMs: 7000, outcome: "timeout" });
  store.record("decision", { durationMs: 4000, outcome: "degraded" });
  const decision = store.summary("decision");
  assert.strictEqual(decision.count, 7, "count keeps the all-runs semantics");
  assert.strictEqual(decision.successCount, 3);
  assert.strictEqual(decision.failureCount, 2, "failed + timeout");
  assert.strictEqual(decision.cancelledCount, 1);
  assert.strictEqual(decision.degradedCount, 1);
  // success-only 序列：failed/cancelled/degraded/timeout 一律不混入。
  assert.deepStrictEqual([decision.p50Ms, decision.p95Ms], [200, 300]);
  assert.deepStrictEqual([decision.success.count, decision.success.p50Ms, decision.success.p95Ms], [3, 200, 300]);
  // all-runs 序列包含全部样本。
  assert.deepStrictEqual([decision.allRuns.count, decision.allRuns.p50Ms, decision.allRuns.p95Ms], [7, 4000, 9000]);

  const labeled = createMetricsStore({ sampleLimit: 50 });
  labeled.record("total", { durationMs: 100, labels: { outcome: "ok", executionPolicy: "strict_model_first", taskComplexity: "simple", usedFallback: false, providerClass: "external", environment: "trial" } });
  labeled.record("total", { durationMs: 200, labels: { outcome: "ok", executionPolicy: "strict_model_first", taskComplexity: "multi_tool", usedFallback: true, providerClass: "external", environment: "trial" } });
  labeled.record("total", { durationMs: 800, labels: { outcome: "degraded", executionPolicy: "strict_model_first", taskComplexity: "simple", usedFallback: true, providerClass: "none", environment: "trial" } });
  const total = labeled.summary("total");
  assert.strictEqual(total.fallback.count, 2, "fallback runs separated");
  assert.strictEqual(total.nonFallback.count, 1, "non-fallback runs separated");
  assert.strictEqual(total.nonFallback.p50Ms, 100);
  assert.strictEqual(total.fallbackCount, 2);
  const simpleCombo = total.byLabel.find((entry) => entry.labels.taskComplexity === "simple" && entry.labels.usedFallback !== true);
  const multiCombo = total.byLabel.find((entry) => entry.labels.taskComplexity === "multi_tool");
  assert.ok(simpleCombo && multiCombo, "simple vs multi_tool label separation");
  assert.strictEqual(simpleCombo.p50Ms, 100);
  assert.strictEqual(multiCombo.p50Ms, 200);
  const degradedCombo = total.byLabel.find((entry) => entry.labels.outcome === "degraded");
  assert.ok(degradedCombo);
  assert.strictEqual(degradedCombo.successCount, 0, "degraded stays out of the success series");

  // warm-up 样本只计数，不进入任何统计序列。
  const warmed = createMetricsStore({ sampleLimit: 50 });
  warmed.record("total", { durationMs: 99999, outcome: "ok", warmUp: true });
  warmed.record("total", { durationMs: 99999, outcome: "failed", warmUp: true });
  [100, 200, 300].forEach((durationMs) => warmed.record("total", { durationMs, outcome: "ok" }));
  const warmedSummary = warmed.summary("total");
  assert.strictEqual(warmedSummary.warmUpCount, 2);
  assert.strictEqual(warmedSummary.count, 3, "warm-up samples must not pollute reported stats");
  assert.strictEqual(warmedSummary.p95Ms, 300);
  assert.strictEqual(warmedSummary.allRuns.p95Ms, 300);

  // 旧调用形（providerRuntime 尝试级记录）保持兼容：success 别名 + fallback 布尔。
  const legacy = createMetricsStore();
  legacy.record("decision", { durationMs: 50, outcome: "success", fallback: true });
  legacy.record("decision", { durationMs: 70, outcome: "failed" });
  const legacySummary = legacy.summary("decision");
  assert.strictEqual(legacySummary.count, 2);
  assert.strictEqual(legacySummary.successCount, 1);
  assert.strictEqual(legacySummary.fallbackCount, 1);
  assert.strictEqual(legacySummary.fallback.count, 1);
  console.log("✓ outcome-aware store: success-only vs all-runs, fallback split, warm-up isolation");
}

function testMetricsLabelCardinality() {
  const guarded = createMetricsStore();
  // 未知标签值 / 未知标签键 / 高基数或自由文本一律拒绝，且不得留下空桶。
  assert.throws(() => guarded.record("decision", { durationMs: 1, outcome: "success-ish" }), /METRICS_LABEL_INVALID/);
  assert.throws(() => guarded.record("decision", { durationMs: 1, labels: { outcome: "done" } }), /METRICS_LABEL_INVALID/);
  assert.throws(() => guarded.record("decision", { durationMs: 1, labels: { environment: "staging" } }), /METRICS_LABEL_INVALID/);
  assert.throws(() => guarded.record("decision", { durationMs: 1, labels: { executionPolicy: "adaptive_v2" } }), /METRICS_LABEL_INVALID/);
  assert.throws(() => guarded.record("decision", { durationMs: 1, labels: { providerClass: "deepseek" } }), /METRICS_LABEL_INVALID/);
  assert.throws(() => guarded.record("decision", { durationMs: 1, labels: { taskComplexity: "multi" } }), /METRICS_LABEL_INVALID/);
  assert.throws(() => guarded.record("decision", { durationMs: 1, labels: { usedFallback: "yes" } }), /METRICS_LABEL_INVALID/);
  assert.throws(() => guarded.record("decision", { durationMs: 1, labels: { runId: "run_123" } }), /METRICS_LABEL_INVALID/);
  assert.throws(() => guarded.record("decision", { durationMs: 1, labels: { conversationId: "conv_1" } }), /METRICS_LABEL_INVALID/);
  assert.throws(() => guarded.record("decision", { durationMs: 1, labels: { model: "deepseek-chat-v3" } }), /METRICS_LABEL_INVALID/);
  const freeText = "帮我查明天第三节在哪个教室上课";
  assert.throws(() => guarded.record("decision", { durationMs: 1, labels: { environment: freeText } }), /METRICS_LABEL_INVALID/);
  const summaryJson = JSON.stringify(guarded.summary());
  assert.ok(!summaryJson.includes(freeText), "no free-form message content may enter bucket keys");
  assert.ok(!summaryJson.includes("run_123") && !summaryJson.includes("conv_1"), "no high-cardinality ids in metrics");
  console.log("✓ label cardinality is bounded: unknown values, keys, and free text rejected");
}

async function testRuntimeOutcomeLabels() {
  const runtime = createAgentRuntime();
  let ledgerSeen = null;
  await runtime.executeTurn({
    request: { runId: "perf-degraded", deadlineAt: Date.now() + 15000, runtimeMode: "trial" },
    configSnapshot: { configVersion: "perf", pluginIds: ["benchmark"] },
    stages: {
      async context() { return { messageCount: 1, memoryCount: 0 }; },
      async decision() {
        return {
          goal: { name: "benchmark" },
          selectedSkillId: "benchmark",
          decisionSource: "deterministic_fallback",
          executionPolicy: "strict_model_first",
          taskComplexity: "simple",
          intendedProvider: "deepseek",
          actualFirstProvider: "deepseek",
          fallbackPath: ["deepseek:PROVIDER_TIMEOUT"],
          failureClass: "timeout",
          fallbackReason: "code:PROVIDER_TIMEOUT",
          remainingFallbackBudget: 0,
        };
      },
      async skillTool(input) { ledgerSeen = input.providerAttemptLedger; return { toolCalls: [] }; },
      async verification() { return { ok: true }; },
      async response() {
        return {
          answer: "ok",
          cards: [],
          suggestions: [],
          responseMode: "deterministic",
          runtimeMode: "trial",
          provider: "mock",
          externalProviderUsed: false,
          fallback: true,
          fallbackReason: "timeout",
          status: "degraded",
        };
      },
    },
  });
  const metrics = runtime.diagnostics().stageMetrics;
  assert.strictEqual(metrics.decision.degradedCount, 1, "decision degradation propagated from the stage artifact");
  assert.strictEqual(metrics.decision.successCount, 0, "degraded runs stay out of the success series");
  assert.strictEqual(metrics.decision.fallbackCount, 1);
  assert.strictEqual(metrics.response.degradedCount, 1, "response degradation propagated from the composer artifact");
  assert.strictEqual(metrics.total.degradedCount, 1);
  assert.strictEqual(metrics.total.successCount, 0);
  assert.strictEqual(metrics.total.fallback.count, 1);
  assert.strictEqual(metrics.total.nonFallback.count, 0);
  const totalCombo = metrics.total.byLabel.find((entry) => entry.labels.usedFallback === true);
  assert.ok(totalCombo, "fallback runs are separated into the fallback series");
  assert.strictEqual(totalCombo.labels.environment, "trial");
  assert.strictEqual(totalCombo.labels.executionPolicy, "strict_model_first");
  assert.strictEqual(totalCombo.labels.taskComplexity, "simple");
  const decisionCombo = metrics.decision.byLabel[0];
  assert.strictEqual(decisionCombo.labels.providerClass, "external");
  assert.strictEqual(decisionCombo.labels.outcome, "degraded");
  const ledgerSnapshot = ledgerSeen.snapshot();
  assert.strictEqual(ledgerSnapshot.failureClass, "timeout", "ledger archives the artifact failureClass");
  // 最新一次归档生效：Response 产物的 fallbackReason（failureClass 词表）覆盖 Decision 的 code:* 原因串。
  assert.strictEqual(ledgerSnapshot.fallbackReason, "timeout");
  assert.strictEqual(ledgerSnapshot.remainingBudget, 0);

  // 阶段超时映射为 timeout outcome，不混入 failed/success 序列。
  const timeoutRuntime = createAgentRuntime();
  const timeoutError = new Error("stage timed out");
  timeoutError.code = "STAGE_TIMEOUT";
  await assert.rejects(timeoutRuntime.executeTurn({
    request: { runId: "perf-timeout", deadlineAt: Date.now() + 15000 },
    configSnapshot: { configVersion: "perf", pluginIds: ["benchmark"] },
    stages: {
      async context() { return { messageCount: 1 }; },
      async decision() { throw timeoutError; },
      async skillTool() { return { toolCalls: [] }; },
      async verification() { return { ok: true }; },
      async response() { return { answer: "unreachable" }; },
    },
  }), (error) => error && error.code === "STAGE_TIMEOUT");
  const timeoutMetrics = timeoutRuntime.diagnostics().stageMetrics;
  assert.strictEqual(timeoutMetrics.decision.timeoutCount, 1);
  assert.strictEqual(timeoutMetrics.decision.failureCount, 1, "timeout counts as failure, separately from generic failed");
  assert.strictEqual(timeoutMetrics.decision.successCount, 0);
  assert.strictEqual(timeoutMetrics.total.timeoutCount, 1);
  console.log("✓ runtime labels: degraded/fallback from artifacts, timeout outcome, ledger failure archive");
}

function testImmediateRunAcceptance() {
  runRepository.resetForTests();
  const runMetrics = createMetricsStore({ sampleLimit: 50 });
  let scheduled = null;
  const handlers = createRunHandlers({
    platform: { async executeTurn() { return { success: true, status: "completed" }; } },
    runRepository,
    protocol: { createRequestId: () => "request-perf" },
    agui: { mapRunToAguiEvents: () => [], serializeSse: () => "" },
    buildFailureResponse: () => ({ success: false }),
    schedule(fn) { scheduled = fn; },
    metrics: runMetrics,
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
  // 首事件延迟独立桶：含 environment 标签，数值与响应字段一致。
  const firstEvent = runMetrics.summary("firstEvent");
  assert.strictEqual(firstEvent.count, 1, "first-event latency is aggregated into its own bucket");
  assert.strictEqual(firstEvent.allRuns.p50Ms, res.body.firstEventLatencyMs);
  const publicCombo = firstEvent.byLabel.find((entry) => entry.labels.environment === "public");
  assert.ok(publicCombo, "first-event bucket carries the environment label");
  assert.strictEqual(publicCombo.count, 1);
  console.log(`✓ Run API accepted and persisted its first real event in ${res.body.firstEventLatencyMs}ms`);
}

async function run() {
  await testBenchmarks();
  testOutcomeAwareMetricsStore();
  testMetricsLabelCardinality();
  await testRuntimeOutcomeLabels();
  testImmediateRunAcceptance();
  console.log("\ntest-agent-performance-budget: PASS (mock benchmark; not staging-live latency)");
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
