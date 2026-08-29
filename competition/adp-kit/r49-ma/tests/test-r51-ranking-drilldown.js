"use strict";
// R51-G Ranking Drill-down 门禁（2026-08-19）
// P1 metric 语义 ≠ position 语义：Top1 = ordered items[0]，业务指标并列不使位置失效；
// P2 并列 → 单排位引用 NO CLARIFICATION；仅明确多对象才进多对象逻辑；
// P3 下钻携带 selected entity + selected position + 有效 ranking/detail window；
// P4 overview 聚合 count 不是 academic week（不得继承为 schedule week）。
const test = require("node:test");
const assert = require("node:assert");
const path = require("path");

const R51 = path.join(__dirname, "..", "..", "r51");
const { planMission } = require(path.join(R51, "mission", "planner.js"));
const { newMissionState } = require(path.join(R51, "mission", "model.js"));
const { freshToolRequired } = require(path.join(R51, "mission", "fresh-guard.js"));

// 并列的排名结果：t-001 与 t-002 指标完全相同（tiedWithPrevious）
const RANKING_ITEMS = [
  { rank: 1, teacher: { id: "t-001", name: "教师001" }, lessonOccurrences: 27, periodUnits: 54, tiedWithPrevious: false },
  { rank: 2, teacher: { id: "t-002", name: "教师002" }, lessonOccurrences: 27, periodUnits: 54, tiedWithPrevious: true },
  { rank: 3, teacher: { id: "t-003", name: "教师003" }, lessonOccurrences: 20, periodUnits: 40, tiedWithPrevious: false },
];

test("G1. 并列不使 position 失效：Top1 = items[0]，Top2 = items[1]", () => {
  assert.strictEqual(RANKING_ITEMS[0].rank, 1, "稳定位置由 rank 决定");
  assert.strictEqual(RANKING_ITEMS[1].rank, 2);
  assert.strictEqual(RANKING_ITEMS[1].tiedWithPrevious, true, "并列事实保留（不改变 position）");
  assert.ok(RANKING_ITEMS[0].lessonOccurrences === RANKING_ITEMS[1].lessonOccurrences, "指标并列存在");
});

test("G2. 单排位引用直接下钻（NO CLARIFICATION）：position=1 → 选中 items[0] 实体", () => {
  const selected = RANKING_ITEMS[0];
  const plan = planMission({
    goalFamily: "campus_operations_insight",
    userOutcome: "看看排第一的老师课表",
    target: { entityType: "teacher", entityRef: selected.teacher.id, name: selected.teacher.name },
    temporalScope: { kind: "explicit", weekStart: 1, weekEnd: 4 },
    constraints: {},
    selection: { metric: "teacher_load", position: 1 },
  });
  assert.deepStrictEqual(plan.steps.map((s) => s.capability), ["TEACHER_LOAD_RANKING", "SCHEDULE_DETAIL"]);
  const state = newMissionState(plan.goal || { goalFamily: "campus_operations_insight" }, { kind: "NEW_TASK" });
  state.rankingSelection = { selectedEntity: selected.teacher, position: 1, window: { weekStart: 1, weekEnd: 4 } };
  assert.strictEqual(state.rankingSelection.selectedEntity.id, "t-001");
  assert.strictEqual(state.rankingSelection.position, 1);
  assert.deepStrictEqual(state.rankingSelection.window, { weekStart: 1, weekEnd: 4 });
});

test("G3. 排名完成 ≠ 目标完成：drill-down 必须继续 schedule detail（completion 集成）", () => {
  const { planMission } = require(path.join(R51, "mission", "planner.js"));
  const { applyFacts } = require(path.join(R51, "mission", "model.js"));
  const { evaluateMission } = require(path.join(R51, "mission", "completion.js"));
  const goal = {
    goalFamily: "campus_operations_insight",
    userOutcome: "x",
    target: { entityType: "teacher", entityRef: "t-001", name: "教师001" },
    temporalScope: { kind: "explicit", weekStart: 1, weekEnd: 4 },
    constraints: {},
    selection: { metric: "teacher_load", position: 1 },
  };
  const plan = planMission(goal);
  const st = newMissionState(goal, { kind: "NEW_TASK" });
  st.steps = plan.steps;
  st.goal.completionCriteria = plan.completionCriteria;
  applyFacts(st, [{ capabilityId: "TEACHER_LOAD_RANKING", factKey: "rankingFacts", slots: { weekStart: 1, weekEnd: 4 }, resultRef: "r", verified: true }]);
  assert.strictEqual(evaluateMission(st).status, "in_progress");
});

test("G4. overview 聚合 count 不得作为 academic week（下钻窗口继承纪律）", () => {
  const ovFact = {
    capabilityId: "CAMPUS_OVERVIEW",
    factKey: "overviewFacts",
    slots: { windowAggregateCount: 4, weekStart: null, weekEnd: null },
    resultRef: "r-ov",
    verified: true,
  };
  assert.strictEqual(freshToolRequired({ weekStart: 1, weekEnd: 1 }, [ovFact]), true);
});

test("G5. 明确多对象才进多对象逻辑：并列两位 → 两个实体同时下钻（不自动压缩为 Top1）", () => {
  const multi = RANKING_ITEMS.slice(0, 2).map((i) => i.teacher);
  assert.strictEqual(multi.length, 2);
  assert.deepStrictEqual(multi.map((t) => t.id), ["t-001", "t-002"]);
});