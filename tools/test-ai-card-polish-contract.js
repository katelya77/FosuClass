const assert = require("assert");
const fs = require("fs");
const path = require("path");

global.wx = {
  getStorageSync() { return ""; },
  setStorageSync() {},
  removeStorageSync() {},
  setClipboardData(options) {
    global.__CLIPBOARD_TEXT__ = options && options.data || "";
    if (options && typeof options.success === "function") options.success();
  },
  showToast(options) {
    global.__TOAST_TEXT__ = options && options.title || "";
  },
};
global.getCurrentPages = () => [];
global.getApp = () => ({ globalData: {} });
global.Page = (config) => {
  global.__AI_ASSISTANT_PAGE__ = config;
};

const ROOT = path.resolve(__dirname, "..");
const { normalizeCard } = require("../miniprogram/packageXiaofu/pages/ai-assistant/ai-assistant.js");

function read(file) {
  return fs.readFileSync(path.join(ROOT, file), "utf8");
}

function run() {
  const wxml = read("miniprogram/packageXiaofu/pages/ai-assistant/ai-assistant.wxml");
  const js = read("miniprogram/packageXiaofu/pages/ai-assistant/ai-assistant.js");

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

  const weatherCard = normalizeCard({
    type: "weather_card",
    title: "仙溪校区天气",
    weather: {
      campus: "仙溪校区",
      weatherText: "天气待确认",
      temperatureC: "--",
      humidity: "",
      rainProbabilityMax24h: null,
      next6Hours: [{ time: "09时", temperatureC: "--", rainProbability: "" }],
    },
  }, "m-weather", 0, {});
  assert.strictEqual(weatherCard.weather.temperatureText, "暂无该项数据");
  assert.strictEqual(weatherCard.weather.humidityText, "暂无该项数据");
  assert.strictEqual(weatherCard.weather.rainProbabilityText, "暂无该项数据");
  assert.strictEqual(weatherCard.weather.next6Hours[0].temperatureText, "暂无该项数据");
  assert(!/--[℃%]|--\s*(?:km\/h|mm)/.test(JSON.stringify(weatherCard.weather)), "weather display payload should not expose placeholder units");

  assert(js.includes("服务暂时不可用，已保留你的问题。"), "error card title should use the polished copy");
  assert(js.includes("可以重试，或先使用全校课表/空教室页面。"), "error card subtitle should suggest safe next steps");
  assert(wxml.includes("card-disclaimer"), "result cards should render the disclaimer");
  assert(wxml.includes("card-action-primary"), "primary card action class should be explicit");
  assert(wxml.includes("card-action-secondary"), "secondary card action class should be explicit");
  assert(!wxml.includes("onCopyMessage"), "assistant text replies should not expose copy answer");
  assert(!wxml.includes("复制回答"), "assistant copy answer button should be removed");
  assert(!js.includes("copyToClipboard"), "AI page should not use clipboard helper");
  assert(!wxml.includes("{{card.weather.temperatureC}}<text>℃</text>"), "weather card should not hard-code °C for missing temperature");
  assert(!wxml.includes("{{card.weather.humidity}}%"), "weather card should not hard-code % for missing humidity");

  const page = Object.assign({}, global.__AI_ASSISTANT_PAGE__, {
    data: {
      messages: [
        {
          role: "assistant",
          content: "可选择回答",
          displayCards: [
            {
              actions: [
                { label: "继续追问", type: "ask", payload: { message: "佛大有哪些校区" }, originalIndex: 0 },
              ],
            },
          ],
        },
      ],
    },
    queued: [],
    setData(patch) { this.data = Object.assign({}, this.data, patch || {}); },
    queueTaskMessage(message) { this.queued.push(message); },
  });
  page.onCardAction({
    currentTarget: { dataset: { messageIndex: 0, cardIndex: 0, actionIndex: 0 } },
  });
  assert.deepStrictEqual(page.queued, ["佛大有哪些校区"], "ask card action should continue in the chat flow");
  assert.strictEqual(global.__CLIPBOARD_TEXT__ || "", "", "AI card actions should not use wx.setClipboardData");

  console.log("test-ai-card-polish-contract passed");
}

run();
