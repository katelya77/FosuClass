const assert = require("assert");
const fs = require("fs");
const path = require("path");

global.wx = {
  getStorageSync() { return ""; },
  setStorageSync() {},
  removeStorageSync() {},
};
global.getCurrentPages = () => [];
global.getApp = () => ({ globalData: {} });
global.Page = (config) => {
  global.__AI_ASSISTANT_PAGE__ = config;
};

const ROOT = path.resolve(__dirname, "..");
const { normalizeCard } = require("../miniprogram/pages/ai-assistant/ai-assistant.js");

function read(file) {
  return fs.readFileSync(path.join(ROOT, file), "utf8");
}

function run() {
  const wxml = read("miniprogram/pages/ai-assistant/ai-assistant.wxml");
  const js = read("miniprogram/pages/ai-assistant/ai-assistant.js");

  const card = normalizeCard({
    type: "schedule",
    title: "今日课程",
    items: [
      { title: "本周课程", value: "第1-2节", active: true },
      { title: "非本周课程", value: "第3-4节", active: false },
    ],
  }, "m1", 0, {});
  assert.strictEqual(card.filteredHint, "已过滤 1 门非本周课程");
  assert(!card.visibleItems.some((item) => item.title === "非本周课程"), "inactive course should not render");

  assert(js.includes("服务暂时不可用，已保留你的问题。"), "error card title should use the polished copy");
  assert(js.includes("可以重试，或先使用全校查询/空教室页面。"), "error card subtitle should suggest safe next steps");
  assert(wxml.includes("card-disclaimer"), "result cards should render the disclaimer");
  assert(wxml.includes("card-action-primary"), "primary card action class should be explicit");
  assert(wxml.includes("card-action-secondary"), "secondary card action class should be explicit");

  console.log("test-ai-card-polish-contract passed");
}

run();
