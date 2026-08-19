"use strict";
// R51-A Mission Planner 门禁（2026-08-19）
// P1 goalFamily → 基础 capability 集合（结构化映射，不依赖句式）；
// P2 依赖拓扑序：ENTITY/TEMPORAL_RESOLUTION 前置，produces 先于 requires；
// P3 组合族展开：teaching_assurance / collaboration_planning / campus_operations_insight；
// P4 确定性：同一 GoalSpec 两次规划字节一致；仅 userOutcome 变化 → 计划不变；
// P5 不静默 week=1：时间缺失且不可解析 → unresolved temporal requirement（→ Clarify）。
const test = require("node:test");
const assert = require("node:assert");
const path = require("path");

const R51 = path.join(__dirname, "..", "..", "r51");
const { planMission } = require(path.join(R51, "mission", "planner.js"));

function spec(overrides) {
  return {
    goalFamily: "schedule_inquiry",
    userOutcome: "看看某位老师的课表",
    target: { entityType: "teacher", entityRef: "t-003" },
    temporalScope: { kind: "explicit", weekStart: 1, weekEnd: 1 },
    constraints: {},
    selection: {},
    ...overrides,
  };
}

test("A1. 单域直接任务：schedule_inquiry → [SCHEDULE_DETAIL]，criteria=[scheduleFacts]", () => {
  const plan = planMission(spec());
  assert.deepStrictEqual(plan.steps.map((s) => s.capability), ["SCHEDULE_DETAIL"]);
  assert.deepStrictEqual(plan.completionCriteria, ["scheduleFacts"]);
  assert.strictEqual(plan.steps[0].domain, "schedule");
  assert.deepStrictEqual(plan.steps[0].tools, ["campus_schedule_query"]);
});

test("A2. 未解析实体 → 前置 ENTITY_RESOLUTION（不澄清，先尝试 resolver）", () => {
  const plan = planMission(spec({ target: { entityType: "teacher", entityRef: null, name: "教师003" } }));
  assert.deepStrictEqual(plan.steps.map((s) => s.capability), ["ENTITY_RESOLUTION", "SCHEDULE_DETAIL"]);
});

test("A3. teaching_assurance 展开：单周 → [SCHEDULE_DETAIL, RISK_CHECK]；needSpace/whatIf 追加", () => {
  const base = planMission(spec({ goalFamily: "teaching_assurance" }));
  assert.deepStrictEqual(base.steps.map((s) => s.capability), ["SCHEDULE_DETAIL", "RISK_CHECK"]);
  assert.deepStrictEqual(base.completionCriteria, ["scheduleFacts", "riskFacts"]);

  const full = planMission(spec({
    goalFamily: "teaching_assurance",
    constraints: { needSpace: true, whatIf: true },
  }));
  assert.deepStrictEqual(full.steps.map((s) => s.capability), [
    "SCHEDULE_DETAIL", "RISK_CHECK", "SPACE_DISCOVERY", "RESCHEDULE_SIMULATION",
  ]);
  assert.deepStrictEqual(full.completionCriteria, ["scheduleFacts", "riskFacts", "spaceFacts", "rescheduleSimFacts"]);
});

test("A4. teaching_assurance 周范围 → 使用 SCHEDULE_RANGE", () => {
  const plan = planMission(spec({
    goalFamily: "teaching_assurance",
    temporalScope: { kind: "explicit", weekStart: 1, weekEnd: 4 },
  }));
  assert.deepStrictEqual(plan.steps.map((s) => s.capability), ["SCHEDULE_RANGE", "RISK_CHECK"]);
});

test("A5. campus_operations_insight：排名 → 下钻课表 →（可选）风险", () => {
  const drill = planMission(spec({
    goalFamily: "campus_operations_insight",
    selection: { metric: "teacher_load", position: 1 },
  }));
  assert.deepStrictEqual(drill.steps.map((s) => s.capability), ["TEACHER_LOAD_RANKING", "SCHEDULE_DETAIL"]);
  assert.deepStrictEqual(drill.completionCriteria, ["rankingFacts", "scheduleFacts"]);

  const withRisk = planMission(spec({
    goalFamily: "campus_operations_insight",
    selection: { metric: "teacher_load", position: 1 },
    constraints: { needRisk: true },
  }));
  assert.deepStrictEqual(withRisk.steps.map((s) => s.capability), ["TEACHER_LOAD_RANKING", "SCHEDULE_DETAIL", "RISK_CHECK"]);
});

test("A6. collaboration_planning：实体解析 → 共同空闲 → 教室", () => {
  const plan = planMission(spec({
    goalFamily: "collaboration_planning",
    target: { entities: [{ type: "teacher", name: "教师001" }, { type: "teacher", name: "教师002" }], resolved: false },
  }));
  assert.deepStrictEqual(plan.steps.map((s) => s.capability), [
    "ENTITY_RESOLUTION", "COMMON_AVAILABILITY", "SPACE_DISCOVERY",
  ]);
  assert.deepStrictEqual(plan.completionCriteria, ["availabilityFacts", "spaceFacts"]);
});

test("A7. 确定性：同 spec 两次字节一致；仅 userOutcome 变化 → 计划不变（无固定短语依赖）", () => {
  const s1 = spec();
  const p1 = planMission(s1);
  const p2 = planMission(s1);
  assert.strictEqual(JSON.stringify(p1), JSON.stringify(p2));

  const p3 = planMission(spec({ userOutcome: "老师这周忙不忙？具体看看排课情况" }));
  assert.strictEqual(JSON.stringify(p1.steps), JSON.stringify(p3.steps));
  assert.strictEqual(JSON.stringify(p1.completionCriteria), JSON.stringify(p3.completionCriteria));
});

test("A8. 时间缺失且无 hint → unresolved temporal requirement（绝不静默默认 week=1）", () => {
  const plan = planMission(spec({
    temporalScope: { kind: "inherited", weekStart: null, weekEnd: null, weekday: null, date: null },
  }));
  assert.ok(plan.unresolved.some((u) => u.kind === "temporal"), "必须记录 temporal unresolved");
  assert.ok(!plan.steps.some((s) => s.capability === "TEMPORAL_RESOLUTION"), "无 hint 时不得伪造解析步骤");
});

test("A9. 时间 hint 存在但非 explicit → 插入 TEMPORAL_RESOLUTION", () => {
  const plan = planMission(spec({
    temporalScope: { kind: "inherited", weekday: 3, weekStart: null, weekEnd: null },
  }));
  assert.deepStrictEqual(plan.steps.map((s) => s.capability), ["TEMPORAL_RESOLUTION", "SCHEDULE_DETAIL"]);
});

test("A10. reschedule_simulation 课程未解析 → ENTITY_RESOLUTION(schedule) 前置，随后 RISK 域", () => {
  const plan = planMission(spec({
    goalFamily: "reschedule_simulation",
    target: { entityType: "course", entityRef: null, name: "程序设计" },
    temporalScope: { kind: "explicit", weekStart: 1, weekEnd: 1 },
  }));
  assert.deepStrictEqual(plan.steps.map((s) => s.capability), ["ENTITY_RESOLUTION", "RESCHEDULE_SIMULATION"]);
  assert.deepStrictEqual(plan.steps.map((s) => s.domain), ["schedule", "risk"]);
});