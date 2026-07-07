const assert = require("assert");
const fs = require("fs");
const path = require("path");

global.wx = {
  getStorageSync() { return ""; },
  setStorageSync() {},
  removeStorageSync() {},
  showToast() {},
};
global.getCurrentPages = () => [];
global.getApp = () => ({ globalData: {} });
global.Page = (config) => {
  global.__AI_ASSISTANT_PAGE__ = config;
};

const ROOT = path.resolve(__dirname, "..");
const pageModule = require("../miniprogram/pages/ai-assistant/ai-assistant.js");

function read(file) {
  return fs.readFileSync(path.join(ROOT, file), "utf8");
}

function assertNoBadText(value) {
  const text = JSON.stringify(value);
  assert(!text.includes("[object Object]"), "render payload must not contain [object Object]");
  assert(!text.includes("undefined"), "render payload must not contain undefined");
  assert(!text.includes("NaN"), "render payload must not contain NaN");
}

function run() {
  const js = read("miniprogram/pages/ai-assistant/ai-assistant.js");
  const wxml = read("miniprogram/pages/ai-assistant/ai-assistant.wxml");
  assert(!/String\s*\(\s*action\.label/.test(js), "action.label must not be directly String() converted");
  assert(!/String\s*\(\s*source\.label/.test(js), "source.label must not be directly String() converted");
  assert(wxml.includes("{{action.label}}"), "WXML should render normalized action label only");

  const messages = pageModule.normalizeMessagesForDisplay([{
    id: "m1",
    role: "assistant",
    content: { text: "对象回答" },
    cards: [
      {
        type: "reminder",
        title: { foo: "bad" },
        subtitle: { value: "对象副标题" },
        items: [{ title: { text: "候选" }, subtitle: { foo: "bad" }, value: ["bad"] }],
        actions: [
          { label: { foo: "bad" }, type: "navigate", url: "/pages/empty-room/empty-room" },
          { label: { text: "继续追问" }, type: "ask", payload: { message: "继续查空教室" } },
          { label: { text: "旧快捷动作" }, type: "copy", payload: { text: "ok" } },
        ],
      },
      {},
    ],
    suggestions: [{ text: "对象建议" }, {}],
    safety: { provider: "mock", externalProviderUsed: false },
  }], {});

  assert.strictEqual(messages[0].displayCards.length, 1, "empty malformed card should be hidden");
  const card = messages[0].displayCards[0];
  assert.strictEqual(card.title, "时间推荐");
  assert.strictEqual(card.subtitle, "对象副标题");
  assert.strictEqual(card.primaryActions[0].label, "查看详情");
  assert.strictEqual(card.secondaryActions[0].label, "继续追问");
  assert(!card.actions.some((action) => action.type === "copy"), "copy actions should be filtered");
  assert.deepStrictEqual(messages[0].suggestions, ["对象建议"]);
  assertNoBadText(messages);

  console.log("test-ai-no-object-object-render passed");
}

run();
