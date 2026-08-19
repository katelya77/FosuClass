"use strict";
// R51-C FreshToolCallGuard 门禁（2026-08-19）
// P1 动态槽位（week/weekStart/weekEnd/weekday/date/periodStart/periodEnd/campus/building/
//    room/capacity/entity/metric/sort/topN 等）变化 → 必须 fresh capability execution；
// P2 历史结果只用于 reference/entity/temporal inheritance，不能代替新动态 Tool query；
// P3 单纯解释型 follow-up（无槽位变化）→ 可复用 verified result；
// P4 槽位清单派生自现有 OpenAPI input schemas（非手工固定清单）。
const test = require("node:test");
const assert = require("node:assert");
const path = require("path");

const R51 = path.join(__dirname, "..", "..", "r51");
const { freshToolRequired, isReusableFact, slotSnapshotOf, DYNAMIC_SLOT_KEYS } = require(path.join(R51, "mission", "fresh-guard.js"));
const { loadOperationContracts, OPENAPI_PATH } = require(path.join(R51, "mission", "preflight.js"));

const FACT_WEEK1 = {
  capabilityId: "SCHEDULE_DETAIL",
  factKey: "scheduleFacts",
  slots: { weekStart: 1, weekEnd: 1, weekday: null, periodStart: null, periodEnd: null, entityType: "teacher", entityName: "教师003" },
  resultRef: "r-week1",
  verified: true,
};

test("C1. 无任何可用事实 → fresh 必填", () => {
  assert.strictEqual(freshToolRequired({ weekStart: 1 }, []), true);
});

test("C2. 槽位完全一致 → 可复用（解释型 follow-up）", () => {
  assert.strictEqual(freshToolRequired({ weekStart: 1, weekEnd: 1, entityName: "教师003" }, [FACT_WEEK1]), false);
});

test("C3. weekday 变化（整周 → 某一天）→ 必须 fresh（问题 A 回归）", () => {
  assert.strictEqual(freshToolRequired({ weekStart: 1, weekEnd: 1, weekday: 3, entityName: "教师003" }, [FACT_WEEK1]), true);
});

test("C4. week 变化 → fresh", () => {
  assert.strictEqual(freshToolRequired({ weekStart: 2, weekEnd: 2, entityName: "教师003" }, [FACT_WEEK1]), true);
});

test("C5. 实体变化 → fresh", () => {
  assert.strictEqual(freshToolRequired({ weekStart: 1, weekEnd: 1, entityName: "教师009" }, [FACT_WEEK1]), true);
});

test("C6. 全部槽位为空（纯解释请求）→ 复用 verified result", () => {
  assert.strictEqual(freshToolRequired({}, [FACT_WEEK1]), false);
});

test("C7. overview 聚合窗口计数 ≠ academic week：聚合 fact 不可满足单周查询", () => {
  const ovFact = {
    capabilityId: "CAMPUS_OVERVIEW",
    factKey: "overviewFacts",
    slots: { windowAggregateCount: 4, weekStart: null, weekEnd: null },
    resultRef: "r-ov",
    verified: true,
  };
  assert.strictEqual(freshToolRequired({ weekStart: 1, weekEnd: 1 }, [ovFact]), true, "聚合计数不得继承为教学周");
  assert.strictEqual(isReusableFact(ovFact, { weekStart: 1, weekEnd: 1 }), false);
});

test("C8. 槽位清单派生自 OpenAPI：每个 DYNAMIC_SLOT_KEYS 成员 ∈ 13 个 operation input props 并集", () => {
  const contracts = loadOperationContracts();
  const props = new Set();
  for (const c of Object.values(contracts)) {
    for (const name of Object.keys(c.params)) props.add(name);
  }
  for (const key of DYNAMIC_SLOT_KEYS) {
    assert.ok(props.has(key), `槽位 ${key} 必须存在于 OpenAPI input 契约中`);
  }
});

test("C9. slotSnapshotOf 覆盖全部动态槽位类别（含 metric/sort/topN/period）", () => {
  const snap = slotSnapshotOf({
    goalFamily: "ranking_inquiry",
    userOutcome: "x",
    target: { entityType: "teacher", entityRef: "t-003", name: "教师003" },
    temporalScope: { kind: "explicit", weekStart: 1, weekEnd: 4, weekday: 3, date: null, periodStart: 5, periodEnd: 6 },
    constraints: { campus: "校区A", building: "A2", minCapacity: 60 },
    selection: { metric: "teacher_load", sort: "highest", topN: 3, position: 1 },
  });
  assert.strictEqual(snap.weekStart, 1);
  assert.strictEqual(snap.weekEnd, 4);
  assert.strictEqual(snap.weekday, 3);
  assert.strictEqual(snap.periodStart, 5);
  assert.strictEqual(snap.periodEnd, 6);
  assert.strictEqual(snap.campus, "校区A");
  assert.strictEqual(snap.building, "A2");
  assert.strictEqual(snap.minCapacity, 60);
  assert.strictEqual(snap.metric, "teacher_load");
  assert.strictEqual(snap.sort, "highest");
  assert.strictEqual(snap.topN, 3);
  assert.strictEqual(snap.entityName, "教师003");
  assert.ok(OPENAPI_PATH.includes("campus-agent-tools.adp-import.json"), "槽位来源 = ADP OpenAPI");
});