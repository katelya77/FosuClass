const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");

const secret = "unit-test-runtime-key-not-real";
const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "fosu-ai-provider-"));
const configPath = path.join(tempRoot, "secure", "ai-provider-config.json");

process.env.FOSU_AI_PROVIDER_CONFIG_PATH = configPath;
process.env.AI_PROVIDER_IGNORE_ENV_FILE = "true";

[
  "AI_AGENT_ENABLED",
  "AI_PROVIDER",
  "AI_PROVIDER_POLICY",
  "AI_MODEL",
  "AI_API_KEY",
  "DEEPSEEK_API_KEY",
  "COZE_API_KEY",
].forEach((key) => {
  delete process.env[key];
});

const runtimeStore = require("../server/src/services/ai/providerRuntimeConfigStore");
const providerConfigService = require("../server/src/services/ai/providerConfigService");

function modeOf(file) {
  return fs.statSync(file).mode & 0o777;
}

function run() {
  const saved = providerConfigService.saveConfig({
    enabled: true,
    provider: "deepseek",
    providerPolicy: "auto",
    model: "deepseek-v4-flash",
    apiKey: secret,
    allowPersonalContext: true,
  });
  assert.strictEqual(saved.deepseekKeyConfigured, true);
  assert.strictEqual(saved.provider, "deepseek");
  assert(!JSON.stringify(saved).includes(secret), "getStatus must not expose the API key");
  assert(fs.existsSync(configPath), "runtime config file should exist");

  if (process.platform !== "win32") {
    assert.strictEqual(modeOf(path.dirname(configPath)), 0o700, "secure dir should be 0700");
    assert.strictEqual(modeOf(configPath), 0o600, "runtime config file should be 0600");
  }

  delete process.env.AI_API_KEY;
  delete process.env.AI_AGENT_ENABLED;
  delete process.env.AI_PROVIDER;
  const loaded = runtimeStore.loadRuntimeConfigIntoProcessEnv({ throwOnError: true });
  assert.strictEqual(loaded.values.AI_API_KEY, secret);
  assert.strictEqual(process.env.AI_API_KEY, secret);
  assert.strictEqual(process.env.AI_AGENT_ENABLED, "true");
  assert.strictEqual(providerConfigService.getStatus().deepseekKeyConfigured, true);
  assert(!JSON.stringify(providerConfigService.getStatus()).includes(secret), "reloaded status must not expose key");

  console.log("test-ai-provider-runtime-config-store passed");
}

try {
  run();
} finally {
  try {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  } catch (error) {
    // best effort cleanup
  }
}
