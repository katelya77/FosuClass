"use strict";

const { classifyVisionObservation, extractVisionGoalHints } = require("./intake.js");
const { validateVisionObservation } = require("./contract.js");
const { publicProjectionIsSafe } = require("./security.js");

function cleanStrings(values) {
  return [...new Set((Array.isArray(values) ? values : []).filter((value) => typeof value === "string" && value.trim() !== ""))];
}

function createPublicVisionReceipt({ observations, extractedGoal, campusResult, outcomeTitle } = {}) {
  const list = (Array.isArray(observations) ? observations : []).filter((observation) => validateVisionObservation(observation).ok);
  const hints = extractVisionGoalHints(list);
  const kinds = [...new Set(list.map(classifyVisionObservation))];
  const safeGoal = {
    goalFamily: typeof extractedGoal?.goalFamily === "string" ? extractedGoal.goalFamily : null,
    entityLabels: cleanStrings(extractedGoal?.entityLabels || hints.entities.map((entity) => entity.text)),
    temporalLabels: cleanStrings(extractedGoal?.temporalLabels || hints.temporal.map((temporal) => temporal.text)),
  };
  const receipt = {
    kind: kinds.length === 1 ? kinds[0] : "multiple_images",
    observations: list.map((observation) => ({
      assetId: observation.assetId,
      kind: classifyVisionObservation(observation),
      summary: cleanStrings(observation.observations).slice(0, 4),
    })),
    extractedGoal: safeGoal,
    verifiedByCampusTools: Boolean(campusResult && campusResult.verified === true),
    ...(typeof outcomeTitle === "string" && outcomeTitle.trim() ? { outcomeTitle } : {}),
  };
  if (!publicProjectionIsSafe(receipt)) throw new Error("unsafe PublicVisionReceipt projection");
  return receipt;
}

module.exports = { createPublicVisionReceipt };
