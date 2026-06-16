const crypto = require("crypto");
const generatedPayloadContract = require("./generatedPayloadContract");
const safetyGuard = require("./safetyGuard");

const PROTOCOL_VERSION = "agent.v1";

const INTENT_DEFINITIONS = Object.freeze({
  clarify_missing_slot: { public: true, fact: true },
  get_today_courses: { public: true, fact: true },
  get_tomorrow_courses: { public: true, fact: true },
  get_next_course: { public: true, fact: true },
  get_week_schedule: { public: true, fact: true },
  get_teaching_week: { public: true, fact: true },
  get_term_calendar: { public: true, fact: true },
  search_empty_rooms: { public: true, fact: true },
  search_continuous_empty_rooms: { public: true, fact: true },
  search_school_index: { public: true, fact: true },
  get_schedule_detail: { public: true, fact: true },
  recommend_meeting_time: { public: true, fact: true },
  diagnose_data_status: { public: true, fact: true },
  explain_personal_import: { public: true, fact: true },
  get_campus_weather: { public: true, fact: false },
  get_course_weather_advice: { public: true, fact: false },
  search_campus_place: { public: true, fact: true },
  get_campus_route: { public: true, fact: true },
  get_classroom_location: { public: true, fact: true },
  rag_search: { public: true, fact: false },
  project_qa: { public: true, fact: false },
  conversational_help: { public: false, fact: false },
  generate_image: { public: false, competition: true, fact: false },
  campus_multi_step_advice: { public: true, fact: true },
});

const TOOL_DEFINITIONS = Object.freeze({
  get_today_courses: { public: true },
  get_tomorrow_courses: { public: true },
  get_next_course: { public: true },
  get_week_schedule: { public: true },
  get_teaching_week: { public: true },
  get_term_calendar: { public: true },
  search_empty_rooms: { public: true },
  search_continuous_empty_rooms: { public: true },
  search_school_index: { public: true },
  get_schedule_detail: { public: true },
  diagnose_data_status: { public: true },
  explain_personal_import: { public: true },
  recommend_meeting_time: { public: true },
  clarify_missing_slot: { public: true },
  get_campus_weather: { public: true },
  get_course_weather_advice: { public: true },
  search_campus_place: { public: true },
  get_campus_route: { public: true },
  get_classroom_location: { public: true },
  rag_search: { public: true },
  generate_image: { public: false, competition: true },
});

const CARD_TYPES = new Set(generatedPayloadContract.ALLOWED_CARD_TYPES);
const ACTION_TYPES = new Set(generatedPayloadContract.ALLOWED_ACTION_TYPES);

function createRequestId() {
  if (crypto.randomUUID) return crypto.randomUUID();
  return crypto.randomBytes(16).toString("hex");
}

function isSupportedProtocolVersion(value) {
  return !value || String(value) === PROTOCOL_VERSION;
}

function normalizeRuntimeMode(value) {
  return String(value || "").trim().toLowerCase() === "competition" ? "competition" : "public";
}

function isKnownIntent(name) {
  return Object.prototype.hasOwnProperty.call(INTENT_DEFINITIONS, String(name || ""));
}

function isKnownTool(name) {
  return Object.prototype.hasOwnProperty.call(TOOL_DEFINITIONS, String(name || ""));
}

function isPublicIntent(name) {
  const item = INTENT_DEFINITIONS[String(name || "")];
  return Boolean(item && item.public);
}

function isFactIntent(name) {
  const item = INTENT_DEFINITIONS[String(name || "")];
  return Boolean(item && item.fact);
}

function isAllowedToolForRuntime(name, runtimeMode) {
  const item = TOOL_DEFINITIONS[String(name || "")];
  if (!item) return false;
  if (normalizeRuntimeMode(runtimeMode) === "competition") return true;
  return item.public === true;
}

function stableSlots(slots = {}) {
  return safetyGuard.sanitizeToolResult(slots && typeof slots === "object" && !Array.isArray(slots) ? slots : {});
}

function buildPlanStep(toolName, args = {}, reason = "") {
  return {
    toolName: String(toolName || ""),
    args: stableSlots(args),
    reason: safetyGuard.redactSensitiveText(String(reason || "")).slice(0, 160),
  };
}

function normalizePlan(plan = [], runtimeMode = "public") {
  const list = Array.isArray(plan) ? plan : [];
  return list
    .map((item) => buildPlanStep(item.toolName || item.name, item.args || item.input || {}, item.reason || ""))
    .filter((item) => item.toolName && isAllowedToolForRuntime(item.toolName, runtimeMode))
    .slice(0, 6);
}

function summarizeEvidenceItem(call = {}) {
  const result = call.result || {};
  const meta = result.meta || result.metadata || {};
  return {
    toolName: String(call.name || call.toolName || "").slice(0, 80),
    status: String(call.status || (result.success === false ? "failed" : "success")).slice(0, 24),
    sourceId: String(result.sourceId || result.source || meta.sourceId || "").slice(0, 120),
    updatedAt: String(result.updatedAt || meta.updatedAt || "").slice(0, 40),
    checksum: String(result.checksum || meta.checksum || "").slice(0, 80),
    factCount: Number(result.total || result.courseCount || (Array.isArray(result.items) ? result.items.length : 0) || 0) || 0,
  };
}

function buildProtocolEnvelope(payload = {}) {
  const runtimeMode = normalizeRuntimeMode(payload.runtimeMode);
  const toolCalls = Array.isArray(payload.rawToolCalls || payload.toolCalls)
    ? (payload.rawToolCalls || payload.toolCalls)
    : [];
  const evidenceItems = toolCalls.map(summarizeEvidenceItem).filter((item) => item.toolName);
  return {
    protocolVersion: PROTOCOL_VERSION,
    requestId: payload.requestId || createRequestId(),
    conversationId: String(payload.conversationId || "").slice(0, 80),
    runtimeMode,
    intent: payload.intent && payload.intent.name || "conversational_help",
    slots: stableSlots(payload.intent && payload.intent.slots || payload.slots || {}),
    plan: normalizePlan(payload.plan || [], runtimeMode),
    evidenceItems,
  };
}

function validateCards(cards = []) {
  return (Array.isArray(cards) ? cards : []).map((card) => {
    const stable = generatedPayloadContract.stableCard(card);
    if (!stable || !CARD_TYPES.has(stable.type)) return null;
    return stable;
  }).filter(Boolean).slice(0, 8);
}

function validateActions(cards = []) {
  return validateCards(cards).flatMap((card) => card.actions || []).every((action) => ACTION_TYPES.has(action.type));
}

function validateResponse(payload = {}) {
  const cards = validateCards(payload.cards);
  const errors = [];
  if (!isSupportedProtocolVersion(payload.protocolVersion || PROTOCOL_VERSION)) {
    errors.push({ code: "PROTOCOL_VERSION_UNSUPPORTED" });
  }
  if (!isKnownIntent(payload.intent && payload.intent.name || payload.intent || "conversational_help")) {
    errors.push({ code: "INTENT_UNKNOWN" });
  }
  const plan = normalizePlan(payload.plan || [], payload.runtimeMode);
  const invalidPlan = (Array.isArray(payload.plan) ? payload.plan : []).filter((step) => !isKnownTool(step.toolName || step.name));
  if (invalidPlan.length) errors.push({ code: "TOOL_NOT_WHITELISTED" });
  if (!validateActions(cards)) errors.push({ code: "ACTION_NOT_WHITELISTED" });
  return {
    ok: errors.length === 0,
    errors,
    cards,
    plan,
  };
}

module.exports = {
  PROTOCOL_VERSION,
  INTENT_DEFINITIONS,
  TOOL_DEFINITIONS,
  buildPlanStep,
  buildProtocolEnvelope,
  createRequestId,
  isAllowedToolForRuntime,
  isFactIntent,
  isKnownIntent,
  isKnownTool,
  isPublicIntent,
  isSupportedProtocolVersion,
  normalizePlan,
  normalizeRuntimeMode,
  stableSlots,
  validateResponse,
};
