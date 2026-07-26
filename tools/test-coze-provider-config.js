const assert = require("assert");

delete process.env.COZE_API_KEY;
delete process.env.COZE_BOT_ID;
process.env.AI_AGENT_ENABLED = "true";
process.env.AI_PROVIDER = "coze";
process.env.AI_PROVIDER_POLICY = "always";

const cozeProvider = require("../server/src/services/ai/providers/cozeProvider");
const agentService = require("../server/src/services/ai/agentService");

function assertPublicProviderHidden(response) {
  assert.strictEqual(response.runtimeMode, "public");
  assert(!("provider" in response.safety), "public safety must hide provider");
  assert.strictEqual(response.safety.externalProviderUsed, false, "public safety must explicitly disable external provider use");
  assert.strictEqual(response.metrics.externalProviderUsed, false, "public metrics must explicitly disable external provider use");
}

async function run() {
  await assert.rejects(
    () => cozeProvider.generate({
      message: "hello",
      toolResults: [],
      // Explicit request scope keeps this unit test isolated from a developer's
      // local runtime/.env Provider credentials and prevents accidental live calls.
      providerRuntimeConfig: {
        COZE_API_TOKEN: "",
        COZE_API_KEY: "",
        COZE_BOT_ID: "",
        COZE_AGENT_ID: "",
        COZE_WORKLOAD_ENDPOINT: "",
        COZE_AGENT_BASE_URL: "",
      },
    }),
    (error) => error && error.code === "NOT_CONFIGURED"
  );

  const localGuide = await agentService.chat({
    message: "怎么导入个人课表？",
    context: { timezone: "Asia/Shanghai" },
  });
  assert.strictEqual(localGuide.success, true);
  assert.notStrictEqual(localGuide.safety.provider, "coze");
  assertPublicProviderHidden(localGuide);
  assert(!localGuide.toolCalls.some((item) => item.status === "skipped"), "import guide should stay on local template");

  const fallback = await agentService.chat({
    message: "现在有空教室吗？",
    context: { timezone: "Asia/Shanghai" },
  });
  assert.strictEqual(fallback.success, true);
  assert.notStrictEqual(fallback.safety.provider, "coze");
  assertPublicProviderHidden(fallback);
  assert(fallback.toolCalls.length >= 1, "fact task should still report deterministic tool work");

  console.log("test-coze-provider-config passed");
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
