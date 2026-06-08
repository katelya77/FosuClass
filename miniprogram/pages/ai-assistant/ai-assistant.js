const aiAssistantService = require("../../services/aiAssistantService");
const demoData = require("./demo-data");

const PRIVACY_TIP_KEY = "FOSU_AI_PRIVACY_TIP_CONFIRMED";
const PRIVACY_SUMMARY_TEXT = "仅发送课程名、教师、教室、星期、节次、教学周；不发送学号、姓名、密码或原始文件。";
const QUICK_QUESTIONS = [
  "现在有空教室吗？",
  "今天还有课吗？",
  "帮我查老师课表",
  "找连续 2 节空教室",
  "怎么导入个人课表？",
  "为什么数据加载失败？",
  "更多任务",
];

const TASK_PANEL_ITEMS = [
  { label: "查老师课表", desc: "输入老师姓名后查询", draft: "查某某老师课表", requiresKeyword: true },
  { label: "查教室占用", desc: "输入教室或楼栋", draft: "查 C7-203 教室", requiresKeyword: true },
  { label: "查课程安排", desc: "输入课程关键词", draft: "查高等数学课程", requiresKeyword: true },
  { label: "找连续空教室", desc: "按节次和楼栋筛选", message: "找连续 2 节空教室", requiresKeyword: false },
  { label: "分析今日课程", desc: "基于当前课表摘要", message: "分析今日课程", requiresKeyword: false },
  { label: "数据诊断", desc: "检查索引和缓存状态", message: "为什么数据加载失败？", requiresKeyword: false },
  { label: "XLS 导入指引", desc: "安全导入个人课表", message: "怎么导入个人课表？", requiresKeyword: false },
  { label: "组会/自习推荐", desc: "需要课表摘要", message: "帮我推荐连续 2 节自习时间", requiresKeyword: false },
];

const TABBAR_PENDING_QUERY = {
  "/pages/school/school": "FOSU_AI_PENDING_SCHOOL_QUERY",
  "/pages/today/today": "FOSU_AI_PENDING_TODAY_QUERY",
};

const PROVIDER_LABELS = {
  mock: "本地规则",
  deepseek: "DeepSeek",
  coze: "扣子",
  unknown: "AI",
};

const SAFETY_MODE_LABELS = {
  "tool-grounded": "工具验证",
  fallback: "降级模式",
  "fallback-mock": "已降级",
};

const TOOL_LABELS = {
  search_empty_rooms: "空教室",
  get_today_courses: "今日课表",
  search_school_index: "全校索引",
  get_schedule_detail: "课表详情",
  diagnose_data_status: "数据诊断",
  explain_personal_import: "导入指引",
  recommend_meeting_time: "时间推荐",
  clarify_missing_slot: "缺槽追问",
  safety_guard: "安全拦截",
};

const CARD_TYPE_LABELS = {
  empty_room: "空教室",
  schedule: "课表",
  teacher: "教师",
  course: "课程",
  diagnosis: "诊断",
  guide: "指引",
  reminder: "提醒",
  generic: "结果",
};

function timeText() {
  const date = new Date();
  const pad = (value) => String(value).padStart(2, "0");
  return `${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function mapProviderLabel(provider) {
  const normalized = String(provider || "unknown").toLowerCase();
  if (PROVIDER_LABELS[normalized]) return PROVIDER_LABELS[normalized];
  if (normalized.indexOf("deepseek") >= 0) return "DeepSeek";
  if (normalized.indexOf("coze") >= 0) return "扣子";
  if (normalized.indexOf("mock") >= 0) return "本地规则";
  return "AI";
}

function mapSafetyModeLabel(mode) {
  const normalized = String(mode || "tool-grounded").toLowerCase();
  if (SAFETY_MODE_LABELS[normalized]) return SAFETY_MODE_LABELS[normalized];
  if (normalized.indexOf("fallback") >= 0) return "降级模式";
  if (normalized.indexOf("tool") >= 0 || normalized.indexOf("grounded") >= 0) return "工具验证";
  return "安全模式";
}

function mapToolName(name) {
  const normalized = String(name || "").toLowerCase();
  return TOOL_LABELS[normalized] || "校园工具";
}

function mapCardTypeLabel(type) {
  const normalized = String(type || "generic").toLowerCase();
  return CARD_TYPE_LABELS[normalized] || "结果";
}

function mapToolStatusLabel(status) {
  const normalized = String(status || "").toLowerCase();
  if (normalized === "success" || normalized === "ok" || normalized === "done") return "已完成";
  if (normalized === "failed" || normalized === "error") return "失败";
  if (normalized === "skipped") return "已跳过";
  if (normalized === "running") return "调用中";
  return "已调用";
}

function normalizeStatusClass(status) {
  const normalized = String(status || "").toLowerCase();
  if (normalized === "failed" || normalized === "error") return "failed";
  if (normalized === "skipped") return "skipped";
  if (normalized === "running") return "running";
  return "success";
}

function normalizeTypeClass(type) {
  return String(type || "generic").toLowerCase().replace(/_/g, "-").replace(/[^a-z0-9-]/g, "") || "generic";
}

function normalizeToolCall(tool) {
  const source = tool || {};
  const rawName = source.name || source.tool || source.type || "";
  const label = mapToolName(rawName);
  const toolText = label === "校园工具" || label.indexOf("工具") >= 0 ? label : `${label}工具`;
  return Object.assign({}, source, {
    displayName: label,
    displayStatus: mapToolStatusLabel(source.status),
    displayText: `已调用：${toolText}`,
    statusClass: normalizeStatusClass(source.status),
  });
}

function normalizeCardItem(item) {
  const source = item || {};
  return {
    title: aiAssistantService.redactSensitiveText(source.title || source.name || ""),
    subtitle: aiAssistantService.redactSensitiveText(source.subtitle || source.desc || source.detail || ""),
    value: aiAssistantService.redactSensitiveText(source.value || source.time || source.status || ""),
  };
}

function normalizeCardAction(action, index) {
  const source = action || {};
  return {
    label: aiAssistantService.redactSensitiveText(source.label || "查看"),
    type: source.type || "noop",
    url: source.url || "",
    payload: source.payload && typeof source.payload === "object" && !Array.isArray(source.payload) ? source.payload : {},
    originalIndex: index,
  };
}

function parseActionUrl(url) {
  const target = String(url || "");
  const parts = target.split("?");
  const path = parts[0] || "";
  const queryText = parts.slice(1).join("?");
  const query = {};
  if (queryText) {
    queryText.split("&").forEach((pair) => {
      if (!pair) return;
      const kv = pair.split("=");
      const key = decodeQuery(kv[0] || "");
      if (!key) return;
      query[key] = decodeQuery(kv.slice(1).join("=") || "");
    });
  }
  return { path, query, raw: target };
}

function normalizeCard(card) {
  const source = card || {};
  const items = Array.isArray(source.items) ? source.items.map(normalizeCardItem) : [];
  const actions = Array.isArray(source.actions) ? source.actions.map(normalizeCardAction) : [];
  const type = String(source.type || "generic");
  const visibleItems = items.slice(0, 5);
  const primaryActions = actions.slice(0, 2);
  const secondaryActions = actions.slice(2);
  return Object.assign({}, source, {
    title: aiAssistantService.redactSensitiveText(source.title || "结果"),
    subtitle: aiAssistantService.redactSensitiveText(source.subtitle || ""),
    badges: Array.isArray(source.badges) ? source.badges.slice(0, 6).map((item) => aiAssistantService.redactSensitiveText(item)) : [],
    items,
    actions,
    typeLabel: mapCardTypeLabel(type),
    typeClass: normalizeTypeClass(type),
    visibleItems,
    hiddenItemCount: Math.max(0, items.length - visibleItems.length),
    primaryActions,
    secondaryActions,
    actionLayoutClass: primaryActions.length === 1 ? "one-action" : "two-actions",
  });
}

function normalizeSafety(safety) {
  const source = safety || {};
  const provider = source.provider || source.lastProvider || source.providerName || "unknown";
  const mode = source.mode || source.safetyMode || "tool-grounded";
  let providerLabel = mapProviderLabel(provider);
  if (source.externalProviderUsed === false &&
    source.fallbackReason &&
    /provider fallback|NOT_CONFIGURED|INVALID_PROVIDER|fallback to mock/i.test(source.fallbackReason)) {
    providerLabel = "已降级";
  }
  const modeLabel = mapSafetyModeLabel(mode);
  return {
    provider,
    mode,
    providerLabel,
    modeLabel,
    text: `${providerLabel} · ${modeLabel}`,
  };
}

function normalizeMetrics(metrics) {
  const source = metrics && typeof metrics === "object" && !Array.isArray(metrics) ? metrics : null;
  if (!source) return null;
  const latencyMs = Number(source.latencyMs);
  return {
    latencyMs: Number.isFinite(latencyMs) ? Math.max(0, Math.round(latencyMs)) : 0,
    intentName: source.intentName || "",
    externalProviderUsed: source.externalProviderUsed === true,
  };
}

function normalizeMessageForDisplay(message) {
  const source = message || {};
  const toolCalls = Array.isArray(source.toolCalls) ? source.toolCalls.slice(0, 8) : [];
  const displayToolCalls = toolCalls.map(normalizeToolCall);
  const displayCards = Array.isArray(source.cards) ? source.cards.map(normalizeCard) : [];
  const displaySafety = source.safety ? normalizeSafety(source.safety) : null;
  const metrics = normalizeMetrics(source.metrics);
  return Object.assign({}, source, {
    id: source.id || `m-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
    role: source.role === "user" ? "user" : "assistant",
    content: aiAssistantService.redactSensitiveText(source.content || ""),
    cards: Array.isArray(source.cards) ? source.cards : [],
    displayCards,
    suggestions: Array.isArray(source.suggestions) ? source.suggestions.slice(0, 6) : [],
    toolCalls,
    displayToolCalls,
    toolSummaryText: displayToolCalls.map((item) => item.displayText).join("；"),
    safety: source.safety || null,
    displaySafety,
    metrics,
    metricsText: metrics ? `耗时 ${metrics.latencyMs} ms` : "",
    timeText: source.timeText || timeText(),
  });
}

function normalizeMessagesForDisplay(messages) {
  return Array.isArray(messages) ? messages.map(normalizeMessageForDisplay) : [];
}

function makeMessage(role, content, patch) {
  return normalizeMessageForDisplay(Object.assign({
    id: `${role}-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
    role,
    content,
    cards: [],
    suggestions: [],
    toolCalls: [],
    safety: null,
    timeText: timeText(),
  }, patch || {}));
}

function decodeQuery(value) {
  try {
    return decodeURIComponent(String(value || ""));
  } catch (error) {
    return String(value || "");
  }
}

function buildPrivacyState(allowed) {
  return {
    allowPersonalContext: allowed === true,
    privacyStatusText: allowed ? "个人课表摘要：开启" : "个人课表摘要：关闭",
    privacyCompactClass: allowed ? "enabled" : "disabled",
    privacyActionText: allowed ? "摘要已开启" : "默认关闭",
    composerNote: allowed ? "摘要已开启" : "摘要关闭",
  };
}

function resolveProviderState(messages) {
  const list = Array.isArray(messages) ? messages : [];
  for (let index = list.length - 1; index >= 0; index -= 1) {
    const message = list[index];
    if (message && message.displaySafety) {
      return {
        providerLabel: message.displaySafety.providerLabel,
        providerModeLabel: message.displaySafety.modeLabel,
        lastProvider: message.displaySafety.provider,
      };
    }
    if (message && message.safety) {
      const safety = normalizeSafety(message.safety);
      return {
        providerLabel: safety.providerLabel,
        providerModeLabel: safety.modeLabel,
        lastProvider: safety.provider,
      };
    }
  }
  return {
    providerLabel: "AI",
    providerModeLabel: "工具验证",
    lastProvider: "unknown",
  };
}

Page({
  data: {
    quickQuestions: QUICK_QUESTIONS,
    taskPanelItems: TASK_PANEL_ITEMS,
    messages: [],
    inputValue: "",
    inputFocus: false,
    sending: false,
    showTaskPanel: false,
    slowRequest: false,
    showPrivacyTip: false,
    privacyExpanded: false,
    privacyText: PRIVACY_SUMMARY_TEXT,
    privacyStatusText: "个人课表摘要：关闭",
    privacyCompactClass: "disabled",
    privacyActionText: "默认关闭",
    allowPersonalContext: false,
    providerLabel: "AI",
    providerModeLabel: "工具验证",
    lastProvider: "unknown",
    hasHeroLogo: true,
    demoMode: "",
    scrollTop: 0,
    composerNote: "摘要关闭",
    welcome: {
      title: "小佛 AI 校园管家",
      desc: "基于课表、空教室和全校索引处理校园任务，结果以教务数据为准。",
    },
  },

  onLoad(options) {
    const showPrivacyTip = wx.getStorageSync(PRIVACY_TIP_KEY) !== true;
    const allowPersonalContext = aiAssistantService.isPersonalContextAllowed();
    const demoMode = demoData.normalizeDemoMode(options && options.demo);
    const sourceMessages = demoMode ? demoData.getDemoMessages(demoMode) : aiAssistantService.getAiHistory();
    const messages = normalizeMessagesForDisplay(sourceMessages);
    const question = decodeQuery(options && (options.q || options.question || ""));
    const nextState = Object.assign({
      messages,
      showPrivacyTip,
      privacyExpanded: showPrivacyTip,
      demoMode,
    }, buildPrivacyState(allowPersonalContext), resolveProviderState(messages));

    this.setData(nextState, () => this.scrollToBottom());

    if (!demoMode && question) {
      setTimeout(() => this.sendMessage(question), 300);
    }
  },

  onShow() {
    this.setData(buildPrivacyState(aiAssistantService.isPersonalContextAllowed()));
  },

  onInput(event) {
    this.setData({
      inputValue: event.detail.value,
      inputFocus: false,
    });
  },

  onQuickQuestion(event) {
    const question = event.currentTarget.dataset.question;
    if (!question) return;
    if (question === "更多任务") {
      this.setData({
        showTaskPanel: !this.data.showTaskPanel,
      });
      return;
    }
    this.sendMessage(question);
  },

  onTaskPanelItemTap(event) {
    const index = Number(event.currentTarget.dataset.index);
    const task = this.data.taskPanelItems[index];
    if (!task) return;
    if (task.requiresKeyword) {
      this.setData({
        inputValue: task.draft || task.label,
        inputFocus: true,
        showTaskPanel: false,
      });
      wx.showToast({
        title: "请替换关键词后发送",
        icon: "none",
      });
      return;
    }
    this.setData({
      showTaskPanel: false,
    });
    this.sendMessage(task.message || task.label);
  },

  onSuggestionTap(event) {
    const suggestion = event.currentTarget.dataset.suggestion;
    if (!suggestion) return;
    this.sendMessage(suggestion);
  },

  onSubmit() {
    this.sendMessage(this.data.inputValue);
  },

  setMessages(nextMessages, patch, options) {
    const messages = normalizeMessagesForDisplay(nextMessages);
    const nextState = Object.assign({
      messages,
    }, resolveProviderState(messages), patch || {});
    this.setData(nextState, () => this.scrollToBottom());
    if (options && options.save) {
      aiAssistantService.saveAiHistory(messages);
    }
  },

  sendMessage(rawText) {
    const message = String(rawText || "").trim();
    if (!message || this.data.sending) return;

    const userMessage = makeMessage("user", message);
    const nextMessages = this.data.messages.concat(userMessage);
    this.setMessages(nextMessages, {
      inputValue: "",
      inputFocus: false,
      sending: true,
      slowRequest: false,
    }, { save: !this.data.demoMode });

    if (this.data.demoMode) {
      setTimeout(() => {
        const response = demoData.getDemoResponse(this.data.demoMode, message);
        const assistantMessage = makeMessage("assistant", response.answer || "我已经整理好演示结果。", {
          cards: Array.isArray(response.cards) ? response.cards : [],
          suggestions: Array.isArray(response.suggestions) ? response.suggestions : [],
          toolCalls: Array.isArray(response.toolCalls) ? response.toolCalls : [],
          safety: response.safety || null,
          metrics: response.metrics || null,
        });
        this.setMessages(nextMessages.concat(assistantMessage), {
          sending: false,
          slowRequest: false,
        }, { save: false });
      }, 180);
      return;
    }

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
          metrics: response.metrics || null,
        });
        this.setMessages(this.data.messages.concat(assistantMessage), {
          sending: false,
          slowRequest: false,
        }, { save: true });
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
          safety: { provider: "mock", mode: "fallback" },
        });
        this.setMessages(this.data.messages.concat(assistantMessage), {
          sending: false,
          slowRequest: false,
        }, { save: true });
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
      privacyExpanded: false,
    });
  },

  expandPrivacyTip() {
    this.setData({
      privacyExpanded: true,
    });
  },

  applyPersonalContextAllowed(allowed) {
    aiAssistantService.setPersonalContextAllowed(allowed);
    this.setData(buildPrivacyState(allowed));
    wx.showToast({
      title: allowed ? "已允许摘要分析" : "已关闭摘要分析",
      icon: "none",
    });
  },

  onPersonalContextToggle(event) {
    const allowed = event.detail.value === true;
    if (!allowed) {
      this.applyPersonalContextAllowed(false);
      return;
    }

    wx.showModal({
      title: "允许分析本机课表摘要？",
      content: "仅发送课程名、教师、教室、星期、节次、教学周，不发送学号、姓名、密码或原始文件。",
      confirmText: "允许",
      cancelText: "取消",
      success: (res) => {
        if (res.confirm) {
          this.applyPersonalContextAllowed(true);
          return;
        }
        this.setData(buildPrivacyState(false));
      },
      fail: () => {
        this.setData(buildPrivacyState(false));
      },
    });
  },

  onHeroLogoError() {
    if (!this.data.hasHeroLogo) return;
    this.setData({
      hasHeroLogo: false,
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
        this.setMessages([], {}, { save: false });
      },
    });
  },

  onCardOverflow() {
    wx.showToast({
      title: "可用卡片按钮查看详情",
      icon: "none",
    });
  },

  onCardAction(event) {
    const messageIndex = Number(event.currentTarget.dataset.messageIndex);
    const cardIndex = Number(event.currentTarget.dataset.cardIndex);
    const actionIndex = Number(event.currentTarget.dataset.actionIndex);
    const message = this.data.messages[messageIndex] || {};
    const card = ((message.displayCards || message.cards || []))[cardIndex] || {};
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
    const parsed = parseActionUrl(target);
    const storageKey = TABBAR_PENDING_QUERY[parsed.path];
    if (storageKey) {
      if (parsed.query && Object.keys(parsed.query).length) {
        try {
          wx.setStorageSync(storageKey, parsed.query);
        } catch (error) {
          // ignore storage failure; switchTab still opens the target page.
        }
      }
      wx.switchTab({ url: parsed.path });
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
