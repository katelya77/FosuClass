"use strict";
// R51-H Mission State Isolation 门禁（2026-08-19）
// P1 NEW_TASK 清旧 domain-local pending（不继承已完成能力 / facts / 旧槽位快照）；
// P2 FOLLOW_UP 继承最小必要状态（activeEntity 同引用、相对时间、ranking selection）；
// P3 FOLLOW_UP 不继承 slotSnapshot：动态槽位变化仍必须 fresh execution。
const test = require("node:test");
const assert = require("node:assert");
const path = require("path");

const R51 = path.join(__dirname, "..", "..", "r51");
const { newMissionState, applyFacts } = require(path.join(R51, "mission", "model.js"));
const { freshToolRequired } = require(path.join(R51, "mission", "fresh-guard.js"));

function baseGoal(overrides) {
  return {
    goalFamily: "schedule_inquiry",
    userOutcome: "x",
    target: { entityType: "teacher", entityRef: "t-003", name: "教师003" },
    temporalScope: { kind: "explicit", weekStart: 1, weekEnd: 1 },
    constraints: {},
    selection: {},
    ...overrides,
  };
}

test("H1. NEW_TASK：旧状态全清（facts / completedCapabilities / unresolved 不继承）", () => {
  const prior = newMissionState(baseGoal(), { kind: "NEW_TASK" });
  applyFacts(prior, [{ capabilityId: "SCHEDULE_DETAIL", factKey: "scheduleFacts", slots: { weekStart: 1 }, resultRef: "r1", verified: true }]);
  prior.unresolvedRequirements.push({ kind: "temporal", missing: "week" });
  prior.status = "in_progress";

  const next = newMissionState(baseGoal({ goalFamily: "risk_inquiry" }), { kind: "NEW_TASK", prior });
  assert.deepStrictEqual(Object.keys(next.availableFacts), [], "NEW_TASK 不得继承 facts");
  assert.deepStrictEqual(next.completedCapabilities, [], "NEW_TASK 不得继承已完成能力");
  assert.deepStrictEqual(next.unresolvedRequirements, [], "NEW_TASK 不得继承 unresolved");
  assert.strictEqual(next.activeEntity, null);
  assert.strictEqual(next.status, "pending");
});

test("H2. FOLLOW_UP：activeEntity 同引用 → 继承；不同引用 → 不继承", () => {
  const prior = newMissionState(baseGoal(), { kind: "NEW_TASK" });
  prior.activeEntity = { type: "teacher", id: "t-003", name: "教师003" };

  const sameRef = newMissionState(baseGoal({ target: { entityType: "teacher", entityRef: "t-003" } }), { kind: "FOLLOW_UP", prior });
  assert.strictEqual(sameRef.activeEntity.id, "t-003", "FOLLOW_UP 继承同引用实体");

  const diffRef = newMissionState(baseGoal({ target: { entityType: "teacher", entityRef: "t-009", name: "教师009" } }), { kind: "FOLLOW_UP", prior });
  assert.strictEqual(diffRef.activeEntity, null, "新实体引用不得继承旧实体");
});

test("H3. FOLLOW_UP：kind=inherited 时继承最小 temporal；explicit 新值覆盖", () => {
  const prior = newMissionState(baseGoal(), { kind: "NEW_TASK" });
  prior.temporalScope = { weekStart: 1, weekEnd: 1 };

  const inherited = newMissionState(baseGoal({ temporalScope: { kind: "inherited" } }), { kind: "FOLLOW_UP", prior });
  assert.deepStrictEqual(inherited.temporalScope, { weekStart: 1, weekEnd: 1 });

  const explicit = newMissionState(baseGoal({ temporalScope: { kind: "explicit", weekStart: 2, weekEnd: 2 } }), { kind: "FOLLOW_UP", prior });
  assert.deepStrictEqual(explicit.temporalScope, { weekStart: 2, weekEnd: 2 }, "显式新值覆盖继承");
});

test("H4. FOLLOW_UP 不继承 slotSnapshot：weekday 变化 → 仍 fresh（问题 A 在 follow-up 同样生效）", () => {
  const prior = newMissionState(baseGoal(), { kind: "NEW_TASK" });
  prior.availableFacts = {
    scheduleFacts: {
      capabilityId: "SCHEDULE_DETAIL",
      factKey: "scheduleFacts",
      slots: { weekStart: 1, weekEnd: 1, weekday: null },
      resultRef: "r1",
      verified: true,
    },
  };
  const next = newMissionState(baseGoal({ temporalScope: { kind: "inherited", weekday: 3 } }), { kind: "FOLLOW_UP", prior });
  assert.deepStrictEqual(Object.keys(next.availableFacts), [], "FOLLOW_UP 状态不携带旧 facts（fresh 决策由 guard 独立完成）");
  const facts = [prior.availableFacts.scheduleFacts];
  assert.strictEqual(freshToolRequired({ weekStart: 1, weekEnd: 1, weekday: 3 }, facts), true, "动态槽位变化必须 fresh");
  assert.strictEqual(freshToolRequired({ weekStart: 1, weekEnd: 1, weekday: null }, facts), false, "槽位不变可复用");
});

test("H5. NEW_TASK 不继承 rankingSelection（跨域下钻外的排位不残留）", () => {
  const prior = newMissionState(baseGoal(), { kind: "NEW_TASK" });
  prior.rankingSelection = { selectedEntity: { id: "t-001", name: "教师001" }, position: 1, window: { weekStart: 1, weekEnd: 4 } };
  const next = newMissionState(baseGoal({ goalFamily: "space_inquiry" }), { kind: "NEW_TASK", prior });
  assert.strictEqual(next.rankingSelection, null);
});