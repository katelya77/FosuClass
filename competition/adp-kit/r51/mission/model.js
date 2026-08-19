"use strict";
// R51 Mission Model —— MissionGoal / MissionStep / MissionState（内部协议，不展示给用户）
// 只保留「完成当前目标真正需要」的状态；不复制整个历史 Tool Result。
const GOAL_FAMILIES = Object.freeze([
  "schedule_inquiry",
  "schedule_range_inquiry",
  "day_planning",
  "space_inquiry",
  "common_availability",
  "group_planning",
  "risk_inquiry",
  "reschedule_simulation",
  "ranking_inquiry",
  "overview_inquiry",
  "space_utilization_inquiry",
  "entity_query",
  "teaching_assurance",
  "collaboration_planning",
  "campus_operations_insight",
]);

const MISSION_STATUS = Object.freeze(["pending", "in_progress", "needs_clarification", "complete", "failed"]);
const STEP_STATUS = Object.freeze(["pending", "in_progress", "done", "failed"]);
const TEMPORAL_KINDS = Object.freeze(["explicit", "inherited", "history"]);

function validateGoalSpec(spec) {
  const errors = [];
  if (!spec || typeof spec !== "object") return { ok: false, errors: ["missing goalSpec"] };
  if (!GOAL_FAMILIES.includes(spec.goalFamily)) errors.push(`unknown goalFamily: ${spec.goalFamily}`);
  const ts = spec.temporalScope || {};
  if (!TEMPORAL_KINDS.includes(ts.kind)) errors.push(`invalid temporalScope.kind: ${ts.kind}`);
  if (ts.kind === "explicit" && ts.weekStart == null && ts.weekEnd == null && ts.weekday == null && ts.date == null) {
    errors.push("explicit temporalScope 必须至少含 weekStart/weekEnd/weekday/date 之一");
  }
  if (spec.selection && spec.selection.position != null && (!Number.isInteger(spec.selection.position) || spec.selection.position < 1)) {
    errors.push("selection.position 必须是 ≥1 的整数（稳定位置）");
  }
  if (spec.selection && spec.selection.topN != null && (!Number.isInteger(spec.selection.topN) || spec.selection.topN < 1)) {
    errors.push("selection.topN 必须是 ≥1 的整数");
  }
  // visionAssets：多模态预留——只透传展示资产引用，绝不作事实来源、绝不进入工具参数
  if (spec.visionAssets != null) {
    if (!Array.isArray(spec.visionAssets)) {
      errors.push("visionAssets 必须是数组（只透传，不作为事实）");
    } else {
      for (const a of spec.visionAssets) {
        if (typeof a !== "string" && (!a || typeof a.id !== "string")) {
          errors.push("visionAssets 元素须为字符串或含 id 的对象");
        }
      }
    }
  }
  return { ok: errors.length === 0, errors };
}

function baseState(goalSpec) {
  return {
    goal: {
      goalFamily: goalSpec.goalFamily,
      userOutcome: goalSpec.userOutcome || "",
      constraints: goalSpec.constraints || {},
      completionCriteria: [],
      // 多模态预留：展示资产引用透传（复制快照），不参与完成度判定
      visionAssets: Array.isArray(goalSpec.visionAssets)
        ? JSON.parse(JSON.stringify(goalSpec.visionAssets))
        : [],
    },
    steps: [],
    completedCapabilities: [],
    availableFacts: {},
    unresolvedRequirements: [],
    activeEntity: null,
    temporalScope: null,
    rankingSelection: null,
    status: "pending",
  };
}

// NEW_TASK：清旧 domain-local pending（facts / completedCapabilities / unresolved / ranking 不继承）。
// FOLLOW_UP：继承最小必要状态（activeEntity 同引用、相对时间、排位下钻）。
function newMissionState(goalSpec, { kind, prior } = {}) {
  const kind2 = kind === "FOLLOW_UP" ? "FOLLOW_UP" : "NEW_TASK";
  const st = baseState(goalSpec);
  if (kind2 === "FOLLOW_UP" && prior) {
    const ref = goalSpec.target && goalSpec.target.entityRef;
    if (ref && prior.activeEntity && prior.activeEntity.id === ref) {
      st.activeEntity = JSON.parse(JSON.stringify(prior.activeEntity));
    }
    const ts = goalSpec.temporalScope || {};
    if (ts.kind === "inherited" && prior.temporalScope) {
      st.temporalScope = JSON.parse(JSON.stringify(prior.temporalScope));
    } else if (ts.kind === "explicit") {
      const { kind, ...resolved } = ts; // 解析后的时间范围不携带 kind（内部语义字段）
      st.temporalScope = JSON.parse(JSON.stringify(resolved));
    } else if (ts.kind === "history" && prior.temporalScope) {
      st.temporalScope = JSON.parse(JSON.stringify(prior.temporalScope));
    }
    if (goalSpec.selection && goalSpec.selection.position != null && prior.rankingSelection) {
      st.rankingSelection = JSON.parse(JSON.stringify(prior.rankingSelection));
    }
  }
  return st;
}

function applyFacts(state, factRecords) {
  for (const rec of factRecords) {
    if (!rec || !rec.factKey) continue;
    state.availableFacts[rec.factKey] = {
      capabilityId: rec.capabilityId,
      factKey: rec.factKey,
      slots: rec.slots || {},
      resultRef: rec.resultRef || null,
      verified: rec.verified === true,
    };
    if (rec.capabilityId && !state.completedCapabilities.includes(rec.capabilityId)) {
      state.completedCapabilities.push(rec.capabilityId);
    }
  }
  return state;
}

function addUnresolvedRequirement(state, req) {
  state.unresolvedRequirements.push(req);
  return state;
}

function markStepStatus(state, capabilityId, status) {
  const step = state.steps.find((s) => s.capability === capabilityId);
  if (step) step.status = status;
  if (status === "failed") {
    state.status = "failed";
  } else if (status === "done" && state.status !== "failed") {
    state.status = "in_progress";
  }
  return state;
}

module.exports = {
  GOAL_FAMILIES,
  MISSION_STATUS,
  STEP_STATUS,
  TEMPORAL_KINDS,
  validateGoalSpec,
  newMissionState,
  applyFacts,
  addUnresolvedRequirement,
  markStepStatus,
};