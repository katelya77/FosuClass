const assert = require("assert");

process.env.AI_AGENT_ENABLED = "false";
process.env.AI_PROVIDER_POLICY = "auto";

const agentService = require("../server/src/services/ai/agentService");

const context = {
  term: "2025-2026-2",
  timezone: "Asia/Shanghai",
  clientLocalTime: "2026-06-08T18:20:00+08:00",
};

async function assertClarifies(message) {
  const response = await agentService.chat({ message, context });
  assert.strictEqual(response.success, true);
  const names = response.toolCalls.map((item) => item.name);
  assert(names.includes("clarify_missing_slot"), `${message} should clarify, got ${names.join(",")}`);
  assert(!names.includes("search_school_index"), `${message} should not search index before required slot`);
  assert.deepStrictEqual(response.cards, [], `${message} should not return duplicate guide card`);
  assert(response.safety.pendingClarification || /XLS|课表摘要/.test(response.answer), `${message} should return pending slot or schedule-context guidance`);
  assert(/哪位|哪间|哪门|哪个|课表摘要|关键词/.test(response.answer), `${message} should ask a follow-up question`);
  assert.strictEqual(response.safety.externalProviderUsed, false);
}

async function run() {
  await assertClarifies("帮我查老师课表");
  await assertClarifies("查教室占用");
  await assertClarifies("查课程安排");
  await assertClarifies("查班级课表");
  console.log("test-ai-clarify-missing-slot passed");
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
