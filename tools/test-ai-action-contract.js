const assert = require("assert");

const storage = {};
const calls = {
  switchTab: [],
  navigateTo: [],
  toasts: [],
  modals: [],
};

global.wx = {
  getStorageSync(key) { return Object.prototype.hasOwnProperty.call(storage, key) ? storage[key] : ""; },
  setStorageSync(key, value) { storage[key] = value; },
  removeStorageSync(key) { delete storage[key]; },
  setClipboardData(options) {
    storage.__clipboard = options && options.data || "";
    if (options && typeof options.success === "function") options.success();
    if (options && typeof options.complete === "function") options.complete();
  },
  showToast(options) { calls.toasts.push(options); },
  showModal(options) {
    calls.modals.push(options);
    if (options && typeof options.success === "function") options.success({ confirm: true });
  },
  switchTab(options) {
    calls.switchTab.push(options);
    if (options && typeof options.success === "function") options.success();
  },
  navigateTo(options) {
    calls.navigateTo.push(options);
    if (options && typeof options.success === "function") options.success();
  },
};
global.getCurrentPages = () => [];
global.getApp = () => ({ globalData: {} });
global.Page = (config) => {
  global.__AI_ASSISTANT_PAGE__ = config;
};

const { normalizeCard } = require("../miniprogram/packageXiaofu/pages/ai-assistant/ai-assistant.js");
const generatedPayloadContract = require("../server/src/services/ai/generatedPayloadContract");
const xiaofuFloatService = require("../miniprogram/services/xiaofuFloatService");

function makePage() {
  const config = global.__AI_ASSISTANT_PAGE__;
  return Object.assign({}, config, {
    data: JSON.parse(JSON.stringify(config.data)),
    sent: [],
    setData(patch) {
      this.data = Object.assign({}, this.data, patch || {});
    },
    sendMessage(message, options) {
      this.sent.push({ message, options });
    },
  });
}

function tap(page, messageIndex, actionIndex) {
  page.onCardAction({
    currentTarget: { dataset: { messageIndex, cardIndex: 0, actionIndex } },
  });
}

function run() {
  const normalized = normalizeCard({
    type: "help",
    title: "Action Contract",
    actions: [
      { label: "旧 bind", type: "bind", url: "/pages/personal-sync/personal-sync" },
      { label: "切到今日", type: "switchTab", url: "/pages/today/today?from=ai", toast: "已打开" },
      { label: "继续问", type: "ask", payload: { message: "今天有什么课" }, confirm: "继续追问？" },
      { label: "打开任务", type: "openSheet", payload: { sheet: "task" } },
    ],
  }, "m-action", 0, {});
  const floatCard = normalizeCard({
    type: "help",
    title: "Float Action",
    actions: [
      { label: "关闭浮窗", type: "toggleFloat", payload: { enabled: false } },
    ],
  }, "m-float", 0, {});

  assert.strictEqual(normalized.actions[0].type, "navigate", "legacy bind should normalize to navigate");
  assert.strictEqual(normalized.actions[1].type, "switchTab", "switchTab should stay canonical");
  assert.strictEqual(normalized.actions[2].type, "ask", "ask should be supported");
  assert(normalized.actions[2].confirm && normalized.actions[2].confirm.content, "confirm should be normalized");
  assert.strictEqual(normalized.actions[3].type, "openSheet", "openSheet should be supported");
  assert.strictEqual(floatCard.actions[0].type, "toggleFloat", "toggleFloat should be supported");

  const stableBind = generatedPayloadContract.stableAction({
    label: "前往设置",
    type: "bind",
    url: "/pages/personal-sync/personal-sync",
  });
  assert.strictEqual(stableBind.type, "navigate", "server contract should normalize bind to navigate");

  const page = makePage();
  page.setData({
    messages: [
      { role: "user", content: "上一个问题" },
      { role: "assistant", content: "回答", displayCards: [normalized] },
      { role: "assistant", content: "浮窗", displayCards: [floatCard] },
    ],
  });

  tap(page, 1, 0);
  assert.strictEqual(calls.navigateTo[0].url, "/pages/personal-sync/personal-sync", "navigate should call navigateTo");
  tap(page, 1, 1);
  assert.strictEqual(calls.switchTab[0].url, "/pages/today/today", "switchTab should use tab path");
  assert(storage.FOSU_AI_PENDING_TODAY_QUERY && storage.FOSU_AI_PENDING_TODAY_QUERY.from === "ai", "switchTab should store pending query");
  tap(page, 1, 2);
  assert.strictEqual(calls.modals.length, 1, "confirmed action should open modal first");
  assert.strictEqual(page.sent[0].message, "今天有什么课", "ask should send a real chat message");
  tap(page, 1, 3);
  assert.strictEqual(page.data.showTaskPanel, true, "openSheet task should open task panel");
  tap(page, 2, 0);
  assert.strictEqual(xiaofuFloatService.isEnabled(), false, "toggleFloat should update float state");

  const retryCard = normalizeCard({
    type: "generic",
    title: "Retry",
    actions: [{ label: "重试", type: "retry" }],
  }, "m-retry", 0, {});
  page.setData({
    messages: [
      { role: "user", content: "重试这个问题" },
      { role: "assistant", content: "失败", displayCards: [retryCard] },
    ],
  });
  tap(page, 1, 0);
  assert.strictEqual(page.sent[1].message, "重试这个问题", "retry should use last user message");

  console.log("test-ai-action-contract passed");
}

run();
