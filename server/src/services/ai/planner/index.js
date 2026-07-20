/**
 * Unified Planner entry.
 */

const deterministicPlanner = require("./deterministicPlanner");
const modelPlanner = require("./modelPlanner");
const { getPlannerPolicy } = require("./plannerPolicy");
const { runObservationLoop } = require("./observationLoop");
const { normalizePlan } = require("./planSchema");
const { validatePlan } = require("./planValidator");

async function plan(input = {}) {
  const policy = getPlannerPolicy(input.runtimeMode);
  if (policy.useModelPlanner) {
    return modelPlanner.plan(input);
  }
  return deterministicPlanner.plan(input);
}

async function replan(input = {}) {
  const policy = getPlannerPolicy(input.runtimeMode);
  if (policy.useModelPlanner) {
    return modelPlanner.replan(input);
  }
  return deterministicPlanner.replan(input);
}

module.exports = {
  plan,
  replan,
  runObservationLoop,
  getPlannerPolicy,
  normalizePlan,
  validatePlan,
  deterministicPlanner,
  modelPlanner,
};
