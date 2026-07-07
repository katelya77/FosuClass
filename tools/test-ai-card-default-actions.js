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

function assertNoCopy(card, message) {
  assert(!(card.actions || []).some((action) => action.type === "copy"), `${message} should not expose copy action type`);
  assert(!labels(card).some((label) => /^复制/.test(label)), `${message} should not expose copy labels`);
}

function run() {
  assert.deepStrictEqual(labels(firstCard({ type: "import_guide", title: "导入个人课表" })), [
    "打开个人课表同步",
    "查看 XLS 文件导入",
    "继续问今天课程",
  ], "import guide should get sync, xls and follow-up actions");

  const nav = firstCard({
    type: "navigation",
    title: "图书馆入口",
    sourceUrl: "https://www.fosu.edu.cn/library/",
  });
  assert(labels(nav).includes("打开入口"), "external navigation should keep an open entry action");
  assert(labels(nav).includes("继续追问"), "navigation should include follow-up");
  assertNoCopy(nav, "navigation card");

  const knowledge = firstCard({
    type: "school_knowledge",
    title: "佛山大学校区",
    sourceUrl: "https://www.fosu.edu.cn/school-overview",
  }, "仙溪、江湾、河滨等校区。");
  assert(labels(knowledge).includes("继续追问"), "knowledge card should keep follow-up");
  assertNoCopy(knowledge, "knowledge card");

  const schedule = firstCard({
    type: "schedule_result",
    title: "班级课表",
    items: [{ title: "周一 第1-2节 高等数学", subtitle: "C7-101", value: "08:30-10:05" }],
  });
  assert(labels(schedule).includes("查看完整课表"), "schedule card should open full schedule");
  assert(labels(schedule).includes("继续查本周"), "schedule card should keep week follow-up");
  assertNoCopy(schedule, "schedule card");

  const weather = firstCard({
    type: "weather_card",
    title: "仙溪校区天气",
    weather: { advice: "建议带伞。", weatherText: "多云" },
  });
  assert(labels(weather).includes("重新获取天气"), "weather card should retry weather");
  assert(labels(weather).includes("继续问带伞"), "weather card should keep weather follow-up");
  assertNoCopy(weather, "weather card");

  const status = firstCard({ type: "schedule_status", title: "课表数据状态" });
  assert.deepStrictEqual(labels(status), ["查看全校课表"], "schedule status should only keep the primary navigation action");
  assertNoCopy(status, "schedule status card");

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
