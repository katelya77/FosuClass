#!/usr/bin/env node
const assert = require("assert");

const providerRuntimeComposition = require("../server/src/services/ai/providerRuntimeComposition");
const providerChainService = require("../server/src/services/ai/providerChainService");

async function run() {
  const orchestratorPath = require.resolve("../server/src/services/ai/runtime/providerOrchestrator");
  const originalGetRuntime = providerRuntimeComposition.getProviderRuntime;
  const originalResolveResponse = providerRuntimeComposition.resolveResponseProviders;
  const originalLegacyGenerate = providerChainService.generateWithChain;
  const calls = [];
  providerRuntimeComposition.getProviderRuntime = () => ({
    async generate(input) {
      calls.push(input);
      return {
        payload: { provider: "deepseek", answer: "runtime response", cards: [], suggestions: [] },
        provider: "deepseek",
        actualFirstProvider: "deepseek",
        fallbackPath: ["deepseek:success"],
        attemptCount: 1,
        latencyMs: 4,
      };
    },
  });
  providerRuntimeComposition.resolveResponseProviders = () => ({
    intendedProvider: "deepseek",
    fallbackProvider: "cloudbase-openai",
    chain: ["deepseek", "cloudbase-openai"],
  });
  providerChainService.generateWithChain = async () => {
    throw new Error("legacy response chain must not execute");
  };
  delete require.cache[orchestratorPath];

  try {
    const orchestrator = require(orchestratorPath);
    const ledger = { claimFallback: () => true };
    const result = await orchestrator.generateAssistantResponse({
      intent: { name: "conversational_help", slots: {} },
      toolCalls: [],
      runtimeMode: "trial",
      executionPolicy: "strict_model_first",
      providerRuntimeConfig: {
        AI_AGENT_ENABLED: "true",
        AI_PROVIDER: "deepseek",
        AI_PROVIDER_POLICY: "always",
      },
      principal: { authenticated: true, principalKey: "test" },
      context: { recentMessages: [], userMemories: [], currentScheduleSummary: {} },
      message: "hello",
      eventInput: { onEvent() {} },
      publicToolCalls: [],
      understanding: { source: "model", externalProviderUsed: true, providerUsed: "deepseek", providerChain: [] },
      plannerDiag: {},
      execution: { steps: [], observations: [], verification: { ok: true, errors: [] } },
      deadline: { deadlineAt: Date.now() + 1000, remainingMs: () => 1000, lease: () => ({ timeoutMs: 500 }) },
      responseBudgetMs: 500,
      providerAttemptLedger: ledger,
    });
    assert.strictEqual(result.externalProviderUsed, true);
    assert.strictEqual(result.providerPayload.answer, "runtime response");
    assert.strictEqual(calls.length, 1, "Response must execute through the shared Provider Runtime");
    assert.strictEqual(calls[0].providerAttemptLedger, ledger);
    assert.strictEqual(calls[0].stage, "response");
    assert.deepStrictEqual(calls[0].fallbackProvider, "cloudbase-openai");
    console.log("test-response-provider-runtime: PASS");
  } finally {
    providerRuntimeComposition.getProviderRuntime = originalGetRuntime;
    if (originalResolveResponse) providerRuntimeComposition.resolveResponseProviders = originalResolveResponse;
    else delete providerRuntimeComposition.resolveResponseProviders;
    providerChainService.generateWithChain = originalLegacyGenerate;
    delete require.cache[orchestratorPath];
  }
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
