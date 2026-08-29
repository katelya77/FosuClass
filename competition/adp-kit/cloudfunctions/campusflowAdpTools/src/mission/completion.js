"use strict";
// R51 Completion Evaluator —— 确定性 / contract-driven 完成度判定
// 规则：criteria 全满足 → complete；unresolved → needs_clarification；failed 步骤 → failed；否则 in_progress。
// 核心原则：只完成部分能力（如仅 COMMON_AVAILABILITY）绝不提前 COMPLETE。
function evaluateMission(state) {
  const criteria = (state.goal && state.goal.completionCriteria) || [];
  // 只有 verified Tool/Personal Schedule facts 能满足动态 completion criteria。
  // VisionObservation 即使被恶意放进 availableFacts，也不能完成 Mission。
  const missing = criteria.filter((k) => {
    const fact = state.availableFacts[k];
    return !fact || fact.verified !== true || fact.trust === "unverified_visual_observation";
  });

  if (missing.length === 0) {
    return { status: "complete", missing: [] };
  }

  if (state.unresolvedRequirements && state.unresolvedRequirements.length > 0) {
    return { status: "needs_clarification", missing, unresolved: state.unresolvedRequirements };
  }

  if (state.steps && state.steps.some((s) => s.status === "failed")) {
    return { status: "failed", missing };
  }

  const next = state.steps && state.steps.find((s) => s.status === "pending");
  return {
    status: "in_progress",
    missing,
    nextCapabilityId: next ? next.capability : null,
  };
}

function isMissionComplete(state) {
  return evaluateMission(state).status === "complete";
}

module.exports = { evaluateMission, isMissionComplete };
