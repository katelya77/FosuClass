"use strict";
// Campus Decision Intelligence —— 授权感知动作（2026-08-19）
// L0/L1/L2 保留普通 sys.chat；L3 始终替换为 confirmation-only，不产生自动执行/写入动作。
const { AUTHORITY_LEVELS, authorizeMission } = require("../mission/authority.js");

function normalizeChatAction(action) {
  if (!action || action.type !== "sys.chat" || typeof action.label !== "string" || !action.payload || typeof action.payload.query !== "string") {
    return null;
  }
  return { type: "sys.chat", label: action.label, payload: { query: action.payload.query } };
}

function authorityLevelFor({ missionState, goalSpec } = {}) {
  const stateLevel = missionState && missionState.authorityLevel;
  const policySpecified = Boolean(goalSpec && (goalSpec.goalFamily || goalSpec.intent));
  const policyLevel = policySpecified ? authorizeMission(goalSpec).level : null;
  if (AUTHORITY_LEVELS.includes(stateLevel) && policyLevel && stateLevel !== policyLevel) return "L3";
  if (policyLevel) return policyLevel;
  if (AUTHORITY_LEVELS.includes(stateLevel)) return stateLevel;
  return authorizeMission(goalSpec || {}).level;
}

function confirmationOnlyAction() {
  return {
    type: "sys.chat",
    label: "确认后继续",
    payload: { query: "请先确认是否继续此项操作" },
    requiresConfirm: true,
  };
}

function authorityAwareAction(action, context = {}) {
  const safeAction = normalizeChatAction(action);
  if (!safeAction) return null;
  return authorityLevelFor(context) === "L3" ? confirmationOnlyAction() : safeAction;
}

module.exports = {
  normalizeChatAction,
  authorityLevelFor,
  confirmationOnlyAction,
  authorityAwareAction,
};
