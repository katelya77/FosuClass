const assert = require("assert");

delete process.env.COZE_API_KEY;
delete process.env.COZE_BOT_ID;
process.env.AI_AGENT_ENABLED = "true";
process.env.AI_PROVIDER = "coze";
process.env.AI_PROVIDER_POLICY = "always";

const cozeProvider = require("../server/src/services/ai/providers/cozeProvider");
const agentService = require("../server/src/services/ai/agentService");

async function run() {
  await assert.rejects(
    () => cozeProvider.generate({ message: "hello", toolResults: [] }),
    (error) => error && error.code === "NOT_CONFIGURED"
  );

  const localGuide = await agentService.chat({
    message: "怎么导入个人课表？",
    context: { timezone: "Asia/Shanghai" },
  });
  assert.strictEqual(localGuide.success, true);
  assert.strictEqual(localGuide.safety.provider, "mock");
  assert.strictEqual(localGuide.safety.externalProviderUsed, false);
  assert(!localGuide.toolCalls.some((item) => item.status === "skipped"), "import guide should stay on local template");

  const fallback = await agentService.chat({
    message: "现在有空教室吗？",
    context: { timezone: "Asia/Shanghai" },
  });
  assert.strictEqual(fallback.success, true);
  assert.strictEqual(fallback.safety.provider, "mock");
  assert(fallback.toolCalls.some((item) => item.status === "skipped"), "fallback tool call should be reported for non-template tasks");

  console.log("test-coze-provider-config passed");
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
