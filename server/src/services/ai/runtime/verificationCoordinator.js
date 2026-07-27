/**
 * Verification coordination: pending-clarification state machine and planner
 * outcome verification glue for chat(). Skill/tool verification itself stays in
 * skillRegistry and agentKernel; this module only shapes what chat() passes
 * into buildResponse / memory commit.
 */
function buildClarificationPatch(intent = {}) {
  if (!intent || intent.name !== "clarify_missing_slot") {
    return { pendingClarification: null, clearPendingClarification: false };
  }
  const slot = intent.slots && intent.slots.slot || {};
  const type = ["teacher", "classroom", "course", "class"].includes(slot.type) ? slot.type : "";
  if (!type) {
    return { pendingClarification: null, clearPendingClarification: false };
  }
  const createdAt = Date.now();
  return {
    pendingClarification: {
      intentName: "search_school_index",
      type,
      missing: slot.missing || `${type}Name`,
      createdAt,
      expiresAt: createdAt + 5 * 60 * 1000,
    },
    clearPendingClarification: false,
  };
}

function resolvePendingClarificationPatch(input = {}) {
  const intent = input.intent || {};
  const context = input.context || {};
  const pendingPatch = buildClarificationPatch(intent);
  const pendingExpiresAt = Number(context.pendingClarification && context.pendingClarification.expiresAt || 0);
  const pendingExpired = Boolean(context.pendingClarification && pendingExpiresAt && pendingExpiresAt < Date.now());
  if (intent.name !== "clarify_missing_slot" && intent.slots && intent.slots.filledFromPendingClarification) {
    pendingPatch.clearPendingClarification = true;
  } else if (intent.name !== "clarify_missing_slot" && context.pendingClarification) {
    pendingPatch.clearPendingClarification = true;
  } else if (pendingExpired && !pendingPatch.pendingClarification) {
    pendingPatch.clearPendingClarification = true;
  }
  return pendingPatch;
}

function resolveVerificationGoalContract(execution) {
  return execution.goalContract || (execution.verification && execution.verification.goalContract) || null;
}

module.exports = {
  buildClarificationPatch,
  resolvePendingClarificationPatch,
  resolveVerificationGoalContract,
};
