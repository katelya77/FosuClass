"use strict";
// R51 Mission-aware Widget Action —— 根据已完成能力生成下一步 sys.chat 动作。
// 动作一律 type=sys.chat，payload 只允许 { query } 自然语言；禁止内部 Mission / entity id / JSON。
const MAX_ACTIONS = 3;

function goalHas(state, factKey) {
  const c = (state.goal && state.goal.completionCriteria) || [];
  return c.includes(factKey);
}

function factPresent(state, factKey) {
  return Boolean(state.availableFacts && state.availableFacts[factKey]);
}

function nextActions(state) {
  const caps = state.completedCapabilities || [];
  if (caps.length === 0) return [];

  const family = (state.goal && state.goal.goalFamily) || "";
  const actions = [];
  const push = (label, query) => actions.push({ type: "sys.chat", label, payload: { query } });

  const scheduleDone = caps.includes("SCHEDULE_DETAIL") || caps.includes("SCHEDULE_RANGE");
  const riskDone = caps.includes("RISK_CHECK");
  const rankingDone = caps.includes("TEACHER_LOAD_RANKING") || caps.includes("SPACE_UTILIZATION_RANKING");
  const availabilityDone = caps.includes("COMMON_AVAILABILITY");

  // teaching_assurance / campus_operations_insight：课表完成、风险未做 → 检查风险
  if (scheduleDone && !factPresent(state, "riskFacts") && (family === "teaching_assurance" || family === "campus_operations_insight")) {
    push("检查风险", "检查刚刚那份课表的风险情况");
  }

  // what-if 目标：风险完成、模拟未做 → 模拟调课
  if (goalHas(state, "rescheduleSimFacts") && (riskDone || scheduleDone) && !factPresent(state, "rescheduleSimFacts")) {
    push("模拟调课", "模拟一下把当前课程调整到目标时段的可行性");
  }

  // 排名完成且已选中实体、课表未做 → 查看排位对象课表
  if (rankingDone && !factPresent(state, "scheduleFacts") && state.activeEntity && state.activeEntity.name) {
    push("查看课表", `查看${state.activeEntity.name}的课表`);
  }

  // 周范围课表完成 → 看下一周
  if (caps.includes("SCHEDULE_RANGE") && factPresent(state, "scheduleFacts")) {
    push("看下一周", "看看下一个教学周的情况");
  }

  // 共同空闲完成、教室未做 → 找教室
  if (availabilityDone && !factPresent(state, "spaceFacts")) {
    push("找教室", "帮我们找个能开会用的教室");
  }

  return actions.slice(0, MAX_ACTIONS);
}

module.exports = { nextActions, MAX_ACTIONS };