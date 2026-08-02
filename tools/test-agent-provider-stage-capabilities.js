#!/usr/bin/env node
const assert = require("assert");

const {
  resolveDecisionProviders,
  resolveResponseProviders,
  resolveStageProviders,
} = require("../server/src/services/ai/providerRuntimeComposition");
const { createAgentRuntime } = require("../packages/agent-runtime");

function workloadConfig(extra = {}) {
  return Object.assign({
    AI_PROVIDER_CHAIN: "coze,deepseek,mock",
    AI_DECISION_PROVIDER: "coze",
    COZE_ENABLED: "true",
    COZE_API_MODE: "workload",
    COZE_API_TOKEN: "unit-test-token-not-real",
    COZE_WORKLOAD_ENDPOINT: "https://example.invalid/stream_run",
    COZE_PROJECT_ID: "unit-test-project",
    DEEPSEEK_API_KEY: "unit-test-key-not-real",
  }, extra);
}

function testStageCapabilityAndConfigurationFiltering() {
  assert.deepStrictEqual(resolveDecisionProviders("public", workloadConfig()).chain, []);

  const decision = resolveDecisionProviders("trial", workloadConfig());
  assert.deepStrictEqual(decision.chain, ["deepseek"],
    "a normal Coze workload is a response workflow, not a strict Decision JSON provider");
  assert.strictEqual(decision.intendedProvider, "deepseek");
  assert.strictEqual(decision.fallbackProvider, "");

  const response = resolveResponseProviders("trial", workloadConfig());
  assert.deepStrictEqual(response.chain, ["coze", "deepseek"],
    "the same Coze workload remains eligible for response composition");

  const explicitStructured = resolveDecisionProviders("trial", workloadConfig({
    COZE_STRUCTURED_DECISION_ENABLED: "true",
  }));
  assert.deepStrictEqual(explicitStructured.chain, ["coze", "deepseek"],
    "an explicit structured-decision capability may opt a verified workflow in");

  const skipsUnconfigured = resolveStageProviders("decision", "trial", {
    AI_PROVIDER_CHAIN: "cloudbase-openai,deepseek,mock",
    AI_DECISION_PROVIDER: "cloudbase-openai",
    CLOUDBASE_OPENAI_ENABLED: "false",
    DEEPSEEK_API_KEY: "unit-test-key-not-real",
  });
  assert.deepStrictEqual(skipsUnconfigured.chain, ["deepseek"],
    "an unconfigured provider must not consume a timeout lease");
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function testEnhancedDecisionGetsUsableBoundedBudget() {
  const runtime = createAgentRuntime();
  const startedAt = Date.now();
  const result = await runtime.executeTurn({
    request: {
      runId: "provider-budget-spoken-class",
      runtimeMode: "trial",
      deadlineAt: Date.now() + 15_000,
    },
    configSnapshot: { configVersion: "cfg-test", pluginIds: ["fosu-campus"] },
    stages: {
      async context() { return { messageCount: 1, memoryCount: 0 }; },
      async decision() {
        await sleep(3_700);
        return {
          goal: { name: "open_schedule" },
          selectedSkillId: "schedule_search",
          decisionSource: "model",
          executionPolicy: "strict_model_first",
          taskComplexity: "simple",
          intendedProvider: "deepseek",
          actualFirstProvider: "deepseek",
          fallbackPath: ["deepseek:success"],
        };
      },
      async skillTool() { return { toolCalls: [] }; },
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
        };
      },
    },
  });
  assert.ok(result.platformTrace.timings.decision >= 3_600,
    "a real-world structured Decision taking about 3.7s must not be cut off by the old 3.5s cap");
  assert.ok(Date.now() - startedAt < 15_000, "the full Turn remains inside the hard 15s deadline");
}

async function run() {
  testStageCapabilityAndConfigurationFiltering();
  await testEnhancedDecisionGetsUsableBoundedBudget();
  console.log("test-agent-provider-stage-capabilities: PASS");
}

run().catch((error) => {
  console.error(error && error.stack || error);
  process.exit(1);
});
