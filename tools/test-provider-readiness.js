#!/usr/bin/env node
const assert = require("assert");
const providerReadinessService = require("../server/src/services/ai/providerReadinessService");
const agentReadinessService = require("../server/src/services/ai/agentReadinessService");
const providerChainService = require("../server/src/services/ai/providerChainService");

function withEnv(patch, fn) {
  const previous = {};
  Object.keys(patch).forEach((key) => {
    previous[key] = process.env[key];
    if (patch[key] === undefined) delete process.env[key];
    else process.env[key] = patch[key];
  });
  try {
    return fn();
  } finally {
    Object.keys(patch).forEach((key) => {
      if (previous[key] === undefined) delete process.env[key];
      else process.env[key] = previous[key];
    });
  }
}

async function run() {
  withEnv({
    AI_RUNTIME_MODE: "public",
    AI_AGENT_ENABLED: "false",
    AI_PROVIDER: "mock",
  }, () => {
    const publicEnv = providerReadinessService.evaluateEnvironment("public");
    assert.strictEqual(publicEnv.agentEnabled, false);
    assert.strictEqual(publicEnv.provider, "mock");
    assert.strictEqual(publicEnv.reasonCode, "SERVER_RUNTIME_PUBLIC");

    const readiness = agentReadinessService.resolveRequestReadiness({
      context: { envVersion: "release" },
      serverSession: null,
    });
    assert.strictEqual(readiness.runtimeMode, "public");
    assert.strictEqual(readiness.enhancedMode, "disabled");
    assert.ok(!JSON.stringify(readiness).includes("API_KEY"));
    assert.ok(!JSON.stringify(readiness).toLowerCase().includes("openid"));
    assert.strictEqual(agentReadinessService.toClientStatusMachine(readiness), "public_ready");
  });

  withEnv({
    AI_RUNTIME_MODE: "trial",
    AI_AGENT_ENABLED: "false",
    AI_PROVIDER: "deepseek",
    AI_COMPETITION_ALLOW_TRIAL_ENV: "true",
  }, () => {
    const trial = providerReadinessService.evaluateEnvironment("trial");
    assert.strictEqual(trial.reasonCode, "AGENT_DISABLED");
    const readiness = agentReadinessService.resolveRequestReadiness({
      context: { envVersion: "trial" },
      serverSession: { openidHash: "abc123", appid: "wx" },
    });
    // may still degrade or disable based on session rules
    assert.ok(["disabled", "degraded", "ready"].includes(readiness.enhancedMode));
    assert.ok(readiness.reasonCode);
  });

  withEnv({
    AI_RUNTIME_MODE: "trial",
    AI_AGENT_ENABLED: "true",
    AI_PROVIDER: "mock",
    AI_COMPETITION_ALLOW_TRIAL_ENV: "true",
    AI_ENHANCED_REQUIRE_SESSION: "false",
  }, () => {
    const flags = providerReadinessService.publicProviderFlags("trial", {
      AI_AGENT_ENABLED: "true",
      AI_PROVIDER: "mock",
    });
    assert.strictEqual(flags.reasonCode, "PROVIDER_MOCK");
  });

  const matrix = providerReadinessService.getAdminMatrix();
  assert.ok(matrix.environments.public);
  assert.ok(matrix.environments.trial);
  assert.ok(matrix.environments.dev);
  assert.ok(matrix.checkedAt);

  providerChainService.resetForTest();
  const runtimeConfig = {
    AI_AGENT_ENABLED: "true",
    AI_PROVIDER: "deepseek",
    AI_MODEL: "deepseek-chat",
    DEEPSEEK_API_KEY: "test-only-placeholder",
  };
  const configuredOnly = providerReadinessService.publicProviderFlags("trial", runtimeConfig);
  assert.strictEqual(configuredOnly.providerConfigured, true);
  assert.strictEqual(configuredOnly.configuredAvailable, true);
  assert.strictEqual(configuredOnly.verified, false);
  assert.strictEqual(configuredOnly.providerReachable, false, "configured must not be reported as reachable");
  assert.strictEqual(configuredOnly.reasonCode, "PROVIDER_UNVERIFIED");
  assert.strictEqual(configuredOnly.lastProbeAt, "");
  assert.strictEqual(configuredOnly.lastSuccessAt, "");
  assert.strictEqual(configuredOnly.circuitState, "closed");

  await providerChainService.probeProvider("deepseek", {
    runtimeMode: "trial",
    providerRuntimeConfig: runtimeConfig,
    probeGenerate: async () => ({ ok: true }),
  });
  const verified = providerReadinessService.publicProviderFlags("trial", runtimeConfig);
  assert.strictEqual(verified.verified, true);
  assert.strictEqual(verified.providerReachable, true);
  assert.ok(verified.lastProbeAt);
  assert.ok(verified.lastSuccessAt);
  assert.strictEqual(verified.reasonCode, "PROVIDER_HEALTHY");

  console.log("test-provider-readiness: PASS");
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
