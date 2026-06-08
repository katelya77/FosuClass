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

  const response = await agentService.chat({
    message: "怎么导入个人课表？",
    context: { timezone: "Asia/Shanghai" },
  });
  assert.strictEqual(response.success, true);
  assert.strictEqual(response.safety.provider, "mock");
  assert(response.toolCalls.some((item) => item.status === "skipped"), "fallback tool call should be reported");

  console.log("test-coze-provider-config passed");
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
