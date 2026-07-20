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

const aiAssistantService = require("../miniprogram/services/aiAssistantService");
aiAssistantService.buildClientContext = () => ({ timezone: "Asia/Shanghai" });
aiAssistantService.saveAiHistory = (messages) => messages;

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

function waitTick() {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

async function run() {
  const page = makePage();
  let callCount = 0;
  aiAssistantService.chat = async () => {
    callCount += 1;
    if (callCount === 1) {
      throw new Error("network failed");
    }
    return {
      answer: "已经重新整理好结果。",
      cards: [],
      suggestions: [],
      toolCalls: [],
      safety: { provider: "mock", mode: "tool-grounded" },
      metrics: { latencyMs: 12 },
    };
  };

  page.sendMessage("今天还有课吗？");
  await waitTick();

  assert.strictEqual(page.data.messages.length, 2, "first failure should keep user and one assistant card");
  assert.strictEqual(page.data.messages[0].role, "user");
  assert.strictEqual(page.data.messages[1].role, "assistant");
  assert.strictEqual(page.data.messages[1].cards[0].variant, "error");

  page.onCardAction({
    currentTarget: {
      dataset: {
        messageIndex: 1,
        cardIndex: 0,
        actionIndex: 0,
      },
    },
  });
  await waitTick();

  assert.strictEqual(callCount, 2);
  assert.strictEqual(page.data.messages.length, 2, "retry should replace the previous failure assistant message");
  assert.strictEqual(page.data.messages[0].role, "user");
  assert.strictEqual(page.data.messages[0].content, "今天还有课吗？");
  assert.strictEqual(page.data.messages[1].role, "assistant");
  assert.strictEqual(page.data.messages[1].content, "已经重新整理好结果。");
  assert(!page.data.messages.some((message) => {
    return Array.isArray(message.cards) && message.cards.some((card) => card.variant === "error");
  }), "successful retry should remove the old error card");

  const unloadPage = makePage();
  aiAssistantService.chat = async (message, context, options) => {
    await new Promise((resolve) => setTimeout(resolve, 5));
    if (options && options.callbacks && options.callbacks.onDelta) {
      options.callbacks.onDelta("stream", "stream");
    }
    return {
      answer: "should be ignored",
      cards: [],
      suggestions: [],
      toolCalls: [],
      safety: { provider: "mock", mode: "tool-grounded" },
      metrics: { latencyMs: 5 },
    };
  };
  unloadPage.sendMessage("卸载测试");
  unloadPage.onUnload();
  await new Promise((resolve) => setTimeout(resolve, 15));
  assert.strictEqual(unloadPage.data.messages.length, 1, "unloaded page should ignore stream and final assistant updates");
  assert.strictEqual(unloadPage.data.messages[0].role, "user");

  console.log("test-ai-message-retry-replace passed");
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
