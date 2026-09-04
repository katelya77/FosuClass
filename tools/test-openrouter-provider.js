#!/usr/bin/env node
const assert = require("assert");
const axios = require("../server/node_modules/axios");
const fs = require("fs");
const os = require("os");
const path = require("path");

const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "fosu-openrouter-provider-"));
process.env.FOSU_AI_PROVIDER_CONFIG_PATH = path.join(tempRoot, "secure", "provider.json");
process.env.FOSU_AI_CONFIG_ENCRYPTION_KEY = "ab".repeat(32);

delete process.env.OPENROUTER_API_KEY;
delete process.env.OPENROUTER_ENABLED;
process.env.AI_PROVIDER_IGNORE_ENV_FILE = "true";

const openrouterProvider = require("../server/src/services/ai/providers/openrouterProvider");
const providerChainService = require("../server/src/services/ai/providerChainService");
const providerConfigService = require("../server/src/services/ai/providerConfigService");
const providerFactory = require("../server/src/services/ai/providerFactory");

async function run() {
  await assert.rejects(
    () => openrouterProvider.generateStructured({ messages: [] }),
    (error) => error && error.code === "NOT_CONFIGURED"
  );

  const originalPost = axios.post;
  let captured = null;
  axios.post = async (url, body, options) => {
    captured = { url, body, options };
    return {
      data: {
        model: "unit/free-model",
        choices: [{ message: { content: '{"intent":"query_today_schedule","confidence":0.9,"slots":{}}' } }],
        usage: { prompt_tokens: 1, completion_tokens: 1 },
      },
    };
  };
  try {
    const runtime = {
      OPENROUTER_ENABLED: "true",
      OPENROUTER_API_KEY: "unit-test-key-not-real",
      OPENROUTER_BASE_URL: "https://openrouter.ai/api/v1",
      OPENROUTER_MODELS: "unit/model-a:free,unit/model-b:free,openrouter/free",
      OPENROUTER_TIMEOUT_MS: "4321",
    };
    const result = await openrouterProvider.generateStructured({
      providerRuntimeConfig: runtime,
      messages: [{ role: "user", content: "今天有什么课" }],
    });
    assert.strictEqual(result.provider, "openrouter");
    assert.strictEqual(result.resolvedModel, "unit/free-model");
    assert(captured.url.endsWith("/chat/completions"));
    assert.deepStrictEqual(captured.body.models, ["unit/model-a:free", "unit/model-b:free", "openrouter/free"]);
    assert.strictEqual(Object.prototype.hasOwnProperty.call(captured.body, "model"), false);
    assert.deepStrictEqual(captured.body.response_format, { type: "json_object" });
    assert.strictEqual(captured.body.provider.allow_fallbacks, true);
    assert.strictEqual(captured.body.provider.require_parameters, true);
    assert.strictEqual(captured.body.provider.data_collection, "deny");
    assert.strictEqual(captured.options.timeout, 4321);
    assert.strictEqual(captured.options.headers["X-OpenRouter-Title"], "FosuClass Xiaoxu");

    assert.deepStrictEqual(providerChainService.getProviderChain("public", Object.assign({ AI_PROVIDER: "openrouter" }, runtime)), ["mock"]);
    assert.deepStrictEqual(
      providerChainService.getProviderChain("competition", Object.assign({ AI_PROVIDER_CHAIN: "openrouter,deepseek,mock", AI_DISABLED_PROVIDERS: "openrouter" }, runtime)),
      ["deepseek", "mock"]
    );
    assert.strictEqual(
      providerFactory.getProviderName("competition", Object.assign({
        AI_AGENT_ENABLED: "true",
        AI_PROVIDER: "openrouter",
        AI_DISABLED_PROVIDERS: "openrouter,cloudbase-openai,deepseek,coze",
      }, runtime)),
      "mock",
      "removed built-ins must also be unavailable through the legacy provider factory"
    );

    providerConfigService.saveConfig({
      environment: "trial",
      activeEnvironment: "trial",
      enabled: true,
      provider: "openrouter",
      providerPolicy: "auto",
      openrouterEnabled: true,
      openrouterApiKey: "unit-test-key-not-real",
      openrouterModels: "unit/model-a:free,openrouter/free",
    });
    const removed = providerConfigService.removeBuiltinProvider({ provider: "openrouter" });
    assert(removed.disabledProviders.includes("openrouter"));
    assert.notStrictEqual(removed.environmentProfiles.trial.provider, "openrouter");
    assert.strictEqual(removed.environmentProfiles.public.provider, "mock");
    assert.strictEqual(removed.environmentProfiles.public.enabled, false);
    assert.strictEqual(providerConfigService.getRuntimeConfigForEnvironment("trial").OPENROUTER_API_KEY, "unit-test-key-not-real", "remove keeps encrypted credential available for restore");
    const restored = providerConfigService.restoreBuiltinProvider({ provider: "openrouter" });
    assert(!restored.disabledProviders.includes("openrouter"));
    assert.throws(() => providerConfigService.removeBuiltinProvider({ provider: "mock" }), (error) => error && error.code === "BUILTIN_PROVIDER_INVALID");
  } finally {
    axios.post = originalPost;
    delete process.env.AI_PROVIDER_IGNORE_ENV_FILE;
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
  console.log("test-openrouter-provider passed");
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
