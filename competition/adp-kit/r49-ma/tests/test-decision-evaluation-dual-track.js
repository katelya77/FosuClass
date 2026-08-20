"use strict";
// Campus Decision Intelligence T6 —— DecisionBundle 双轨裁判器（2026-08-20）
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const judge = require(path.join(__dirname, "..", "..", "evaluation", "dual-track", "judge.js"));
const { decisionIdFor } = require(path.join(__dirname, "..", "..", "r51", "decision", "receipt.js"));
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
    if (Object.hasOwn(fixture.expected, "presentationPass")) {
      assert.strictEqual(result.trackB.pass, fixture.expected.presentationPass, fixture.id);
    }
    if (fixture.expected.hardGate) {
      assert.strictEqual(result.trackA.items[fixture.expected.hardGate], false, fixture.id);
    }
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

function cloneValid() {
  return JSON.parse(JSON.stringify(testset.cases[0].bundle));
}

test("DDE7. 非 hard-gate 业务失败必须 verdict=fail，但保留非零 businessScore", () => {
  const relaxed = cloneValid();
  relaxed.evaluation.relaxedCount = 1;
  const relaxedScore = judge.scoreDecisionBundle(relaxed);
  assert.strictEqual(relaxedScore.trackA.items.hard_constraints_preserved, false);
  assert.strictEqual(relaxedScore.trackA.items.safety, true);
  assert.strictEqual(relaxedScore.trackA.items.no_contradiction, true);
  assert.strictEqual(relaxedScore.trackA.pass, false);
  assert.strictEqual(relaxedScore.businessScore, 7);
  assert.strictEqual(relaxedScore.verdict, "fail");

  const forged = cloneValid();
  forged.recommendation.candidate.attributes = { periodStart: 1, forged: true };
  const forgedScore = judge.scoreDecisionBundle(forged);
  assert.strictEqual(forgedScore.trackA.items.no_invented_alternatives, false);
  assert.strictEqual(forgedScore.trackA.items.no_contradiction, true);
  assert.ok(forgedScore.businessScore > 0);
  assert.strictEqual(forgedScore.verdict, "fail");

  const unverified = cloneValid();
  unverified.candidates[0].evidence.verified = false;
  unverified.recommendation.candidate.evidence.verified = false;
  unverified.recommendation.reasons = [];
  unverified.receipt.recommendation.reasons = [];
  unverified.viewModel.sections.find((section) => section.title === "理由").rows = [];
  refreshReceiptId(unverified);
  const unverifiedScore = judge.scoreDecisionBundle(unverified);
  assert.strictEqual(unverifiedScore.trackA.items.verified_recommendation_reasons, false);
  assert.strictEqual(unverifiedScore.trackA.items.no_invented_alternatives, false);
  assert.strictEqual(unverifiedScore.trackA.items.no_contradiction, true);
  assert.ok(unverifiedScore.businessScore > 0);
  assert.strictEqual(unverifiedScore.verdict, "fail");
});

test("DDE8. receipt hash/content 与 Widget 结构必须精确投影，不能靠字符串包含蒙混", () => {
  const badHash = cloneValid();
  badHash.receipt.decisionId = `decision-${"f".repeat(64)}`;
  const hashScore = judge.scoreDecisionBundle(badHash);
  assert.strictEqual(hashScore.trackA.items.stable_public_projection, false);
  assert.strictEqual(hashScore.trackA.items.no_contradiction, true, "内容一致但 hash 错误不是事实矛盾");
  assert.ok(hashScore.businessScore > 0);
  assert.strictEqual(hashScore.verdict, "fail");

  const receiptMismatch = cloneValid();
  receiptMismatch.receipt.recommendation.label = "伪造推荐";
  const receiptScore = judge.scoreDecisionBundle(receiptMismatch);
  assert.strictEqual(receiptScore.trackA.items.stable_public_projection, false);
  assert.strictEqual(receiptScore.trackA.items.no_contradiction, false);
  assert.strictEqual(receiptScore.businessScore, 0);

  const wrongSummary = cloneValid();
  wrongSummary.viewModel.summary = "推荐：伪造推荐";
  wrongSummary.viewModel.context = `其他位置提到：${wrongSummary.recommendation.candidate.label}`;
  const widgetScore = judge.scoreDecisionBundle(wrongSummary);
  assert.strictEqual(widgetScore.trackA.items.stable_public_projection, false);
  assert.strictEqual(widgetScore.trackA.items.no_contradiction, false);
  assert.strictEqual(widgetScore.businessScore, 0);
});

test("DDE9. renderOnlyFail 只在全部 Track A 通过且唯一呈现失败为 Widget renderability 时成立", () => {
  const presentation = score("decision-dt-04-presentation-only-failure");
  assert.strictEqual(presentation.trackA.pass, true);
  assert.strictEqual(presentation.trackB.items.widget_renderable, false);
  assert.strictEqual(presentation.trackB.items.follow_up, true);
  assert.strictEqual(presentation.renderOnlyFail, true);

  const businessAndWidget = cloneValid();
  businessAndWidget.evaluation.relaxedCount = 1;
  businessAndWidget.viewModel.version = "2.0-dev";
  assert.strictEqual(judge.scoreDecisionBundle(businessAndWidget).renderOnlyFail, false);
});

function refreshReceiptId(bundle) {
  const { decisionId, ...content } = bundle.receipt;
  bundle.receipt.decisionId = decisionIdFor(content);
  return bundle;
}

function validWithAlternative() {
  const bundle = cloneValid();
  const candidate = {
    id: "plan-2",
    label: "周四第1-2节",
    attributes: { periodStart: 1 },
    evidence: { factKey: "groupPlanFacts", verified: true },
    sourceIndex: 1,
    toolRank: 2,
  };
  const reason = {
    kind: "soft_preference",
    text: "已核验：备选时段符合当前偏好。",
    source: { constraintId: "prefer-earlier", attribute: "periodStart", factKey: "groupPlanFacts" },
  };
  bundle.candidates.push(candidate);
  bundle.alternatives.push({
    candidate: JSON.parse(JSON.stringify(candidate)),
    hardSatisfied: true,
    hardViolations: [],
    excluded: false,
    exclusionViolations: [],
    reasons: [reason],
  });
  bundle.receipt.alternatives.push({ label: candidate.label, reasons: [reason.text] });
  const alternativeSection = bundle.viewModel.sections.find((section) => section.title === "备选");
  alternativeSection.rows.push({ label: "备选1", value: candidate.label, hint: reason.text });
  return refreshReceiptId(bundle);
}

test("DDE10. no_viable 两种公开 summary 必须精确，不能伪装成推荐", () => {
  const verifiedEmpty = JSON.parse(JSON.stringify(testset.cases[1].bundle));
  verifiedEmpty.viewModel.summary = "推荐：伪造方案";
  const verifiedScore = judge.scoreDecisionBundle(verifiedEmpty);
  assert.strictEqual(verifiedScore.trackA.items.stable_public_projection, false);
  assert.strictEqual(verifiedScore.trackA.items.no_contradiction, false);
  assert.strictEqual(verifiedScore.businessScore, 0);
  assert.strictEqual(verifiedScore.verdict, "fail");

  const noSource = JSON.parse(JSON.stringify(testset.cases[2].bundle));
  noSource.viewModel.summary = "推荐：伪造方案";
  const recoveryScore = judge.scoreDecisionBundle(noSource);
  assert.strictEqual(recoveryScore.trackA.items.stable_public_projection, false);
  assert.strictEqual(recoveryScore.trackA.items.no_contradiction, false);
  assert.strictEqual(recoveryScore.businessScore, 0);
  assert.strictEqual(recoveryScore.verdict, "fail");
});

test("DDE11. 推荐理由 rows 必须与 receipt reasons 精确一致，禁止追加未核验理由", () => {
  const inventedReason = cloneValid();
  inventedReason.viewModel.sections.find((section) => section.title === "理由").rows.push({
    label: "理由2",
    value: "未核验的伪造理由",
  });
  const score = judge.scoreDecisionBundle(inventedReason);
  assert.strictEqual(score.trackA.items.stable_public_projection, false);
  assert.strictEqual(score.trackA.items.no_contradiction, false);
  assert.strictEqual(score.businessScore, 0);
  assert.strictEqual(score.verdict, "fail");
});

test("DDE12. 备选 reason hint 存在时必须与 receipt reasons 精确一致", () => {
  const valid = validWithAlternative();
  assert.strictEqual(judge.scoreDecisionBundle(valid).verdict, "pass");

  const wrongHint = validWithAlternative();
  wrongHint.viewModel.sections.find((section) => section.title === "备选").rows[0].hint = "未核验的伪造理由";
  const wrongScore = judge.scoreDecisionBundle(wrongHint);
  assert.strictEqual(wrongScore.trackA.items.stable_public_projection, false);
  assert.strictEqual(wrongScore.trackA.items.no_contradiction, false);
  assert.strictEqual(wrongScore.businessScore, 0);

  const missingHint = validWithAlternative();
  delete missingHint.viewModel.sections.find((section) => section.title === "备选").rows[0].hint;
  assert.strictEqual(judge.scoreDecisionBundle(missingHint).trackA.items.stable_public_projection, false);
});
