"use strict";
// R51 Capability Registry —— 13 能力 ↔ 13 现有 CampusTools（不新增工具）
// 绑定与 r50.1/agent-tool-bindings.json 一致；domain = 该工具所属域 Agent。
const bindings = require("../../r50.1/agent-tool-bindings.json");

const CAPABILITY_IDS = Object.freeze([
  "ENTITY_RESOLUTION",
  "TEMPORAL_RESOLUTION",
  "SCHEDULE_DETAIL",
  "SCHEDULE_RANGE",
  "DAY_PLANNING",
  "SPACE_DISCOVERY",
  "COMMON_AVAILABILITY",
  "GROUP_PLANNING",
  "RISK_CHECK",
  "RESCHEDULE_SIMULATION",
  "CAMPUS_OVERVIEW",
  "TEACHER_LOAD_RANKING",
  "SPACE_UTILIZATION_RANKING",
]);

const CAPABILITIES = Object.freeze({
  ENTITY_RESOLUTION: {
    id: "ENTITY_RESOLUTION",
    domain: "schedule",
    tools: ["campus_entity_search"],
    requires: ["entityRef"],
    produces: ["resolvedEntities"],
    fulfills: ["entity_query", "collaboration_planning", "teaching_assurance", "campus_operations_insight", "reschedule_simulation", "schedule_inquiry", "schedule_range_inquiry", "risk_inquiry", "day_planning", "common_availability", "group_planning"],
  },
  TEMPORAL_RESOLUTION: {
    id: "TEMPORAL_RESOLUTION",
    domain: "schedule",
    tools: ["campus_academic_context"],
    requires: ["temporalHint"],
    produces: ["temporalScopeExplicit"],
    fulfills: ["schedule_inquiry", "schedule_range_inquiry", "day_planning", "space_inquiry", "common_availability", "group_planning", "risk_inquiry", "reschedule_simulation", "ranking_inquiry", "overview_inquiry", "space_utilization_inquiry", "teaching_assurance", "collaboration_planning", "campus_operations_insight"],
  },
  SCHEDULE_DETAIL: {
    id: "SCHEDULE_DETAIL",
    domain: "schedule",
    tools: ["campus_schedule_query"],
    requires: ["resolvedEntities?", "temporalScope"],
    produces: ["scheduleFacts"],
    fulfills: ["schedule_inquiry", "teaching_assurance", "campus_operations_insight"],
  },
  SCHEDULE_RANGE: {
    id: "SCHEDULE_RANGE",
    domain: "schedule",
    tools: ["campus_schedule_range_query"],
    requires: ["resolvedEntities?", "temporalScope"],
    produces: ["scheduleFacts"],
    fulfills: ["schedule_range_inquiry", "teaching_assurance"],
  },
  DAY_PLANNING: {
    id: "DAY_PLANNING",
    domain: "risk",
    tools: ["campus_day_plan"],
    requires: ["resolvedEntities?", "temporalScope"],
    produces: ["dayPlanFacts"],
    fulfills: ["day_planning"],
  },
  SPACE_DISCOVERY: {
    id: "SPACE_DISCOVERY",
    domain: "schedule",
    tools: ["campus_classroom_search"],
    requires: ["temporalScope"],
    produces: ["spaceFacts"],
    fulfills: ["space_inquiry", "teaching_assurance", "collaboration_planning"],
  },
  COMMON_AVAILABILITY: {
    id: "COMMON_AVAILABILITY",
    domain: "schedule",
    tools: ["campus_common_free_time_query"],
    requires: ["entities(>=2)", "temporalScope"],
    produces: ["availabilityFacts"],
    fulfills: ["common_availability", "collaboration_planning"],
  },
  GROUP_PLANNING: {
    id: "GROUP_PLANNING",
    domain: "schedule",
    tools: ["campus_group_plan"],
    requires: ["entities(>=2)", "temporalScope"],
    produces: ["groupPlanFacts"],
    fulfills: ["group_planning", "collaboration_planning"],
  },
  RISK_CHECK: {
    id: "RISK_CHECK",
    domain: "risk",
    tools: ["campus_risk_check"],
    requires: ["resolvedEntities?", "temporalScope"],
    produces: ["riskFacts"],
    fulfills: ["risk_inquiry", "teaching_assurance", "campus_operations_insight"],
  },
  RESCHEDULE_SIMULATION: {
    id: "RESCHEDULE_SIMULATION",
    domain: "risk",
    tools: ["campus_reschedule_feasibility"],
    requires: ["courseRef", "targetSlot"],
    produces: ["rescheduleSimFacts"],
    fulfills: ["reschedule_simulation", "teaching_assurance"],
  },
  CAMPUS_OVERVIEW: {
    id: "CAMPUS_OVERVIEW",
    domain: "insight",
    tools: ["campus_overview"],
    requires: ["temporalScope"],
    produces: ["overviewFacts"],
    fulfills: ["overview_inquiry"],
  },
  TEACHER_LOAD_RANKING: {
    id: "TEACHER_LOAD_RANKING",
    domain: "insight",
    tools: ["campus_teacher_load_query"],
    requires: ["temporalScope", "metric"],
    produces: ["rankingFacts"],
    fulfills: ["ranking_inquiry", "campus_operations_insight"],
  },
  SPACE_UTILIZATION_RANKING: {
    id: "SPACE_UTILIZATION_RANKING",
    domain: "insight",
    tools: ["campus_room_utilization_query"],
    requires: ["temporalScope"],
    produces: ["spaceUtilFacts"],
    fulfills: ["space_utilization_inquiry"],
  },
});

const DOMAIN_BINDINGS = Object.freeze({
  schedule: bindings.agents.schedule,
  risk: bindings.agents.risk,
  insight: bindings.agents.insight,
  main: bindings.agents.main,
});

function capability(id) {
  return CAPABILITIES[id] || null;
}

function toolsForCapability(id) {
  const def = CAPABILITIES[id];
  return def ? def.tools.slice() : [];
}

// 工具 → 能力 唯一映射（13 ↔ 13）
const TOOL_TO_CAPABILITY = (() => {
  const map = {};
  for (const def of Object.values(CAPABILITIES)) {
    for (const t of def.tools) {
      if (map[t]) throw new Error(`tool ${t} 重复映射`);
      map[t] = def.id;
    }
  }
  return map;
})();

function capabilityForTool(toolName) {
  return TOOL_TO_CAPABILITY[toolName] || null;
}

module.exports = {
  CAPABILITY_IDS,
  CAPABILITIES,
  DOMAIN_BINDINGS,
  capability,
  toolsForCapability,
  capabilityForTool,
};