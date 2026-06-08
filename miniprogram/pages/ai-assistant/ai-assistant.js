const aiAssistantService = require("../../services/aiAssistantService");

const PRIVACY_TIP_KEY = "FOSU_AI_PRIVACY_TIP_CONFIRMED";
const QUICK_QUESTIONS = [
  "现在有空教室吗？",
  "今天还有课吗？",
  "帮我查老师课表",
  "找连续 2 节空教室",
  "怎么导入个人课表？",
  "为什么数据加载失败？",
];

function timeText() {
  const date = new Date();
  const pad = (value) => String(value).padStart(2, "0");
  return `${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function makeMessage(role, content, patch) {
  return Object.assign({
    id: `${role}-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
    role,
    content: aiAssistantService.redactSensitiveText(content || ""),
    cards: [],
    suggestions: [],
    toolCalls: [],
    safety: null,
    timeText: timeText(),
  }, patch || {});
}

function decodeQuery(value) {
  try {
    return decodeURIComponent(String(value || ""));
  } catch (error) {
    return String(value || "");
  }
}

Page({
  data: {
    quickQuestions: QUICK_QUESTIONS,
    messages: [],
    inputValue: "",
    sending: false,
    slowRequest: false,
    showPrivacyTip: false,
    scrollTop: 0,
    welcome: {
      title: "小佛 AI 校园管家",
      desc: "基于课表和空教室数据提供建议，结果以教务数据为准。",
    },
  },

  onLoad(options) {
    const history = aiAssistantService.getAiHistory();
    const showPrivacyTip = wx.getStorageSync(PRIVACY_TIP_KEY) !== true;
    this.setData({
      messages: history,
      showPrivacyTip,
    }, () => this.scrollToBottom());

    const question = decodeQuery(options && (options.q || options.question || ""));
    if (question) {
      setTimeout(() => this.sendMessage(question), 300);
    }
  },

  onInput(event) {
    this.setData({
      inputValue: event.detail.value,
    });
  },

  onQuickQuestion(event) {
    const question = event.currentTarget.dataset.question;
    if (!question) return;
    this.sendMessage(question);
  },

  onSuggestionTap(event) {
    const suggestion = event.currentTarget.dataset.suggestion;
    if (!suggestion) return;
    this.sendMessage(suggestion);
  },

  onSubmit() {
    this.sendMessage(this.data.inputValue);
  },

  sendMessage(rawText) {
    const message = String(rawText || "").trim();
    if (!message || this.data.sending) return;

    const userMessage = makeMessage("user", message);
    const nextMessages = this.data.messages.concat(userMessage);
    this.setData({
      messages: nextMessages,
      inputValue: "",
      sending: true,
      slowRequest: false,
    }, () => this.scrollToBottom());
    aiAssistantService.saveAiHistory(nextMessages);

    const slowTimer = setTimeout(() => {
      this.setData({ slowRequest: true });
    }, 7000);

    aiAssistantService.chat(message, aiAssistantService.buildClientContext())
      .then((response) => {
        const assistantMessage = makeMessage("assistant", response.answer || "我已经整理好结果。", {
          cards: Array.isArray(response.cards) ? response.cards : [],
          suggestions: Array.isArray(response.suggestions) ? response.suggestions : [],
          toolCalls: Array.isArray(response.toolCalls) ? response.toolCalls : [],
          safety: response.safety || null,
        });
        const updated = this.data.messages.concat(assistantMessage);
        this.setData({
          messages: updated,
          sending: false,
          slowRequest: false,
        }, () => this.scrollToBottom());
        aiAssistantService.saveAiHistory(updated);
      })
      .catch((error) => {
        const assistantMessage = makeMessage("assistant", "网络较慢或 AI 服务暂时不可用，已保留你的问题。可以稍后重试，或先使用全校查询、空教室和个人课表导入页面。", {
          cards: [{
            type: "generic",
            title: "请求失败",
            subtitle: error && error.message ? error.message : "请稍后重试",
            badges: ["网络异常", "可重试"],
            items: [],
            actions: [
              { label: "重试", type: "retry", url: "", payload: { message } },
              { label: "打开全校查询", type: "navigate", url: "/pages/school/school", payload: {} },
            ],
          }],
          suggestions: ["为什么数据加载失败？", "怎么导入个人课表？"],
        });
        const updated = this.data.messages.concat(assistantMessage);
        this.setData({
          messages: updated,
          sending: false,
          slowRequest: false,
        }, () => this.scrollToBottom());
        aiAssistantService.saveAiHistory(updated);
      })
      .finally(() => {
        clearTimeout(slowTimer);
      });
  },

  scrollToBottom() {
    this.setData({
      scrollTop: Date.now(),
    });
  },

  dismissPrivacyTip() {
    wx.setStorageSync(PRIVACY_TIP_KEY, true);
    this.setData({
      showPrivacyTip: false,
    });
  },

  clearHistory() {
    wx.showModal({
      title: "清空对话",
      content: "仅会清空本机保存的最近 AI 对话，不影响课表数据。",
      confirmText: "清空",
      success: (res) => {
        if (!res.confirm) return;
        aiAssistantService.clearAiHistory();
        this.setData({
          messages: [],
        });
      },
    });
  },

  onCardAction(event) {
    const messageIndex = Number(event.currentTarget.dataset.messageIndex);
    const cardIndex = Number(event.currentTarget.dataset.cardIndex);
    const actionIndex = Number(event.currentTarget.dataset.actionIndex);
    const message = this.data.messages[messageIndex] || {};
    const card = (message.cards || [])[cardIndex] || {};
    const action = (card.actions || [])[actionIndex] || {};
    const type = action.type || "noop";

    if (type === "retry") {
      const retryMessage = action.payload && action.payload.message || this.findLastUserMessage();
      this.sendMessage(retryMessage);
      return;
    }

    if (type === "copy") {
      wx.setClipboardData({
        data: action.payload && action.payload.text || action.url || card.title || "",
      });
      return;
    }

    if ((type === "navigate" || type === "bind") && action.url) {
      this.navigateByUrl(action.url);
    }
  },

  findLastUserMessage() {
    const list = this.data.messages || [];
    for (let index = list.length - 1; index >= 0; index -= 1) {
      if (list[index].role === "user") return list[index].content;
    }
    return "";
  },

  navigateByUrl(url) {
    const target = String(url || "");
    if (!target) return;
    const pathOnly = target.split("?")[0];
    if (pathOnly === "/pages/school/school" || pathOnly === "/pages/today/today") {
      wx.switchTab({ url: pathOnly });
      return;
    }
    wx.navigateTo({
      url: target,
      fail: () => {
        wx.showToast({
          title: "暂时无法打开该页面",
          icon: "none",
        });
      },
    });
  },
});
