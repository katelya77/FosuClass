#!/usr/bin/env node
const assert = require("assert");

const { createAgentRuntime } = require("../packages/agent-runtime");
const { createKeepAliveRegistry } = require("../packages/provider-runtime");
const { abortableDelay } = require("../server/src/services/ai/providers/cozeProvider");

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function stages(overrides = {}) {
  return Object.assign({
    async context(input) {
      return { messageCount: 1, memoryCount: 0, deadlineSeen: Boolean(input.deadline), budgetSeen: Boolean(input.budget) };
    },
    async decision(input) {
      return {
        goal: { name: "echo" },
        selectedSkillId: "echo",
        decisionSource: "deterministic",
        executionPolicy: "deterministic",
        taskComplexity: "simple",
        ledger: input.providerAttemptLedger,
      };
    },
    async skillTool(input) { return { toolCalls: [], ledger: input.providerAttemptLedger }; },
    async verification(input) { return { ok: true, ledger: input.providerAttemptLedger }; },
    async response(input) { return { answer: "ok", cards: [], suggestions: [], responseMode: "deterministic", ledger: input.providerAttemptLedger }; },
  }, overrides);
}

async function testDeadlineAndHandoffs() {
  const runtime = createAgentRuntime();
  const started = Date.now();
  const result = await runtime.executeTurn({
    request: { runId: "deadline-handoff", deadlineAt: started + 3000, createRunDurationMs: 12 },
    configSnapshot: { configVersion: "test", pluginIds: ["test"] },
    stages: stages(),
  });
  assert.ok(result.deadlineAt <= started + 3000);
  assert.strictEqual(result.artifacts.context.deadlineSeen, true);
  assert.strictEqual(result.artifacts.context.budgetSeen, true);
  assert.strictEqual(result.artifacts.decision.ledger, result.artifacts.skillTool.ledger);
  assert.strictEqual(result.artifacts.skillTool.ledger, result.artifacts.verification.ledger);
  assert.strictEqual(result.artifacts.verification.ledger, result.artifacts.response.ledger);
  assert.deepStrictEqual(Object.keys(result.platformTrace.timings), [
    "createRun", "decision", "tool", "verification", "response", "total",
  ]);
  assert.strictEqual(result.platformTrace.timings.createRun, 12);
  const metrics = runtime.diagnostics().stageMetrics;
  assert.strictEqual(metrics.total.count, 1);
  assert.strictEqual(metrics.decision.count, 1);
  console.log("✓ one deadline, fallback ledger, and six timing fields cross every stage");
}

async function testStageTimeout() {
  const runtime = createAgentRuntime({
    stageBudgets: {
      simple: { context: 100, decision: 20, skillTool: 100, verification: 100, response: 100, ui: 100, finishReserve: 1 },
      multi: { context: 100, decision: 20, skillTool: 100, verification: 100, response: 100, ui: 100, finishReserve: 1 },
    },
  });
  let laterSideEffects = 0;
  await assert.rejects(runtime.executeTurn({
    request: { runId: "deadline-stage-timeout", deadlineAt: Date.now() + 1000 },
    configSnapshot: { configVersion: "test", pluginIds: ["test"] },
    stages: stages({
      async decision() {
        await sleep(80);
        return { goal: { name: "late" }, taskComplexity: "simple" };
      },
      async skillTool() { laterSideEffects += 1; return { toolCalls: [] }; },
    }),
  }), (error) => error && error.code === "STAGE_TIMEOUT");
  await sleep(90);
  assert.strictEqual(laterSideEffects, 0, "a timed-out stage must not advance the lifecycle");
  console.log("✓ a stage cannot consume the next stage or hard-deadline reserve");
}

async function testCancellation() {
  const runtime = createAgentRuntime();
  const controller = new AbortController();
  let responseCalls = 0;
  const promise = runtime.executeTurn({
    request: { runId: "deadline-cancel", deadlineAt: Date.now() + 2000 },
    configSnapshot: { configVersion: "test", pluginIds: ["test"] },
    signal: controller.signal,
    stages: stages({
      async decision(input) {
        await new Promise((resolve, reject) => {
          input.signal.addEventListener("abort", () => {
            const error = new Error("aborted");
            error.code = "ABORTED";
            reject(error);
          }, { once: true });
        });
      },
      async response() { responseCalls += 1; return { answer: "must not happen" }; },
    }),
  });
  setTimeout(() => controller.abort(), 10);
  await assert.rejects(promise, (error) => error && error.code === "ABORTED");
  assert.strictEqual(responseCalls, 0);
  console.log("✓ caller cancellation aborts active work and prevents success continuation");
}

function testKeepAliveRegistry() {
  const registry = createKeepAliveRegistry({ maxSockets: 4, maxFreeSockets: 2 });
  const first = registry.getAgent("https://provider.example/v1/chat");
  const sameOrigin = registry.getAgent("https://provider.example/v1/models");
  const other = registry.getAgent("https://other.example/v1/chat");
  assert.strictEqual(first, sameOrigin);
  assert.notStrictEqual(first, other);
  assert.strictEqual(first.options.keepAlive, true);
  assert.strictEqual(registry.diagnostics().originCount, 2);
  registry.close();
  console.log("✓ Provider transports reuse keep-alive agents per origin");
}

async function testProviderPollingCancellation() {
  assert.strictEqual(typeof abortableDelay, "function");
  const controller = new AbortController();
  const started = Date.now();
  const waiting = abortableDelay(1000, controller.signal);
  setTimeout(() => controller.abort(), 10);
  await assert.rejects(waiting, (error) => error && error.code === "ABORTED");
  assert.ok(Date.now() - started < 250, "Provider polling must stop promptly after cancellation");
  console.log("鉁?Provider polling does not outlive a cancelled Run");
}

async function run() {
  await testDeadlineAndHandoffs();
  await testStageTimeout();
  await testCancellation();
  testKeepAliveRegistry();
  await testProviderPollingCancellation();
  console.log("\ntest-agent-deadline-runtime: PASS");
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
