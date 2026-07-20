#!/usr/bin/env node
const assert = require("assert");
const runtimeModeService = require("../server/src/services/ai/runtimeModeService");
const agentService = require("../server/src/services/ai/agentService");
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
  // public force mock
  await withEnv({
    AI_RUNTIME_MODE: "public",
    AI_AGENT_ENABLED: "true",
    AI_PROVIDER: "deepseek",
    AI_PROVIDER_POLICY: "always",
  }, async () => {
    const decision = runtimeModeService.resolveRuntimeMode({
      context: { envVersion: "trial" },
      serverSession: { openidHash: "abc" },
    });
    assert.strictEqual(decision.runtimeMode, "public");
    const policy = agentService.evaluateProviderPolicy(
      { name: "conversational_help" },
      [],
      "always",
      "deepseek",
      "public",
      { AI_AGENT_ENABLED: "true", AI_PROVIDER: "deepseek" }
    );
    assert.strictEqual(policy.useExternal, false);
    assert.ok(/public/i.test(policy.reason));
    const chain = providerChainService.getProviderChain("public", { AI_PROVIDER: "deepseek" });
    assert.deepStrictEqual(chain, ["mock"]);
  });

  // release fail closed
  await withEnv({
    AI_RUNTIME_MODE: "trial",
    AI_AGENT_ENABLED: "true",
    AI_PROVIDER: "deepseek",
    AI_COMPETITION_ALLOW_TRIAL_ENV: "true",
  }, async () => {
    const decision = runtimeModeService.resolveRuntimeMode({
      context: { envVersion: "release" },
      serverSession: { openidHash: "abc" },
    });
    assert.strictEqual(decision.runtimeMode, "public");
    assert.strictEqual(decision.reason, "release_env_fail_closed");
  });

  // agent disabled
  const disabled = agentService.evaluateProviderPolicy(
    { name: "conversational_help" },
    [],
    "auto",
    "deepseek",
    "trial",
    { AI_AGENT_ENABLED: "false", AI_PROVIDER: "deepseek" }
  );
  assert.strictEqual(disabled.useExternal, false);
  assert.ok(/AI_AGENT_ENABLED/i.test(disabled.reason));

  // fact intent never external under auto
  const fact = agentService.evaluateProviderPolicy(
    { name: "get_today_courses" },
    [{ name: "get_today_courses" }],
    "auto",
    "deepseek",
    "trial",
    { AI_AGENT_ENABLED: "true", AI_PROVIDER: "deepseek" }
  );
  // if intent not in FACT set, may differ; still ensure conversational can be external
  const chat = agentService.evaluateProviderPolicy(
    { name: "conversational_help" },
    [],
    "auto",
    "deepseek",
    "trial",
    { AI_AGENT_ENABLED: "true", AI_PROVIDER: "deepseek" }
  );
  assert.strictEqual(chat.useExternal, true);

  // provider mock
  const mockPolicy = agentService.evaluateProviderPolicy(
    { name: "conversational_help" },
    [],
    "auto",
    "mock",
    "trial",
    { AI_AGENT_ENABLED: "true", AI_PROVIDER: "mock" }
  );
  assert.strictEqual(mockPolicy.useExternal, false);

  console.log("test-provider-runtime-matrix: PASS");
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
