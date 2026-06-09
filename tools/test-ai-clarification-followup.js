const assert = require("assert");

process.env.AI_AGENT_ENABLED = "false";

const agentService = require("../server/src/services/ai/agentService");

async function run() {
  const first = await agentService.chat({
    message: "帮我查老师课表",
    context: { timezone: "Asia/Shanghai" },
  });
  assert.strictEqual(first.metrics.intentName, "clarify_missing_slot");
  assert.strictEqual(first.answer, "你想查哪位老师？直接输入姓名就可以。");
  assert.deepStrictEqual(first.cards, [], "clarification should not render duplicate guide card");
  assert(first.safety.pendingClarification, "pending slot should be returned");
  assert.strictEqual(first.safety.pendingClarification.type, "teacher");

  const followup = await agentService.chat({
    message: "张三",
    context: { timezone: "Asia/Shanghai", pendingClarification: first.safety.pendingClarification },
  });
  assert.strictEqual(followup.metrics.intentName, "search_school_index");
  assert(followup.toolCalls.some((call) => call.name === "search_school_index"));
  assert.strictEqual(followup.safety.clearPendingClarification, true);
  assert(JSON.stringify(followup).includes("张三"), "teacher name should become search query");

  const nextTask = await agentService.chat({
    message: "现在有空教室吗",
    context: { timezone: "Asia/Shanghai", pendingClarification: first.safety.pendingClarification },
  });
  assert.strictEqual(nextTask.metrics.intentName, "search_empty_rooms");
  assert.strictEqual(nextTask.safety.clearPendingClarification, true);

  const expired = Object.assign({}, first.safety.pendingClarification, { expiresAt: Date.now() - 1 });
  const expiredFollowup = await agentService.chat({
    message: "李四",
    context: { timezone: "Asia/Shanghai", pendingClarification: expired },
  });
  assert.notStrictEqual(expiredFollowup.metrics.intentName, "search_school_index", "expired pending slot must not be used");
  assert.strictEqual(expiredFollowup.safety.clearPendingClarification, true, "expired pending slot should be cleared");

  console.log("test-ai-clarification-followup passed");
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
