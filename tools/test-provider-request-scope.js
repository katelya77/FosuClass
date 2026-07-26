#!/usr/bin/env node
const assert = require("assert");

const previousChain = process.env.AI_PROVIDER_CHAIN;
const previousProvider = process.env.AI_PROVIDER;
process.env.AI_PROVIDER_CHAIN = "coze,cloudbase-openai,mock";
process.env.AI_PROVIDER = "coze";

const providerChainService = require("../server/src/services/ai/providerChainService");
const providerConfigService = require("../server/src/services/ai/providerConfigService");

function restore() {
  if (previousChain === undefined) delete process.env.AI_PROVIDER_CHAIN;
  else process.env.AI_PROVIDER_CHAIN = previousChain;
  if (previousProvider === undefined) delete process.env.AI_PROVIDER;
  else process.env.AI_PROVIDER = previousProvider;
}

function run() {
  try {
    assert.deepStrictEqual(
      providerChainService.getProviderChain("trial", { AI_PROVIDER: "deepseek" }),
      ["deepseek", "mock"],
      "request AI_PROVIDER must override process AI_PROVIDER_CHAIN"
    );
    assert.deepStrictEqual(
      providerChainService.getProviderChain("dev", {
        AI_PROVIDER_CHAIN: "",
        AI_PROVIDER: "deepseek",
      }),
      ["deepseek", "mock"],
      "an explicit empty request chain must not resurrect the process chain"
    );
    assert.deepStrictEqual(
      providerChainService.getProviderChain("trial", {
        AI_PROVIDER_CHAIN: "deepseek,mock",
        AI_PROVIDER: "coze",
      }),
      ["deepseek", "mock"],
      "request chain has priority over request provider"
    );
    assert.strictEqual(providerChainService.normalizeProviderName("hunyuan3"), "cloudbase-openai");
    assert.deepStrictEqual(
      providerChainService.getProviderChain("trial", { AI_PROVIDER: "hunyuan3" }),
      ["cloudbase-openai", "mock"]
    );
    const hunyuanProfile = providerConfigService.buildUpdates({
      environment: "trial",
      enabled: true,
      provider: "hunyuan3",
    });
    assert.strictEqual(hunyuanProfile.AI_PROVIDER, "cloudbase-openai", "admin profile must preserve Hunyuan3 as the canonical CloudBase provider");
    assert.ok(hunyuanProfile.AI_PROVIDER_CHAIN.includes("hunyuan3"), "trial profile must expose Hunyuan3 in the fallback chain");
    assert.deepStrictEqual(
      providerChainService.getProviderChain("public", {
        AI_PROVIDER_CHAIN: "deepseek,coze",
      }),
      ["mock"],
      "public must stay zero-provider"
    );
    assert.strictEqual(providerChainService.isProviderConfigured("coze", {
      COZE_ENABLED: "false",
      COZE_API_KEY: "test-only-placeholder",
      COZE_BOT_ID: "test-only-placeholder",
    }), false, "request-scoped COZE_ENABLED=false must override local .env");
    console.log("test-provider-request-scope: PASS");
  } finally {
    restore();
  }
}

run();
