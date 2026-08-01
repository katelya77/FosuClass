/**
 * Strict plan schema for constrained Agent Planner.
 * No hidden reasoning text allowed in plan output.
 */

const REASON_CODES = Object.freeze([
  "NEED_CURRENT_SCHEDULE",
  "NEED_TEACHING_WEEK",
  "NEED_EMPTY_ROOM_RESULTS",
  "NEED_WEATHER",
  "NEED_CAMPUS_LOCATION",
  "NEED_KNOWLEDGE",
  "NEED_SCHOOL_INDEX",
  "NEED_SCHEDULE_DETAIL",
  "NEED_USER_CLARIFICATION",
  "NEED_DATA_STATUS",
  "NEED_PERSONAL_IMPORT_HELP",
  "NEED_MEETING_TIME",
  "NEED_ROUTE",
  "COMPOSE_TEXT_RESPONSE",
  "EXPAND_EMPTY_ROOM_SEARCH",
]);

const STOP_CONDITIONS = Object.freeze([
  "all_steps_done",
  "clarification_needed",
  "empty_result_recovery",
  "tool_failure",
  "budget_exhausted",
]);

// Low-cardinality provenance of the resolved plan. `model_skeleton` means the
// model Decision plan.steps skeleton genuinely constrained step selection/order;
// the deterministic_* values record which deterministic path produced the plan.
const PLAN_SOURCES = Object.freeze([
  "model_skeleton",
  "deterministic",
  "deterministic_fallback",
  "deterministic_adaptive",
  "deterministic_public",
]);

// Enum-only rewrite/rejection reasons for planAdjustments (no free text).
const ADJUSTMENT_REASON_CODES = Object.freeze([
  "MODEL_STEP_SKILL_UNKNOWN",
  "MODEL_STEP_TOOL_FILTERED",
  "MODEL_STEP_TRUNCATED",
  "MODEL_SKELETON_EMPTY",
  "MODEL_SKELETON_BYPASSED",
  "PLANNER_SOFT_FALLBACK",
]);

const MAX_PLAN_ADJUSTMENTS = 8;

const MAX_STEPS = 6;
const MAX_REPLAN = 2;

function safeText(value, max = 120) {
  return String(value == null ? "" : value).trim().slice(0, max);
}

function emptyPlan(overrides = {}) {
  return {
    goal: "",
    intent: "",
    confidence: 0,
    slots: {},
    needsClarification: false,
    clarification: null,
    steps: [],
    stopCondition: "all_steps_done",
    replanCount: 0,
    plannerType: "deterministic",
    ...overrides,
  };
}

function normalizeStep(step = {}, index = 0) {
  const id = safeText(step.id || `step-${index + 1}`, 40) || `step-${index + 1}`;
  const toolName = safeText(step.toolName || step.name, 80);
  const reasonCode = REASON_CODES.includes(String(step.reasonCode || ""))
    ? String(step.reasonCode)
    : "COMPOSE_TEXT_RESPONSE";
  return {
    id,
    skillId: safeText(step.skillId, 80),
    toolName,
    args: step.args && typeof step.args === "object" && !Array.isArray(step.args) ? step.args : {},
    reasonCode,
    dependsOn: Array.isArray(step.dependsOn)
      ? step.dependsOn.map((item) => safeText(item, 40)).filter(Boolean).slice(0, 5)
      : [],
    stopOnFailure: step.stopOnFailure !== false,
  };
}

function normalizeClarification(value) {
  if (!value || typeof value !== "object") return null;
  const slot = safeText(value.slot, 40);
  const prompt = safeText(value.prompt, 200);
  if (!slot || !prompt) return null;
  return {
    slot,
    prompt,
    suggestions: Array.isArray(value.suggestions)
      ? value.suggestions.map((item) => safeText(item, 40)).filter(Boolean).slice(0, 6)
      : [],
  };
}

function normalizePlanSource(raw = {}) {
  const explicit = String(raw.planSource || "");
  if (PLAN_SOURCES.includes(explicit)) return explicit;
  const plannerType = String(raw.plannerType || "");
  if (plannerType === "model" || plannerType === "model_replan") return "model_skeleton";
  if (plannerType === "deterministic_fallback") return "deterministic_fallback";
  return "deterministic";
}

function normalizePlanAdjustments(value) {
  if (!Array.isArray(value)) return [];
  return value.map((item) => ({
    stepId: safeText(item && item.stepId, 40),
    reasonCode: ADJUSTMENT_REASON_CODES.includes(String(item && item.reasonCode || ""))
      ? String(item.reasonCode)
      : "",
  })).filter((item) => item.reasonCode).slice(0, MAX_PLAN_ADJUSTMENTS);
}

function normalizePlan(raw = {}) {
  const steps = Array.isArray(raw.steps) ? raw.steps.map(normalizeStep).filter((s) => s.toolName) : [];
  const clarification = normalizeClarification(raw.clarification);
  const needsClarification = raw.needsClarification === true || Boolean(clarification);
  return {
    goal: safeText(raw.goal, 200),
    intent: safeText(raw.intent || raw.intentName, 80),
    confidence: Math.max(0, Math.min(1, Number(raw.confidence) || 0)),
    slots: raw.slots && typeof raw.slots === "object" && !Array.isArray(raw.slots) ? raw.slots : {},
    needsClarification,
    clarification,
    steps: steps.slice(0, MAX_STEPS),
    stopCondition: STOP_CONDITIONS.includes(String(raw.stopCondition || ""))
      ? String(raw.stopCondition)
      : (needsClarification ? "clarification_needed" : "all_steps_done"),
    replanCount: Math.max(0, Math.min(MAX_REPLAN, Number(raw.replanCount) || 0)),
    plannerType: safeText(raw.plannerType || "deterministic", 32) || "deterministic",
    planSource: normalizePlanSource(raw),
    planAdjustments: normalizePlanAdjustments(raw.planAdjustments),
  };
}

module.exports = {
  ADJUSTMENT_REASON_CODES,
  MAX_PLAN_ADJUSTMENTS,
  MAX_REPLAN,
  MAX_STEPS,
  PLAN_SOURCES,
  REASON_CODES,
  STOP_CONDITIONS,
  emptyPlan,
  normalizeClarification,
  normalizePlan,
  normalizePlanAdjustments,
  normalizePlanSource,
  normalizeStep,
};
