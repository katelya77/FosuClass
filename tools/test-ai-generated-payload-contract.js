const assert = require("assert");

const contract = require("../server/src/services/ai/generatedPayloadContract");

function assertNoBadText(payload) {
  const text = JSON.stringify(payload);
  assert(!text.includes("[object Object]"), "payload must not contain [object Object]");
  assert(!text.includes("undefined"), "payload must not contain undefined");
  assert(!text.includes("null"), "payload must not contain null text");
  assert(!text.includes("NaN"), "payload must not contain NaN");
}

function run() {
  const payload = contract.stableGeneratedPayload({
    answer: { text: "测试" },
    cards: [{
      type: "empty_room",
      title: { value: "错误标题" },
      subtitle: { text: "对象副标题" },
      badges: ["有效", { value: "对象徽标" }, {}, null, undefined, NaN],
      items: [{
        title: { title: "对象项目" },
        subtitle: true,
        value: ["数组不允许"],
      }],
      actions: [
        {
          label: {},
          type: "navigate",
          url: "/pages/empty-room/empty-room?building=C7",
          payload: { ok: true },
        },
        {
          label: { text: "外链" },
          type: "navigate",
          url: "https://example.com/unsafe",
        },
      ],
    }],
    suggestions: [{ text: "对象建议" }, {}, null, undefined, NaN],
  });

  assert.strictEqual(payload.answer, "测试");
  assert.strictEqual(payload.cards[0].title, "错误标题");
  assert.deepStrictEqual(payload.cards[0].badges, ["有效", "对象徽标"]);
  assert.strictEqual(payload.cards[0].items[0].title, "对象项目");
  assert.strictEqual(payload.cards[0].items[0].subtitle, "true");
  assert.strictEqual(payload.cards[0].items[0].value, "");
  assert.strictEqual(payload.cards[0].actions[0].label, "查看详情");
  assert.strictEqual(payload.cards[0].actions[0].type, "navigate");
  assert.strictEqual(payload.cards[0].actions[0].url, "/pages/empty-room/empty-room?building=C7");
  assert.strictEqual(payload.cards[0].actions[1].label, "外链");
  assert.strictEqual(payload.cards[0].actions[1].type, "noop");
  assert.strictEqual(payload.cards[0].actions[1].url, "");
  assert.deepStrictEqual(payload.suggestions, ["对象建议"]);
  assertNoBadText(payload);

  const removedCopy = contract.stableAction({ type: "copy", label: Symbol("bad") });
  assert.strictEqual(removedCopy.type, "noop");
  assert.strictEqual(removedCopy.label, "查看");

  console.log("test-ai-generated-payload-contract passed");
}

run();
