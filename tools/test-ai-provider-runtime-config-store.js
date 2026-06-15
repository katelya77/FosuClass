const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");

const secret = "unit-test-runtime-key-not-real";
const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "fosu-ai-provider-"));
const configPath = path.join(tempRoot, "secure", "ai-provider-config.json");

process.env.FOSU_AI_PROVIDER_CONFIG_PATH = configPath;
process.env.AI_PROVIDER_IGNORE_ENV_FILE = "true";
delete process.env.FOSU_AI_CONFIG_ENCRYPTION_KEY;

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
  assert.throws(() => providerConfigService.saveConfig({
    provider: "deepseek",
    apiKey: secret,
  }), /FOSU_AI_CONFIG_ENCRYPTION_KEY/, "saving a provider key without master key should fail closed");
  assert.strictEqual(providerConfigService.getStatus().encryptionConfigured, false);

  process.env.FOSU_AI_CONFIG_ENCRYPTION_KEY = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
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
  assert.strictEqual(saved.encryptionConfigured, true);
  assert.strictEqual(saved.encryptionReady, true);
  assert(!JSON.stringify(saved).includes(secret), "getStatus must not expose the API key");
  assert(fs.existsSync(configPath), "runtime config file should exist");
  const rawSaved = fs.readFileSync(configPath, "utf8");
  assert(rawSaved.includes("enc:v1:"), "runtime config should store encrypted API key");
  assert(!rawSaved.includes(secret), "runtime config should not store plaintext API key");

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

  const plaintextSecret = "legacy-plaintext-secret";
  fs.writeFileSync(configPath, `${JSON.stringify({ AI_PROVIDER: "deepseek", AI_API_KEY: plaintextSecret }, null, 2)}\n`, "utf8");
  const migrated = runtimeStore.readRuntimeConfig();
  assert.strictEqual(migrated.AI_API_KEY, plaintextSecret);
  const migratedRaw = fs.readFileSync(configPath, "utf8");
  assert(migratedRaw.includes("enc:v1:"), "plaintext config should be migrated to encrypted storage");
  assert(!migratedRaw.includes(plaintextSecret), "migrated config should not contain plaintext secret");
  assert(fs.readdirSync(path.dirname(configPath)).some((name) => name.includes("plaintext-backup")), "migration should leave a protected backup");

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
