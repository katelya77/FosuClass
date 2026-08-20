"use strict";
// Campus Decision Intelligence T6 —— DecisionBundle 双轨裁判器（2026-08-20）
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const judge = require(path.join(__dirname, "..", "..", "evaluation", "dual-track", "judge.js"));
const testset = JSON.parse(fs.readFileSync(
  path.join(__dirname, "..", "..", "evaluation", "dual-track", "decision-testset.json"),
  "utf8",
));

function score(id) {
  const fixture = testset.cases.find((item) => item.id === id);
  assert.ok(fixture, `missing fixture ${id}`);
  return judge.scoreDecisionBundle(fixture.bundle);
}

test("DDE1. testset 覆盖六类必需决策结果且全部可确定性评分", () => {
  assert.deepStrictEqual(testset.cases.map((item) => item.id), [
    "decision-dt-01-valid-recommend",
    "decision-dt-02-verified-empty",
    "decision-dt-03-no-source-recoverable",
    "decision-dt-04-presentation-only-failure",
    "decision-dt-05-safety-leak",
    "decision-dt-06-contradiction",
  ]);
  for (const fixture of testset.cases) {
    const result = judge.scoreDecisionBundle(fixture.bundle);
    assert.strictEqual(result.verdict, fixture.expected.verdict, fixture.id);
    assert.strictEqual(result.trackA.pass, fixture.expected.businessPass, fixture.id);
  }
});

test("DDE2. 合法 recommend：eligibility、核验理由、hard=0、候选与公开投影全部通过", () => {
  const result = score("decision-dt-01-valid-recommend");
  assert.deepStrictEqual(result.trackA.items, {
    eligibility_shape: true,
    verified_recommendation_reasons: true,
    hard_constraints_preserved: true,
    no_invented_alternatives: true,
    stable_public_projection: true,
    no_contradiction: true,
    recovery_on_failure: true,
    safety: true,
  });
  assert.strictEqual(result.trackB.items.widget_renderable, true);
  assert.strictEqual(result.trackB.items.follow_up, true);
  assert.strictEqual(result.trackB.items.no_internal_leak, true);
  assert.strictEqual(result.verdict, "pass");
});

test("DDE3. verified empty 与 no-source recoverable 都不得发明推荐、备选或理由", () => {
  for (const id of ["decision-dt-02-verified-empty", "decision-dt-03-no-source-recoverable"]) {
    const result = score(id);
    assert.strictEqual(result.trackA.items.no_invented_alternatives, true, id);
    assert.strictEqual(result.trackA.items.verified_recommendation_reasons, true, id);
    assert.strictEqual(result.trackA.items.recovery_on_failure, true, id);
    assert.strictEqual(result.businessScore, 8, id);
    assert.strictEqual(result.verdict, "pass", id);
  }
});

test("DDE4. Widget-only failure 只降 Track B，绝不清零有效业务结果", () => {
  const result = score("decision-dt-04-presentation-only-failure");
  assert.strictEqual(result.trackA.pass, true);
  assert.strictEqual(result.trackA.score, 8);
  assert.strictEqual(result.businessScore, 8);
  assert.strictEqual(result.trackB.items.widget_renderable, false);
  assert.strictEqual(result.renderOnlyFail, true);
  assert.strictEqual(result.verdict, "pass_with_presentation_issues");
});

test("DDE5. safety 与 no_contradiction 继续作为 hard gates 清零业务分", () => {
  const safety = score("decision-dt-05-safety-leak");
  assert.strictEqual(safety.trackA.items.safety, false);
  assert.strictEqual(safety.businessScore, 0);
  assert.strictEqual(safety.verdict, "fail");

  const contradiction = score("decision-dt-06-contradiction");
  assert.strictEqual(contradiction.trackA.items.no_contradiction, false);
  assert.strictEqual(contradiction.businessScore, 0);
  assert.strictEqual(contradiction.verdict, "fail");
});

test("DDE6. scoreDecisionBundle 是不修改输入的确定性纯函数", () => {
  const fixture = testset.cases[0].bundle;
  const before = JSON.stringify(fixture);
  const first = JSON.stringify(judge.scoreDecisionBundle(fixture));
  const second = JSON.stringify(judge.scoreDecisionBundle(JSON.parse(before)));
  assert.strictEqual(first, second);
  assert.strictEqual(JSON.stringify(fixture), before);
});
