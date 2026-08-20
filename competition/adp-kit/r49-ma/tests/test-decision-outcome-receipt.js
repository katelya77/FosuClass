"use strict";
// Campus Decision Intelligence T5 —— Outcome / Widget / PublicDecisionReceipt（2026-08-20）
const test = require("node:test");
const assert = require("node:assert");
const path = require("path");

const ROOT = path.join(__dirname, "..", "..", "..", "..");
const D = path.join(ROOT, "competition", "adp-kit", "r51", "decision");
const { decide } = require(path.join(D, "controller.js"));
const { synthesizeOutcome } = require(path.join(D, "outcome-synthesizer.js"));
const { createPublicDecisionReceipt, validatePublicDecisionReceipt } = require(path.join(D, "receipt.js"));
const { validateWidgetPayload } = require(path.join(ROOT, "competition", "adp-kit", "widget", "native", "campus-result-unified-v1", "payload-validator.js"));
const RECEIPT_SCHEMA = require(path.join(ROOT, "competition", "showcase", "contracts", "public-decision-receipt.schema.json"));

function fact(factKey, toolName) { return { factKey, toolName, resultRef: `ref-${factKey}`, verified: true }; }
function raw(items) { return { success: true, items, evidence: { verified: true, dataHash: "sha256:internal", computedAt: "2026-08-20T00:00:00Z" }, queryId: "q-internal" }; }
function build(family, factKey, toolName, items, extra = {}) {
  const constraints = family === "teaching_assurance" ? { needSpace: true } : {};
  return decide({
    missionState: { goal: { goalFamily: family, completionCriteria: [factKey] }, availableFacts: { [factKey]: fact(factKey, toolName) }, steps: [], authorityLevel: extra.authorityLevel || "L2" },
    toolResults: { [toolName]: raw(items) },
    goalSpec: { goalFamily: family, constraints, preferences: {}, selection: {} },
  });
}

const CASES = [
  ["collaboration_planning", "groupPlanFacts", "campus_group_plan", [{ planId: "p1", planName: "周三第7-8节", rank: 1 }], "collaboration"],
  ["reschedule_simulation", "rescheduleSimFacts", "campus_reschedule_feasibility", [{ target: { week: 1, weekday: 3, weekdayName: "周三", periodStart: 5, periodEnd: 6, periodText: "第5-6节" }, checks: { teacherConflict: { conflict: false }, classConflict: { conflict: false }, roomConflict: { conflict: false }, capacity: { ok: true }, feature: { ok: true } } }], "reschedule"],
  ["teaching_assurance", "spaceFacts", "campus_classroom_search", [{ roomId: "room-private", roomName: "A3-101", capacity: 80 }], "risk"],
  ["campus_operations_insight", "rankingFacts", "campus_teacher_load_query", [{ rank: 1, entity: { id: "t-private", name: "教师001" }, metrics: { loadCount: 24 } }], "ranking"],
];

test("DO1. 四类结果复用现有 result-card，variant / sections / action 均满足现有 payload validator", () => {
  for (const [family, factKey, toolName, items, variant] of CASES) {
    const result = synthesizeOutcome(build(family, factKey, toolName, items));
    assert.strictEqual(result.ok, true, `${family}: ${JSON.stringify(result.errors)}`);
    assert.strictEqual(result.viewModel.variant, variant);
    assert.strictEqual(result.viewModel.layoutMode, "result-card");
    assert.deepStrictEqual(result.viewModel.sections.map((s) => s.title), ["推荐", "理由", "备选"]);
    assert.strictEqual(result.viewModel.actions.length, 1);
    const action = result.viewModel.actions[0];
    assert.strictEqual(action.type, "sys.chat");
    assert.ok(action.id && typeof action.id === "string");
    assert.deepStrictEqual(Object.keys(action.payload), ["query"]);
    assert.strictEqual(validateWidgetPayload(result.viewModel).ok, true, JSON.stringify(validateWidgetPayload(result.viewModel).errors));
    assert(!JSON.stringify(result.viewModel).includes("q-internal"));
    assert(!JSON.stringify(result.viewModel).includes("sha256:internal"));
  }
});
test("DO2. no candidate 不生成推荐/备选；仍可投影已核验的 empty decision", () => {
  const bundle = build("collaboration_planning", "groupPlanFacts", "campus_group_plan", []);
  const result = synthesizeOutcome(bundle);
  assert.strictEqual(bundle.decision, "no_viable_option");
  assert.strictEqual(result.viewModel.sections[0].rows.length, 0);
  assert.strictEqual(result.viewModel.sections[2].rows.length, 0);
  assert.strictEqual(result.receipt.recommendation, null);
  assert.deepStrictEqual(result.receipt.alternatives, []);
  assert.strictEqual(validateWidgetPayload(result.viewModel).ok, true);
});

test("DO3. L3 confirmation 语义保留到 Widget，但 requiresConfirm / authority 不公开", () => {
  const bundle = build("collaboration_planning", "groupPlanFacts", "campus_group_plan", [{ planId: "p1", planName: "方案一" }], { authorityLevel: "L3" });
  const result = synthesizeOutcome(bundle);
  const action = result.viewModel.actions[0];
  assert(action.label.includes("确认"));
  assert(action.payload.query.includes("确认"));
  assert.strictEqual(Object.hasOwn(action, "requiresConfirm"), false);
  assert(!JSON.stringify(result.viewModel).toLowerCase().includes("authority"));
  assert.strictEqual(validateWidgetPayload(result.viewModel).ok, true);
});

test("DO4. Receipt frozen schema shape、稳定 content hash 与递归泄漏扫描", () => {
  const bundle = build("campus_operations_insight", "rankingFacts", "campus_teacher_load_query", [{ rank: 1, entity: { id: "t-secret", name: "教师001" }, metrics: { loadCount: 24 } }]);
  const a = createPublicDecisionReceipt(bundle);
  const b = createPublicDecisionReceipt(JSON.parse(JSON.stringify(bundle)));
  assert.deepStrictEqual(Object.keys(a), ["receiptVersion", "decisionId", "recommendation", "alternatives", "nextAction", "verified", "decision"]);
  assert.strictEqual(a.decisionId, b.decisionId);
  assert.match(a.decisionId, /^decision-[a-f0-9]{64}$/);
  assert.deepStrictEqual(Object.keys(a.recommendation), ["label", "reasons"]);
  assert.deepStrictEqual(Object.keys(a.nextAction), ["label", "query"]);
  assert.strictEqual(RECEIPT_SCHEMA.additionalProperties, false);
  assert.strictEqual(validatePublicDecisionReceipt(a).ok, true);
  const text = JSON.stringify(a).toLowerCase();
  for (const forbidden of ["t-secret", "campus_teacher_load_query", "queryid", "datahash", "dataversion", "evidence", "resultref", "computedat", "authority", "requiresconfirm", "internalurl", "http://", "https://"]) {
    assert(!text.includes(forbidden), `receipt 不得包含 ${forbidden}`);
  }
});

test("DO5. malicious/internal label、reason、action 不得泄漏到 receipt 或 Widget", () => {
  const malicious = {
    eligible: true,
    bundleType: "DecisionBundle",
    goalFamily: "collaboration_planning",
    recommendation: { candidate: { id: "entity-secret", label: "queryId=q-123 https://internal.example/api/x", evidence: { toolName: "campus_group_plan" } }, reasons: [{ text: "dataHash=sha256:secret" }] },
    alternatives: [{ candidate: { id: "t-secret", label: "安全备选" }, reasons: [{ text: "已核验公开理由" }] }],
    nextAction: { type: "sys.chat", label: "authority=L3", payload: { query: "Bearer secret-token" }, requiresConfirm: true },
    verified: true,
    decision: "recommend",
    tieGroupCount: 0,
  };
  const receipt = createPublicDecisionReceipt(malicious);
  const receiptText = JSON.stringify(receipt).toLowerCase();
  for (const forbidden of ["q-123", "internal.example", "datahash", "sha256:secret", "campus_group_plan", "entity-secret", "t-secret", "authority", "bearer", "requiresconfirm"]) {
    assert(!receiptText.includes(forbidden), forbidden);
  }
  const outcome = synthesizeOutcome(malicious);
  assert.strictEqual(outcome.ok, true);
  assert.strictEqual(validateWidgetPayload(outcome.viewModel).ok, true);
  const widgetText = JSON.stringify(outcome.viewModel).toLowerCase();
  assert(!widgetText.includes("q-123"));
  assert(!widgetText.includes("internal.example"));
  assert(!widgetText.includes("authority"));
});
