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

const { normalizeMessagesForDisplay } = require("../miniprogram/pages/ai-assistant/ai-assistant.js");

function firstCard(rawCard, content) {
  const messages = normalizeMessagesForDisplay([{
    id: "m-default-actions",
    role: "assistant",
    content: content || "这是一段助手回答",
    cards: [rawCard],
  }], {});
  return messages[0].displayCards[0];
}

function labels(card) {
  return (card.actions || []).map((action) => action.label);
}

function run() {
  assert.deepStrictEqual(labels(firstCard({ type: "import_guide", title: "导入个人课表" })), [
    "打开个人课表同步",
    "查看 XLS 文件导入",
    "复制导入说明",
    "继续问今天课程",
  ], "import guide should get sync, xls, copy and follow-up actions");

  const nav = firstCard({
    type: "navigation",
    title: "图书馆入口",
    sourceUrl: "https://www.fosu.edu.cn/library/",
  });
  assert(labels(nav).includes("复制入口"), "external navigation should copy entry");
  assert(labels(nav).includes("继续追问"), "navigation should include follow-up");

  const knowledge = firstCard({
    type: "school_knowledge",
    title: "佛山大学校区",
    sourceUrl: "https://www.fosu.edu.cn/school-overview",
  }, "仙溪、江湾、河滨等校区。");
  assert(labels(knowledge).includes("复制回答"), "knowledge card should copy answer");
  assert(labels(knowledge).includes("复制来源"), "knowledge card should copy source");

  const schedule = firstCard({
    type: "schedule_result",
    title: "班级课表",
    items: [{ title: "周一 第1-2节 高等数学", subtitle: "C7-101", value: "08:30-10:05" }],
  });
  assert(labels(schedule).includes("查看完整课表"), "schedule card should open full schedule");
  assert(labels(schedule).includes("复制课表摘要"), "schedule card should copy summary");

  const weather = firstCard({
    type: "weather_card",
    title: "仙溪校区天气",
    weather: { advice: "建议带伞。", weatherText: "多云" },
  });
  assert(labels(weather).includes("复制天气建议"), "weather card should copy advice");
  assert(labels(weather).includes("重新获取天气"), "weather card should retry weather");

  const clarification = firstCard({ type: "clarification", title: "需要补充教师" });
  assert(labels(clarification).includes("补充老师姓名"), "clarification should provide chips");
  assert(labels(clarification).includes("补充教室"), "clarification should provide classroom chip");

  const unreliable = firstCard({
    type: "school_knowledge",
    variant: "error",
    title: "知识库暂未收录可靠信息",
  });
  assert.strictEqual(unreliable.actions.length, 0, "unreliable knowledge should not add default actions");

  console.log("test-ai-card-default-actions passed");
}

run();
