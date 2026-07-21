/**
 * Product-experience presentation adapter.
 * Maps agent payloads → minimal UI ViewModel rules (Conversation First).
 * Pure functions only — safe for Node tests and mini-program require.
 */

const GREETING_RE = /^(你好|您好|嗨|哈喽|hello|hi|hey|在吗|早上好|下午好|晚上好|谢谢|感谢|多谢|你是谁|你能做什么|你会什么|帮我做什么)[\s!！。.?？~～]*$/i;
const THANKS_RE = /^(谢谢|感谢|多谢|thx|thanks)[\s!！。.?？~～]*$/i;

const MEMORY_STATUS = {
  local_only: {
    short: "仅本机",
    full: "仅保存在本机",
    menu: "仅保存在本机",
    chip: "",
  },
  session_state: {
    short: "会话状态",
    full: "已保存会话状态",
    menu: "已保存会话状态",
    chip: "已记住上下文",
  },
  cloud_sync: {
    short: "跨设备同步",
    full: "已开启跨设备同步",
    menu: "已开启跨设备同步",
    chip: "已记住上下文",
  },
};

function safeText(value, maxLength, fallback) {
  let raw = value;
  if (raw && typeof raw === "object") {
    raw = raw.text != null ? raw.text
      : (raw.label != null ? raw.label
        : (raw.title != null ? raw.title : ""));
  }
  const text = String(raw == null ? "" : raw).replace(/\s+/g, " ").trim();
  if (!text || text === "[object Object]") return fallback || "";
  if (maxLength && text.length > maxLength) return text.slice(0, maxLength);
  return text;
}

function isGenericAssistantCard(card) {
  if (!card) return true;
  const type = String(card.type || "generic");
  const title = String(card.title || "");
  const subtitle = String(card.subtitle || "");
  if (type === "generic" && /^(小佛助手|小佛校园助手|结果)$/.test(title)) return true;
  if (/智能体表达层|来自智能体|自然对话/.test(subtitle)) return true;
  return false;
}

function isGreetingOrPlainUtterance(text) {
  const value = String(text || "").trim();
  if (!value) return false;
  return GREETING_RE.test(value) || THANKS_RE.test(value);
}

/**
 * Resolve intent name from all shapes used by online + offline payloads:
 * - intentName field
 * - intent string (standardizeClientFallback sets intent: canonicalIntent string)
 * - intent.name object
 * - metrics.intentName / metrics.canonicalIntent
 */
function resolveIntentName(source) {
  const src = source || {};
  if (src.intentName) return String(src.intentName);
  if (typeof src.intent === "string" && src.intent) return String(src.intent);
  if (src.intent && typeof src.intent === "object" && src.intent.name) {
    return String(src.intent.name);
  }
  if (src.metrics) {
    if (src.metrics.intentName) return String(src.metrics.intentName);
    if (src.metrics.canonicalIntent) return String(src.metrics.canonicalIntent);
  }
  return "";
}

const PLAIN_INTENT_RE = /^(smalltalk|conversational|conversational_help|project_qa|generic|plain|greeting|chitchat|help)$/i;

function isPlainPresentation(source, options) {
  const src = source || {};
  const opts = options || {};
  const presentationMode = safeText(
    src.presentationMode || (src.presentation && src.presentation.presentationMode) || "",
    32
  );
  if (presentationMode === "plain") return true;
  if (src.role === "user") return false;

  const intentName = resolveIntentName(src) || presentationMode || "";
  const noTools = !src.toolCalls || !src.toolCalls.length;
  const noRealCards = !src.cards
    || !src.cards.length
    || src.cards.every(isGenericAssistantCard);

  if (noTools && noRealCards && PLAIN_INTENT_RE.test(intentName)) {
    return true;
  }
  if (noTools && noRealCards && /conversational|project_qa|generic|plain|greeting|chitchat|smalltalk/i.test(intentName)) {
    return true;
  }

  // Prior user turn (page passes lastUserText / userQuery on assistant message)
  const userText = src.userQuery || src.query || opts.lastUserText || opts.userText || "";
  if (noTools && noRealCards && isGreetingOrPlainUtterance(userText)) {
    return true;
  }
  return false;
}

/**
 * Compose a single user-facing status line for the header.
 * Never includes Provider / Model / plannerType / runId.
 */
function composeHeaderStatus(input) {
  const source = input || {};
  if (source.connectionStatusClass === "offline" || source.statusMachine === "network_offline") {
    return "本地可用";
  }
  if (source.statusMachine === "server_unreachable") {
    return "本地可用";
  }

  const runtime = String(source.runtimeMode || source.mode || "public").toLowerCase();
  let modeLabel = "校园助手";
  if (source.statusMachine === "enhanced_ready" || runtime === "trial" || runtime === "competition" || runtime === "dev") {
    modeLabel = "增强模式";
  } else if (source.statusMachine === "enhanced_degraded") {
    modeLabel = "本地可用";
  } else if (runtime === "public") {
    modeLabel = "校园助手";
  }

  const memoryMode = String(source.memoryMode || "local_only");
  const mem = MEMORY_STATUS[memoryMode] || MEMORY_STATUS.local_only;
  if (mem.chip) {
    return `${modeLabel} · ${mem.chip}`;
  }
  return modeLabel;
}

/**
 * Deduplicate status chips and collapse to at most one composed status.
 */
function dedupeStatusChips(chips, options) {
  const list = Array.isArray(chips) ? chips.map((c) => safeText(c, 24)).filter(Boolean) : [];
  const seen = new Set();
  const unique = [];
  list.forEach((item) => {
    const key = item.replace(/\s+/g, "");
    if (seen.has(key)) return;
    // Drop engineering / provider labels
    if (/CloudBase|DeepSeek|Coze|Provider|planner|runId|Model|OpenAI|mock/i.test(item)) return;
    if (/会话记忆|本地记忆|已同步/.test(item) && options && options.memoryMode) return;
    seen.add(key);
    unique.push(item);
  });
  if (options && options.compose !== false) {
    const composed = composeHeaderStatus(options);
    return composed ? [composed] : unique.slice(0, 1);
  }
  return unique.slice(0, 1);
}

function mapMemoryStatusText(mode, kind) {
  const entry = MEMORY_STATUS[String(mode || "local_only")] || MEMORY_STATUS.local_only;
  if (kind === "short") return entry.short;
  if (kind === "menu") return entry.menu;
  if (kind === "chip") return entry.chip;
  return entry.full;
}

/**
 * Cap cards by presentation mode. Single-fact ≤1; composite default 1 max 2.
 */
function limitDisplayCards(cards, presentationMode) {
  const list = Array.isArray(cards) ? cards.filter((c) => !isGenericAssistantCard(c)) : [];
  const mode = String(presentationMode || "");
  if (mode === "plain") return [];
  if (mode === "single_card" || mode === "fact" || mode === "single_fact") return list.slice(0, 1);
  if (mode === "composite" || mode === "multi") return list.slice(0, 2);
  // Default product rule: at most 1 primary card unless explicitly multi
  if (list.length <= 1) return list;
  return list.slice(0, 1);
}

/**
 * Cap visible primary actions on a card to 2.
 */
function limitCardActions(actions, max) {
  const list = Array.isArray(actions) ? actions : [];
  const limit = typeof max === "number" ? max : 2;
  return list.slice(0, limit);
}

/**
 * Suggestion rules: ≤2, task-related, no immediate repeat of clicked, no identical consecutive sets.
 */
function refineSuggestions(rawSuggestions, context) {
  const ctx = context || {};
  const userText = String(ctx.userText || ctx.query || "").trim();
  if (THANKS_RE.test(userText)) return [];
  if (ctx.stableMultiTurn === true && ctx.turnCount >= 4) return [];

  let list = Array.isArray(rawSuggestions)
    ? rawSuggestions.map((s) => safeText(s, 40)).filter(Boolean)
    : [];

  // Drop recently clicked
  const clicked = new Set((ctx.clickedSuggestions || []).map((s) => String(s)));
  list = list.filter((s) => !clicked.has(s));

  // Greeting: max 2 campus-oriented
  if (isGreetingOrPlainUtterance(userText) || ctx.isPlain === true) {
    list = list.slice(0, 2);
  } else if (ctx.isComposite === true) {
    list = list.slice(0, 1);
  } else {
    list = list.slice(0, 2);
  }

  // Avoid identical consecutive suggestion combination
  const prevKey = String(ctx.previousSuggestionKey || "");
  const nextKey = list.slice().sort().join("|");
  if (prevKey && nextKey && prevKey === nextKey) {
    // rotate: drop first if possible
    if (list.length > 1) list = list.slice(1);
    else list = [];
  }

  return list;
}

function suggestionKey(suggestions) {
  return (Array.isArray(suggestions) ? suggestions : []).slice().sort().join("|");
}

/**
 * Whether an assistant message should keep task trajectory / evidence chrome.
 */
function shouldShowTaskChrome(source) {
  if (!source || source.role === "user") return false;
  if (isPlainPresentation(source)) return false;
  return true;
}

/**
 * Avatar grouping: show only on first assistant message of a consecutive group.
 */
function shouldShowAssistantAvatar(message, previousMessage) {
  if (!message || message.role !== "assistant") return false;
  if (!previousMessage) return true;
  return previousMessage.role === "user";
}

/**
 * Time label: omit when same minute as previous message of same role.
 */
function resolveTimeText(message, previousMessage, rawTimeText) {
  const text = safeText(rawTimeText || message && message.timeText || "", 16);
  if (!text || !previousMessage) return text;
  if (previousMessage.timeText === text) return "";
  return text;
}

/**
 * Build product header view model.
 */
function buildHeaderViewModel(state) {
  const source = state || {};
  const statusLine = composeHeaderStatus(source);
  return {
    conversationTitle: safeText(source.activeConversationTitle || source.conversationTitle || "新对话", 40, "新对话"),
    statusLine,
    statusChips: statusLine ? [statusLine] : [],
    memoryStatusText: mapMemoryStatusText(source.memoryMode, "menu"),
    memoryChipText: "", // never dual-render memory chip next to composed status
    actionCount: 2,
    showProductTitle: false,
  };
}

/**
 * Full message presentation pass used by tests and page.
 */
function presentAssistantMessage(message, options) {
  const source = message || {};
  const opts = options || {};
  const plain = isPlainPresentation(source, {
    lastUserText: opts.lastUserText || (opts.suggestionContext && opts.suggestionContext.userText) || "",
  }) || opts.forcePlain === true;
  const presentationMode = plain
    ? "plain"
    : safeText(source.presentationMode || (source.presentation && source.presentation.presentationMode) || "", 32);

  let cards = Array.isArray(source.cards) ? source.cards.filter((c) => !isGenericAssistantCard(c)) : [];
  cards = plain ? [] : limitDisplayCards(cards, presentationMode || (cards.length > 1 ? "composite" : "single_card"));
  cards = cards.map((card) => {
    const next = Object.assign({}, card);
    if (Array.isArray(next.actions)) next.actions = limitCardActions(next.actions, 2);
    if (Array.isArray(next.primaryActions)) next.primaryActions = limitCardActions(next.primaryActions, 2);
    return next;
  });

  const suggestions = plain || opts.omitSuggestions
    ? refineSuggestions(source.suggestions, Object.assign({ isPlain: true }, opts.suggestionContext))
    : refineSuggestions(source.suggestions, opts.suggestionContext);

  const showChrome = !plain && shouldShowTaskChrome(source);

  return {
    id: source.id,
    role: source.role === "user" ? "user" : "assistant",
    content: safeText(source.content || "", 2000),
    presentationMode: plain ? "plain" : presentationMode,
    isPlain: plain,
    displayCards: cards,
    suggestions,
    showDefaultFeedback: false,
    showTaskTrajectory: showChrome,
    showEvidence: showChrome && Boolean(source.evidence || source.evidenceText),
    showToolChips: false,
    showAvatar: shouldShowAssistantAvatar(source, opts.previousMessage),
    timeText: resolveTimeText(source, opts.previousMessage, source.timeText),
  };
}

function assertNoDefaultFeedbackMarkup(wxml) {
  const text = String(wxml || "");
  if (/class="[^"]*feedback-row/.test(text) && !/wx:if="\{\{false\}\}"/.test(text)) {
    // allow only if never rendered by default conditions that are always true for assistant
    if (/feedback-row[^>]*wx:if="\{\{message\.role == 'assistant'/.test(text)
      || /feedback-row feedback-compact/.test(text)) {
      return false;
    }
  }
  if (/👍|👎/.test(text) && /feedback/.test(text)) return false;
  return true;
}

module.exports = {
  GREETING_RE,
  THANKS_RE,
  MEMORY_STATUS,
  PLAIN_INTENT_RE,
  safeText,
  isGenericAssistantCard,
  isGreetingOrPlainUtterance,
  resolveIntentName,
  isPlainPresentation,
  composeHeaderStatus,
  dedupeStatusChips,
  mapMemoryStatusText,
  limitDisplayCards,
  limitCardActions,
  refineSuggestions,
  suggestionKey,
  shouldShowTaskChrome,
  shouldShowAssistantAvatar,
  resolveTimeText,
  buildHeaderViewModel,
  presentAssistantMessage,
  assertNoDefaultFeedbackMarkup,
};
