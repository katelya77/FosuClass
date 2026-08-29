#!/usr/bin/env node
"use strict";

const assert = require("assert");

const storage = {};
global.wx = {
  getStorageSync(key) { return Object.prototype.hasOwnProperty.call(storage, key) ? storage[key] : ""; },
  setStorageSync(key, value) { storage[key] = value; },
  removeStorageSync(key) { delete storage[key]; },
  getSystemInfoSync() { return { platform: "devtools" }; },
  getAccountInfoSync() { return { miniProgram: { envVersion: "release" } }; },
  showLoading() {}, hideLoading() {}, showToast() {}, showModal() {},
};
global.getCurrentPages = () => [];
global.getApp = () => ({ globalData: { activeRelease: {}, appConfig: { availableTerms: [] } } });

const router = require("../miniprogram/services/xiaofuAgentRouter");
const assistant = require("../miniprogram/services/aiAssistantService");

const context = {
  envVersion: "release",
  contextSlots: {},
  conversation: { conversationId: "legacy-brand-test", contextSlots: {} },
};

function assertNewBrandOnly(response, label, requireName = false) {
  const visible = JSON.stringify({ answer: response.answer, cards: response.cards, suggestions: response.suggestions });
  assert(!visible.includes("小佛助手"), `${label} 不得回显旧称小佛助手`);
  assert(!visible.includes("小佛AI"), `${label} 不得回显旧称小佛AI`);
  assert(!visible.includes("小序助手"), `${label} 新展示应优先使用小序`);
  if (requireName) assert(visible.includes("小序"), `${label} 应显示小序`);
}

async function run() {
  const routeCases = [
    ["小佛助手浮窗怎么开", router.INTENTS.HELP],
    ["打开小佛浮窗", router.INTENTS.HELP],
    ["小佛可以做什么", router.INTENTS.HELP],
    ["你是小佛吗", router.INTENTS.SMALLTALK],
  ];
  for (const [message, intent] of routeCases) {
    assert.strictEqual(router.routeMessage(message, context).intent, intent, `${message} 应保持兼容意图`);
  }
  assert.strictEqual(assistant.isStructuredLocalHelp("小佛助手浮窗怎么开"), true);
  assert.strictEqual(assistant.isStructuredLocalHelp("打开小佛浮窗"), true);

  const oldFloat = await assistant.offlineChat("小佛助手浮窗怎么开", context);
  const newFloat = await assistant.offlineChat("小序浮窗怎么开", context);
  assert.strictEqual(oldFloat.cards[0].type, newFloat.cards[0].type);
  assert.strictEqual(oldFloat.cards[0].title, "小序浮窗");
  assert.strictEqual(newFloat.cards[0].title, "小序浮窗");
  assertNewBrandOnly(oldFloat, "旧浮窗口令", true);
  assertNewBrandOnly(newFloat, "新浮窗口令", true);

  const oldHelp = await assistant.offlineChat("小佛可以做什么", context);
  const newHelp = await assistant.offlineChat("小序可以做什么", context);
  assert.strictEqual(oldHelp.cards[0].type, newHelp.cards[0].type);
  assert.strictEqual(oldHelp.cards[0].title, newHelp.cards[0].title);
  assertNewBrandOnly(oldHelp, "旧能力口令");

  const identity = await assistant.offlineChat("你是小佛吗", context);
  assert.strictEqual(identity.metrics.intentName, "smalltalk");
  assertNewBrandOnly(identity, "旧身份口令", true);
  console.log("assistant legacy input compatibility passed: 4/4 routes, old input accepted, new UI brand only");
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
