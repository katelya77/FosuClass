"use strict";
// R51-E Resolve-before-Clarify 门禁（2026-08-19）
// P1 可被现有 capability 确定性缩小的缺失/歧义 → 先 RESOLVE，不澄清（问题 C 回归）；
// P2 仅以下情形澄清：多实质候选 / 无结果 / required value 不在任何可解析上下文 / 用户主观选择。
const test = require("node:test");
const assert = require("node:assert");
const path = require("path");

const R51 = path.join(__dirname, "..", "..", "r51");
const { decideClarification, shouldAttemptResolution } = require(path.join(R51, "mission", "resolve-before-clarify.js"));

test("E1. 单一候选 → resolve（不澄清）", () => {
  const r = decideClarification({ requirement: { kind: "entity", missing: "courseRef" }, candidates: [{ id: "c-01", name: "程序设计基础" }] });
  assert.strictEqual(r.decision, "resolve");
  assert.strictEqual(r.entityRef.id, "c-01");
});

test("E2. 多实质候选 → clarify(multiple_candidates)", () => {
  const r = decideClarification({
    requirement: { kind: "entity", missing: "courseRef" },
    candidates: [{ id: "c-01", name: "程序设计基础" }, { id: "c-02", name: "程序设计高级" }],
  });
  assert.strictEqual(r.decision, "clarify");
  assert.strictEqual(r.reason, "multiple_candidates");
});

test("E3. 无结果 → clarify(no_result)", () => {
  const r = decideClarification({ requirement: { kind: "entity", missing: "courseRef" }, candidates: [] });
  assert.strictEqual(r.decision, "clarify");
  assert.strictEqual(r.reason, "no_result");
});

test("E4. required value 不在任何可解析上下文 → clarify(not_resolvable)", () => {
  const r = decideClarification({ requirement: { kind: "temporal", missing: "weekStart" }, candidates: [], resolvable: false });
  assert.strictEqual(r.decision, "clarify");
  assert.strictEqual(r.reason, "not_resolvable");
});

test("E5. 用户主观选择 → clarify(subjective)", () => {
  const r = decideClarification({ requirement: { kind: "choice", missing: "compareTarget" }, candidates: [], requiresChoice: true });
  assert.strictEqual(r.decision, "clarify");
  assert.strictEqual(r.reason, "subjective");
});

test("E6. 有 resolver capability 且可解析 → 应尝试解析（允许 Main → Schedule(entity) → Main → Risk）", () => {
  assert.strictEqual(shouldAttemptResolution({ requirement: { kind: "entity" }, hasResolverCapability: true }), true);
  assert.strictEqual(shouldAttemptResolution({ requirement: { kind: "entity" }, hasResolverCapability: false }), false);
  assert.strictEqual(shouldAttemptResolution({ requirement: { kind: "subjective" }, hasResolverCapability: true }), false);
});

test("E7. 课程歧义 → 先 ENTITY_RESOLUTION 而不是直接澄清（planner 集成）", () => {
  const { planMission } = require(path.join(R51, "mission", "planner.js"));
  const plan = planMission({
    goalFamily: "reschedule_simulation",
    userOutcome: "把程序设计基础调到周三下午试试",
    target: { entityType: "course", entityRef: null, name: "程序设计基础" },
    temporalScope: { kind: "explicit", weekStart: 1, weekEnd: 1, weekday: 3, periodStart: 5, periodEnd: 6 },
    constraints: {},
    selection: {},
  });
  assert.deepStrictEqual(plan.steps.map((s) => s.capability), ["ENTITY_RESOLUTION", "RESCHEDULE_SIMULATION"]);
});