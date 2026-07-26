#!/usr/bin/env node
const assert = require("assert");
const providerChain = require("../server/src/services/ai/providerChainService");
const cozeProvider = require("../server/src/services/ai/providers/cozeProvider");
const deepseekProvider = require("../server/src/services/ai/providers/deepseekProvider");

async function run() {
  const events = [];
  const ok = await providerChain.runShadowEvaluation({ message: "脱敏输入" }, {
    runtimeMode: "trial",
    providerRuntimeConfig: {
      AI_PROVIDER_SHADOW_ENABLED: "true",
      AI_PROVIDER_SHADOW: "coze",
      AI_PROVIDER_SHADOW_TIMEOUT_MS: "1000",
    },
    purpose: "understanding",
    onEvent: (event) => events.push(event),
    shadowGenerate: async ({ provider }) => ({ provider, content: '{"private":"must-not-leak"}' }),
  }, "deepseek");
  assert.deepStrictEqual(ok, {
    provider: "coze",
    status: "success",
    latencyMs: ok.latencyMs,
    reason: "",
  });
  assert.ok(!Object.prototype.hasOwnProperty.call(ok, "content"), "shadow content must never enter the decision response");
  assert.deepStrictEqual(events.map((event) => event.type), ["provider.shadow.started", "provider.shadow.completed"]);

  const failed = await providerChain.runShadowEvaluation({}, {
    runtimeMode: "dev",
    providerRuntimeConfig: { AI_PROVIDER_SHADOW_ENABLED: "true", AI_PROVIDER_SHADOW: "hunyuan3" },
    shadowGenerate: async () => { const error = new Error("timeout"); error.code = "ETIMEDOUT"; throw error; },
  }, "deepseek");
  assert.strictEqual(failed.status, "failed");
  assert.strictEqual(failed.provider, "hunyuan3");

  const publicResult = await providerChain.runShadowEvaluation({}, {
    runtimeMode: "public",
    providerRuntimeConfig: { AI_PROVIDER_SHADOW_ENABLED: "true", AI_PROVIDER_SHADOW: "coze" },
    shadowGenerate: async () => { throw new Error("must not run"); },
  }, "deepseek");
  assert.strictEqual(publicResult.status, "skipped");
  assert.strictEqual(publicResult.reason, "public_forbidden");

  const health = await providerChain.probeProvider("hunyuan3", {
    runtimeMode: "trial",
    providerRuntimeConfig: {},
    probeGenerate: async () => ({ content: '{"ok":true}' }),
  });
  assert.strictEqual(health.provider, "hunyuan3");
  assert.strictEqual(health.health, "ok");
  const publicHealth = await providerChain.probeProvider("deepseek", {
    runtimeMode: "public",
    probeGenerate: async () => { throw new Error("must not run"); },
  });
  assert.strictEqual(publicHealth.health, "forbidden");

  const originalCozeTestConnection = cozeProvider.testConnection;
  cozeProvider.testConnection = async () => ({
    success: false,
    code: "COZE_CONNECTION_REJECTED",
  });
  try {
    const rejectedHealth = await providerChain.probeProvider("coze", {
      runtimeMode: "trial",
      providerRuntimeConfig: {
        COZE_ENABLED: "true",
        COZE_API_TOKEN: "unit-test-placeholder-not-real",
        COZE_BOT_ID: "unit-test-bot",
      },
    });
    assert.strictEqual(rejectedHealth.health, "degraded", "a failed adapter probe must never be reported healthy");
    assert.strictEqual(rejectedHealth.reasonCode, "COZE_CONNECTION_REJECTED");
  } finally {
    cozeProvider.testConnection = originalCozeTestConnection;
  }

  const originalDeepseekGenerate = deepseekProvider.generate;
  deepseekProvider.generate = async () => ({ answer: "primary", provider: "deepseek" });
  let shadowFinished = false;
  try {
    const started = Date.now();
    const primary = await providerChain.generateWithChain({ message: "non-blocking-shadow" }, {
      runtimeMode: "trial",
      providerRuntimeConfig: {
        AI_PROVIDER_CHAIN: "deepseek,mock",
        DEEPSEEK_API_KEY: "unit-test-placeholder-not-real",
        AI_PROVIDER_SHADOW_ENABLED: "true",
        AI_PROVIDER_SHADOW: "coze",
        AI_PROVIDER_SHADOW_TIMEOUT_MS: "1000",
      },
      shadowGenerate: () => new Promise((resolve) => {
        setTimeout(() => {
          shadowFinished = true;
          resolve({ content: "diagnostic-only" });
        }, 300);
      }),
    });
    const elapsed = Date.now() - started;
    assert.strictEqual(primary.provider, "deepseek");
    assert.ok(elapsed < 150, `shadow evaluation blocked the primary response for ${elapsed}ms`);
    assert.strictEqual(shadowFinished, false, "primary response must return before shadow completion");
    assert.strictEqual(primary.shadowEvaluation.status, "scheduled");
    await new Promise((resolve) => setTimeout(resolve, 350));
    assert.strictEqual(shadowFinished, true);
  } finally {
    deepseekProvider.generate = originalDeepseekGenerate;
  }

  console.log("test-provider-shadow-eval: PASS");
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
