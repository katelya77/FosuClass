const STORE_KEY = "FOSU_AI_CONVERSATIONS";
const ACTIVE_KEY = "FOSU_AI_ACTIVE_CONVERSATION_ID";
const LEGACY_HISTORY_KEY = "FOSU_AI_ASSISTANT_HISTORY";
const SCHEMA_VERSION = 1;
const MAX_CONVERSATIONS = 12;
const MAX_MESSAGES_PER_CONVERSATION = 20;
const MAX_MESSAGE_TEXT_LENGTH = 1200;
const MAX_CARD_ITEMS = 8;

let memoryStorage = {};

function nowIso() {
  return new Date().toISOString();
}

function getWx() {
  return typeof wx !== "undefined" ? wx : null;
}

function readStorage(key, fallback) {
  const wxRef = getWx();
  if (!wxRef) {
    return Object.prototype.hasOwnProperty.call(memoryStorage, key) ? memoryStorage[key] : fallback;
  }
  try {
    const value = wxRef.getStorageSync(key);
    return value === undefined || value === "" ? fallback : value;
  } catch (error) {
    return fallback;
  }
}

function writeStorage(key, value) {
  const wxRef = getWx();
  if (!wxRef) {
    memoryStorage[key] = value;
    return true;
  }
  try {
    wxRef.setStorageSync(key, value);
    return true;
  } catch (error) {
    return false;
  }
}

function removeStorage(key) {
  const wxRef = getWx();
  if (!wxRef) {
    delete memoryStorage[key];
    return;
  }
  try {
    wxRef.removeStorageSync(key);
  } catch (error) {
    // best effort
  }
}

function safeText(value, maxLength) {
  const text = String(value == null ? "" : value).trim();
  if (!text) return "";
  return text.slice(0, maxLength || MAX_MESSAGE_TEXT_LENGTH);
}

function safeRevision(value) {
  const revision = Number(value);
  return Number.isFinite(revision) && revision >= 0 ? Math.floor(revision) : 0;
}

function toTimestamp(value) {
  const timestamp = Date.parse(String(value || ""));
  return Number.isFinite(timestamp) ? timestamp : 0;
}

function createConversationId() {
  return `xf-${Date.now()}-${Math.floor(Math.random() * 1000000).toString(36)}`;
}

function createEmptyContextSlots() {
  return {
    lastIntent: "",
    lastTargetType: "",
    lastTargetName: "",
    lastWeek: null,
    lastWeekday: null,
    lastQueryResult: null,
    lastSource: "",
  };
}

function normalizeContextSlots(slots) {
  const source = slots && typeof slots === "object" && !Array.isArray(slots) ? slots : {};
  return Object.assign(createEmptyContextSlots(), {
    lastIntent: safeText(source.lastIntent, 60),
    lastTargetType: safeText(source.lastTargetType, 40),
    lastTargetName: safeText(source.lastTargetName, 120),
    lastWeek: Number.isFinite(Number(source.lastWeek)) ? Number(source.lastWeek) : null,
    lastWeekday: Number.isFinite(Number(source.lastWeekday)) ? Number(source.lastWeekday) : null,
    lastQueryResult: source.lastQueryResult && typeof source.lastQueryResult === "object" && !Array.isArray(source.lastQueryResult)
      ? Object.assign({}, source.lastQueryResult)
      : null,
    lastSource: safeText(source.lastSource, 120),
  });
}

function normalizeCardItem(item) {
  const source = item && typeof item === "object" && !Array.isArray(item) ? item : {};
  return {
    title: safeText(source.title || source.name, 80),
    subtitle: safeText(source.subtitle || source.desc || source.detail, 160),
    value: safeText(source.value || source.time || source.status, 80),
  };
}

function normalizeCardAction(action) {
  const source = action && typeof action === "object" && !Array.isArray(action) ? action : {};
  const type = safeText(source.type || "noop", 20);
  if (type.toLowerCase() === "copy") return null;
  return {
    label: safeText(source.label, 32),
    type,
    url: safeText(source.url, 260),
    payload: source.payload && typeof source.payload === "object" && !Array.isArray(source.payload)
      ? Object.assign({}, source.payload)
      : {},
  };
}

function normalizeCard(card) {
  const source = card && typeof card === "object" && !Array.isArray(card) ? card : {};
  const weather = source.weather && typeof source.weather === "object" && !Array.isArray(source.weather)
    ? Object.assign({}, source.weather)
    : null;
  return {
    type: safeText(source.type || "generic", 40),
    variant: safeText(source.variant, 24),
    title: safeText(source.title, 90),
    subtitle: safeText(source.subtitle, 180),
    badges: Array.isArray(source.badges) ? source.badges.map((item) => safeText(item, 40)).filter(Boolean).slice(0, 4) : [],
    items: Array.isArray(source.items) ? source.items.slice(0, MAX_CARD_ITEMS).map(normalizeCardItem).filter((item) => item.title || item.subtitle || item.value) : [],
    actions: Array.isArray(source.actions) ? source.actions.slice(0, 3).map(normalizeCardAction).filter((item) => item && item.label) : [],
    weather,
    sourceUrl: safeText(source.sourceUrl, 260),
    updatedAt: safeText(source.updatedAt, 40),
  };
}

function normalizeMessage(message) {
  const source = message && typeof message === "object" && !Array.isArray(message) ? message : {};
  return {
    id: safeText(source.id, 80) || `m-${Date.now()}-${Math.floor(Math.random() * 10000)}`,
    role: source.role === "user" ? "user" : "assistant",
    content: safeText(source.content, MAX_MESSAGE_TEXT_LENGTH),
    cards: Array.isArray(source.cards) ? source.cards.slice(0, 5).map(normalizeCard).filter((card) => card.title || card.subtitle || card.items.length || card.actions.length || card.weather) : [],
    suggestions: Array.isArray(source.suggestions) ? source.suggestions.map((item) => safeText(item, 80)).filter(Boolean).slice(0, 6) : [],
    toolCalls: Array.isArray(source.toolCalls) ? source.toolCalls.slice(0, 8) : [],
    taskSteps: Array.isArray(source.taskSteps) ? source.taskSteps.slice(0, 8) : [],
    evidence: source.evidence && typeof source.evidence === "object" && !Array.isArray(source.evidence) ? Object.assign({}, source.evidence) : null,
    safety: source.safety && typeof source.safety === "object" && !Array.isArray(source.safety) ? Object.assign({}, source.safety) : null,
    metrics: source.metrics && typeof source.metrics === "object" && !Array.isArray(source.metrics) ? Object.assign({}, source.metrics) : null,
    timeText: safeText(source.timeText, 20),
  };
}

function trimMessages(messages) {
  return (Array.isArray(messages) ? messages : [])
    .slice(-MAX_MESSAGES_PER_CONVERSATION)
    .map(normalizeMessage);
}

function generateTitleFromMessages(messages) {
  const firstUser = (Array.isArray(messages) ? messages : []).find((message) => message && message.role === "user" && message.content);
  return generateConversationTitle(firstUser && firstUser.content || "");
}

function generateConversationTitle(text) {
  const value = safeText(text, 48)
    .replace(/\s+/g, " ")
    .replace(/[\r\n]+/g, " ")
    .trim();
  if (!value) return "新查询";
  return value.length > 18 ? `${value.slice(0, 18)}...` : value;
}

function normalizeConversation(conversation) {
  const source = conversation && typeof conversation === "object" && !Array.isArray(conversation) ? conversation : {};
  const createdAt = safeText(source.createdAt, 40) || nowIso();
  const messages = trimMessages(source.messages);
  const title = safeText(source.title, 40) || generateTitleFromMessages(messages);
  return {
    conversationId: safeText(source.conversationId, 80) || createConversationId(),
    title,
    createdAt,
    updatedAt: safeText(source.updatedAt, 40) || createdAt,
    messages,
    contextSlots: normalizeContextSlots(source.contextSlots),
    revision: safeRevision(source.revision),
    memoryMode: ["local_only", "session_state", "cloud_sync"].indexOf(source.memoryMode || source.mode) >= 0
      ? (source.memoryMode || source.mode)
      : "local_only",
    source: source.source === "cloud_projection" ? "cloud_projection" : "local",
  };
}

function sortConversations(conversations) {
  return (Array.isArray(conversations) ? conversations : [])
    .map(normalizeConversation)
    .sort((left, right) => {
      const rightTime = Date.parse(right.updatedAt || right.createdAt || "") || 0;
      const leftTime = Date.parse(left.updatedAt || left.createdAt || "") || 0;
      return rightTime - leftTime;
    })
    .slice(0, MAX_CONVERSATIONS);
}

function createEmptyConversation(patch = {}) {
  const at = nowIso();
  return normalizeConversation(Object.assign({
    conversationId: createConversationId(),
    title: "新查询",
    createdAt: at,
    updatedAt: at,
    messages: [],
    contextSlots: createEmptyContextSlots(),
  }, patch || {}));
}

function readStoreRaw() {
  const value = readStorage(STORE_KEY, null);
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value;
  }
  return {
    schemaVersion: SCHEMA_VERSION,
    activeConversationId: readStorage(ACTIVE_KEY, ""),
    conversations: [],
  };
}

function writeStore(store) {
  const conversations = sortConversations(store && store.conversations || []);
  const activeExists = conversations.some((item) => item.conversationId === (store && store.activeConversationId));
  const activeConversationId = activeExists
    ? store.activeConversationId
    : (conversations[0] && conversations[0].conversationId || "");
  const next = {
    schemaVersion: SCHEMA_VERSION,
    activeConversationId,
    conversations,
  };
  writeStorage(STORE_KEY, next);
  writeStorage(ACTIVE_KEY, activeConversationId);
  return next;
}

function migrateLegacyHistoryIfNeeded(store) {
  if (store.conversations && store.conversations.length) return store;
  const legacy = readStorage(LEGACY_HISTORY_KEY, []);
  if (!Array.isArray(legacy) || !legacy.length) return store;
  const conversation = createEmptyConversation({
    title: generateTitleFromMessages(legacy),
    messages: legacy,
    contextSlots: createEmptyContextSlots(),
  });
  return writeStore({
    schemaVersion: SCHEMA_VERSION,
    activeConversationId: conversation.conversationId,
    conversations: [conversation],
  });
}

function getStore(options = {}) {
  let store = readStoreRaw();
  store = {
    schemaVersion: SCHEMA_VERSION,
    activeConversationId: safeText(store.activeConversationId, 80),
    conversations: sortConversations(store.conversations),
  };
  if (options.migrateLegacy !== false) {
    store = migrateLegacyHistoryIfNeeded(store);
  }
  if (!store.conversations.length && options.createIfEmpty !== false) {
    const conversation = createEmptyConversation();
    store = writeStore({
      schemaVersion: SCHEMA_VERSION,
      activeConversationId: conversation.conversationId,
      conversations: [conversation],
    });
  }
  return store;
}

function getConversationList() {
  return getStore().conversations.map((item) => ({
    conversationId: item.conversationId,
    title: item.title,
    createdAt: item.createdAt,
    updatedAt: item.updatedAt,
    messageCount: item.messages.length,
    revision: item.revision || 0,
    memoryMode: item.memoryMode || "local_only",
    source: item.source || "local",
  }));
}

/**
 * 投影层消息白名单：仅 user/assistant 且正文非空的条目可进入本机缓存；
 * 非法条目安全忽略，不伪造系统消息/执行状态，也不把未知角色强行归为 assistant。
 */
function isProjectableCloudMessage(message) {
  if (!message || typeof message !== "object" || Array.isArray(message)) return false;
  if (message.role !== "user" && message.role !== "assistant") return false;
  return Boolean(safeText(message.content, MAX_MESSAGE_TEXT_LENGTH));
}

/**
 * Cache a server-owned conversation for rendering on this device. The cloud
 * payload is normalized through the same privacy/size boundary as local
 * messages, and a stale revision can never replace a newer cached projection.
 * Messages come from the client-normalized conversation (recentTurns 权威来源）：
 * 显式空数组表示"无可恢复消息"并会清空缓存；载荷完全未携带消息（如重命名响应）
 * 时保留本机已有缓存，避免误清空。
 */
function upsertCloudProjection(conversation, options = {}) {
  const source = conversation && typeof conversation === "object" && !Array.isArray(conversation)
    ? conversation
    : null;
  const conversationId = safeText(source && source.conversationId, 80);
  if (!source || !conversationId) return null;

  const store = getStore({ createIfEmpty: false });
  const existing = (store.conversations || []).find((item) => item.conversationId === conversationId) || null;
  const normalizedSource = Object.assign({}, source, {
    conversationId,
    source: "cloud_projection",
    memoryMode: source.memoryMode || source.mode || "cloud_sync",
  });
  if (Array.isArray(source.messages)) {
    normalizedSource.messages = source.messages.filter(isProjectableCloudMessage);
  } else if (existing && Array.isArray(existing.messages)) {
    normalizedSource.messages = existing.messages;
  }
  const projection = normalizeConversation(normalizedSource);

  if (existing) {
    const incomingRevision = safeRevision(projection.revision);
    const existingRevision = safeRevision(existing.revision);
    const incomingTime = toTimestamp(projection.updatedAt);
    const existingTime = toTimestamp(existing.updatedAt);
    const isNewer = incomingRevision > existingRevision
      || (incomingRevision === existingRevision && incomingTime > existingTime);
    if (!isNewer) {
      if (options.activate === true) {
        writeStore(Object.assign({}, store, { activeConversationId: existing.conversationId }));
      }
      return existing;
    }
  }

  const conversations = [projection].concat(
    (store.conversations || []).filter((item) => item.conversationId !== conversationId)
  );
  const nextStore = writeStore({
    schemaVersion: SCHEMA_VERSION,
    activeConversationId: options.activate === true
      ? projection.conversationId
      : (store.activeConversationId || projection.conversationId),
    conversations,
  });
  return nextStore.conversations.find((item) => item.conversationId === projection.conversationId) || projection;
}

function getActiveConversation() {
  const store = getStore();
  return store.conversations.find((item) => item.conversationId === store.activeConversationId) ||
    store.conversations[0] ||
    createConversation();
}

function setActiveConversation(conversationId) {
  const store = getStore();
  const target = store.conversations.find((item) => item.conversationId === conversationId);
  if (!target) return getActiveConversation();
  writeStore(Object.assign({}, store, { activeConversationId: target.conversationId }));
  return target;
}

function createConversation(patch = {}) {
  const store = getStore({ createIfEmpty: false });
  const conversation = createEmptyConversation(patch);
  writeStore({
    schemaVersion: SCHEMA_VERSION,
    activeConversationId: conversation.conversationId,
    conversations: [conversation].concat(store.conversations || []),
  });
  return conversation;
}

function updateConversation(conversationId, updater) {
  const store = getStore();
  const id = conversationId || store.activeConversationId;
  let updated = null;
  const conversations = store.conversations.map((item) => {
    if (item.conversationId !== id) return item;
    const patch = typeof updater === "function" ? updater(item) : updater;
    updated = normalizeConversation(Object.assign({}, item, patch || {}, { updatedAt: nowIso() }));
    return updated;
  });
  if (!updated) return null;
  writeStore(Object.assign({}, store, { conversations }));
  return updated;
}

function saveConversationMessages(conversationId, messages, contextSlots) {
  const sourceMessages = trimMessages(messages);
  return updateConversation(conversationId, (conversation) => {
    const shouldUseGeneratedTitle = !conversation.title || conversation.title === "新查询" || conversation.title === "新对话";
    return {
      title: shouldUseGeneratedTitle ? generateTitleFromMessages(sourceMessages) : conversation.title,
      messages: sourceMessages,
      contextSlots: contextSlots ? normalizeContextSlots(contextSlots) : normalizeContextSlots(conversation.contextSlots),
    };
  });
}

function updateConversationContext(conversationId, contextSlots) {
  return updateConversation(conversationId, {
    contextSlots: normalizeContextSlots(contextSlots),
  });
}

function renameConversation(conversationId, title) {
  const nextTitle = safeText(title, 40) || "新查询";
  return updateConversation(conversationId, { title: nextTitle });
}

function clearConversation(conversationId) {
  return updateConversation(conversationId, {
    messages: [],
    contextSlots: createEmptyContextSlots(),
    title: "新查询",
  });
}

function deleteConversation(conversationId) {
  const store = getStore();
  const remaining = store.conversations.filter((item) => item.conversationId !== conversationId);
  if (!remaining.length) {
    const fresh = createEmptyConversation();
    return writeStore({
      schemaVersion: SCHEMA_VERSION,
      activeConversationId: fresh.conversationId,
      conversations: [fresh],
    });
  }
  return writeStore({
    schemaVersion: SCHEMA_VERSION,
    activeConversationId: store.activeConversationId === conversationId ? remaining[0].conversationId : store.activeConversationId,
    conversations: remaining,
  });
}

function resetForTest() {
  memoryStorage = {};
  removeStorage(STORE_KEY);
  removeStorage(ACTIVE_KEY);
}

module.exports = {
  ACTIVE_KEY,
  LEGACY_HISTORY_KEY,
  MAX_CONVERSATIONS,
  MAX_MESSAGES_PER_CONVERSATION,
  STORE_KEY,
  clearConversation,
  createConversation,
  createEmptyContextSlots,
  deleteConversation,
  generateConversationTitle,
  getActiveConversation,
  getConversationList,
  getStore,
  normalizeContextSlots,
  renameConversation,
  resetForTest,
  saveConversationMessages,
  setActiveConversation,
  updateConversation,
  updateConversationContext,
  upsertCloudProjection,
};
