"use strict";
// Campus Decision Intelligence T6 —— structured Decision E2E acceptance matrix（2026-08-20）
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const ADP = path.join(__dirname, "..", "..");
const DECISION = path.join(ADP, "r51", "decision");
const { decide, ELIGIBLE_GOAL_FAMILIES } = require(path.join(DECISION, "controller.js"));
const { explainCandidate } = require(path.join(DECISION, "explainability.js"));
const { authorityAwareAction } = require(path.join(DECISION, "authority-action.js"));
const { synthesizeOutcome } = require(path.join(DECISION, "outcome-synthesizer.js"));
const { validatePublicDecisionReceipt } = require(path.join(DECISION, "receipt.js"));
const { validateWidgetPayload } = require(path.join(ADP, "widget", "native", "campus-result-unified-v1", "payload-validator.js"));
const { scoreDecisionBundle } = require(path.join(ADP, "evaluation", "dual-track", "judge.js"));
const bindings = require(path.join(ADP, "r50.1", "agent-tool-bindings.json"));

function fact(factKey, toolName) {
  return { factKey, toolName, resultRef: `fixture-${factKey}`, verified: true };
}

function raw(items, verified = true) {
  return { success: true, items, evidence: { verified } };
}

function args({ family, factKey, toolName, items, constraints = {}, preferences = {}, authorityLevel = "L2", verified = true, selection = {}, intent }) {
  return {
    missionState: {
      goal: { goalFamily: family, completionCriteria: factKey ? [factKey] : [] },
      availableFacts: factKey ? { [factKey]: fact(factKey, toolName) } : {},
      steps: [],
      authorityLevel,
    },
    toolResults: toolName ? { [toolName]: raw(items, verified) } : {},
    goalSpec: { goalFamily: family, constraints, preferences, selection, ...(intent ? { intent } : {}) },
  };
}

const OUTCOME_CASES = Object.freeze([
  {
    family: "collaboration_planning", factKey: "groupPlanFacts", toolName: "campus_group_plan", variant: "collaboration",
    items: [{ planId: "plan-1", planName: "周三第7-8节", rank: 1, weekday: 3, periodStart: 7, periodEnd: 8 }],
  },
  {
    family: "reschedule_simulation", factKey: "rescheduleSimFacts", toolName: "campus_reschedule_feasibility", variant: "reschedule",
    items: [{ target: { week: 1, weekday: 3, weekdayName: "周三", periodStart: 5, periodEnd: 6, periodText: "第5-6节" }, checks: { teacherConflict: { conflict: false }, classConflict: { conflict: false }, roomConflict: { conflict: false }, capacity: { ok: true }, feature: { ok: true } } }],
  },
  {
    family: "teaching_assurance", factKey: "spaceFacts", toolName: "campus_classroom_search", variant: "risk", constraints: { needSpace: true },
    items: [{ roomId: "fixture-room", roomName: "A3-101", capacity: 80, campusName: "校区A", building: "A3" }],
  },
  {
    family: "campus_operations_insight", factKey: "rankingFacts", toolName: "campus_teacher_load_query", variant: "ranking",
    items: [{ rank: 1, entity: { id: "fixture-teacher", name: "教师001" }, metrics: { loadCount: 24 } }],
  },
]);

test("DE2E1. 相同候选与约束产生 byte-stable DecisionBundle / PublicDecisionReceipt", () => {
  const fixture = args({
    family: "collaboration_planning", factKey: "groupPlanFacts", toolName: "campus_group_plan",
    items: [{ planId: "later", planName: "较晚方案", rank: 1, weekday: 3, periodStart: 7 }, { planId: "earlier", planName: "较早方案", rank: 2, weekday: 3, periodStart: 3 }],
    preferences: { preferEarlier: true }, selection: { topN: 2 },
  });
  const first = decide(fixture);
  const second = decide(JSON.parse(JSON.stringify(fixture)));
  assert.strictEqual(JSON.stringify(first), JSON.stringify(second));
  assert.strictEqual(
    JSON.stringify(synthesizeOutcome(first).receipt),
    JSON.stringify(synthesizeOutcome(second).receipt),
  );
});

test("DE2E2. hard 约束放宽恰为 0；全部 hard fail 时无推荐与备选", () => {
  const result = decide(args({
    family: "teaching_assurance", factKey: "spaceFacts", toolName: "campus_classroom_search",
    constraints: { needSpace: true, minCapacity: 100 },
    items: [{ roomId: "small", roomName: "小教室", capacity: 20 }, { roomId: "medium", roomName: "中教室", capacity: 80 }],
  }));
  assert.strictEqual(result.evaluation.relaxedCount, 0);
  assert.strictEqual(result.evaluation.infeasible.length, 2);
  assert.strictEqual(result.decision, "no_viable_option");
  assert.strictEqual(result.recommendation, null);
  assert.deepStrictEqual(result.alternatives, []);
});

test("DE2E3. 无 evidence 则无 reason；无候选则无推荐和备选", () => {
  const unverifiedItem = {
    candidate: { id: "candidate-1", label: "候选一", attributes: { capacity: 80 }, evidence: { factKey: "spaceFacts", verified: false } },
    hardSatisfied: true, hardViolations: [], excluded: false, exclusionViolations: [], softContributions: [],
  };
  assert.deepStrictEqual(explainCandidate(unverifiedItem, { hard: [], soft: [], exclusions: [] }), []);

  const noSource = decide(args({
    family: "collaboration_planning", factKey: "groupPlanFacts", toolName: "campus_group_plan",
    items: [{ planId: "must-not-pass", planName: "不得采用" }], verified: false,
  }));
  assert.strictEqual(noSource.verified, false);
  assert.deepStrictEqual(noSource.reasons, { recommendation: [], alternatives: [] });
  assert.strictEqual(noSource.recommendation, null);
  assert.deepStrictEqual(noSource.alternatives, []);

  const verifiedEmpty = decide(args({
    family: "collaboration_planning", factKey: "groupPlanFacts", toolName: "campus_group_plan", items: [],
  }));
  assert.strictEqual(verifiedEmpty.verified, true);
  assert.strictEqual(verifiedEmpty.recommendation, null);
  assert.deepStrictEqual(verifiedEmpty.alternatives, []);
});

test("DE2E4. soft preference 产生可解释排序差异；soft 相等时保留 tool rank", () => {
  const structured = {
    family: "collaboration_planning", factKey: "groupPlanFacts", toolName: "campus_group_plan",
    items: [
      { planId: "later", planName: "较晚方案", rank: 1, weekday: 3, periodStart: 7 },
      { planId: "earlier", planName: "较早方案", rank: 2, weekday: 3, periodStart: 3 },
    ],
  };
  const byTool = decide(args(structured));
  assert.strictEqual(byTool.recommendation.candidate.id, "later");

  const byPreference = decide(args({ ...structured, preferences: { preferEarlier: true } }));
  assert.strictEqual(byPreference.recommendation.candidate.id, "earlier");
  assert.ok(byPreference.recommendation.reasons.some((reason) => reason.kind === "soft_preference"));
  assert.ok(byPreference.recommendation.reasons.every((reason) => reason.source.factKey === "groupPlanFacts"));
});

test("DE2E5. 完全 tie 的顺序稳定且不依赖输入排列", () => {
  const base = {
    family: "collaboration_planning", factKey: "groupPlanFacts", toolName: "campus_group_plan",
    items: [{ planId: "b", planName: "B方案" }, { planId: "a", planName: "A方案" }],
  };
  const forward = decide(args(base));
  const reversed = decide(args({ ...base, items: base.items.slice().reverse() }));
  assert.deepStrictEqual(forward.ranked.map((item) => item.candidate.id), ["a", "b"]);
  assert.deepStrictEqual(reversed.ranked.map((item) => item.candidate.id), ["a", "b"]);
  assert.strictEqual(forward.tieGroupCount, 1);
  assert.strictEqual(reversed.tieGroupCount, 1);
});

test("DE2E6. L3 仅确认；L0-L2 保持普通 sys.chat 动作", () => {
  const action = { type: "sys.chat", label: "继续当前方案", payload: { query: "继续当前方案" } };
  for (const authorityLevel of ["L0", "L1", "L2"]) {
    assert.deepStrictEqual(authorityAwareAction(action, { missionState: { authorityLevel } }), action, authorityLevel);
  }
  const l3 = authorityAwareAction(action, { missionState: { authorityLevel: "L3" } });
  assert.deepStrictEqual(l3, {
    type: "sys.chat", label: "确认后继续", payload: { query: "请先确认是否继续此项操作" }, requiresConfirm: true,
  });
});

test("DE2E6a. 实际 decide + synthesize：L2 正常续接，L3 reserve/submit 只保留公开确认语义", () => {
  const structured = OUTCOME_CASES[0];
  const l2Bundle = decide(args({ ...structured, authorityLevel: "L2" }));
  const l2Outcome = synthesizeOutcome(l2Bundle);
  assert.deepStrictEqual(l2Bundle.authority, { level: "L2", requiresConfirm: false });
  assert.strictEqual(Object.hasOwn(l2Bundle.nextAction, "requiresConfirm"), false);
  assert.strictEqual(l2Outcome.receipt.nextAction.label, l2Bundle.nextAction.label);
  assert.strictEqual(l2Outcome.viewModel.actions[0].label, l2Bundle.nextAction.label);

  for (const intent of ["reserve", "submit"]) {
    const bundle = decide(args({ ...structured, authorityLevel: "L3", intent }));
    const outcome = synthesizeOutcome(bundle);
    assert.deepStrictEqual(bundle.authority, { level: "L3", requiresConfirm: true }, intent);
    assert.strictEqual(bundle.nextAction.requiresConfirm, true, intent);
    assert.strictEqual(bundle.nextAction.label, "确认后继续", intent);
    assert.strictEqual(outcome.receipt.nextAction.label, "确认后继续", intent);
    assert.strictEqual(outcome.receipt.nextAction.query, "请先确认是否继续此项操作", intent);
    assert.strictEqual(outcome.viewModel.actions[0].label, "确认后继续", intent);
    assert.strictEqual(outcome.viewModel.actions[0].payload.query, "请先确认是否继续此项操作", intent);
    assert.strictEqual(validatePublicDecisionReceipt(outcome.receipt).ok, true, intent);
    const publicText = JSON.stringify({ receipt: outcome.receipt, viewModel: outcome.viewModel }).toLowerCase();
    assert.strictEqual(publicText.includes("requiresconfirm"), false, intent);
    assert.strictEqual(publicText.includes("authority"), false, intent);
  }
});

test("DE2E7. 简单课表 eligible:false；四个目标族（含 operations）均返回 DecisionBundle", () => {
  const schedule = decide(args({ family: "schedule_inquiry", items: [] }));
  assert.deepStrictEqual(schedule, { eligible: false });
  for (const fixture of OUTCOME_CASES) {
    const bundle = decide(args(fixture));
    assert.strictEqual(bundle.eligible, true, fixture.family);
    assert.strictEqual(bundle.bundleType, "DecisionBundle", fixture.family);
    assert.strictEqual(bundle.goalFamily, fixture.family, fixture.family);
  }
});

test("DE2E8. 四类 outcome 全部通过既有 Widget validator、receipt validator 与 leak gate", () => {
  const leakPattern = /queryid|datahash|dataversion|evidence|resultref|computedat|toolname|authority|requiresconfirm|internalurl|campus_[a-z0-9_]+|https?:\/\//i;
  for (const fixture of OUTCOME_CASES) {
    const bundle = decide(args(fixture));
    const outcome = synthesizeOutcome(bundle);
    assert.strictEqual(outcome.ok, true, `${fixture.family}: ${JSON.stringify(outcome.errors)}`);
    assert.strictEqual(outcome.viewModel.variant, fixture.variant, fixture.family);
    assert.strictEqual(validateWidgetPayload(outcome.viewModel).ok, true, fixture.family);
    assert.strictEqual(validatePublicDecisionReceipt(outcome.receipt).ok, true, fixture.family);
    assert.strictEqual(leakPattern.test(JSON.stringify(outcome.viewModel)), false, `${fixture.family}: widget leak`);
    assert.strictEqual(leakPattern.test(JSON.stringify(outcome.receipt)), false, `${fixture.family}: receipt leak`);
    const score = scoreDecisionBundle({ ...bundle, viewModel: outcome.viewModel, receipt: outcome.receipt });
    assert.strictEqual(score.verdict, "pass", `${fixture.family}: dual-track`);
  }
});

test("DE2E9. Decision 扩展未引入 Agent / Tool / binding drift", () => {
  assert.deepStrictEqual(Object.keys(bindings.agents), ["main", "schedule", "risk", "insight"]);
  assert.deepStrictEqual(bindings.agents.main, []);
  assert.deepStrictEqual(bindings.agents.schedule, [
    "campus_schedule_query", "campus_schedule_range_query", "campus_classroom_search",
    "campus_entity_search", "campus_academic_context", "campus_common_free_time_query", "campus_group_plan",
  ]);
  assert.deepStrictEqual(bindings.agents.risk, [
    "campus_risk_check", "campus_day_plan", "campus_academic_context", "campus_reschedule_feasibility",
  ]);
  assert.deepStrictEqual(bindings.agents.insight, [
    "campus_overview", "campus_teacher_load_query", "campus_room_utilization_query",
  ]);
  const allBindings = Object.values(bindings.agents).flat();
  assert.strictEqual(new Set(allBindings).size, 13);
  assert.strictEqual(allBindings.length, 14);
  const runtimeConfig = fs.readFileSync(path.join(ADP, "r50.1", "R50.1-ADP-RUNTIME-CONFIG.md"), "utf8");
  const mainRow = runtimeConfig.split(/\r?\n/).find((line) => line.startsWith("| 小序-主协调 |"));
  assert.ok(mainRow, "missing canonical Main runtime row");
  const mainAvailableTools = mainRow.split("|").slice(1, -1).map((cell) => cell.trim()).at(-1);
  assert.strictEqual(mainAvailableTools, "KnowledgeRetrievalAnswer + Agent transfer（不绑定 CampusTools）");
  assert.strictEqual(/campus_[a-z0-9_]+/.test(mainAvailableTools), false);
  assert.deepStrictEqual(ELIGIBLE_GOAL_FAMILIES, [
    "collaboration_planning", "reschedule_simulation", "teaching_assurance", "campus_operations_insight",
  ]);
});
