const assert = require("assert");

process.env.AI_PROVIDER_CHAIN = "cloudbase-openai,mock";
process.env.AI_PROVIDER_CIRCUIT_FAILURES = "1";
process.env.AI_PROVIDER_CIRCUIT_COOLDOWN_MS = "60000";
process.env.CLOUDBASE_OPENAI_ENABLED = "false";

const providerChainService = require("../server/src/services/ai/providerChainService");

async function testProviderFallbackAndCircuitBreaker() {
  providerChainService.resetForTest();
  const response = await providerChainService.generateWithChain({
    intent: { name: "project_qa", slots: {} },
    message: "FosuClass",
    toolResults: [],
    context: {},
  }, { runtimeMode: "competition" });
  assert.strictEqual(response.provider, "mock");
  assert(Array.isArray(response.providerChain));
  assert(response.providerChain.some((item) => item.provider === "cloudbase-openai" && item.reason === "not_configured"));

  const status = providerChainService.getStatus("competition");
  const cloudbase = status.find((item) => item.name === "cloudbase-openai");
  assert(cloudbase);
  assert.strictEqual(cloudbase.enabled, false);
  assert.strictEqual(cloudbase.fallbackReason, "not_configured");
  assert.strictEqual(cloudbase.circuitBreaker.state, "open");
  assert(cloudbase.fallbackCount >= 1);
}

function testFailureClassification() {
  assert.strictEqual(providerChainService.classifyFailure({ status: 400 }), "bad_request");
  assert.strictEqual(providerChainService.classifyFailure({ status: 401 }), "unauthorized");
  assert.strictEqual(providerChainService.classifyFailure({ status: 403 }), "forbidden");
  assert.strictEqual(providerChainService.classifyFailure({ status: 429 }), "rate_limited");
  assert.strictEqual(providerChainService.classifyFailure({ code: "invalid_model" }), "invalid_model");
  assert.strictEqual(providerChainService.classifyFailure({ message: "request timeout" }), "timeout");
}

testProviderFallbackAndCircuitBreaker()
  .then(() => {
    testFailureClassification();
    console.log("test-ai-provider-chain-v1 passed");
  })
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
