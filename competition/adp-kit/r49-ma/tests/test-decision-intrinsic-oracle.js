"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");

const decisionRoot = path.join(__dirname, "..", "..", "r51", "decision");
const { decide } = require(path.join(decisionRoot, "controller.js"));
const { synthesizeOutcome } = require(path.join(decisionRoot, "outcome-synthesizer.js"));
const { evaluateCandidates } = require(path.join(decisionRoot, "evaluator.js"));
const { rankFeasible } = require(path.join(decisionRoot, "ranking.js"));
const { explainCandidate } = require(path.join(decisionRoot, "explainability.js"));
const {
  buildAuthoritativeIntrinsicConstraints,
  intrinsicConstraintFingerprint,
} = require(path.join(decisionRoot, "intrinsic-constraints.js"));
const { scoreDecisionBundle } = require(path.join(__dirname, "..", "..", "evaluation", "dual-track", "judge.js"));

function rawReschedule(feasible) {
  return {
    success: true,
    items: [{
      target: { week: 3, weekday: 3, weekdayName: "周三", periodStart: 5, periodEnd: 6, periodText: "第5-6节" },
      checks: {
        teacherConflict: { conflict: !feasible, details: feasible ? [] : [{ id: "teacher-conflict" }] },
        classConflict: { conflict: false, details: [] },
        roomConflict: { conflict: false, details: [] },
        capacity: { ok: true },
        feature: { ok: true },
      },
      warnings: [],
    }],
    evidence: { verified: true },
  };
}

function productionBundle(feasible = true, preferences = {}) {
  const factKey = "rescheduleSimFacts";
  const toolName = "campus_reschedule_feasibility";
  const core = decide({
    missionState: {
      goal: { goalFamily: "reschedule_simulation", completionCriteria: [factKey] },
      availableFacts: { [factKey]: { factKey, toolName, resultRef: "trusted-reschedule-ref", verified: true } },
      steps: [],
      authorityLevel: "L2",
    },
    toolResults: { [toolName]: rawReschedule(feasible) },
    goalSpec: { goalFamily: "reschedule_simulation", constraints: {}, preferences, selection: { topN: 2 } },
  });
  const outcome = synthesizeOutcome(core);
  return JSON.parse(JSON.stringify({ ...core, receipt: outcome.receipt, viewModel: outcome.viewModel }));
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function reproject(bundle) {
  bundle.evaluation = evaluateCandidates(bundle.candidates, bundle.profile);
  bundle.ranked = rankFeasible(bundle.evaluation.items);
  const chosen = bundle.ranked[0] || null;
  bundle.recommendation = chosen ? { ...chosen, reasons: explainCandidate(chosen, bundle.profile) } : null;
  bundle.alternatives = [];
  bundle.reasons = { recommendation: bundle.recommendation ? bundle.recommendation.reasons : [], alternatives: [] };
  bundle.decision = chosen ? "recommend" : "no_viable_option";
  bundle.tieGroupCount = chosen ? 1 : 0;
  const outcome = synthesizeOutcome(bundle);
  bundle.receipt = outcome.receipt;
  bundle.viewModel = outcome.viewModel;
  return bundle;
}

function expectOracleReject(bundle, label) {
  const scored = scoreDecisionBundle(bundle);
  assert.strictEqual(scored.verdict, "fail", label);
  assert.strictEqual(scored.trackA.items.hard_constraints_preserved, false, label);
}

test("DIO1 authoritative builder 只由可信 goalFamily 生成 canonical intrinsic constraint", () => {
  const constraints = buildAuthoritativeIntrinsicConstraints({ goalFamily: "reschedule_simulation" });
  assert.deepStrictEqual(constraints, [{
    id: "system-reschedule-feasible",
    kind: "hard",
    source: "system",
    field: "feasible",
    op: "eq",
    value: true,
    provenanceRefs: ["rescheduleSimFacts"],
  }]);
  assert.deepStrictEqual(buildAuthoritativeIntrinsicConstraints({ goalFamily: "collaboration_planning" }), []);
});

test("DIO2 intrinsic fingerprint 对同一 canonical context 稳定且 controller 记录同一值", () => {
  const context = { goalFamily: "reschedule_simulation" };
  const expected = intrinsicConstraintFingerprint(buildAuthoritativeIntrinsicConstraints(context));
  const first = productionBundle();
  const second = productionBundle();
  assert.match(expected, /^sha256:[a-f0-9]{64}$/);
  assert.strictEqual(first.intrinsicConstraintFingerprint, expected);
  assert.strictEqual(second.intrinsicConstraintFingerprint, expected);
  assert.strictEqual(scoreDecisionBundle(first).verdict, "pass");
});

test("DIO-A1 删除 system-reschedule-feasible 必须被 oracle 拒绝", () => {
  const bundle = productionBundle();
  bundle.profile.hard = bundle.profile.hard.filter((entry) => entry.id !== "system-reschedule-feasible");
  expectOracleReject(bundle, "missing intrinsic");
});

test("DIO-A2 修改 system constraint value 必须被 oracle 拒绝", () => {
  const bundle = productionBundle();
  bundle.profile.hard.find((entry) => entry.id === "system-reschedule-feasible").value = false;
  expectOracleReject(bundle, "modified value");
});

test("DIO-A3 把 system hard 降级为 soft 必须被 oracle 拒绝", () => {
  const bundle = productionBundle();
  const intrinsic = bundle.profile.hard.pop();
  bundle.profile.soft.push({ ...intrinsic, weight: 1, direction: "prefer-value" });
  expectOracleReject(bundle, "hard downgraded to soft");
});

test("DIO-A4 duplicate same system ID 必须被 oracle 拒绝", () => {
  const bundle = productionBundle();
  bundle.profile.hard.push(clone(bundle.profile.hard.find((entry) => entry.id === "system-reschedule-feasible")));
  expectOracleReject(bundle, "duplicate intrinsic");
});

test("DIO-A5 duplicate conflicting system ID 必须被 oracle 拒绝", () => {
  const bundle = productionBundle();
  bundle.profile.hard.push({ ...clone(bundle.profile.hard[0]), value: false });
  expectOracleReject(bundle, "conflicting duplicate intrinsic");
});

test("DIO-A6 forged evaluation 不能恢复通过", () => {
  const bundle = productionBundle();
  bundle.profile.hard = [];
  bundle.evaluation = evaluateCandidates(bundle.candidates, bundle.profile);
  expectOracleReject(bundle, "forged evaluation");
});

test("DIO-A7 forged receipt 不能恢复通过", () => {
  const bundle = productionBundle();
  bundle.profile.hard = [];
  reproject(bundle);
  expectOracleReject(bundle, "forged receipt");
});

test("DIO-A8 forged Widget 不能恢复通过", () => {
  const bundle = productionBundle();
  bundle.profile.hard = [];
  reproject(bundle);
  bundle.viewModel.summary = `推荐：${bundle.recommendation.candidate.label}`;
  expectOracleReject(bundle, "forged widget");
});

test("DIO-A9 feasible:false + coherent forged bundle 必须 fail closed", () => {
  const bundle = productionBundle(false);
  bundle.profile.hard = [];
  reproject(bundle);
  assert.strictEqual(bundle.recommendation.candidate.attributes.feasible, false);
  expectOracleReject(bundle, "coherent infeasible forgery");
});

test("DIO-A10 profile omission + recomputed soft score 必须 fail closed", () => {
  const bundle = productionBundle(true, { preferEarlier: true });
  bundle.profile = { hard: [], soft: clone(bundle.profile.soft), exclusions: [] };
  reproject(bundle);
  expectOracleReject(bundle, "profile omission with recomputed soft score");
});

test("DIO-A11 forged fingerprint 必须被 judge 自行重算后拒绝", () => {
  const bundle = productionBundle();
  bundle.intrinsicConstraintFingerprint = `sha256:${"0".repeat(64)}`;
  expectOracleReject(bundle, "forged fingerprint");
});
