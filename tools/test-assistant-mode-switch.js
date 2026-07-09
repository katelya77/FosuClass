const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");

const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "fosu-assistant-mode-switch-"));
process.env.FOSU_AI_PROVIDER_CONFIG_PATH = path.join(tempRoot, "ai-provider-config.json");
process.env.FOSU_AI_PROVIDER_WRITE_ENV = "false";

[
  "AI_PROVIDER_ACTIVE_ENV",
  "AI_PROVIDER_ENVIRONMENTS",
  "AI_PROVIDER_RUNTIME_VERSION",
  "AI_PROVIDER_RUNTIME_UPDATED_AT",
  "AI_AGENT_ENABLED",
  "AI_PROVIDER",
  "AI_PROVIDER_POLICY",
].forEach((key) => {
  process.env[key] = "";
});
process.env.AI_AGENT_ENABLED = "false";
process.env.AI_PROVIDER = "mock";
process.env.AI_PROVIDER_POLICY = "tool-only";
process.env.AI_RUNTIME_MODE = "public";
process.env.AI_PROVIDER_ACTIVE_ENV = "public";
process.env.AI_PROVIDER_ENVIRONMENTS = "{}";

try {
  const providerConfig = require("../server/src/services/ai/providerConfigService");

  let status = providerConfig.saveConfig({
    preset: "public-safe",
    environment: "public",
    activeEnvironment: "public",
    activeMode: "public",
    provider: "mock",
    providerPolicy: "tool-only",
    enabled: false,
    runtimeMode: "public",
  });
  assert.strictEqual(status.activeEnvironment, "public");
  assert.strictEqual(status.provider, "mock");
  assert.strictEqual(status.providerPolicy, "tool-only");
  assert.strictEqual(status.enabled, false);
  assert(status.runtimeVersion, "formal switch should write runtime version");
  assert(status.runtimeUpdatedAt, "formal switch should write runtime updatedAt");
  assert.strictEqual(status.globalRuntimeMode, "public");

  status = providerConfig.saveConfig({
    environment: "trial",
    activeEnvironment: "trial",
    activeMode: "trial",
    provider: "deepseek",
    providerPolicy: "auto",
    enabled: true,
    runtimeMode: "competition",
    model: "deepseek-v4-flash",
    mirrorEnvironments: ["trial", "dev"],
  });
  assert.strictEqual(status.activeEnvironment, "trial");
  assert.strictEqual(status.provider, "deepseek");
  assert.strictEqual(status.enabled, true);
  assert.strictEqual(status.runtimeMode, "competition");
  let trialEnv = status.environments.find((item) => item.environment === "trial");
  let devEnv = status.environments.find((item) => item.environment === "dev");
  assert.strictEqual(trialEnv.provider, "deepseek");
  assert.strictEqual(trialEnv.enabled, true);
  assert.strictEqual(devEnv.provider, "deepseek");
  assert.strictEqual(devEnv.enabled, true);

  status = providerConfig.saveConfig({
    preset: "public-safe",
    environment: "public",
    activeEnvironment: "public",
    provider: "mock",
  });
  assert.strictEqual(status.activeEnvironment, "public");
  assert.strictEqual(status.provider, "mock");
  assert.strictEqual(status.enabled, false);
  assert.strictEqual(status.providerPolicy, "tool-only");
  assert.strictEqual(status.globalRuntimeMode, "competition", "enabling formal mode must not disable trial/dev AI");
  trialEnv = status.environments.find((item) => item.environment === "trial");
  devEnv = status.environments.find((item) => item.environment === "dev");
  assert.strictEqual(trialEnv.provider, "deepseek");
  assert.strictEqual(trialEnv.enabled, true);
  assert.strictEqual(devEnv.provider, "deepseek");
  assert.strictEqual(devEnv.enabled, true);
  assert.strictEqual(providerConfig.getRuntimeConfigForEnvironment("public").AI_PROVIDER, "mock");
  assert.strictEqual(providerConfig.getRuntimeConfigForEnvironment("trial").AI_PROVIDER, "deepseek");

  status = providerConfig.saveConfig({
    environment: "trial",
    activeEnvironment: "public",
    activeMode: "public",
    provider: "mock",
    providerPolicy: "tool-only",
    enabled: false,
    runtimeMode: "public",
    mirrorEnvironments: ["trial", "dev"],
  });
  assert.strictEqual(status.activeEnvironment, "public");
  assert.strictEqual(status.globalRuntimeMode, "public");
  trialEnv = status.environments.find((item) => item.environment === "trial");
  devEnv = status.environments.find((item) => item.environment === "dev");
  assert.strictEqual(trialEnv.provider, "mock");
  assert.strictEqual(trialEnv.enabled, false);
  assert.strictEqual(devEnv.provider, "mock");
  assert.strictEqual(devEnv.enabled, false);

  status = providerConfig.saveConfig({
    environment: "trial",
    activeEnvironment: "trial",
    activeMode: "trial",
    provider: "cloudbase-openai",
    providerPolicy: "auto",
    enabled: true,
    runtimeMode: "competition",
    mirrorEnvironments: ["trial", "dev"],
  });
  assert.strictEqual(status.activeEnvironment, "trial");
  assert.strictEqual(status.globalRuntimeMode, "competition");
  trialEnv = status.environments.find((item) => item.environment === "trial");
  devEnv = status.environments.find((item) => item.environment === "dev");
  assert.strictEqual(trialEnv.provider, "cloudbase-openai");
  assert.strictEqual(trialEnv.enabled, true);
  assert.strictEqual(devEnv.provider, "cloudbase-openai");
  assert.strictEqual(devEnv.enabled, true);

  console.log("test-assistant-mode-switch passed");
} finally {
  fs.rmSync(tempRoot, { recursive: true, force: true });
}
