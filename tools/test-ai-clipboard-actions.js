const assert = require("assert");
const fs = require("fs");
const path = require("path");

const storage = {};
let setClipboardCalls = 0;
let lastToast = "";

global.wx = {
  getStorageSync(key) { return Object.prototype.hasOwnProperty.call(storage, key) ? storage[key] : ""; },
  setStorageSync(key, value) { storage[key] = value; },
  removeStorageSync(key) { delete storage[key]; },
  setClipboardData() { setClipboardCalls += 1; },
  showToast(options) { lastToast = options && options.title || ""; },
  navigateTo(options) {
    if (options && typeof options.success === "function") options.success();
  },
  switchTab(options) {
    if (options && typeof options.success === "function") options.success();
  },
};
global.getCurrentPages = () => [];
global.getApp = () => ({ globalData: {} });
global.Page = (config) => {
  global.__AI_ASSISTANT_PAGE__ = config;
};

const ROOT = path.resolve(__dirname, "..");
const aiPage = require("../miniprogram/packageXiaofu/pages/ai-assistant/ai-assistant.js");
const conversationStore = require("../miniprogram/services/conversationStore");

function read(file) {
  return fs.readFileSync(path.join(ROOT, file), "utf8");
}

function actionLabels(card) {
  return (card && card.actions || []).map((action) => action.label);
}

function actionTypes(card) {
  return (card && card.actions || []).map((action) => action.type);
}

function firstCard(rawCard, content) {
  const messages = aiPage.normalizeMessagesForDisplay([{
    id: "m-no-copy-actions",
    role: "assistant",
    content: content || "这是一段可选择的助手回答",
    cards: [rawCard],
  }], {});
  return messages[0].displayCards[0];
}

function run() {
  const wxml = read("miniprogram/packageXiaofu/pages/ai-assistant/ai-assistant.wxml");
  const js = read("miniprogram/packageXiaofu/pages/ai-assistant/ai-assistant.js");

  // Product experience: no always-visible copy chrome; long-press menu may copy.
  assert(!wxml.includes("onCopyMessage"), "assistant message copy handler should not be rendered");
  assert(!wxml.includes("复制回答"), "assistant message copy button should not be visible");
  assert(!wxml.includes('bindtap="onCopy'), "no default copy tap control in WXML");
  // Long-press path may use clipboard; card-level type=copy actions remain forbidden below.
  if (js.includes("setClipboardData") || js.includes("copyToClipboard")) {
    assert(
      js.includes("onMessageLongPress") || js.includes("handleMessageAction"),
      "clipboard usage must be limited to long-press/message action path"
    );
  }

  const legacyCard = firstCard({
    type: "navigation",
    title: "旧入口卡",
    actions: [
      { label: "复制入口", type: "copy", payload: { text: "https://www.fosu.edu.cn/" } },
      { label: "打开入口", type: "navigate", url: "https://www.fosu.edu.cn/" },
      { label: "继续追问", type: "ask", payload: { message: "教务系统在哪里" } },
    ],
  });
  assert(!actionLabels(legacyCard).includes("复制入口"), "legacy copy action should be filtered");
  assert(!actionTypes(legacyCard).includes("copy"), "card actions should not expose type=copy");
  assert(actionLabels(legacyCard).includes("打开入口"), "navigation should keep the open entry action");
  assert(actionLabels(legacyCard).includes("继续追问"), "navigation should keep follow-up action");

  const page = Object.assign({}, global.__AI_ASSISTANT_PAGE__, {
    data: {
      messages: [{
        role: "assistant",
        content: "官网入口见正文",
        displayCards: [legacyCard],
      }],
    },
    setData(patch) { this.data = Object.assign({}, this.data, patch || {}); },
  });
  page.onCardAction({
    currentTarget: { dataset: { messageIndex: 0, cardIndex: 0, actionIndex: 0 } },
  });
  assert.strictEqual(setClipboardCalls, 0, "external entry action should not use wx.setClipboardData");
  assert.strictEqual(lastToast, "请前往对应官网查看", "external entry should ask the user to view the official site");

  const conversation = conversationStore.createConversation({ conversationId: "no-copy-test" });
  conversationStore.saveConversationMessages(conversation.conversationId, [{
    id: "m1",
    role: "assistant",
    content: "回答正文",
    cards: [{
      type: "navigation",
      title: "历史入口",
      actions: [
        { label: "复制来源", type: "copy", payload: { text: "https://www.fosu.edu.cn/" } },
        { label: "打开入口", type: "navigate", url: "/pages/school/school" },
      ],
    }],
  }]);
  const active = conversationStore.getActiveConversation();
  const storedActions = active.messages[0].cards[0].actions || [];
  assert.strictEqual(storedActions.length, 1, "conversation storage should drop copy actions");
  assert.strictEqual(storedActions[0].label, "打开入口");
  assert.strictEqual(storedActions[0].type, "navigate");

  console.log("test-ai-clipboard-actions passed");
}

run();
