"use strict";
// R51-B Completion Evaluator 门禁（2026-08-19）
// P1 全部 criteria 满足 → complete（task_done）；
// P2 缺 criteria → in_progress（下一步能力）；
// P3 unresolved requirement → needs_clarification（不提前结束）；
// P4 组合目标：只完成一部分能力不得 COMPLETE。
const test = require("node:test");
const assert = require("node:assert");
const path = require("path");

const R51 = path.join(__dirname, "..", "..", "r51");
const { planMission } = require(path.join(R51, "mission", "planner.js"));
const { newMissionState, applyFacts } = require(path.join(R51, "mission", "model.js"));
const { evaluateMission, isMissionComplete } = require(path.join(R51, "mission", "completion.js"));

function buildState(goalFamily, overrides) {
  const goal = {
    goalFamily,
    userOutcome: "测试目标",
    temporalScope: { kind: "explicit", weekStart: 1, weekEnd: 1 },
    target: { entityType: "teacher", entityRef: "t-003" },
    constraints: {},
    selection: {},
    ...overrides,
  };
  const plan = planMission(goal);
  const state = newMissionState(goal, { kind: "NEW_TASK" });
  state.steps = plan.steps;
  state.goal.completionCriteria = plan.completionCriteria;
  return state;
}

function fact(capabilityId, factKey) {
  return { capabilityId, factKey, slots: { weekStart: 1, weekEnd: 1 }, resultRef: "r1", verified: true };
}

test("B1. 单域：criteria 全满足 → complete", () => {
  const st = buildState("schedule_inquiry");
  applyFacts(st, [fact("SCHEDULE_DETAIL", "scheduleFacts")]);
  const r = evaluateMission(st);
  assert.strictEqual(r.status, "complete");
  assert.ok(isMissionComplete(st));
});

test("B2. 单域：criteria 未满足 → in_progress 且给出下一步能力", () => {
  const st = buildState("schedule_inquiry");
  const r = evaluateMission(st);
  assert.strictEqual(r.status, "in_progress");
  assert.deepStrictEqual(r.missing, ["scheduleFacts"]);
  assert.strictEqual(r.nextCapabilityId, "SCHEDULE_DETAIL");
});

test("B3. unresolved requirement → needs_clarification（不得提前 COMPLETE）", () => {
  const st = buildState("schedule_inquiry");
  st.unresolvedRequirements.push({ kind: "temporal", missing: "weekStart" });
  const r = evaluateMission(st);
  assert.strictEqual(r.status, "needs_clarification");
  assert.ok(!isMissionComplete(st));
});

test("B4. teaching_assurance：只有 scheduleFacts → 不 COMPLETE；补 riskFacts → COMPLETE", () => {
  const st = buildState("teaching_assurance", { constraints: { needSpace: true, whatIf: true } });
  applyFacts(st, [fact("SCHEDULE_DETAIL", "scheduleFacts")]);
  assert.strictEqual(evaluateMission(st).status, "in_progress", "缺 risk/space/reschedule 不得完成");

  applyFacts(st, [fact("RISK_CHECK", "riskFacts")]);
  assert.strictEqual(evaluateMission(st).status, "in_progress", "缺 space/reschedule 仍不得完成");

  applyFacts(st, [fact("SPACE_DISCOVERY", "spaceFacts"), fact("RESCHEDULE_SIMULATION", "rescheduleSimFacts")]);
  assert.strictEqual(evaluateMission(st).status, "complete");
});

test("B5. collaboration_planning：只有 availabilityFacts → 不 COMPLETE；补 spaceFacts → COMPLETE", () => {
  const st = buildState("collaboration_planning", {
    target: { entities: [{ type: "teacher", name: "教师001" }, { type: "teacher", name: "教师002" }], resolved: false },
  });
  applyFacts(st, [fact("COMMON_AVAILABILITY", "availabilityFacts")]);
  assert.strictEqual(evaluateMission(st).status, "in_progress", "candidate time 有了但缺教室候选，不得完成");

  applyFacts(st, [fact("SPACE_DISCOVERY", "spaceFacts")]);
  assert.strictEqual(evaluateMission(st).status, "complete");
});

test("B6. campus_operations_insight：rankingFacts 完成 → 不 COMPLETE；选中实体课表 facts → COMPLETE", () => {
  const st = buildState("campus_operations_insight", {
    selection: { metric: "teacher_load", position: 1 },
  });
  applyFacts(st, [fact("TEACHER_LOAD_RANKING", "rankingFacts")]);
  assert.strictEqual(evaluateMission(st).status, "in_progress", "排名不是终点，还需下钻课表");

  applyFacts(st, [fact("SCHEDULE_DETAIL", "scheduleFacts")]);
  assert.strictEqual(evaluateMission(st).status, "complete");
});

test("B7. 空/错误恢复：必需 capability 无结果且无替代 → failed（受控错误，不伪装成功）", () => {
  const st = buildState("schedule_inquiry");
  st.steps[0].status = "failed";
  const r = evaluateMission(st);
  assert.strictEqual(r.status, "failed");
});