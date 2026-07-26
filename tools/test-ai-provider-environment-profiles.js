const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");

const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "fosu-ai-env-profiles-"));
process.env.FOSU_AI_PROVIDER_CONFIG_PATH = path.join(tempRoot, "secure", "ai-provider-config.json");
process.env.FOSU_AI_CONFIG_ENCRYPTION_KEY = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
process.env.AI_PROVIDER_IGNORE_ENV_FILE = "true";

[
  "AI_AGENT_ENABLED",
  "AI_PROVIDER",
  "AI_PROVIDER_POLICY",
  "AI_RUNTIME_MODE",
  "AI_PROVIDER_ACTIVE_ENV",
  "AI_PROVIDER_ENVIRONMENTS",
  "AI_API_KEY",
  "DEEPSEEK_API_KEY",
  "COZE_API_KEY",
  "CLOUDBASE_OPENAI_API_KEY",
].forEach((key) => {
  delete process.env[key];
});

const providerConfigService = require("../server/src/services/ai/providerConfigService");
const providerFactory = require("../server/src/services/ai/providerFactory");

try {
  const publicSaved = providerConfigService.saveConfig({
    environment: "public",
    enabled: true,
    provider: "deepseek",
    providerPolicy: "always",
  });
  const publicEnv = publicSaved.environments.find((item) => item.environment === "public");
  assert.strictEqual(publicEnv.provider, "mock");
  assert.strictEqual(publicEnv.enabled, false);
  assert.strictEqual(publicEnv.providerPolicy, "tool-only");
  assert.strictEqual(providerFactory.getProviderName("public", providerConfigService.getRuntimeConfigForEnvironment("public")), "mock");

  const trialSaved = providerConfigService.saveConfig({
    environment: "trial",
    enabled: true,
    provider: "deepseek",
    providerPolicy: "auto",
    apiKey: "unit-test-key-not-real",
  });
  const trialConfig = providerConfigService.getRuntimeConfigForEnvironment("trial");
  assert.strictEqual(trialSaved.globalRuntimeMode, "competition");
  assert.strictEqual(providerFactory.getProviderName("competition", trialConfig), "deepseek");
  assert.strictEqual(trialSaved.deepseekKeyConfigured, true);
  assert(!JSON.stringify(trialSaved).includes("unit-test-key-not-real"), "status must not expose plaintext secret");

  process.env.AI_AGENT_ENABLED = "false";
  process.env.AI_UNDERSTANDING_ENABLED = "0";
  const killedTrialConfig = providerConfigService.getRuntimeConfigForEnvironment("trial");
  assert.strictEqual(killedTrialConfig.AI_AGENT_ENABLED, "false", "process kill switch must override an enabled trial profile");
  assert.strictEqual(killedTrialConfig.AI_UNDERSTANDING_ENABLED, "false", "understanding kill switch must override the profile");
  delete process.env.AI_AGENT_ENABLED;
  delete process.env.AI_UNDERSTANDING_ENABLED;

  const devSaved = providerConfigService.saveConfig({ preset: "dev-full", environment: "dev" });
  const devEnv = devSaved.environments.find((item) => item.environment === "dev");
  assert.strictEqual(devEnv.providerPolicy, "always");
  assert.strictEqual(devEnv.runtimeMode, "competition");
  assert.strictEqual(providerConfigService.getEnvironmentForContext({ envVersion: "trial" }, "trial"), "trial");
  assert.strictEqual(providerConfigService.getEnvironmentForContext({ envVersion: "develop" }, "trial"), "dev");
  assert.strictEqual(providerConfigService.getEnvironmentForContext({ envVersion: "devtools" }, "competition"), "dev");
  assert.strictEqual(providerConfigService.getEnvironmentForContext({ envVersion: "release" }, "public"), "public");

  console.log("test-ai-provider-environment-profiles passed");
} finally {
  fs.rmSync(tempRoot, { recursive: true, force: true });
}
