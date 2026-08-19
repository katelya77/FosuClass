"use strict";
// R51-F Cross-domain Mission 门禁（2026-08-19）
// P1 Schedule → Main → Risk / Insight → Main → Schedule / Risk → Main → Schedule；
// P2 禁止 Child → Child：每个步骤的工具必须属于该 capability 域 Agent 的绑定；
// P3 每步工具 ∈ 13 现有 CampusTools（capability 不新增工具）。
const test = require("node:test");
const assert = require("node:assert");
const path = require("path");

const R51 = path.join(__dirname, "..", "..", "r51");
const { planMission } = require(path.join(R51, "mission", "planner.js"));
const { capability } = require(path.join(R51, "mission", "capabilities.js"));
const bindings = require(path.join("..", "..", "r50.1", "agent-tool-bindings.json"));

function planFor(goalFamily, overrides) {
  return planMission({
    goalFamily,
    userOutcome: "x",
    target: { entityType: "teacher", entityRef: "t-003" },
    temporalScope: { kind: "explicit", weekStart: 1, weekEnd: 1 },
    constraints: {},
    selection: {},
    ...overrides,
  });
}

test("F1. Schedule → Main → Risk（teaching_assurance）", () => {
  const plan = planFor("teaching_assurance");
  assert.deepStrictEqual(plan.steps.map((s) => s.domain), ["schedule", "risk"]);
});

test("F2. Insight → Main → Schedule（campus_operations_insight 下钻）", () => {
  const plan = planFor("campus_operations_insight", { selection: { metric: "teacher_load", position: 1 } });
  assert.deepStrictEqual(plan.steps.map((s) => s.domain), ["insight", "schedule"]);
});

test("F3. Risk → Main → Schedule（reschedule 的实体解析在 schedule 域先执行）", () => {
  const plan = planFor("reschedule_simulation", {
    target: { entityType: "course", entityRef: null, name: "程序设计基础" },
  });
  assert.deepStrictEqual(plan.steps.map((s) => s.domain), ["schedule", "risk"]);
});

test("F4. 每个步骤工具 ∈ 该域 Agent 的 14 bindings（禁止 Child → Child 偷跑他人工具）", () => {
  const families = ["teaching_assurance", "campus_operations_insight", "collaboration_planning", "reschedule_simulation", "schedule_inquiry"];
  const domainBindings = { schedule: bindings.agents.schedule, risk: bindings.agents.risk, insight: bindings.agents.insight };
  for (const f of families) {
    const plan = planFor(f, { selection: { metric: "teacher_load", position: 1 }, constraints: { needRisk: true, whatIf: true, needSpace: true } });
    for (const step of plan.steps) {
      for (const tool of step.tools) {
        assert.ok(domainBindings[step.domain].includes(tool), `${step.capability} 的工具 ${tool} 必须 ∈ ${step.domain} 域绑定`);
        assert.strictEqual(domainBindings.main ? domainBindings.main.includes(tool) : false, false, "Main 不得持有 CampusTools");
      }
    }
  }
});

test("F5. capability 工具映射 = 13 现有 CampusTools 且唯一（不新增工具）", () => {
  const toolToCap = new Set();
  const all = [];
  for (const id of ["ENTITY_RESOLUTION", "TEMPORAL_RESOLUTION", "SCHEDULE_DETAIL", "SCHEDULE_RANGE", "DAY_PLANNING", "SPACE_DISCOVERY", "COMMON_AVAILABILITY", "GROUP_PLANNING", "RISK_CHECK", "RESCHEDULE_SIMULATION", "CAMPUS_OVERVIEW", "TEACHER_LOAD_RANKING", "SPACE_UTILIZATION_RANKING"]) {
    const def = capability(id);
    assert.ok(def, `${id} 必须存在`);
    assert.ok(def.tools.length === 1, `${id} 恰好一个主工具`);
    const t = def.tools[0];
    assert.ok(!toolToCap.has(t), `工具 ${t} 不得重复映射`);
    toolToCap.add(t);
    all.push(t);
  }
  assert.strictEqual(all.length, 13, "13 capabilities ↔ 13 工具");
  assert.deepStrictEqual([...toolToCap].sort(), [
    "campus_academic_context", "campus_classroom_search", "campus_common_free_time_query", "campus_day_plan",
    "campus_entity_search", "campus_group_plan", "campus_overview", "campus_reschedule_feasibility",
    "campus_risk_check", "campus_room_utilization_query", "campus_schedule_query", "campus_schedule_range_query",
    "campus_teacher_load_query",
  ]);
});