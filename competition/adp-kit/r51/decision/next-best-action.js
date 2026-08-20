"use strict";
// Campus Decision Intelligence —— 下一步动作（2026-08-19）
// 只读取 Mission completion 和 Decision state；绝不读取原始用户 query 做关键词路由。
const { evaluateMission } = require("../mission/completion.js");

const CAPABILITY_ACTIONS = Object.freeze({
  ENTITY_RESOLUTION: { label: "确认查询对象", query: "补充要查询的对象后继续" },
  TEMPORAL_RESOLUTION: { label: "补充查询时间", query: "补充要查询的教学周或日期后继续" },
  SCHEDULE_DETAIL: { label: "查看课表", query: "查看当前对象的课表" },
  SCHEDULE_RANGE: { label: "查看时间范围课表", query: "查看当前对象在指定时间范围内的课表" },
  DAY_PLANNING: { label: "生成日程安排", query: "生成当前日期的日程安排" },
  SPACE_DISCOVERY: { label: "查找可用教室", query: "查找符合当前安排的可用教室" },
  COMMON_AVAILABILITY: { label: "查询共同空闲", query: "查询当前成员的共同空闲时间" },
  GROUP_PLANNING: { label: "比较小组方案", query: "比较当前小组的可行安排" },
  RISK_CHECK: { label: "检查风险", query: "检查当前安排的风险情况" },
  RESCHEDULE_SIMULATION: { label: "模拟调课", query: "模拟当前课程调整的可行性" },
  CAMPUS_OVERVIEW: { label: "查看校园概览", query: "查看当前范围的校园概览" },
  TEACHER_LOAD_RANKING: { label: "查看教师负载", query: "查看当前范围的教师负载排名" },
  SPACE_UTILIZATION_RANKING: { label: "查看教室利用率", query: "查看当前范围的教室利用率排名" },
});

const FACT_CAPABILITIES = Object.freeze({
  resolvedEntities: "ENTITY_RESOLUTION",
  temporalScopeExplicit: "TEMPORAL_RESOLUTION",
  scheduleFacts: "SCHEDULE_DETAIL",
  dayPlanFacts: "DAY_PLANNING",
  spaceFacts: "SPACE_DISCOVERY",
  availabilityFacts: "COMMON_AVAILABILITY",
  groupPlanFacts: "GROUP_PLANNING",
  riskFacts: "RISK_CHECK",
  rescheduleSimFacts: "RESCHEDULE_SIMULATION",
  overviewFacts: "CAMPUS_OVERVIEW",
  rankingFacts: "TEACHER_LOAD_RANKING",
  spaceUtilFacts: "SPACE_UTILIZATION_RANKING",
});

function chatAction(action) {
  return action ? { type: "sys.chat", label: action.label, payload: { query: action.query } } : null;
}

function nextCapabilityFor(completion) {
  if (completion && typeof completion.nextCapabilityId === "string" && CAPABILITY_ACTIONS[completion.nextCapabilityId]) {
    return completion.nextCapabilityId;
  }
  const missing = completion && Array.isArray(completion.missing) ? completion.missing : [];
  return missing.map((factKey) => FACT_CAPABILITIES[factKey]).find((capabilityId) => Boolean(capabilityId)) || null;
}

function completedAction(decision) {
  if (decision && decision.tieGroupCount > 0) {
    return chatAction({ label: "细化偏好", query: "补充偏好后重新比较当前候选" });
  }
  if (decision && decision.decision === "no_viable_option") {
    return chatAction({ label: "调整筛选条件", query: "调整筛选条件后重新比较当前候选" });
  }
  return chatAction({ label: "确认推荐方案", query: "确认采用当前推荐方案" });
}

function nextBestAction({ missionState, decision } = {}) {
  if (!missionState || typeof missionState !== "object") return null;
  const completion = evaluateMission(missionState);
  if (completion.status === "complete") return completedAction(decision);
  if (completion.status === "needs_clarification") {
    return chatAction({ label: "补充必要信息", query: "补充必要信息后继续当前安排" });
  }
  if (completion.status === "failed") return null;
  const capabilityId = nextCapabilityFor(completion);
  return capabilityId ? chatAction(CAPABILITY_ACTIONS[capabilityId]) : null;
}

module.exports = {
  CAPABILITY_ACTIONS,
  FACT_CAPABILITIES,
  nextCapabilityFor,
  nextBestAction,
};
