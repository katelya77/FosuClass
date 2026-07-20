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

require("../miniprogram/packageXiaofu/pages/ai-assistant/ai-assistant.js");

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
  page.onQuickAction(tap("class"));
  page.onQuickAction(tap("room"));
  page.onQuickAction(tap("weather"));
  page.onQuickAction(tap("xls"));
  assert.deepStrictEqual(sent, ["今天有什么课", "查班级本周课表", "查教室明天是否有课", "仙溪校区今天会下雨吗？", "如何导入个人课表"]);

  assert.strictEqual(page.data.inputValue, "");
  assert.strictEqual(navigated, "");

  page.openTaskPanel();
  assert.strictEqual(page.data.showTaskPanel, true);

  console.log("test-ai-quick-actions-behavior passed");
}

run();
