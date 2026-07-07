const assert = require("assert");

process.env.AI_AGENT_ENABLED = "false";

const agentService = require("../server/src/services/ai/agentService");

const ALLOWED_CARD_TYPES = new Set(["empty_room", "schedule", "teacher", "course", "diagnosis", "guide", "reminder", "generic"]);
const ALLOWED_ACTION_TYPES = new Set(["navigate", "switchTab", "retry", "ask", "openSheet", "toggleFloat", "noop"]);

async function run() {
  const response = await agentService.chat({
    message: "怎么导入个人课表？",
    context: { timezone: "Asia/Shanghai" },
  });
  assert.strictEqual(response.success, true);
  assert.strictEqual(typeof response.answer, "string");
  assert(Array.isArray(response.cards), "cards must be array");
  assert(response.cards.length > 0, "at least one card is required");
  response.cards.forEach((card) => {
    assert(ALLOWED_CARD_TYPES.has(card.type), `invalid card type: ${card.type}`);
    assert.strictEqual(typeof card.title, "string");
    assert.strictEqual(typeof card.subtitle, "string");
    assert(Array.isArray(card.badges), "badges must be array");
    assert(Array.isArray(card.items), "items must be array");
    assert(Array.isArray(card.actions), "actions must be array");
    card.actions.forEach((action) => {
      assert.strictEqual(typeof action.label, "string");
      assert(ALLOWED_ACTION_TYPES.has(action.type), `invalid action type: ${action.type}`);
      assert.strictEqual(typeof action.url, "string");
      assert(action.payload && typeof action.payload === "object" && !Array.isArray(action.payload), "payload must be object");
    });
  });
  assert(Array.isArray(response.toolCalls), "toolCalls must be array");
  assert(Array.isArray(response.suggestions), "suggestions must be array");
  assert(response.safety && response.safety.mode === "tool-grounded", "safety mode must be stable");
  assert.strictEqual(typeof response.serverTime, "string");

  console.log("test-ai-agent-card-schema passed");
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
