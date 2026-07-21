/**
 * Conversation list ViewModel for mature chat management UX.
 */

function formatRelativeTime(value, nowMs) {
  const time = Date.parse(value || "");
  if (!time) return "";
  const now = typeof nowMs === "number" ? nowMs : Date.now();
  const diffMs = now - time;
  if (diffMs < 60000) return "刚刚";
  if (diffMs < 3600000) return `${Math.floor(diffMs / 60000)}分钟前`;
  const date = new Date(time);
  const today = new Date(now);
  const pad = (n) => String(n).padStart(2, "0");
  if (
    date.getFullYear() === today.getFullYear()
    && date.getMonth() === today.getMonth()
    && date.getDate() === today.getDate()
  ) {
    return `${pad(date.getHours())}:${pad(date.getMinutes())}`;
  }
  return `${pad(date.getMonth() + 1)}/${pad(date.getDate())}`;
}

/**
 * Derive a human title from the first meaningful user turn.
 * Avoid eternal "你好" titles.
 */
function deriveConversationTitle(messages, fallback) {
  const list = Array.isArray(messages) ? messages : [];
  const greetRe = /^(你好|您好|嗨|哈喽|hello|hi|hey|在吗|早上好|下午好|晚上好)[\s!！。.?？~～啊呀哦]*$/i;
  let firstUser = "";
  let firstTask = "";
  for (let i = 0; i < list.length; i += 1) {
    const m = list[i];
    if (!m || m.role !== "user") continue;
    const text = String(m.content || "").replace(/\s+/g, " ").trim();
    if (!text) continue;
    if (!firstUser) firstUser = text;
    if (!greetRe.test(text)) {
      firstTask = text;
      break;
    }
  }
  if (firstTask) {
    return firstTask.length > 18 ? `${firstTask.slice(0, 18)}…` : firstTask;
  }
  if (firstUser && greetRe.test(firstUser)) {
    return "校园助手问候";
  }
  if (firstUser) {
    return firstUser.length > 18 ? `${firstUser.slice(0, 18)}…` : firstUser;
  }
  return fallback || "新对话";
}

/**
 * Last message preview for conversation list (no secrets / no tech status).
 */
function lastMessagePreview(messages) {
  const list = Array.isArray(messages) ? messages : [];
  for (let i = list.length - 1; i >= 0; i -= 1) {
    const m = list[i];
    if (!m || !m.content) continue;
    const text = String(m.content).replace(/\s+/g, " ").trim();
    if (!text) continue;
    return text.length > 36 ? `${text.slice(0, 36)}…` : text;
  }
  return "暂无消息";
}

function buildConversationItem(item, activeId, options) {
  const source = item || {};
  const opts = options || {};
  const messages = opts.messages || source.messages || [];
  const title = source.title && source.title !== "你好" && source.title !== "你好啊"
    ? source.title
    : deriveConversationTitle(messages, source.title || "新对话");

  return {
    conversationId: source.conversationId,
    title: String(title || "新对话").slice(0, 40),
    preview: opts.preview || lastMessagePreview(messages),
    updatedAt: source.updatedAt || source.createdAt,
    updatedAtText: formatRelativeTime(source.updatedAt || source.createdAt, opts.nowMs),
    active: source.conversationId === activeId || source.active === true,
    pinned: source.pinned === true,
    // Product UX: hide internal message counts & tech badges by default
    showMessageCount: false,
    messageCount: source.messageCount,
  };
}

function filterConversations(list, query) {
  const q = String(query || "").trim().toLowerCase();
  const source = Array.isArray(list) ? list : [];
  if (!q) {
    return source.slice().sort((a, b) => {
      if (a.pinned && !b.pinned) return -1;
      if (!a.pinned && b.pinned) return 1;
      return Date.parse(b.updatedAt || 0) - Date.parse(a.updatedAt || 0);
    });
  }
  return source.filter((item) => {
    const title = String(item.title || "").toLowerCase();
    const preview = String(item.preview || "").toLowerCase();
    return title.includes(q) || preview.includes(q);
  });
}

module.exports = {
  formatRelativeTime,
  deriveConversationTitle,
  lastMessagePreview,
  buildConversationItem,
  filterConversations,
};
