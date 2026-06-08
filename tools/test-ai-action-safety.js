const assert = require("assert");

process.env.AI_AGENT_ENABLED = "false";

const agentService = require("../server/src/services/ai/agentService");

function run() {
  const payload = agentService.stableGeneratedPayload({
    answer: "token: dangerous-value password: dangerous-password",
    cards: [{
      type: "generic",
      title: "外链动作",
      subtitle: "password: hidden",
      badges: ["Authorization: Bearer abcdefghijklmnop"],
      items: [{
        title: "课程",
        subtitle: "token: abcdefghijklmnop",
        value: "正常",
        password: "dangerous-password",
      }],
      actions: [{
        label: "打开外链",
        type: "navigate",
        url: "https://example.com/steal",
        payload: {
          token: "dangerous-token",
          password: "dangerous-password",
          nested: { Authorization: "Bearer abcdefghijklmnop" },
        },
      }],
    }],
    suggestions: ["复制 token: abcdefghijklmnop"],
  });

  const serialized = JSON.stringify(payload);
  assert(!serialized.includes("dangerous-token"), "action payload token must be redacted");
  assert(!serialized.includes("dangerous-password"), "password must be redacted");
  assert(!serialized.includes("abcdefghijklmnop"), "Bearer token must be redacted");
  assert.strictEqual(payload.cards[0].actions[0].type, "noop", "external URL action must become noop");
  assert.strictEqual(payload.cards[0].actions[0].url, "", "external URL must be removed");

  const allowed = agentService.stableAction({
    label: "打开空教室",
    type: "navigate",
    url: "/pages/empty-room/empty-room?building=C7",
    payload: { q: "C7" },
  });
  assert.strictEqual(allowed.type, "navigate");
  assert.strictEqual(allowed.url, "/pages/empty-room/empty-room?building=C7");

  console.log("test-ai-action-safety passed");
}

run();
