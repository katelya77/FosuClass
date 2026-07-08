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

  status = providerConfig.saveConfig({
    environment: "trial",
    activeEnvironment: "trial",
    activeMode: "trial",
    provider: "deepseek",
    providerPolicy: "auto",
    enabled: true,
    runtimeMode: "competition",
    model: "deepseek-v4-flash",
  });
  assert.strictEqual(status.activeEnvironment, "trial");
  assert.strictEqual(status.provider, "deepseek");
  assert.strictEqual(status.enabled, true);
  assert.strictEqual(status.runtimeMode, "competition");

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

  console.log("test-assistant-mode-switch passed");
} finally {
  fs.rmSync(tempRoot, { recursive: true, force: true });
}
