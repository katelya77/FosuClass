"use strict";

// Live CampusTool activation seam.  Raw candidates never leave the trusted
// handler to be re-labelled as verified by a model: the deterministic engine
// consumes the handler's verified envelope before the public response returns.
const { decide } = require("./controller.js");
const { synthesizeOutcome } = require("./outcome-synthesizer.js");

const LIVE_DECISION_TOOLS = Object.freeze({
  campus_classroom_search: { goalFamily: "teaching_assurance", factKey: "spaceFacts", needSpace: true },
  campus_teacher_load_query: { goalFamily: "campus_operations_insight", factKey: "rankingFacts" },
  campus_common_free_time_query: { goalFamily: "collaboration_planning", factKey: "availabilityFacts" },
  campus_room_utilization_query: { goalFamily: "campus_operations_insight", factKey: "spaceUtilFacts" },
  campus_reschedule_feasibility: { goalFamily: "reschedule_simulation", factKey: "rescheduleSimFacts" },
  campus_group_plan: { goalFamily: "collaboration_planning", factKey: "groupPlanFacts" },
});

function allowlistedPreferences(raw) {
  const value = raw && typeof raw === "object" && !Array.isArray(raw) ? raw : {};
  const preferences = {};
  if (value.preferEarlier === true) preferences.preferEarlier = true;
  if (value.preferLarger === true) preferences.preferLarger = true;
  if (value.preferSameCampus === true) preferences.preferSameCampus = true;
  if (Array.isArray(value.preferWeekdays)) {
    const weekdays = value.preferWeekdays.filter((day) => Number.isInteger(day) && day >= 1 && day <= 7);
    if (weekdays.length) preferences.preferWeekdays = weekdays;
  }
  return preferences;
}

function trustedConstraints(toolName, params, raw) {
  const constraints = {};
  if (Number.isInteger(params && params.minCapacity) && params.minCapacity > 0) {
    constraints.minCapacity = params.minCapacity;
  }
  // Only adapters that carry the same canonical scalar may evaluate it.  The
  // normalized value comes from the verified handler query, never an LLM echo.
  if (["campus_classroom_search", "campus_room_utilization_query"].includes(toolName)) {
    const query = raw && raw.query && typeof raw.query === "object" ? raw.query : {};
    if (typeof query.campus === "string" && query.campus) constraints.campus = query.campus;
    if (typeof query.building === "string" && query.building) constraints.building = query.building;
  }
  if (toolName === "campus_classroom_search" || toolName === "campus_group_plan") constraints.needSpace = true;
  return constraints;
}

function trustedMission(config, toolName, raw, trustedContext) {
  const fact = {
    factKey: config.factKey,
    toolName,
    resultRef: typeof raw.queryId === "string" ? raw.queryId : null,
    verified: true,
  };
  return {
    goal: { goalFamily: config.goalFamily, completionCriteria: [config.factKey] },
    availableFacts: { [config.factKey]: fact },
    steps: [],
    authorityLevel: trustedContext && trustedContext.authorityLevel || "L2",
  };
}

function publicAction(action) {
  if (!action || typeof action.label !== "string" || typeof action.query !== "string") return null;
  return { type: "sys.chat", label: action.label, payload: { query: action.query } };
}

function publicRuntimeDecision(core, outcome) {
  const receipt = outcome.receipt;
  const nextAction = publicAction(receipt.nextAction);
  const authorityNeedsChoice = Boolean(core.authority && core.authority.level === "L3" && core.authority.requiresConfirm === true);
  const status = core.verified !== true
    ? "needs_more_facts"
    : core.decision === "no_viable_option"
      ? "no_feasible_candidate"
      : authorityNeedsChoice
        ? "needs_user_choice"
        : "recommended";
  return {
    status,
    preferred: receipt.recommendation,
    alternatives: receipt.alternatives,
    reasons: receipt.recommendation ? receipt.recommendation.reasons : [],
    tradeoffs: receipt.alternatives.map((alternative) => ({
      label: alternative.label,
      reasons: alternative.reasons,
    })),
    nextActions: nextAction ? [nextAction] : [],
    receipt,
    resultCard: outcome.viewModel,
  };
}

function activateDecisionForTool(toolName, params, raw, trustedContext = {}) {
  const config = LIVE_DECISION_TOOLS[toolName];
  if (!config || !raw || raw.success !== true || !raw.evidence || raw.evidence.verified !== true) return null;
  const goalSpec = {
    goalFamily: config.goalFamily,
    constraints: trustedConstraints(toolName, params || {}, raw),
    preferences: allowlistedPreferences(params && params.decisionPreferences),
    selection: { topN: 3 },
  };
  const core = decide({
    missionState: trustedMission(config, toolName, raw, trustedContext),
    toolResults: { [toolName]: raw },
    goalSpec,
  });
  const outcome = synthesizeOutcome(core);
  if (!outcome.ok || !outcome.viewModel) return null;
  return publicRuntimeDecision(core, outcome);
}

module.exports = {
  LIVE_DECISION_TOOLS,
  allowlistedPreferences,
  trustedConstraints,
  activateDecisionForTool,
  publicRuntimeDecision,
};
