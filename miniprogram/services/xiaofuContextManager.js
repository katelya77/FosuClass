const conversationStore = require("./conversationStore");

const SCHEDULE_TARGET_TYPES = ["class", "teacher", "room", "classroom", "course"];

function normalizeTargetType(type) {
  const value = String(type || "").trim();
  if (value === "classroom") return "room";
  if (SCHEDULE_TARGET_TYPES.indexOf(value) >= 0) return value;
  if (value === "school_knowledge" || value === "navigation") return value;
  return "";
}

function createEmptyContextSlots() {
  return conversationStore.createEmptyContextSlots();
}

function normalizeContextSlots(slots) {
  return conversationStore.normalizeContextSlots(slots);
}

function buildSchedulePatch(parsed, result) {
  const source = parsed || {};
  const payload = result || {};
  const targetType = normalizeTargetType(source.targetType || payload.targetType);
  const targetName = source.targetName || payload.targetName || "";
  const week = Number.isFinite(Number(source.week)) ? Number(source.week) : payload.week;
  const weekday = Number.isFinite(Number(source.weekday)) ? Number(source.weekday) : payload.weekday;
  return {
    lastIntent: "schedule_query",
    lastTargetType: targetType,
    lastTargetName: targetName,
    lastWeek: Number.isFinite(Number(week)) ? Number(week) : null,
    lastWeekday: Number.isFinite(Number(weekday)) ? Number(weekday) : null,
    lastQueryResult: payload.lastQueryResult || {
      title: payload.title || "",
      total: Number(payload.total || 0) || 0,
      noCourse: payload.noCourse === true,
    },
    lastSource: payload.source || "school-schedule-index",
  };
}

function buildKnowledgePatch(result) {
  const source = result || {};
  return {
    lastIntent: "school_knowledge",
    lastTargetType: "school_knowledge",
    lastTargetName: source.title || source.query || "",
    lastWeek: null,
    lastWeekday: null,
    lastQueryResult: {
      title: source.title || "",
      sourceUrl: source.sourceUrl || "",
      confidence: source.confidence || "",
    },
    lastSource: source.sourceUrl || "fosu-rag-knowledge-base",
  };
}

function buildNavigationPatch(result) {
  const source = result || {};
  return {
    lastIntent: "navigation",
    lastTargetType: "navigation",
    lastTargetName: source.title || source.query || "",
    lastWeek: null,
    lastWeekday: null,
    lastQueryResult: {
      title: source.title || "",
      sourceUrl: source.sourceUrl || "",
      entryType: "navigation",
    },
    lastSource: source.sourceUrl || "fosu-navigation-knowledge-base",
  };
}

function mergeContextSlots(current, patch) {
  return normalizeContextSlots(Object.assign({}, normalizeContextSlots(current), patch || {}));
}

function updateFromResponse(current, response) {
  const source = response || {};
  if (source.contextSlots) {
    return mergeContextSlots(current, source.contextSlots);
  }
  const metrics = source.metrics || {};
  if (["schedule_status", "help", "smalltalk", "ambiguous", "app_navigation", "personal_schedule", "quick_action"].indexOf(metrics.intentName) >= 0) {
    return normalizeContextSlots(current);
  }
  if (metrics.intentName === "navigation" || metrics.intentName === "navigation_followup") {
    return mergeContextSlots(current, buildNavigationPatch(source));
  }
  if (metrics.intentName === "school_knowledge") {
    return mergeContextSlots(current, buildKnowledgePatch(source));
  }
  if (/schedule/.test(String(metrics.intentName || ""))) {
    return mergeContextSlots(current, buildSchedulePatch(source.parsedIntent || {}, source));
  }
  return normalizeContextSlots(current);
}

function getFollowupTarget(slots) {
  const context = normalizeContextSlots(slots);
  const type = normalizeTargetType(context.lastTargetType);
  if (!type || type === "school_knowledge" || type === "navigation") return null;
  if (!context.lastTargetName) return null;
  return {
    targetType: type === "room" ? "classroom" : type,
    targetName: context.lastTargetName,
    week: context.lastWeek,
    weekday: context.lastWeekday,
  };
}

module.exports = {
  buildKnowledgePatch,
  buildNavigationPatch,
  buildSchedulePatch,
  createEmptyContextSlots,
  getFollowupTarget,
  mergeContextSlots,
  normalizeContextSlots,
  normalizeTargetType,
  updateFromResponse,
};
