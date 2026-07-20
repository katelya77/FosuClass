const conversationStore = require("./conversationStore");
const agentCapabilityCompat = require("../shared/agentCapabilityCompat.generated");

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

function getResponseCanonicalIntent(response = {}) {
  const metrics = response.metrics || {};
  const rawIntent = typeof response.intent === "string"
    ? response.intent
    : response.intent && response.intent.name || metrics.canonicalIntent || metrics.intentName;
  return agentCapabilityCompat.toCanonicalIntent(rawIntent);
}

function buildProtocolSlotPatch(slots, canonicalIntent, response = {}) {
  const source = slots && typeof slots === "object" && !Array.isArray(slots) ? slots : {};
  const patch = { lastIntent: canonicalIntent };
  const targetType = normalizeTargetType(source.targetType || source.type);
  const targetName = source.targetName || source.name || source.keyword || "";
  if (targetType) patch.lastTargetType = targetType;
  if (targetName) patch.lastTargetName = targetName;
  if (Number.isFinite(Number(source.week))) patch.lastWeek = Number(source.week);
  if (Number.isFinite(Number(source.weekday))) patch.lastWeekday = Number(source.weekday);
  if (response.answer || response.cards) {
    patch.lastQueryResult = {
      title: String(source.title || targetName || "").slice(0, 120),
      total: Number(response.metrics && response.metrics.resultCount || 0) || 0,
      noCourse: response.metrics && Number(response.metrics.resultCount) === 0,
    };
  }
  const evidence = response.evidence || {};
  const evidenceSource = Array.isArray(evidence.sources) ? evidence.sources[0] : evidence.source;
  if (evidenceSource) patch.lastSource = String(evidenceSource).slice(0, 160);
  return patch;
}

function updateFromResponse(current, response) {
  const source = response || {};
  if (source.contextSlots) {
    return mergeContextSlots(current, source.contextSlots);
  }
  const metrics = source.metrics || {};
  const canonicalIntent = getResponseCanonicalIntent(source);
  const protocolSlots = source.slots && typeof source.slots === "object" && !Array.isArray(source.slots)
    ? source.slots
    : {};
  const canonicalScheduleIntents = [
    "get_today_courses",
    "get_tomorrow_courses",
    "get_next_course",
    "get_week_schedule",
    "search_school_index",
    "get_schedule_detail",
    "next_course_location",
  ];
  if (canonicalScheduleIntents.indexOf(canonicalIntent) >= 0) {
    return mergeContextSlots(current, buildProtocolSlotPatch(protocolSlots, canonicalIntent, source));
  }
  if (["search_campus_place", "get_campus_route", "get_classroom_location"].indexOf(canonicalIntent) >= 0) {
    const navigationSource = Object.assign({}, source, {
      title: protocolSlots.placeName || protocolSlots.location || protocolSlots.targetName || "",
      query: protocolSlots.query || "",
    });
    return mergeContextSlots(current, Object.assign(
      buildNavigationPatch(navigationSource),
      buildProtocolSlotPatch(protocolSlots, canonicalIntent, source)
    ));
  }
  if (["rag_search", "project_qa"].indexOf(canonicalIntent) >= 0) {
    const knowledgeSource = Object.assign({}, source, {
      title: protocolSlots.title || protocolSlots.query || "",
      query: protocolSlots.query || "",
    });
    return mergeContextSlots(current, Object.assign(
      buildKnowledgePatch(knowledgeSource),
      buildProtocolSlotPatch(protocolSlots, canonicalIntent, source)
    ));
  }
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
