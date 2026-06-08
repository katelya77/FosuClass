const assert = require("assert");

global.wx = {
  getStorageSync() { return ""; },
  setStorageSync() {},
  removeStorageSync() {},
  showToast() {},
  navigateTo() {},
  switchTab() {},
};
global.getCurrentPages = () => [];
global.getApp = () => ({ globalData: {} });
global.Page = (config) => {
  global.__AI_ASSISTANT_PAGE__ = config;
};

require("../miniprogram/pages/ai-assistant/ai-assistant.js");

function makePage() {
  const config = global.__AI_ASSISTANT_PAGE__;
  return Object.assign({}, config, {
    data: JSON.parse(JSON.stringify(config.data)),
    setData(patch) {
      Object.assign(this.data, patch);
    },
  });
}

function tap(actionId) {
  return { currentTarget: { dataset: { actionId } } };
}

function run() {
  const page = makePage();
  const sent = [];
  let navigated = "";
  page.sendMessage = (message) => sent.push(message);
  page.navigateByUrl = (url) => {
    navigated = url;
  };

  page.onQuickAction(tap("today"));
  page.onQuickAction(tap("emptyRoom"));
  assert.deepStrictEqual(sent, ["今天还有课吗？", "现在有空教室吗？"]);

  page.onQuickAction(tap("teacher"));
  assert.strictEqual(page.data.inputValue, "查某某老师课表");
  assert.strictEqual(page.data.inputFocus, true);

  page.onQuickAction(tap("xls"));
  assert.strictEqual(navigated, "/pages/personal-sync/personal-sync?tab=xls");

  page.openTaskPanel();
  assert.strictEqual(page.data.showTaskPanel, true);

  console.log("test-ai-quick-actions-behavior passed");
}

run();
