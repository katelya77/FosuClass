const assert = require("assert");

const keys = [
  "AI_COMPETITION_ALLOW_TRIAL_ENV",
  "AI_COMPETITION_ALLOW_ALL_SESSIONS",
  "AI_COMPETITION_ALLOW_UNKNOWN_ENV",
  "AI_COMPETITION_SHORT_TOKEN",
  "AI_COMPETITION_OPENID_HASH_PREFIXES",
  "AI_COMPETITION_CAPABILITY_TOKEN_HASH",
  "AI_COMPETITION_CAPABILITY_TOKEN_EXPIRES_AT",
  "AI_RUNTIME_MODE",
  "AI_PROVIDER_ACTIVE_ENV",
];

const previous = {};
keys.forEach((key) => {
  previous[key] = process.env[key];
  delete process.env[key];
});

try {
  process.env.AI_RUNTIME_MODE = "competition";
  process.env.AI_PROVIDER_ACTIVE_ENV = "trial";
  process.env.AI_COMPETITION_ALLOW_TRIAL_ENV = "true";
  const runtimeModeService = require("../server/src/services/ai/runtimeModeService");

  let resolved = runtimeModeService.resolveRuntimeMode({
    runtimeMode: "competition",
    context: { envVersion: "release" },
  });
  assert.strictEqual(resolved.runtimeMode, "public");
  assert.strictEqual(resolved.reason, "release_env_fail_closed");

  ["trial", "develop", "devtools"].forEach((envVersion) => {
    resolved = runtimeModeService.resolveRuntimeMode({
      runtimeMode: "competition",
      context: { envVersion },
    });
    assert.strictEqual(resolved.runtimeMode, "trial", `${envVersion} should use the server-selected trial mode`);
    assert.strictEqual(resolved.reason, "server_runtime_trial");
  });

  process.env.AI_COMPETITION_ALLOW_TRIAL_ENV = "false";
  resolved = runtimeModeService.resolveRuntimeMode({
    runtimeMode: "competition",
    context: { envVersion: "trial" },
  });
  assert.strictEqual(resolved.runtimeMode, "public", "the server trial-environment gate fails closed when disabled");
  assert.strictEqual(resolved.reason, "competition_not_authorized");

  process.env.AI_RUNTIME_MODE = "dev";
  process.env.AI_PROVIDER_ACTIVE_ENV = "dev";
  process.env.AI_COMPETITION_ALLOW_TRIAL_ENV = "true";
  resolved = runtimeModeService.resolveRuntimeMode({
    runtimeMode: "public",
    context: { envVersion: "develop", runtimeMode: "trial" },
  });
  assert.strictEqual(resolved.runtimeMode, "dev", "client request cannot change a server-selected dev mode");
  assert.strictEqual(resolved.reason, "server_runtime_dev");

  console.log("test-assistant-env-version-routing passed");
} finally {
  keys.forEach((key) => {
    if (previous[key] === undefined) delete process.env[key];
    else process.env[key] = previous[key];
  });
}
