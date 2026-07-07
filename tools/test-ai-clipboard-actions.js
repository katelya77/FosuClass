const assert = require("assert");

const clipboard = require("../miniprogram/utils/clipboard");

let clipboardText = "";
let toastText = "";
let setClipboardCalls = 0;
let shouldFail = false;
let failTimesRemaining = 0;
let warnCount = 0;

global.wx = {
  getStorageSync() { return ""; },
  setStorageSync() {},
  removeStorageSync() {},
  setClipboardData(options) {
    setClipboardCalls += 1;
    if (shouldFail || failTimesRemaining > 0) {
      if (failTimesRemaining > 0) failTimesRemaining -= 1;
      if (options && typeof options.fail === "function") options.fail({ errMsg: "mock fail" });
      if (options && typeof options.complete === "function") options.complete({ errMsg: "mock complete" });
      return;
    }
    clipboardText = options && options.data || "";
    if (options && typeof options.success === "function") options.success({ errMsg: "ok" });
    if (options && typeof options.complete === "function") options.complete({ errMsg: "complete" });
  },
  showToast(options) {
    toastText = options && options.title || "";
  },
  navigateTo() {},
  switchTab() {},
};
global.getCurrentPages = () => [];
global.getApp = () => ({ globalData: {} });
global.Page = (config) => {
  global.__AI_ASSISTANT_PAGE__ = config;
};

const originalWarn = console.warn;
console.warn = function warnProxy() {
  warnCount += 1;
};

const aiPage = require("../miniprogram/pages/ai-assistant/ai-assistant.js");

function makePage(messages) {
  const config = global.__AI_ASSISTANT_PAGE__;
  return Object.assign({}, config, {
    data: { messages: messages || [] },
    setData(patch) {
      this.data = Object.assign({}, this.data, patch || {});
    },
  });
}

async function run() {
  assert.strictEqual(clipboard.normalizeCopyText(undefined), "", "undefined should not become copy text");
  assert.strictEqual(clipboard.normalizeCopyText({ text: "对象" }), "", "objects should not be stringified");
  assert.strictEqual(clipboard.normalizeCopyText(" [object Object] "), "", "invalid object token should not be copied");

  const page = makePage([
    { role: "assistant", content: "这是一段回答", displayCards: [] },
  ]);
  page.onCopyMessage({ currentTarget: { dataset: { messageIndex: 0 } } });
  assert.strictEqual(clipboardText, "这是一段回答", "copy answer should copy assistant text");
  assert.strictEqual(toastText, "已复制", "copy answer should use unified success toast");

  page.data.messages = [{
    role: "assistant",
    content: "",
    displayCards: [{
      actions: [
        { label: "复制来源", type: "copy", payload: { text: "https://www.fosu.edu.cn/jwc/" }, originalIndex: 0 },
      ],
    }],
  }];
  page.onCardAction({ currentTarget: { dataset: { messageIndex: 0, cardIndex: 0, actionIndex: 0 } } });
  assert.strictEqual(clipboardText, "https://www.fosu.edu.cn/jwc/", "copy source should copy payload.text");

  page.data.messages = [{
    role: "assistant",
    content: "",
    displayCards: [{
      actions: [
        { label: "复制入口", type: "copy", url: "https://www.fosu.edu.cn/library/", payload: {}, originalIndex: 0 },
      ],
    }],
  }];
  page.onCardAction({ currentTarget: { dataset: { messageIndex: 0, cardIndex: 0, actionIndex: 0 } } });
  assert.strictEqual(clipboardText, "https://www.fosu.edu.cn/library/", "copy entry should fall back to action.url");

  const callsBeforeEmpty = setClipboardCalls;
  page.data.messages = [{
    role: "assistant",
    content: "",
    displayCards: [{
      actions: [
        { label: "复制空内容", type: "copy", payload: {}, originalIndex: 0 },
      ],
    }],
  }];
  page.onCardAction({ currentTarget: { dataset: { messageIndex: 0, cardIndex: 0, actionIndex: 0 } } });
  assert.strictEqual(setClipboardCalls, callsBeforeEmpty, "empty copy payload should not call wx.setClipboardData");
  assert.strictEqual(toastText, "暂无可复制内容", "empty copy payload should show empty toast");

  page.data.messages = [{
    role: "assistant",
    content: "",
    displayCards: [{
      copyText: "卡片兜底内容",
      actions: [
        { label: "复制对象", type: "copy", payload: { text: { bad: true } }, originalIndex: 0 },
      ],
    }],
  }];
  page.onCardAction({ currentTarget: { dataset: { messageIndex: 0, cardIndex: 0, actionIndex: 0 } } });
  assert.strictEqual(clipboardText, "卡片兜底内容", "object payload should use safe card fallback");
  assert.notStrictEqual(clipboardText, "[object Object]", "object payload must not be copied as [object Object]");

  const callsBeforeRetry = setClipboardCalls;
  failTimesRemaining = 1;
  const retryResult = await page.copyToClipboard("二次复制成功");
  assert.strictEqual(retryResult.ok, true, "transient copy failure should retry once and succeed");
  assert.strictEqual(setClipboardCalls - callsBeforeRetry, 2, "transient copy should call wx.setClipboardData twice");
  assert.strictEqual(clipboardText, "二次复制成功", "retry should keep the original copy text");
  assert.strictEqual(toastText, "已复制", "retry success should show success toast");

  shouldFail = true;
  const callsBeforeFailure = setClipboardCalls;
  const failResult = await page.copyToClipboard("失败兜底");
  assert.strictEqual(failResult.ok, false, "copy failure should resolve as failed");
  assert.strictEqual(setClipboardCalls - callsBeforeFailure, 2, "final failure should retry before falling back");
  assert.strictEqual(toastText, "复制失败，可长按文本手动复制", "copy failure should show manual-copy fallback");
  assert(warnCount >= 1, "copy failure should keep console.warn diagnostics");

  console.warn = originalWarn;
  console.log("test-ai-clipboard-actions passed");
}

run().catch((error) => {
  console.warn = originalWarn;
  console.error(error);
  process.exit(1);
});
