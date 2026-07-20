#!/usr/bin/env node
const assert = require("assert");
const crypto = require("crypto");

const keys = [
  "AI_AGENT_ENABLED", "AI_PROVIDER", "AI_PROVIDER_POLICY", "AI_RUNTIME_MODE",
  "AI_PROVIDER_ACTIVE_ENV", "AI_COMPETITION_ALLOW_TRIAL_ENV",
  "AI_COMPETITION_ALLOW_UNKNOWN_ENV", "AI_COMPETITION_ALLOW_ALL_SESSIONS",
  "AI_COMPETITION_OPENID_HASH_PREFIXES", "AI_COMPETITION_CAPABILITY_TOKEN_SHA256",
  "AI_COMPETITION_CAPABILITY_EXPIRES_AT", "AI_ENHANCED_REQUIRE_SESSION",
  "AI_COMPETITION_REQUIRE_SESSION", "NODE_ENV",
];
const previous = Object.fromEntries(keys.map((key) => [key, process.env[key]]));

async function run() {
  const runtimeModeService = require("../server/src/services/ai/runtimeModeService");
  const agentService = require("../server/src/services/ai/agentService");
  const providerChainService = require("../server/src/services/ai/providerChainService");

  process.env.AI_RUNTIME_MODE = "public";
  process.env.AI_COMPETITION_ALLOW_TRIAL_ENV = "true";
  let decision = runtimeModeService.resolveRuntimeMode({
    runtimeMode: "dev",
    context: { envVersion: "develop", runtimeMode: "dev" },
  });
  assert.strictEqual(decision.runtimeMode, "public", "client input cannot elevate a public server");
  assert.strictEqual(decision.reason, "server_runtime_public");

  process.env.AI_RUNTIME_MODE = "competition";
  process.env.AI_PROVIDER_ACTIVE_ENV = "public";
  assert.strictEqual(
    runtimeModeService.resolveConfiguredMode(),
    "public",
    "legacy competition must fail closed when the active provider environment is public"
  );
  process.env.AI_PROVIDER_ACTIVE_ENV = "unexpected";
  assert.strictEqual(
    runtimeModeService.resolveConfiguredMode(),
    "public",
    "legacy competition must fail closed for an unknown active provider environment"
  );

  process.env.AI_RUNTIME_MODE = "competition";
  process.env.AI_PROVIDER_ACTIVE_ENV = "trial";
  decision = runtimeModeService.resolveRuntimeMode({
    runtimeMode: "public",
    context: { envVersion: "trial", runtimeMode: "public" },
  });
  assert.strictEqual(decision.runtimeMode, "trial", "legacy competition maps to server-selected trial");
  assert.strictEqual(decision.reason, "server_runtime_trial");

  process.env.AI_COMPETITION_ALLOW_TRIAL_ENV = "false";
  decision = runtimeModeService.resolveRuntimeMode({
    runtimeMode: "trial",
    context: { envVersion: "trial", runtimeMode: "dev" },
  });
  assert.strictEqual(decision.runtimeMode, "public", "a known trial environment still needs the server allow flag");
  assert.strictEqual(decision.authorized, false);

  decision = runtimeModeService.resolveRuntimeMode({
    runtimeMode: "public",
    context: { envVersion: "trial", runtimeMode: "public" },
    serverSession: { adminProviderVerification: true },
  });
  assert.strictEqual(decision.runtimeMode, "trial", "a server-authorized session may enable trial even when the env flag is off");
  assert.strictEqual(decision.reason, "server_session_authorized");

  process.env.AI_COMPETITION_ALLOW_UNKNOWN_ENV = "true";
  decision = runtimeModeService.resolveRuntimeMode({
    runtimeMode: "trial",
    context: { envVersion: "unknown", runtimeMode: "trial" },
  });
  assert.strictEqual(decision.runtimeMode, "public", "allow-unknown must never authorize an unknown environment by itself");

  decision = runtimeModeService.resolveRuntimeMode({
    context: {
      envVersion: "unknown",
      serverSession: { adminProviderVerification: true },
    },
  });
  assert.strictEqual(decision.runtimeMode, "public", "client context cannot forge a server-authorized session");

  decision = runtimeModeService.resolveRuntimeMode({
    context: { envVersion: "unknown" },
    serverSession: { adminProviderVerification: true },
  });
  assert.strictEqual(decision.runtimeMode, "trial", "allow-unknown requires a real server session or capability token");
  assert.strictEqual(decision.reason, "server_session_authorized");

  process.env.AI_COMPETITION_ALLOW_UNKNOWN_ENV = "false";
  decision = runtimeModeService.resolveRuntimeMode({
    context: { envVersion: "unknown" },
    serverSession: { adminProviderVerification: true },
  });
  assert.strictEqual(decision.runtimeMode, "public", "unknown environments fail closed unless the server explicitly enables them");

  const capabilityToken = "unit-test-capability";
  process.env.AI_COMPETITION_ALLOW_UNKNOWN_ENV = "true";
  process.env.AI_COMPETITION_CAPABILITY_TOKEN_SHA256 = crypto.createHash("sha256").update(capabilityToken).digest("hex");
  process.env.AI_COMPETITION_CAPABILITY_EXPIRES_AT = new Date(Date.now() + 60_000).toISOString();
  decision = runtimeModeService.resolveRuntimeMode({
    context: { envVersion: "unknown", competitionCapabilityToken: capabilityToken },
  });
  assert.strictEqual(decision.runtimeMode, "trial", "a valid, unexpired capability token can authorize an explicitly allowed unknown env");
  assert.strictEqual(decision.reason, "capability_token_authorized");

  process.env.AI_COMPETITION_CAPABILITY_EXPIRES_AT = new Date(Date.now() - 60_000).toISOString();
  decision = runtimeModeService.resolveRuntimeMode({
    context: { envVersion: "unknown", competitionCapabilityToken: capabilityToken },
  });
  assert.strictEqual(decision.runtimeMode, "public", "expired capability tokens fail closed");

  delete process.env.AI_COMPETITION_CAPABILITY_TOKEN_SHA256;
  delete process.env.AI_COMPETITION_CAPABILITY_EXPIRES_AT;
  process.env.AI_COMPETITION_ALLOW_UNKNOWN_ENV = "false";
  process.env.AI_COMPETITION_ALLOW_TRIAL_ENV = "true";

  decision = runtimeModeService.resolveRuntimeMode({
    runtimeMode: "dev",
    context: { envVersion: "release", runtimeMode: "dev" },
  });
  assert.strictEqual(decision.runtimeMode, "public");
  assert.strictEqual(decision.reason, "release_env_fail_closed");

  process.env.AI_RUNTIME_MODE = "dev";
  process.env.AI_PROVIDER_ACTIVE_ENV = "dev";
  decision = runtimeModeService.resolveRuntimeMode({ context: { envVersion: "develop", runtimeMode: "trial" } });
  assert.strictEqual(decision.runtimeMode, "dev", "server mode wins over client-requested trial");

  process.env.AI_AGENT_ENABLED = "true";
  process.env.AI_PROVIDER = "deepseek";
  process.env.AI_PROVIDER_POLICY = "always";
  assert.strictEqual(
    agentService.evaluateProviderPolicy(
      { name: "get_today_courses" },
      [{ name: "get_today_courses", result: { success: true } }],
      "always",
      "deepseek",
      "trial",
      { AI_AGENT_ENABLED: "true", AI_PROVIDER: "deepseek", AI_PROVIDER_POLICY: "always" }
    ).useExternal,
    false,
    "factual intents cannot use an external provider even under always policy"
  );
  assert.strictEqual(
    agentService.evaluateProviderPolicy(
      { name: "project_qa" }, [], "always", "deepseek", "trial",
      { AI_AGENT_ENABLED: "true", AI_PROVIDER: "deepseek", AI_PROVIDER_POLICY: "always" }
    ).useExternal,
    true,
    "an allowed non-factual trial intent may use the external expression layer"
  );
  assert.strictEqual(
    agentService.evaluateProviderPolicy(
      { name: "project_qa" }, [], "always", "deepseek", "public",
      { AI_AGENT_ENABLED: "true", AI_PROVIDER: "deepseek", AI_PROVIDER_POLICY: "always" }
    ).useExternal,
    false,
    "public mode always has zero external provider calls"
  );

  const originalGenerate = providerChainService.generateWithChain;
  let externalCalls = 0;
  providerChainService.generateWithChain = async () => {
    externalCalls += 1;
    throw new Error("external provider must not be reached");
  };
  try {
    process.env.AI_RUNTIME_MODE = "public";
    await agentService.chat({
      protocolVersion: "agent.v2",
      message: "今天有什么课",
      context: { envVersion: "release", term: "test-term", releaseVersion: "test-release" },
    });
    assert.strictEqual(externalCalls, 0);
  } finally {
    providerChainService.generateWithChain = originalGenerate;
  }

  console.log("test-agent-runtime-boundaries passed");
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
}).finally(() => {
  keys.forEach((key) => {
    if (previous[key] === undefined) delete process.env[key];
    else process.env[key] = previous[key];
  });
});
