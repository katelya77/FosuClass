"use strict";
// R51 Mission Planner —— GoalSpec → MissionStep[] 确定性规划
// 依据：goalFamily → capability 集合（结构化映射）+ 依赖边（requires/produces）+ 输入就绪度。
// 不依赖任何固定句式 / 关键词 / 测试字符串；userOutcome 只做展示，不参与路由。
const { GOAL_FAMILIES, validateGoalSpec } = require("./model.js");
const { CAPABILITIES } = require("./capabilities.js");

// 组合目标族：capability composition（非固定语句 Case）
const COMPOSITIONS = {
  teaching_assurance: {
    base: ["SCHEDULE_DETAIL", "RISK_CHECK"],
    expand(goalSpec) {
      const list = this.base.slice();
      const ts = goalSpec.temporalScope || {};
      if (ts.weekStart != null && ts.weekEnd != null && ts.weekStart < ts.weekEnd) {
        list[0] = "SCHEDULE_RANGE";
      }
      if (goalSpec.constraints && goalSpec.constraints.needSpace) list.push("SPACE_DISCOVERY");
      if (goalSpec.constraints && goalSpec.constraints.whatIf) list.push("RESCHEDULE_SIMULATION");
      return list;
    },
    criteria(goalSpec) {
      const c = ["scheduleFacts", "riskFacts"];
      if (goalSpec.constraints && goalSpec.constraints.needSpace) c.push("spaceFacts");
      if (goalSpec.constraints && goalSpec.constraints.whatIf) c.push("rescheduleSimFacts");
      return c;
    },
  },
  collaboration_planning: {
    base: ["COMMON_AVAILABILITY", "SPACE_DISCOVERY"],
    expand(goalSpec) {
      const list = this.base.slice();
      if (goalSpec.constraints && goalSpec.constraints.wantPlan) list.push("GROUP_PLANNING");
      return list;
    },
    criteria(goalSpec) {
      const c = ["availabilityFacts", "spaceFacts"];
      if (goalSpec.constraints && goalSpec.constraints.wantPlan) c.push("groupPlanFacts");
      return c;
    },
  },
  campus_operations_insight: {
    base: ["TEACHER_LOAD_RANKING", "SCHEDULE_DETAIL"],
    expand(goalSpec) {
      const list = this.base.slice();
      if (goalSpec.constraints && goalSpec.constraints.needRisk) list.push("RISK_CHECK");
      return list;
    },
    criteria(goalSpec) {
      const c = ["rankingFacts", "scheduleFacts"];
      if (goalSpec.constraints && goalSpec.constraints.needRisk) c.push("riskFacts");
      return c;
    },
  },
};

const SINGLES = {
  schedule_inquiry: { capabilities: ["SCHEDULE_DETAIL"], criteria: ["scheduleFacts"] },
  schedule_range_inquiry: { capabilities: ["SCHEDULE_RANGE"], criteria: ["scheduleFacts"] },
  day_planning: { capabilities: ["DAY_PLANNING"], criteria: ["dayPlanFacts"] },
  space_inquiry: { capabilities: ["SPACE_DISCOVERY"], criteria: ["spaceFacts"] },
  common_availability: { capabilities: ["COMMON_AVAILABILITY"], criteria: ["availabilityFacts"] },
  group_planning: { capabilities: ["GROUP_PLANNING"], criteria: ["groupPlanFacts"] },
  risk_inquiry: { capabilities: ["RISK_CHECK"], criteria: ["riskFacts"] },
  reschedule_simulation: { capabilities: ["RESCHEDULE_SIMULATION"], criteria: ["rescheduleSimFacts"] },
  ranking_inquiry: { capabilities: ["TEACHER_LOAD_RANKING"], criteria: ["rankingFacts"] },
  overview_inquiry: { capabilities: ["CAMPUS_OVERVIEW"], criteria: ["overviewFacts"] },
  space_utilization_inquiry: { capabilities: ["SPACE_UTILIZATION_RANKING"], criteria: ["spaceUtilFacts"] },
  entity_query: { capabilities: ["ENTITY_RESOLUTION"], criteria: ["resolvedEntities"] },
};

const TIME_NEEDING_FAMILIES = new Set([
  "schedule_inquiry", "schedule_range_inquiry", "day_planning", "space_inquiry", "common_availability",
  "group_planning", "risk_inquiry", "reschedule_simulation", "ranking_inquiry", "overview_inquiry",
  "space_utilization_inquiry", "teaching_assurance", "collaboration_planning", "campus_operations_insight",
]);

function isRange(temporalScope) {
  return temporalScope != null
    && temporalScope.weekStart != null
    && temporalScope.weekEnd != null
    && temporalScope.weekStart < temporalScope.weekEnd;
}

function hasTemporalHint(temporalScope) {
  if (!temporalScope) return false;
  const { weekday, weekStart, weekEnd, date, dateText, periodStart, periodEnd } = temporalScope;
  return [weekday, weekStart, weekEnd, date, dateText, periodStart, periodEnd].some(
    (v) => v !== null && v !== undefined && v !== "",
  );
}

function needsEntityResolution(goalSpec) {
  const t = goalSpec.target || {};
  if (t.entityRef != null) return false;
  if (t.name) return true;
  if (Array.isArray(t.entities) && t.entities.length >= 1 && t.resolved !== true) return true;
  return false;
}

function planMission(goalSpec) {
  const v = validateGoalSpec(goalSpec);
  if (!v.ok) throw new Error(`invalid GoalSpec: ${v.errors.join("; ")}`);

  const family = goalSpec.goalFamily;
  const ts = goalSpec.temporalScope || { kind: "history" };

  let capIds;
  let criteria;
  const composition = COMPOSITIONS[family];
  if (composition) {
    capIds = composition.expand(goalSpec);
    criteria = composition.criteria(goalSpec);
  } else {
    const single = SINGLES[family];
    capIds = single.capabilities.slice();
    criteria = single.criteria.slice();
  }

  const unresolved = [];

  // 前置 ENTITY_RESOLUTION（可被工具缩小的缺失/歧义 → 先解析，不澄清）
  const needsEntity = needsEntityResolution(goalSpec);
  const anyEntityProduced = capIds.some((id) => CAPABILITIES[id].produces.includes("resolvedEntities"));
  if (needsEntity && !anyEntityProduced) {
    capIds.unshift("ENTITY_RESOLUTION");
  }

  // 前置 TEMPORAL_RESOLUTION（非 explicit、时间范围未就绪但有 hint）；无 hint 且目标需要时间 → unresolved
  const needsTime = TIME_NEEDING_FAMILIES.has(family);
  const timeProduced = capIds.some((id) => CAPABILITIES[id].produces.includes("temporalScopeExplicit"));
  const resolvedScope = ts.weekStart != null || ts.weekEnd != null || ts.week != null || ts.date != null;
  if (needsTime && ts.kind !== "explicit" && !resolvedScope) {
    if (hasTemporalHint(ts)) {
      if (!timeProduced) capIds.unshift("TEMPORAL_RESOLUTION");
    } else {
      unresolved.push({ kind: "temporal", missing: ["weekStart", "weekEnd", "weekday", "date"], hint: null });
    }
  }

  const steps = capIds.map((id) => {
    const def = CAPABILITIES[id];
    return {
      capability: def.id,
      domain: def.domain,
      tools: def.tools.slice(),
      requires: def.requires.slice(),
      produces: def.produces.slice(),
      status: "pending",
    };
  });

  const goal = {
    goalFamily: family,
    userOutcome: goalSpec.userOutcome || "",
    constraints: goalSpec.constraints || {},
    completionCriteria: criteria,
    // 多模态预留：只随 goal 透传展示资产引用，绝不进入 steps / 工具参数
    visionAssets: Array.isArray(goalSpec.visionAssets)
      ? JSON.parse(JSON.stringify(goalSpec.visionAssets))
      : [],
  };

  return { steps, completionCriteria: criteria.slice(), unresolved, goal };
}

module.exports = {
  planMission,
  COMPOSITIONS,
  SINGLES,
  GOAL_FAMILIES,
  isRange,
  hasTemporalHint,
  needsEntityResolution,
};