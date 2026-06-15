const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");

const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "fosu-ai-cloudbase-"));
const configPath = path.join(tempRoot, "secure", "ai-provider-config.json");
const secret = "cloudbase-openai-secret-1234";

[
  "AI_RUNTIME_MODE",
  "AI_AGENT_ENABLED",
  "AI_PROVIDER",
  "CLOUDBASE_OPENAI_ENABLED",
  "CLOUDBASE_OPENAI_API_KEY",
  "FOSU_AI_PROVIDER_CONFIG_PATH",
  "FOSU_AI_CONFIG_ENCRYPTION_KEY",
].forEach((key) => delete process.env[key]);

function reload(modulePath) {
  const resolved = require.resolve(modulePath);
  delete require.cache[resolved];
  return require(modulePath);
}

process.env.AI_RUNTIME_MODE = "public";
process.env.AI_AGENT_ENABLED = "true";
process.env.AI_PROVIDER = "deepseek";
let providerFactory = reload("../server/src/services/ai/providerFactory");
assert.strictEqual(providerFactory.getProviderName(), "mock", "public runtime must force mock provider");

process.env.AI_RUNTIME_MODE = "competition";
process.env.AI_AGENT_ENABLED = "true";
process.env.AI_PROVIDER = "cloudbase-openai";
process.env.CLOUDBASE_OPENAI_ENABLED = "true";
process.env.CLOUDBASE_OPENAI_API_KEY = secret;
providerFactory = reload("../server/src/services/ai/providerFactory");
assert.strictEqual(providerFactory.getProviderName(), "cloudbase-openai", "competition runtime should allow CloudBase OpenAI");
assert.strictEqual(providerFactory.createProvider().name, "cloudbase-openai");

process.env.FOSU_AI_PROVIDER_CONFIG_PATH = configPath;
process.env.FOSU_AI_CONFIG_ENCRYPTION_KEY = "unit-test-master-key";
delete process.env.CLOUDBASE_OPENAI_API_KEY;
const runtimeStore = reload("../server/src/services/ai/providerRuntimeConfigStore");
runtimeStore.writeRuntimeConfig({
  CLOUDBASE_OPENAI_API_KEY: secret,
  CLOUDBASE_OPENAI_ENABLED: "true",
});
const rawFile = fs.readFileSync(configPath, "utf8");
assert(!rawFile.includes(secret), "runtime config file must not contain plaintext CloudBase key when encryption key is set");
assert(rawFile.includes("enc:v1:"), "runtime config should store encrypted secret envelope");
const loaded = runtimeStore.readRuntimeConfig(configPath);
assert.strictEqual(loaded.CLOUDBASE_OPENAI_API_KEY, secret, "encrypted CloudBase key should decrypt");

const providerConfigService = reload("../server/src/services/ai/providerConfigService");
const status = providerConfigService.getStatus();
assert.strictEqual(status.cloudbaseOpenaiKeyConfigured, true);
assert.strictEqual(status.cloudbaseOpenaiKeyLast4, "1234");
assert(!JSON.stringify(status).includes(secret), "provider status must not expose full CloudBase key");
assert.strictEqual(status.encryptionConfigured, true);

console.log("test-ai-runtime-modes-and-cloudbase passed");
