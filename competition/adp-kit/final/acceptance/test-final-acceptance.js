"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const KIT = path.join(__dirname, "..", "..");
const MATRIX = path.join(__dirname, "FINAL-ACCEPTANCE-MATRIX.md");
const { freshToolRequired } = require(path.join(KIT, "r51", "mission", "fresh-guard.js"));
const { preflightToolCall } = require(path.join(KIT, "r51", "mission", "preflight.js"));
const { decideClarification } = require(path.join(KIT, "r51", "mission", "resolve-before-clarify.js"));

test("FA1 Final matrix contains A-P with paraphrases and executable evidence", () => {
  const text = fs.readFileSync(MATRIX, "utf8");
  for (const id of "ABCDEFGHIJKLMNOP") assert.match(text, new RegExp(`\\| ${id} \\|`), id);
  assert.match(text, /自然改写样本/);
  assert.match(text, /自动证据/);
});

test("FA2 fresh dynamic slots and new-session bare follow-up remain fail-closed", () => {
  const prior = [{ verified: true, slots: { entityName: "某教师", weekStart: 1, weekEnd: 1 } }];
  assert.equal(freshToolRequired({ entityName: "某教师", weekStart: 1, weekEnd: 1, weekday: 3 }, prior), true);
  assert.equal(freshToolRequired({ entityName: "某教师", weekStart: 2, weekEnd: 2 }, prior), true);
  assert.deepEqual(decideClarification({ requirement: { kind: "entity" }, candidates: [], resolvable: true }), {
    decision: "clarify", reason: "no_result",
  });
});

test("FA3 paraphrased soft preferences map to the first eligible call without query-string routing", () => {
  const paraphrases = ["空间宽裕一点", "尽量能坐更多人", "容量大的优先"];
  for (const text of paraphrases) {
    const result = preflightToolCall("campus_classroom_search", { campus: "校区A", week: 1, weekday: 3, periodStart: 5, periodEnd: 6 }, {
      callIndex: 0,
      goalSpec: { userOutcome: text, constraints: { soft: { preferLarger: true, preferEarlier: true, preferSameCampus: true } } },
    });
    assert.equal(result.ok, true, text);
    assert.deepEqual(result.params.decisionPreferences, { preferEarlier: true, preferLarger: true, preferSameCampus: true });
  }
});

test("FA4 Final runtime topology, knowledge count and anonymous dataset truth remain unchanged", () => {
  const bindings = JSON.parse(fs.readFileSync(path.join(KIT, "r50.1", "agent-tool-bindings.json"), "utf8"));
  const dataset = JSON.parse(fs.readFileSync(path.join(KIT, "mock-data", "competition-demo-v3.json"), "utf8"));
  const knowledge = fs.readdirSync(path.join(KIT, "knowledge", "current")).filter((name) => /^\d{2}-.*\.md$/.test(name));
  assert.equal(bindings.uniqueOperationCount, 13);
  assert.equal(bindings.bindingCount, 14);
  assert.deepEqual(bindings.agents.main, []);
  assert.equal(knowledge.length, 10);
  assert.equal(dataset.meta.dataVersion, "competition-demo-v3");
});

test("FA5 knowledge no longer instructs the UI to display internal data-version evidence", () => {
  const dir = path.join(KIT, "knowledge", "current");
  const text = fs.readdirSync(dir).filter((name) => name.endsWith(".md"))
    .map((name) => fs.readFileSync(path.join(dir, name), "utf8")).join("\n");
  assert.doesNotMatch(text, /数据版本.*随结果展示|由工具返回并随结果展示/);
  assert.doesNotMatch(text, /competition-demo-v[123]/);
});
