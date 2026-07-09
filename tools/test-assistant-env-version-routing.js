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
];

const previous = {};
keys.forEach((key) => {
  previous[key] = process.env[key];
  delete process.env[key];
});

try {
  process.env.AI_RUNTIME_MODE = "competition";
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
    assert.strictEqual(resolved.runtimeMode, "competition", `${envVersion} should enter competition mode`);
    assert.strictEqual(resolved.reason, "trial_env_authorized");
  });

  process.env.AI_COMPETITION_ALLOW_TRIAL_ENV = "false";
  resolved = runtimeModeService.resolveRuntimeMode({
    runtimeMode: "competition",
    context: { envVersion: "trial" },
  });
  assert.strictEqual(resolved.runtimeMode, "public");
  assert.strictEqual(resolved.reason, "competition_not_authorized");

  console.log("test-assistant-env-version-routing passed");
} finally {
  keys.forEach((key) => {
    if (previous[key] === undefined) delete process.env[key];
    else process.env[key] = previous[key];
  });
}
