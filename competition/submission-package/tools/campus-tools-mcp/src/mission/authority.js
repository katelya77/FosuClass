"use strict";
// CSF P5 权限模型 L0–L3（2026-08-19）
// L0 static=auto / L1 read=auto / L2 analysis=auto / L3 write=confirm。
// MissionState 挂 authorityLevel；L3 写操作必须先确认，主协调的主动性不得绕过。
const AUTHORITY_LEVELS = Object.freeze(["L0", "L1", "L2", "L3"]);

const L3_WRITE_INTENTS = Object.freeze([
  "import",
  "bind",
  "resync",
  "change_source",
  "modify",
  "reserve",
  "submit",
]);

const AUTO_LEVELS = Object.freeze(["L0", "L1", "L2"]);

// 能力/目标族 → 授权等级（静态策略；运行时事实仍由 CampusTools 核验）
function resolveAuthorityForGoal(goalFamily, intent) {
  const writeIntent = intent || goalFamily || "";
  if (L3_WRITE_INTENTS.includes(writeIntent)) return "L3";
  if (goalFamily === "entity_query") return "L1";
  if (goalFamily === "schedule_inquiry" || goalFamily === "schedule_range_inquiry") return "L1";
  return "L2"; // 分析 / 比较 / 风险 / what-if / 候选 / 排名 / 态势 / 日规划
}

function authorizeMission(goalSpec) {
  const family = goalSpec && goalSpec.goalFamily;
  const intent = goalSpec && goalSpec.intent;
  const level = resolveAuthorityForGoal(family, intent);
  return {
    level,
    requiresConfirm: level === "L3",
  };
}

// NEW_TASK 时把授权等级挂到 MissionState（FOLLOW_UP 继承 prior 的 authorityLevel）
function attachAuthority(state, goalSpec, { prior } = {}) {
  if (prior && prior.authorityLevel && (goalSpec.kind === "FOLLOW_UP" || goalSpec.kind === undefined)) {
    state.authorityLevel = prior.authorityLevel;
    state.authorityConfirmed = prior.authorityConfirmed === true;
    return state;
  }
  const { level } = authorizeMission(goalSpec);
  state.authorityLevel = level;
  state.authorityConfirmed = false;
  return state;
}

function isAuthorized(state) {
  if (!state) return false;
  if (state.authorityLevel === "L3") return state.authorityConfirmed === true;
  return AUTO_LEVELS.includes(state.authorityLevel);
}

// 主协调主动性不得绕过 L3：任何规划入口在授权为 L3 且未确认时必须停在确认点。
function assertNoL3AutoRun(goalSpec) {
  const { level, requiresConfirm } = authorizeMission(goalSpec);
  if (!requiresConfirm) return true;
  return goalSpec.confirmed === true;
}

module.exports = {
  AUTHORITY_LEVELS,
  L3_WRITE_INTENTS,
  AUTO_LEVELS,
  resolveAuthorityForGoal,
  authorizeMission,
  attachAuthority,
  isAuthorized,
  assertNoL3AutoRun,
};