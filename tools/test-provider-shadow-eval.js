#!/usr/bin/env node
const assert = require("assert");
const providerChain = require("../server/src/services/ai/providerChainService");

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

  console.log("test-provider-shadow-eval: PASS");
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
