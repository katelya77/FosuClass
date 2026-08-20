"use strict";
// Campus Decision Intelligence T1 —— ConstraintProfile（2026-08-19）
const test = require("node:test");
const assert = require("node:assert");
const path = require("path");

const { normalizeProfile, validateProfile, profileFromGoalSpec } = require(
  path.join(__dirname, "..", "..", "r51", "decision", "constraint-profile.js")
);

test("CP1. 合法 profile：hard/soft/exclusions 三类保留，errors 为空", () => {
  const { profile, errors } = normalizeProfile({
    hard: [{ id: "cap", field: "capacity", op: "gte", value: 60 }],
    soft: [{ id: "earlier", field: "periodStart", weight: 1, direction: "asc" }],
    exclusions: [{ id: "no-b", field: "building", op: "in", value: ["A2"] }],
  });
  assert.strictEqual(errors.length, 0);
  assert.strictEqual(profile.hard.length, 1);
  assert.strictEqual(profile.soft.length, 1);
  assert.strictEqual(profile.exclusions.length, 1);
});

test("CP2. 非法 op / direction / 非正 weight / 空 in 值 fail-closed", () => {
  const bad = [
    { hard: [{ id: "x", field: "f", op: "bogus", value: 1 }] },
    { soft: [{ id: "x", field: "f", weight: 1, direction: "bogus" }] },
    { soft: [{ id: "x", field: "f", weight: 0, direction: "asc" }] },
    { soft: [{ id: "x", field: "f", weight: -1, direction: "asc" }] },
    { hard: [{ id: "x", field: "f", op: "in", value: [] }] },
    { exclusions: [{ id: "x", field: "f", op: "in", value: [] }] },
  ];
  for (const raw of bad) {
    const r = normalizeProfile(raw);
    assert.strictEqual(r.profile, null, JSON.stringify(raw));
    assert.ok(r.errors.length > 0, JSON.stringify(raw));
  }
});

test("CP3. profileFromGoalSpec：设计指定 constraints→hard，preferences→soft", () => {
  const profile = profileFromGoalSpec({
    constraints: { minCapacity: 80, campus: "校区A", building: "A1", excludeBuilding: ["A2"] },
    preferences: { preferEarlier: true, preferLarger: true, preferSameCampus: true, preferWeekdays: [1, 3] },
  });
  assert.ok(profile.hard.some((h) => h.id === "capacity-min" && h.op === "gte" && h.value === 80));
  assert.ok(profile.hard.some((h) => h.id === "campus-eq" && h.value === "校区A"));
  assert.ok(profile.hard.some((h) => h.id === "building-eq" && h.value === "A1"));
  assert.ok(profile.hard.some((h) => h.id === "exclude-building" && h.op === "nin" && h.value.includes("A2")));
  assert.ok(profile.soft.some((s) => s.id === "prefer-earlier" && s.direction === "asc"));
  assert.ok(profile.soft.some((s) => s.id === "prefer-larger" && s.direction === "desc"));
  assert.ok(profile.soft.some((s) => s.id === "prefer-same-campus" && s.value === "校区A"));
  assert.ok(profile.soft.some((s) => s.id === "prefer-weekdays" && s.value.includes(3)));
});

test("CP4. 空 constraints/preferences → 空 profile，不注入默认约束", () => {
  const profile = profileFromGoalSpec({ constraints: {}, preferences: {} });
  assert.strictEqual(profile.hard.length, 0);
  assert.strictEqual(profile.soft.length, 0);
  assert.strictEqual(profile.exclusions.length, 0);
});

test("CP5. validateProfile 对已构造 profile 幂等（非法字段拒绝）", () => {
  const good = { hard: [{ id: "c", field: "capacity", op: "gte", value: 1 }], soft: [], exclusions: [] };
  assert.strictEqual(validateProfile(good).ok, true);
  const bad = { hard: [{ id: "c", field: "capacity", op: "bad", value: 1 }], soft: [], exclusions: [] };
  assert.strictEqual(validateProfile(bad).ok, false);
});

test("CP6. 已提供但非数值的 minCapacity 保留为非法 hard，评估前 fail-closed", () => {
  const mapped = profileFromGoalSpec({ constraints: { minCapacity: "eighty" }, preferences: {} });
  assert.strictEqual(mapped.hard.length, 1, "不得静默丢弃已提供的硬约束");
  assert.strictEqual(mapped.hard[0].id, "capacity-min");
  const validation = validateProfile(mapped);
  assert.strictEqual(validation.ok, false);
  assert.match(validation.errors.join("; "), /capacity-min.*有限数/);
});
