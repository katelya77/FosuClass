"use strict";
// CSF P5 authority model 测试（2026-08-19）
const test = require("node:test");
const assert = require("node:assert");
const path = require("path");
const auth = require(path.join(__dirname, "..", "..", "r51", "mission", "authority.js"));

test("A1. 只读查询族 = L1 auto（schedule / range / entity）", () => {
  for (const family of ["schedule_inquiry", "schedule_range_inquiry", "entity_query"]) {
    const r = auth.authorizeMission({ goalFamily: family });
    assert.strictEqual(r.level, "L1", family);
    assert.strictEqual(r.requiresConfirm, false, family);
  }
});

test("A2. 分析族 = L2 auto（分析/比较/风险/what-if/候选/排名/态势）", () => {
  for (const family of [
    "risk_inquiry",
    "reschedule_simulation",
    "ranking_inquiry",
    "overview_inquiry",
    "space_utilization_inquiry",
    "common_availability",
    "collaboration_planning",
    "campus_operations_insight",
    "day_planning",
    "space_inquiry",
    "group_planning",
    "teaching_assurance",
  ]) {
    const r = auth.authorizeMission({ goalFamily: family });
    assert.strictEqual(r.level, "L2", family);
    assert.strictEqual(r.requiresConfirm, false, family);
  }
});

test("A3. L3 写操作：import/bind/resync/modify/reserve/submit 全部要求确认", () => {
  for (const intent of auth.L3_WRITE_INTENTS) {
    const r = auth.authorizeMission({ goalFamily: "personal_schedule", intent });
    assert.strictEqual(r.level, "L3", intent);
    assert.strictEqual(r.requiresConfirm, true, intent);
  }
});

test("A4. MissionState 挂载 authorityLevel", () => {
  const state = {};
  auth.attachAuthority(state, { goalFamily: "risk_inquiry" });
  assert.strictEqual(state.authorityLevel, "L2");
  assert.strictEqual(state.authorityConfirmed, false);
  const w = {};
  auth.attachAuthority(w, { goalFamily: "personal_schedule", intent: "import" });
  assert.strictEqual(w.authorityLevel, "L3");
});

test("A5. isAuthorized：L0/L1/L2 通过；L3 未确认被拦截", () => {
  assert.strictEqual(auth.isAuthorized({ authorityLevel: "L0" }), true);
  assert.strictEqual(auth.isAuthorized({ authorityLevel: "L1" }), true);
  assert.strictEqual(auth.isAuthorized({ authorityLevel: "L2" }), true);
  assert.strictEqual(auth.isAuthorized({ authorityLevel: "L3", authorityConfirmed: false }), false);
  assert.strictEqual(auth.isAuthorized({ authorityLevel: "L3", authorityConfirmed: true }), true);
  assert.strictEqual(auth.isAuthorized(null), false);
});

test("A6. 主协调主动性不得绕过 L3（assertNoL3AutoRun）", () => {
  assert.strictEqual(auth.assertNoL3AutoRun({ goalFamily: "ranking_inquiry" }), true);
  assert.strictEqual(auth.assertNoL3AutoRun({ goalFamily: "personal_schedule", intent: "import" }), false);
  assert.strictEqual(
    auth.assertNoL3AutoRun({ goalFamily: "personal_schedule", intent: "import", confirmed: true }),
    true
  );
});

test("A7. FOLLOW_UP 继承 prior 授权（不重新降级/升级）", () => {
  const state = { authorityLevel: "L3", authorityConfirmed: true };
  auth.attachAuthority(state, { goalFamily: "personal_schedule", intent: "resync" }, { prior: state });
  assert.strictEqual(state.authorityLevel, "L3");
  assert.strictEqual(state.authorityConfirmed, true);
});