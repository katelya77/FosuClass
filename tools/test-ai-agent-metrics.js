const assert = require("assert");

process.env.AI_AGENT_ENABLED = "false";

const agentService = require("../server/src/services/ai/agentService");

async function run() {
  const message = "帮我查 C7-203 教室";
  const response = await agentService.chat({
    message,
    context: {
      term: "2025-2026-2",
      clientLocalTime: "2026-06-08T18:20:00+08:00",
    },
  });
  assert.strictEqual(response.success, true);
  assert(response.metrics && typeof response.metrics === "object", "metrics should exist");
  assert.strictEqual(typeof response.metrics.latencyMs, "number", "latencyMs should be number");
  assert.strictEqual(typeof response.metrics.intentName, "string", "intentName should be string");
  assert.strictEqual(typeof response.metrics.toolCallCount, "number", "toolCallCount should be number");
  assert.strictEqual(typeof response.metrics.externalProviderUsed, "boolean", "externalProviderUsed should be boolean");
  if (response.runtimeMode === "public") {
    assert.strictEqual(response.metrics.externalProviderUsed, false, "public metrics must explicitly disable external provider use");
  }
  assert.strictEqual(typeof response.metrics.fallback, "boolean", "fallback should be boolean");
  assert.strictEqual(typeof response.metrics.itemCount, "number", "itemCount should be number");
  assert.strictEqual(typeof response.metrics.usedPersonalContext, "boolean", "usedPersonalContext should be boolean");

  const metricsText = JSON.stringify(response.metrics);
  assert(!metricsText.includes(message), "metrics must not contain original message");
  assert(!/(key|token|password)/i.test(metricsText), "metrics must not contain sensitive key names");

  console.log("test-ai-agent-metrics passed");
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
