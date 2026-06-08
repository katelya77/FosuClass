const assert = require("assert");

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

const { normalizeCard } = require("../miniprogram/pages/ai-assistant/ai-assistant.js");

function run() {
  const card = normalizeCard({
    type: "schedule",
    title: "今日课程",
    inactiveFilteredCount: 1,
    badges: ["工具核验", "已过滤 1 门非本周课程"],
    items: [
      { title: "active-course", subtitle: "C7-101", value: "第1-2节", active: true },
      { title: "inactive-course", subtitle: "C7-102", value: "第3-4节", active: false },
      { title: "uncertain-course", subtitle: "C7-103", value: "第5-6节", uncertain: true },
    ],
  }, "test-message", 0, {});

  const visibleTitles = card.visibleItems.map((item) => item.title);
  assert(visibleTitles.includes("active-course"), "active course should render");
  assert(!visibleTitles.includes("inactive-course"), "inactive course must not render as a normal course");
  assert(!visibleTitles.includes("uncertain-course"), "uncertain week course must not render as a normal course");
  assert(/已过滤\s+\d+\s+门非本周课程/.test(card.filteredHint), "filtered hint should be available");

  console.log("test-ai-today-card-no-inactive-render passed");
}

run();
