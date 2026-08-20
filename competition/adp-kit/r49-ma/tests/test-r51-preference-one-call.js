"use strict";

const test = require("node:test");
const assert = require("node:assert");
const path = require("node:path");

const { preflightToolCall, mapDecisionPreferences } = require(path.join(__dirname, "..", "..", "r51", "mission", "preflight.js"));

test("PF1 structured GoalSpec soft preferences reach the first Decision-capable call", () => {
  const goalSpec = { constraints: { soft: { preferLarger: true, preferEarlier: false, preferWeekdays: [5, 1, 5] } } };
  const result = preflightToolCall("campus_classroom_search", { week: 2 }, { goalSpec, callIndex: 0 });
  assert.strictEqual(result.ok, true);
  assert.deepStrictEqual(result.params.decisionPreferences, { preferEarlier: false, preferLarger: true, preferWeekdays: [1, 5] });
});

test("PF2 paraphrases converge before preflight and therefore need one business query", () => {
  const structuredParaphrases = [
    { text: "优先容量大的", goalSpec: { constraints: { soft: { preferLarger: true } } } },
    { text: "尽量选能坐更多人的教室", goalSpec: { constraints: { soft: { preferLarger: true } } } },
    { text: "空间宽裕一点更好", goalSpec: { constraints: { soft: { preferLarger: true } } } },
  ];
  for (const fixture of structuredParaphrases) {
    const calls = [];
    const first = preflightToolCall("campus_group_plan", { entities: [], week: 1 }, { goalSpec: fixture.goalSpec, callIndex: 0 });
    calls.push(first.params);
    assert.strictEqual(calls.length, 1, fixture.text);
    assert.deepStrictEqual(calls[0].decisionPreferences, { preferLarger: true }, fixture.text);
  }
});

test("PF3 only four preference fields are accepted and non-Decision tools stay unchanged", () => {
  assert.deepStrictEqual(mapDecisionPreferences({ preferEarlier: true, preferLarger: true, preferSameCampus: true, preferWeekdays: [2], arbitrary: true }), {
    preferEarlier: true, preferLarger: true, preferSameCampus: true, preferWeekdays: [2],
  });
  const result = preflightToolCall("campus_schedule_query", { entityType: "teacher", entityName: "教师009" }, {
    goalSpec: { constraints: { soft: { preferLarger: true } } }, callIndex: 0,
  });
  assert.strictEqual(result.params.decisionPreferences, undefined);
});
