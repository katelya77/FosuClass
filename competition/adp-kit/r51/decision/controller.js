"use strict";
// Campus Decision Intelligence —— Mission Decision Controller（2026-08-20）
// 唯一路由键为结构化 goalFamily；本模块不接受、读取或解释原始 query。
const { profileFromGoalSpec, validateProfile } = require("./constraint-profile.js");
const { FACT_ADAPTORS, candidatesForFact, verifiedOf } = require("./candidate-source.js");
const { evaluateCandidates } = require("./evaluator.js");
const { rankFeasible } = require("./ranking.js");
const { selectDecision } = require("./alternatives.js");
const { explainCandidate } = require("./explainability.js");
const { nextBestAction } = require("./next-best-action.js");
const { authorityAwareAction, authorityLevelFor } = require("./authority-action.js");

const ELIGIBLE_GOAL_FAMILIES = Object.freeze([
  "collaboration_planning",
  "reschedule_simulation",
  "teaching_assurance",
  "campus_operations_insight",
]);

function isDecisionEligible(goalFamily) {
  return ELIGIBLE_GOAL_FAMILIES.includes(goalFamily);
}

function structuredGoalFamily(missionState, goalSpec) {
  const stateFamily = missionState && missionState.goal && missionState.goal.goalFamily;
  const specFamily = goalSpec && goalSpec.goalFamily;
  // 两个结构化来源冲突时 fail closed，绝不借助 query 猜测。
  if (stateFamily && specFamily && stateFamily !== specFamily) return null;
  return stateFamily || specFamily || null;
}

function sourcePriority(goalFamily, goalSpec) {
  switch (goalFamily) {
    case "collaboration_planning":
      return ["groupPlanFacts", "availabilityFacts", "spaceFacts"];
    case "reschedule_simulation":
      return ["rescheduleSimFacts"];
    case "teaching_assurance":
      return goalSpec && goalSpec.constraints && goalSpec.constraints.needSpace === true
        ? ["spaceFacts", "riskFacts"]
        : ["riskFacts"];
    case "campus_operations_insight":
      return ["rankingFacts"];
    default:
      return [];
  }
}

function verifiedSource(factKey, missionState, toolResults) {
  const fact = missionState && missionState.availableFacts && missionState.availableFacts[factKey];
  if (!fact || fact.verified !== true) return null;
  const def = FACT_ADAPTORS[factKey];
  if (!def) {
    // riskFacts 当前没有规范化候选适配器；仍记录双重核验的空来源，绝不从风险文本造候选。
    const toolName = fact.toolName || (factKey === "riskFacts" ? "campus_risk_check" : null);
    const raw = toolName && toolResults && toolResults[toolName];
    return raw && verifiedOf(raw) ? { factKey, fact, toolName, raw, candidates: [] } : null;
  }
  const toolName = fact.toolName || def.tool;
  const raw = toolResults && toolResults[toolName];
  if (!raw || verifiedOf(raw) !== true) return null;
  return {
    factKey,
    fact,
    toolName,
    raw,
    candidates: candidatesForFact(factKey, toolResults, { fact, toolName, resultRef: fact.resultRef }),
  };
}

function selectCandidateSource(goalFamily, missionState, toolResults, goalSpec) {
  let firstVerifiedEmpty = null;
  for (const factKey of sourcePriority(goalFamily, goalSpec)) {
    const source = verifiedSource(factKey, missionState, toolResults);
    if (!source) continue;
    if (source.candidates.length > 0) return source;
    if (!firstVerifiedEmpty) firstVerifiedEmpty = source;
  }
  return firstVerifiedEmpty;
}

function emptyEvaluation() {
  return { items: [], feasible: [], infeasible: [], totalCount: 0, relaxedCount: 0 };
}

function failedBundle(goalFamily, profile, errors) {
  return {
    eligible: true,
    ok: false,
    bundleType: "DecisionBundle",
    goalFamily,
    sourceFactKey: null,
    profile: profile || null,
    candidates: [],
    evaluation: emptyEvaluation(),
    ranked: [],
    recommendation: null,
    alternatives: [],
    reasons: { recommendation: [], alternatives: [] },
    nextAction: null,
    authority: null,
    verified: false,
    decision: "no_viable_option",
    tieGroupCount: 0,
    failureReason: "invalid_profile",
    errors: errors.slice(),
  };
}

function enrich(item, profile) {
  return item ? { ...item, reasons: explainCandidate(item, profile) } : null;
}

function decide({ missionState, toolResults, goalSpec } = {}) {
  const goalFamily = structuredGoalFamily(missionState, goalSpec);
  if (!isDecisionEligible(goalFamily)) return { eligible: false };

  const profile = profileFromGoalSpec(goalSpec || {});
  const profileCheck = validateProfile(profile);
  if (!profileCheck.ok) return failedBundle(goalFamily, profile, profileCheck.errors);

  const source = selectCandidateSource(goalFamily, missionState, toolResults, goalSpec || {});
  const candidates = source ? source.candidates : [];
  const evaluation = evaluateCandidates(candidates, profile);
  const ranked = rankFeasible(evaluation.items);
  const selected = selectDecision(ranked, {
    topN: goalSpec && goalSpec.selection && goalSpec.selection.topN,
  });
  const recommendation = enrich(selected.recommendation, profile);
  const alternatives = selected.alternatives.map((item) => enrich(item, profile));
  const selectionForAction = { ...selected, recommendation, alternatives };
  const missionCanBeEvaluated = Boolean(
    missionState
    && missionState.goal
    && Array.isArray(missionState.goal.completionCriteria)
    && missionState.availableFacts
    && typeof missionState.availableFacts === "object"
  );
  const baseAction = missionCanBeEvaluated
    ? nextBestAction({ missionState, decision: selectionForAction })
    : null;
  const nextAction = authorityAwareAction(baseAction, { missionState, goalSpec });
  const authorityLevel = nextAction ? authorityLevelFor({ missionState, goalSpec }) : null;

  return {
    eligible: true,
    ok: true,
    bundleType: "DecisionBundle",
    goalFamily,
    sourceFactKey: source ? source.factKey : null,
    profile,
    candidates,
    evaluation,
    ranked,
    recommendation,
    alternatives,
    reasons: {
      recommendation: recommendation ? recommendation.reasons : [],
      alternatives: alternatives.map((item) => item.reasons),
    },
    nextAction,
    authority: nextAction ? { level: authorityLevel, requiresConfirm: nextAction.requiresConfirm === true } : null,
    verified: Boolean(source),
    decision: selected.decision,
    tieGroupCount: selected.tieGroupCount,
    failureReason: null,
    errors: [],
  };
}

module.exports = {
  ELIGIBLE_GOAL_FAMILIES,
  isDecisionEligible,
  structuredGoalFamily,
  sourcePriority,
  verifiedSource,
  selectCandidateSource,
  decide,
};
