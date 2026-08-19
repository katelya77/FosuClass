"use strict";
// R51 E2E Mission Matrix 门禁（2026-08-19）
// 13 行高价值 E2E：goal → 能力 DAG → agent sequence → fresh calls → completion criteria → forbidden behaviors。
const test = require("node:test");
const assert = require("node:assert");
const path = require("path");

const R51 = path.join(__dirname, "..", "..", "r51");
const { planMission } = require(path.join(R51, "mission", "planner.js"));
const { newMissionState, applyFacts, markStepStatus, addUnresolvedRequirement } = require(path.join(R51, "mission", "model.js"));
const { evaluateMission } = require(path.join(R51, "mission", "completion.js"));
const { freshToolRequired } = require(path.join(R51, "mission", "fresh-guard.js"));
const { decideClarification } = require(path.join(R51, "mission", "resolve-before-clarify.js"));
const { nextActions } = require(path.join(R51, "mission", "widget-actions.js"));

function makeFact(capabilityId, factKey, slots) {
  return { capabilityId, factKey, slots: slots || {}, resultRef: `r-${factKey}`, verified: true };
}

function goalSpec(overrides) {
  return {
    goalFamily: "schedule_inquiry",
    userOutcome: "e2e",
    target: { entityType: "teacher", entityRef: "t-003", name: "教师003" },
    temporalScope: { kind: "explicit", weekStart: 1, weekEnd: 1 },
    constraints: {},
    selection: {},
    ...overrides,
  };
}

function runPlan(gs, fixtureByCapability) {
  const plan = planMission(gs);
  const st = newMissionState(gs, { kind: "NEW_TASK" });
  st.steps = plan.steps;
  st.goal.completionCriteria = plan.completionCriteria;
  st.unresolvedRequirements = plan.unresolved.slice();
  const sequence = [];
  const freshCalls = [];
  for (const step of plan.steps) {
    const e = evaluateMission(st);
    if (e.status !== "in_progress") break;
    const fix = fixtureByCapability[step.capability];
    if (!fix) break;
    sequence.push(step.domain);
    freshCalls.push({ capability: step.capability, tool: step.tools[0] });
    if (fix.unresolved) {
      addUnresolvedRequirement(st, fix.unresolved);
      markStepStatus(st, step.capability, "done");
    } else {
      applyFacts(st, [fix.fact]);
      markStepStatus(st, step.capability, "done");
    }
  }
  return { plan, state: st, sequence, freshCalls, final: evaluateMission(st) };
}

test("E1. 单域直接任务：schedule_inquiry → 1 次 fresh call → complete，无多余工具", () => {
  const r = runPlan(goalSpec(), { SCHEDULE_DETAIL: { fact: makeFact("SCHEDULE_DETAIL", "scheduleFacts", { weekStart: 1, weekEnd: 1 }) } });
  assert.deepStrictEqual(r.sequence, ["schedule"]);
  assert.strictEqual(r.freshCalls.length, 1);
  assert.strictEqual(r.final.status, "complete");
  assert.strictEqual(r.final.missing.length, 0);
});

test("E2. 同域 follow-up：槽位不变 → 复用 verified result（不触发 fresh）", () => {
  const prior = { capabilityId: "SCHEDULE_DETAIL", factKey: "scheduleFacts", slots: { weekStart: 1, weekEnd: 1, weekday: null }, resultRef: "r1", verified: true };
  assert.strictEqual(freshToolRequired({ weekStart: 1, weekEnd: 1 }, [prior]), false, "解释型 follow-up 可复用");
});

test("E3. dynamic slot 变化 → 必须 fresh query（整周结果不可截取回答某天）", () => {
  const prior = { capabilityId: "SCHEDULE_DETAIL", factKey: "scheduleFacts", slots: { weekStart: 1, weekEnd: 1, weekday: null }, resultRef: "r1", verified: true };
  assert.strictEqual(freshToolRequired({ weekStart: 1, weekEnd: 1, weekday: 3 }, [prior]), true);
});

test("E4. schedule → risk（teaching_assurance）：完整序列后 complete", () => {
  const r = runPlan(goalSpec({ goalFamily: "teaching_assurance" }), {
    SCHEDULE_DETAIL: { fact: makeFact("SCHEDULE_DETAIL", "scheduleFacts", { weekStart: 1, weekEnd: 1 }) },
    RISK_CHECK: { fact: makeFact("RISK_CHECK", "riskFacts", { weekStart: 1, weekEnd: 1 }) },
  });
  assert.deepStrictEqual(r.sequence, ["schedule", "risk"]);
  assert.strictEqual(r.final.status, "complete");
});

test("E5. schedule → risk → space（teaching_assurance needSpace）", () => {
  const r = runPlan(goalSpec({ goalFamily: "teaching_assurance", constraints: { needSpace: true } }), {
    SCHEDULE_DETAIL: { fact: makeFact("SCHEDULE_DETAIL", "scheduleFacts", { weekStart: 1, weekEnd: 1 }) },
    RISK_CHECK: { fact: makeFact("RISK_CHECK", "riskFacts", { weekStart: 1, weekEnd: 1 }) },
    SPACE_DISCOVERY: { fact: makeFact("SPACE_DISCOVERY", "spaceFacts", { weekStart: 1, weekEnd: 1 }) },
  });
  assert.deepStrictEqual(r.sequence, ["schedule", "risk", "schedule"]);
  assert.strictEqual(r.final.status, "complete");
});

test("E6. ranking → schedule（campus_operations_insight 下钻）", () => {
  const r = runPlan(goalSpec({ goalFamily: "campus_operations_insight", selection: { metric: "teacher_load", position: 1 } }), {
    TEACHER_LOAD_RANKING: { fact: makeFact("TEACHER_LOAD_RANKING", "rankingFacts", { weekStart: 1, weekEnd: 4 }) },
    SCHEDULE_DETAIL: { fact: makeFact("SCHEDULE_DETAIL", "scheduleFacts", { weekStart: 1, weekEnd: 1 }) },
  });
  assert.deepStrictEqual(r.sequence, ["insight", "schedule"]);
  assert.strictEqual(r.final.status, "complete");
});

test("E7. ranking → schedule → risk", () => {
  const r = runPlan(goalSpec({ goalFamily: "campus_operations_insight", selection: { metric: "teacher_load", position: 1 }, constraints: { needRisk: true } }), {
    TEACHER_LOAD_RANKING: { fact: makeFact("TEACHER_LOAD_RANKING", "rankingFacts", { weekStart: 1, weekEnd: 4 }) },
    SCHEDULE_DETAIL: { fact: makeFact("SCHEDULE_DETAIL", "scheduleFacts", { weekStart: 1, weekEnd: 1 }) },
    RISK_CHECK: { fact: makeFact("RISK_CHECK", "riskFacts", { weekStart: 1, weekEnd: 1 }) },
  });
  assert.deepStrictEqual(r.sequence, ["insight", "schedule", "risk"]);
  assert.strictEqual(r.final.status, "complete");
});

test("E8. collaboration → room plan：实体解析 → 共同空闲 → 教室 → 排优方案", () => {
  const r = runPlan(goalSpec({
    goalFamily: "collaboration_planning",
    target: { entities: [{ type: "teacher", name: "教师001" }, { type: "teacher", name: "教师002" }], resolved: false },
    constraints: { wantPlan: true },
  }), {
    ENTITY_RESOLUTION: { fact: makeFact("ENTITY_RESOLUTION", "resolvedEntities", {}) },
    COMMON_AVAILABILITY: { fact: makeFact("COMMON_AVAILABILITY", "availabilityFacts", {}) },
    SPACE_DISCOVERY: { fact: makeFact("SPACE_DISCOVERY", "spaceFacts", {}) },
    GROUP_PLANNING: { fact: makeFact("GROUP_PLANNING", "groupPlanFacts", {}) },
  });
  assert.deepStrictEqual(r.sequence, ["schedule", "schedule", "schedule", "schedule"]);
  assert.strictEqual(r.final.status, "complete");
});

test("E9. reschedule 课程可解析：先 ENTITY_RESOLUTION 而非澄清（resolve-before-clarify）", () => {
  const r = runPlan(goalSpec({
    goalFamily: "reschedule_simulation",
    target: { entityType: "course", entityRef: null, name: "程序设计基础" },
    temporalScope: { kind: "explicit", weekStart: 1, weekEnd: 1, weekday: 3, periodStart: 5, periodEnd: 6 },
  }), {
    ENTITY_RESOLUTION: { fact: makeFact("ENTITY_RESOLUTION", "resolvedEntities", {}) },
    RESCHEDULE_SIMULATION: { fact: makeFact("RESCHEDULE_SIMULATION", "rescheduleSimFacts", {}) },
  });
  assert.deepStrictEqual(r.sequence, ["schedule", "risk"]);
  assert.strictEqual(r.final.status, "complete");
});

test("E10. reschedule 课程不可解析：多/零候选 → 澄清（不伪造实体）", () => {
  const plan = planMission(goalSpec({
    goalFamily: "reschedule_simulation",
    target: { entityType: "course", entityRef: null, name: "模糊课程" },
    temporalScope: { kind: "explicit", weekStart: 1, weekEnd: 1, weekday: 3, periodStart: 5, periodEnd: 6 },
  }));
  assert.deepStrictEqual(plan.steps.map((s) => s.capability), ["ENTITY_RESOLUTION", "RESCHEDULE_SIMULATION"]);
  const decision = decideClarification({ requirement: { kind: "entity", missing: "courseRef" }, candidates: [] });
  assert.strictEqual(decision.decision, "clarify");
  assert.strictEqual(decision.reason, "no_result");
});

test("E11. stale context escape：NEW_TASK 清旧 domain-local pending（跨域不继承 facts/排位）", () => {
  const prior = newMissionState(goalSpec({ goalFamily: "risk_inquiry" }), { kind: "NEW_TASK" });
  applyFacts(prior, [makeFact("RISK_CHECK", "riskFacts", { weekStart: 1 })]);
  prior.rankingSelection = { selectedEntity: { id: "t-001", name: "教师001" }, position: 1, window: { weekStart: 1, weekEnd: 4 } };
  prior.status = "in_progress";

  const next = newMissionState(goalSpec({ goalFamily: "space_inquiry" }), { kind: "NEW_TASK", prior });
  assert.deepStrictEqual(Object.keys(next.availableFacts), [], "NEW_TASK 不继承旧 facts");
  assert.strictEqual(next.rankingSelection, null, "NEW_TASK 不继承排位");
  assert.strictEqual(next.status, "pending");
});

test("E12. empty/error 恢复：必需能力空/错 → 受控失败（不伪装成功、不宣称完成）", () => {
  const plan = planMission(goalSpec());
  const st = newMissionState(goalSpec(), { kind: "NEW_TASK" });
  st.steps = plan.steps;
  st.goal.completionCriteria = plan.completionCriteria;
  markStepStatus(st, "SCHEDULE_DETAIL", "failed");
  const e = evaluateMission(st);
  assert.strictEqual(e.status, "failed");
  assert.notStrictEqual(e.status, "complete");
});

test("E13. Widget sys.chat → Main → 下一能力：动作 payload 重新进入 Main 并构造后续 Mission", () => {
  const st = {
    goal: { goalFamily: "teaching_assurance", completionCriteria: ["scheduleFacts", "riskFacts"] },
    completedCapabilities: ["SCHEDULE_DETAIL"],
    availableFacts: { scheduleFacts: { verified: true } },
    activeEntity: { type: "teacher", id: "t-003", name: "教师003" },
  };
  const actions = nextActions(st);
  const riskAction = actions.find((a) => a.label === "检查风险");
  assert.ok(riskAction && riskAction.type === "sys.chat", "动作走官方 sys.chat");

  // 动作 payload 作为新用户回合 → Main 构造 follow-up mission（风险目标，继承实体）
  const followUp = planMission(goalSpec({
    goalFamily: "risk_inquiry",
    userOutcome: riskAction.payload.query,
    target: { entityType: "teacher", entityRef: "t-003", name: "教师003" },
    temporalScope: { kind: "inherited", weekStart: 1, weekEnd: 1 },
  }));
  assert.deepStrictEqual(followUp.steps.map((s) => s.capability), ["RISK_CHECK"]);
  assert.deepStrictEqual(followUp.completionCriteria, ["riskFacts"]);
  assert.ok(riskAction.payload.query.includes("风险"), "payload 为自然语言语义 query");
  assert.ok(!riskAction.payload.query.includes("t-003") && !riskAction.payload.query.includes("{"), "payload 不得含内部 id 或 JSON");
  assert.deepStrictEqual(Object.keys(riskAction.payload), ["query"], "payload 只允许 query 字段");
});