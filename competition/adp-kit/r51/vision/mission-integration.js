"use strict";

const { validateVisionObservation } = require("./contract.js");
const { classifyVisionObservation, extractVisionGoalHints } = require("./intake.js");
const { planMission } = require("../mission/planner.js");
const { newMissionState } = require("../mission/model.js");
const { evaluateMission } = require("../mission/completion.js");
const personalBridge = require("../../personal-bridge/bridge.js");

const ENTITY_TYPES_BY_FAMILY = Object.freeze({
  schedule_inquiry: new Set(["course", "teacher", "class", "student"]),
  schedule_range_inquiry: new Set(["course", "teacher", "class", "student"]),
  risk_inquiry: new Set(["course", "teacher", "class", "student"]),
  teaching_assurance: new Set(["course", "teacher", "class", "student", "classroom"]),
  space_inquiry: new Set(["classroom", "building", "campus", "location"]),
  space_utilization_inquiry: new Set(["classroom", "building", "campus", "location"]),
  ranking_inquiry: new Set(["teacher", "classroom", "building", "campus"]),
  campus_operations_insight: new Set(["teacher", "classroom", "building", "campus"]),
  reschedule_simulation: new Set(["course", "classroom"]),
});

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function relevantEntities(goalFamily, entities) {
  const allowed = ENTITY_TYPES_BY_FAMILY[goalFamily];
  if (!allowed) return [];
  return entities.filter((entity) => allowed.has(entity.type));
}

function candidateGoalSpec(goalSpec, observations, hints) {
  const next = clone(goalSpec);
  next.visionObservations = clone(observations);
  const entities = relevantEntities(next.goalFamily, hints.entities);
  if ((!next.target || Object.keys(next.target).length === 0) && entities.length === 1) {
    next.target = { entityType: entities[0].type, entityRef: null, name: entities[0].text };
  } else if ((!next.target || Object.keys(next.target).length === 0) && entities.length > 1) {
    next.target = {
      entities: entities.map((entity) => ({ type: entity.type, name: entity.text })),
      resolved: false,
    };
  }
  const temporal = hints.temporal[0];
  const currentTemporal = next.temporalScope || {};
  const hasResolved = currentTemporal.kind === "explicit"
    || currentTemporal.date != null || currentTemporal.week != null
    || currentTemporal.weekStart != null || currentTemporal.weekEnd != null;
  if (!hasResolved && temporal) {
    next.temporalScope = { kind: "history", dateText: temporal.text };
  }
  return next;
}

function summaryFor(observations) {
  const lines = observations.flatMap((observation) => [
    ...observation.observations,
    ...observation.extractedText,
  ]).filter((line) => line && line !== "[已隔离的图片指令文本]");
  return [...new Set(lines)].slice(0, 8).join("；");
}

function prepareVisionTurn({ mode, observations, goalSpec } = {}) {
  const list = Array.isArray(observations) ? observations : [];
  const invalid = list.flatMap((observation, index) => validateVisionObservation(observation).errors.map((error) => `observation[${index}]: ${error}`));
  if (list.length === 0 || invalid.length > 0) {
    return { ok: false, recoverable: true, errors: list.length ? invalid : ["missing vision observations"], observations: [], verified: false, missionState: null };
  }
  const safeObservations = clone(list);
  const hints = extractVisionGoalHints(safeObservations);
  const base = {
    ok: true,
    observations: safeObservations,
    hints,
    verified: false,
    recoverable: hints.recoverable,
  };
  const effectiveMode = goalSpec && personalBridge.PERSONAL_SYNC_WRITE_INTENTS.includes(goalSpec.intent)
    ? "personal_import"
    : mode;
  if (effectiveMode === "static_explanation") {
    return {
      ...base,
      canAnswerDirectly: true,
      requiresCampusVerification: false,
      staticSummary: summaryFor(safeObservations),
      missionState: null,
      plan: null,
    };
  }
  if (effectiveMode === "personal_import") {
    const bridge = personalBridge.buildBridgeMessage("import");
    return {
      ...base,
      canAnswerDirectly: false,
      requiresCampusVerification: true,
      authorityLevel: "L3",
      requiresConfirm: true,
      executed: false,
      personalBridge: bridge,
      missionState: null,
      plan: null,
    };
  }
  if (effectiveMode !== "dynamic_verification" || !goalSpec) {
    return { ...base, ok: false, errors: ["dynamic vision turn requires a structured GoalSpec"], missionState: null };
  }
  const nextGoal = candidateGoalSpec(goalSpec, safeObservations, hints);
  const plan = planMission(nextGoal);
  const missionState = newMissionState(nextGoal, { kind: "NEW_TASK" });
  missionState.steps = plan.steps;
  missionState.goal.completionCriteria = plan.completionCriteria;
  missionState.unresolvedRequirements = plan.unresolved;
  return {
    ...base,
    canAnswerDirectly: false,
    requiresCampusVerification: true,
    goalSpec: nextGoal,
    plan,
    missionState,
    completion: evaluateMission(missionState),
  };
}

function buildVisionChildParameters(preparedTurn) {
  if (!preparedTurn || !preparedTurn.ok || !preparedTurn.goalSpec) return null;
  const goalSpec = preparedTurn.goalSpec;
  return {
    goalFamily: goalSpec.goalFamily,
    target: clone(goalSpec.target || {}),
    temporalScope: clone(goalSpec.temporalScope || {}),
    constraints: clone(goalSpec.constraints || {}),
    selection: clone(goalSpec.selection || {}),
  };
}

function safeResultCard(card) {
  if (!card) return null;
  if (card.layoutMode !== "result-card" && card.layoutMode !== "week-board") return null;
  const actions = Array.isArray(card.actions) ? card.actions : [];
  const valid = actions.every((action) => action && action.type === "sys.chat"
    && action.payload && typeof action.payload.query === "string"
    && Object.keys(action.payload).length === 1);
  return valid ? card : null;
}

function collectDifferences(observations, facts) {
  const differences = [];
  const entities = observations.flatMap((observation) => observation.entityCandidates);
  const temporal = observations.flatMap((observation) => observation.temporalCandidates);
  const visualLocation = entities.find((entity) => ["location", "classroom"].includes(entity.type));
  const verifiedLocation = facts.location || facts.classroom || facts.roomName;
  if (visualLocation && verifiedLocation && visualLocation.text !== verifiedLocation) {
    differences.push({ field: "location", visual: visualLocation.text, authoritative: verifiedLocation });
  }
  const visualWeekday = temporal.find((candidate) => candidate.weekday != null);
  if (visualWeekday && facts.weekday != null && visualWeekday.weekday !== facts.weekday) {
    differences.push({ field: "weekday", visual: visualWeekday.weekday, authoritative: facts.weekday });
  }
  return differences;
}

function reconcileVisionWithCampusFacts({ observations, campusResult } = {}) {
  const list = Array.isArray(observations) ? observations : [];
  if (!campusResult || campusResult.verified !== true) {
    return {
      status: "needs_more_facts",
      verified: false,
      authoritativeFacts: null,
      differences: [],
      resultCard: null,
    };
  }
  const facts = clone(campusResult.facts || {});
  const differences = collectDifferences(list, facts);
  return {
    status: differences.length ? "verified_with_differences" : "verified",
    verified: true,
    authoritativeFacts: facts,
    differences,
    resultCard: safeResultCard(campusResult.resultCard),
  };
}

module.exports = {
  ENTITY_TYPES_BY_FAMILY,
  prepareVisionTurn,
  buildVisionChildParameters,
  reconcileVisionWithCampusFacts,
};
