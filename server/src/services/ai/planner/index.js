/**
 * Unified Planner entry.
 */

const deterministicPlanner = require("./deterministicPlanner");
const modelPlanner = require("./modelPlanner");
const plannerModelAdapter = require("./plannerModelAdapter");
const { getPlannerPolicy } = require("./plannerPolicy");
const { runObservationLoop } = require("./observationLoop");
const { normalizePlan } = require("./planSchema");
const { validatePlan } = require("./planValidator");

async function plan(input = {}) {
  if (input.unifiedDecision === true) return deterministicPlanner.plan(input);
  const policy = getPlannerPolicy(input.runtimeMode, input.plannerEnv || input.providerRuntimeConfig || process.env);
  if (policy.useModelPlanner) {
    return modelPlanner.plan(input);
  }
  return deterministicPlanner.plan(input);
}

async function replan(input = {}) {
  if (input.unifiedDecision === true) return deterministicPlanner.replan(input);
  const policy = getPlannerPolicy(input.runtimeMode, input.plannerEnv || input.providerRuntimeConfig || process.env);
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
  plannerModelAdapter,
};
