#!/usr/bin/env node
const assert = require("assert");
const providerChain = require("../server/src/services/ai/providerChainService");
const plannerAdapter = require("../server/src/services/ai/planner/plannerModelAdapter");

async function run() {
  const original = providerChain.generateWithChain;
  const calls = [];
  providerChain.generateWithChain = async (input, options) => {
    calls.push({ input, options });
    return {
      provider: "coze",
      content: JSON.stringify({
        goal: "conversational_help",
        intent: "conversational_help",
        confidence: 0.9,
        slots: {},
        needsClarification: false,
        clarification: null,
        steps: [],
        stopCondition: "all_steps_done",
      }),
      latencyMs: 3,
    };
  };
  try {
    const result = await plannerAdapter.generate({
      runtimeMode: "trial",
      providerRuntimeConfig: {
        AI_PROVIDER: "coze",
        AI_PROVIDER_CHAIN: "coze,mock",
        COZE_ENABLED: "true",
        COZE_API_KEY: "unit-test-placeholder-not-real",
        COZE_BOT_ID: "unit-test-bot",
      },
      messages: [{ role: "user", content: "{}" }],
      env: { AI_PLANNER_TIMEOUT_MS: "2000" },
    });
    assert.strictEqual(result.provider, "coze");
    assert.strictEqual(calls.length, 1);
    assert.strictEqual(calls[0].options.structured, true);
    assert.strictEqual(calls[0].options.purpose, "planning");
  } finally {
    providerChain.generateWithChain = original;
    plannerAdapter.resetCircuitForTests();
  }
  console.log("test-planner-unified-provider-layer: PASS");
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
