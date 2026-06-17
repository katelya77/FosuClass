const safetyGuard = require("./safetyGuard");

const ALLOWED_CARD_TYPES = new Set([
  "empty_room",
  "schedule",
  "teacher",
  "course",
  "diagnosis",
  "guide",
  "reminder",
  "generic",
]);

const ALLOWED_ACTION_TYPES = new Set(["navigate", "copy", "retry", "bind", "noop"]);

const ALLOWED_NAVIGATION_URLS = new Set([
  "/pages/school/school",
  "/pages/today/today",
  "/pages/empty-room/empty-room",
  "/pages/schedule-view/schedule-view",
  "/pages/personal-sync/personal-sync",
  "/pages/ai-assistant/ai-assistant",
  "/pages/campus-map/campus-map",
]);

const CARD_TITLE_FALLBACKS = {
  empty_room: "空教室推荐",
  schedule: "今日课程",
  teacher: "教师查询",
  course: "课程查询",
  diagnosis: "数据诊断",
  guide: "使用指引",
  reminder: "时间推荐",
  generic: "结果",
};

const ACTION_LABEL_FALLBACKS = {
  navigate: "查看详情",
  retry: "重新尝试",
  copy: "复制",
  bind: "前往设置",
  noop: "查看",
};

const INVALID_TEXT_TOKENS = new Set(["[object Object]", "undefined", "null", "NaN"]);

function isPrimitive(value) {
  return ["string", "number", "boolean"].includes(typeof value);
}

function primitiveToText(value) {
  if (typeof value === "number" && !Number.isFinite(value)) return "";
  if (typeof value === "boolean") return value ? "true" : "false";
  return String(value);
}

function extractObjectText(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return "";
  const keys = ["text", "label", "title", "value"];
  for (const key of keys) {
    const candidate = value[key];
    if (isPrimitive(candidate)) return primitiveToText(candidate);
  }
  return "";
}

function safePrimitiveText(value, fallback = "", maxLength = 0) {
  let text = "";
  if (isPrimitive(value)) {
    text = primitiveToText(value);
  } else if (value && typeof value === "object" && !Array.isArray(value)) {
    text = extractObjectText(value);
  }
  text = safetyGuard.redactSensitiveText(text).trim();
  if (!text || INVALID_TEXT_TOKENS.has(text)) {
    text = safetyGuard.redactSensitiveText(isPrimitive(fallback) ? primitiveToText(fallback) : "").trim();
  }
  if (!text || INVALID_TEXT_TOKENS.has(text)) return "";
  const limit = Number(maxLength || 0);
  return limit > 0 ? text.slice(0, limit) : text;
}

function normalizeActionType(type) {
  const value = safePrimitiveText(type, "noop", 20).toLowerCase();
  return ALLOWED_ACTION_TYPES.has(value) ? value : "noop";
}

function normalizeCardType(type) {
  const value = safePrimitiveText(type, "generic", 30).toLowerCase();
  return ALLOWED_CARD_TYPES.has(value) ? value : "generic";
}

function isAllowedNavigationUrl(url) {
  const rawUrl = safePrimitiveText(url, "", 240);
  if (!rawUrl) return false;
  const pathOnly = rawUrl.split("?")[0].split("#")[0];
  return Boolean(pathOnly && ALLOWED_NAVIGATION_URLS.has(pathOnly));
}

function normalizePayloadObject(value) {
  return value && typeof value === "object" && !Array.isArray(value)
    ? safetyGuard.sanitizeToolResult(value)
    : {};
}

function stableAction(action) {
  const source = action && typeof action === "object" && !Array.isArray(action) ? action : {};
  let type = normalizeActionType(source.type);
  let url = safePrimitiveText(source.url, "", 240);
  if ((type === "navigate" || type === "bind") && !isAllowedNavigationUrl(url)) {
    type = "noop";
    url = "";
  }
  if (type === "noop") {
    url = "";
  }
  const fallbackLabel = ACTION_LABEL_FALLBACKS[type] || ACTION_LABEL_FALLBACKS.noop;
  const label = safePrimitiveText(source.label, fallbackLabel, 30) || fallbackLabel;
  return {
    label,
    type,
    url,
    payload: normalizePayloadObject(source.payload),
  };
}

function stableCardItem(item) {
  const source = item && typeof item === "object" && !Array.isArray(item) ? item : {};
  const normalized = {
    title: safePrimitiveText(source.title || source.name, "", 80),
    subtitle: safePrimitiveText(source.subtitle || source.desc || source.detail, "", 160),
    value: safePrimitiveText(source.value || source.time || source.status, "", 80),
  };
  return normalized.title || normalized.subtitle || normalized.value ? normalized : null;
}

function normalizeStringArray(value, maxItems, maxLength) {
  if (!Array.isArray(value)) return [];
  const output = [];
  value.slice(0, maxItems).forEach((item) => {
    const text = safePrimitiveText(item, "", maxLength);
    if (text) output.push(text);
  });
  return output;
}

function stableCard(card) {
  if (!card || typeof card !== "object" || Array.isArray(card)) return null;
  const type = normalizeCardType(card.type);
  const items = Array.isArray(card.items)
    ? card.items.slice(0, 12).map(stableCardItem).filter(Boolean)
    : [];
  const actions = Array.isArray(card.actions)
    ? card.actions.slice(0, 4).map(stableAction).filter((item) => item.label)
    : [];
  const badges = normalizeStringArray(card.badges, 8, 40);
  const hasOriginalContent = Boolean(
    card.title || card.subtitle || badges.length || items.length || actions.length
  );
  if (!hasOriginalContent) return null;
  const title = safePrimitiveText(card.title, CARD_TITLE_FALLBACKS[type], 80) || CARD_TITLE_FALLBACKS[type];
  const normalized = {
    type,
    title,
    subtitle: safePrimitiveText(card.subtitle, "", 160),
    badges,
    items,
    actions,
  };
  if (card.allFinished === true) normalized.allFinished = true;
  if (card.variant === "error") normalized.variant = "error";
  if (card.metrics && typeof card.metrics === "object" && !Array.isArray(card.metrics)) {
    normalized.metrics = safetyGuard.sanitizeToolResult(card.metrics);
  }
  return normalized;
}

function stableGeneratedPayload(payload, options = {}) {
  const source = payload && typeof payload === "object" && !Array.isArray(payload) ? payload : {};
  const fallbackAnswer = options.fallbackAnswer || "";
  return {
    answer: safePrimitiveText(source.answer, fallbackAnswer, 1200),
    cards: Array.isArray(source.cards)
      ? source.cards.slice(0, 6).map(stableCard).filter(Boolean)
      : [],
    suggestions: normalizeStringArray(source.suggestions, 6, 60),
  };
}

module.exports = {
  ACTION_LABEL_FALLBACKS,
  ALLOWED_ACTION_TYPES,
  ALLOWED_CARD_TYPES,
  ALLOWED_NAVIGATION_URLS,
  CARD_TITLE_FALLBACKS,
  isAllowedNavigationUrl,
  safePrimitiveText,
  stableAction,
  stableCard,
  stableCardItem,
  stableGeneratedPayload,
};
