"use strict";
// Campus Decision Intelligence T5 —— Outcome / Widget / PublicDecisionReceipt（2026-08-20）
const test = require("node:test");
const assert = require("node:assert");
const path = require("path");

const ROOT = path.join(__dirname, "..", "..", "..", "..");
const D = path.join(ROOT, "competition", "adp-kit", "r51", "decision");
const { decide } = require(path.join(D, "controller.js"));
const { synthesizeOutcome } = require(path.join(D, "outcome-synthesizer.js"));
const { createPublicDecisionReceipt, validatePublicDecisionReceipt, decisionIdFor } = require(path.join(D, "receipt.js"));
const { containsCredentialLeak } = require(path.join(D, "credential-leak.js"));
const { validateWidgetPayload } = require(path.join(ROOT, "competition", "adp-kit", "widget", "native", "campus-result-unified-v1", "payload-validator.js"));
const RECEIPT_SCHEMA = require(path.join(ROOT, "competition", "showcase", "contracts", "public-decision-receipt.schema.json"));

function schemaContractErrors(receipt) {
  const errors = [];
  if (!receipt || typeof receipt !== "object" || Array.isArray(receipt)) return ["top:type"];
  const topKeys = Object.keys(RECEIPT_SCHEMA.properties);
  for (const required of RECEIPT_SCHEMA.required) {
    if (!Object.hasOwn(receipt, required)) errors.push(`missing:${required}`);
  }
  if (RECEIPT_SCHEMA.additionalProperties === false) {
    for (const key of Object.keys(receipt)) if (!topKeys.includes(key)) errors.push(`extra:${key}`);
  }
  if (receipt.receiptVersion !== RECEIPT_SCHEMA.properties.receiptVersion.const) errors.push("receiptVersion");
  if (!(new RegExp(RECEIPT_SCHEMA.properties.decisionId.pattern)).test(receipt.decisionId || "")) errors.push("decisionId");
  if (!RECEIPT_SCHEMA.properties.decision.enum.includes(receipt.decision)) errors.push("decision");
  if (typeof receipt.verified !== "boolean") errors.push("verified");

  const choiceDef = RECEIPT_SCHEMA.$defs.choice;
  const checkChoice = (choice, trail) => {
    if (!choice || typeof choice !== "object" || Array.isArray(choice)) return errors.push(`${trail}:type`);
    for (const required of choiceDef.required) if (!Object.hasOwn(choice, required)) errors.push(`${trail}:missing:${required}`);
    if (choiceDef.additionalProperties === false) {
      for (const key of Object.keys(choice)) if (!Object.hasOwn(choiceDef.properties, key)) errors.push(`${trail}:extra:${key}`);
    }
    if (typeof choice.label !== "string" || choice.label.length < choiceDef.properties.label.minLength) errors.push(`${trail}:label`);
    if (!Array.isArray(choice.reasons) || choice.reasons.some((reason) => typeof reason !== "string" || reason.length < choiceDef.properties.reasons.items.minLength)) errors.push(`${trail}:reasons`);
  };
  if (receipt.recommendation !== null) checkChoice(receipt.recommendation, "recommendation");
  if (!Array.isArray(receipt.alternatives)) errors.push("alternatives:type");
  else receipt.alternatives.forEach((choice, index) => checkChoice(choice, `alternatives[${index}]`));
  if (receipt.decision === "recommend" && (receipt.verified !== true || receipt.recommendation === null)) errors.push("recommend:invariant");
  if (receipt.decision === "no_viable_option" && (receipt.recommendation !== null || !Array.isArray(receipt.alternatives) || receipt.alternatives.length !== 0)) errors.push("no_viable_option:invariant");
  const actionDef = RECEIPT_SCHEMA.$defs.nextAction;
  if (receipt.nextAction !== null) {
    const action = receipt.nextAction;
    if (!action || typeof action !== "object" || Array.isArray(action)) errors.push("nextAction:type");
    else {
      for (const required of actionDef.required) if (!Object.hasOwn(action, required)) errors.push(`nextAction:missing:${required}`);
      if (actionDef.additionalProperties === false) for (const key of Object.keys(action)) if (!Object.hasOwn(actionDef.properties, key)) errors.push(`nextAction:extra:${key}`);
      for (const key of ["label", "query"]) if (typeof action[key] !== "string" || action[key].length < actionDef.properties[key].minLength) errors.push(`nextAction:${key}`);
    }
  }
  return errors;
}

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
    assert.deepStrictEqual(result.viewModel.sections.map((s) => s.kind), ["recommendation", "notice", "entity-list"]);
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
test("DO2. verified-but-empty source 保持 family result-card，三个语义 sections 均为空", () => {
  const bundle = build("collaboration_planning", "groupPlanFacts", "campus_group_plan", []);
  const result = synthesizeOutcome(bundle);
  assert.strictEqual(bundle.decision, "no_viable_option");
  assert.strictEqual(bundle.verified, true);
  assert.strictEqual(result.viewModel.variant, "collaboration");
  assert.strictEqual(result.viewModel.layoutMode, "result-card");
  assert.deepStrictEqual(result.viewModel.sections.map((section) => section.title), ["推荐", "理由", "备选"]);
  assert.deepStrictEqual(result.viewModel.sections.map((section) => section.rows), [[], [], []]);
  assert.strictEqual(result.receipt.recommendation, null);
  assert.deepStrictEqual(result.receipt.alternatives, []);
  assert.strictEqual(validateWidgetPayload(result.viewModel).ok, true);
});

test("DO2a. no/unverified source 走 recoverable error fallback，绝不伪装 family success", () => {
  const family = "collaboration_planning";
  const bundle = decide({
    missionState: { goal: { goalFamily: family, completionCriteria: ["groupPlanFacts"] }, availableFacts: { groupPlanFacts: { ...fact("groupPlanFacts", "campus_group_plan"), verified: false } }, steps: [], authorityLevel: "L2" },
    toolResults: { campus_group_plan: raw([{ planId: "p1", planName: "不得采用" }]) },
    goalSpec: { goalFamily: family, constraints: {}, preferences: {}, selection: {} },
  });
  const result = synthesizeOutcome(bundle);
  assert.strictEqual(bundle.verified, false);
  assert.strictEqual(bundle.recommendation, null);
  assert.strictEqual(result.viewModel.variant, "error");
  assert.strictEqual(result.viewModel.verified, false);
  assert.deepStrictEqual(result.viewModel.sections, []);
  assert.strictEqual(result.receipt.decision, "no_viable_option");
  assert.strictEqual(result.receipt.recommendation, null);
  assert.deepStrictEqual(result.receipt.alternatives, []);
  assert.strictEqual(validateWidgetPayload(result.viewModel).ok, true);
});

test("DO2b. reschedule intrinsic check 失败经 synthesis 保留 verified infeasible，不得投影推荐", () => {
  const family = "reschedule_simulation";
  const factKey = "rescheduleSimFacts";
  const toolName = "campus_reschedule_feasibility";
  const bundle = build(family, factKey, toolName, [{
    target: { week: 1, weekday: 3, weekdayName: "周三", periodStart: 5, periodEnd: 6, periodText: "第5-6节" },
    checks: {
      teacherConflict: { conflict: false },
      classConflict: { conflict: false },
      roomConflict: { conflict: false },
      capacity: { ok: false },
      feature: { ok: true },
    },
  }]);
  const result = synthesizeOutcome(bundle);
  assert.strictEqual(bundle.verified, true);
  assert.strictEqual(bundle.evaluation.infeasible.length, 1);
  assert.strictEqual(bundle.recommendation, null);
  assert.strictEqual(result.receipt.decision, "no_viable_option");
  assert.strictEqual(result.receipt.recommendation, null);
  assert.strictEqual(result.viewModel.variant, "reschedule");
  assert.strictEqual(result.viewModel.summary, "暂无可行候选。");
  assert.deepStrictEqual(result.viewModel.sections.map((section) => section.rows), [[], [], []]);
});

test("DO2c. success:false / malformed items 不得成为 verified-empty，必须投影 recoverable error", () => {
  const family = "collaboration_planning";
  const factKey = "groupPlanFacts";
  const toolName = "campus_group_plan";
  for (const envelope of [
    { success: false, items: [], evidence: { verified: true } },
    { success: true, evidence: { verified: true } },
    { success: true, items: {}, evidence: { verified: true } },
  ]) {
    const bundle = decide({
      missionState: { goal: { goalFamily: family, completionCriteria: [factKey] }, availableFacts: { [factKey]: fact(factKey, toolName) }, steps: [], authorityLevel: "L2" },
      toolResults: { [toolName]: envelope },
      goalSpec: { goalFamily: family, constraints: {}, preferences: {}, selection: {} },
    });
    const result = synthesizeOutcome(bundle);
    assert.strictEqual(bundle.verified, false, JSON.stringify(envelope));
    assert.strictEqual(result.viewModel.variant, "error", JSON.stringify(envelope));
    assert.strictEqual(result.viewModel.displayMeta.recoverable, true, JSON.stringify(envelope));
  }
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
  assert.strictEqual(RECEIPT_SCHEMA.allOf.length, 2);
  assert.deepStrictEqual(schemaContractErrors(a), []);
  assert.strictEqual(validatePublicDecisionReceipt(a).ok, true);
  const text = JSON.stringify(a).toLowerCase();
  for (const forbidden of ["t-secret", "campus_teacher_load_query", "queryid", "datahash", "dataversion", "evidence", "resultref", "computedat", "authority", "requiresconfirm", "internalurl", "http://", "https://"]) {
    assert(!text.includes(forbidden), `receipt 不得包含 ${forbidden}`);
  }
});

test("DO4a. Receipt recommend 必须 verified + safe recommendation；no_viable 强制清空选择", () => {
  const safeRecommendation = { candidate: { label: "安全推荐" }, reasons: [{ text: "已核验公开理由" }] };
  const safeAlternative = { candidate: { label: "安全备选" }, reasons: [{ text: "公开备选理由" }] };
  const unverified = createPublicDecisionReceipt({ verified: false, decision: "recommend", recommendation: safeRecommendation, alternatives: [safeAlternative] });
  assert.strictEqual(unverified.decision, "no_viable_option");
  assert.strictEqual(unverified.recommendation, null);
  assert.deepStrictEqual(unverified.alternatives, []);
  assert.deepStrictEqual(schemaContractErrors(unverified), []);
  assert.strictEqual(validatePublicDecisionReceipt(unverified).ok, true);

  const filteredRecommendation = createPublicDecisionReceipt({
    verified: true,
    decision: "recommend",
    recommendation: { candidate: { label: "queryId=q-secret" }, reasons: [] },
    alternatives: [safeAlternative],
  });
  assert.strictEqual(filteredRecommendation.decision, "no_viable_option");
  assert.strictEqual(filteredRecommendation.recommendation, null);
  assert.deepStrictEqual(filteredRecommendation.alternatives, [], "不得把安全 alternative 留在矛盾 no_viable receipt");
  assert.deepStrictEqual(schemaContractErrors(filteredRecommendation), []);
  assert.strictEqual(validatePublicDecisionReceipt(filteredRecommendation).ok, true);
  const alreadyNoViable = createPublicDecisionReceipt({
    verified: true,
    decision: "no_viable_option",
    recommendation: safeRecommendation,
    alternatives: [safeAlternative],
  });
  assert.strictEqual(filteredRecommendation.decisionId, alreadyNoViable.decisionId, "decisionId 必须基于相同的规范化公开内容");
});

test("DO4b. Validator 拒绝 schema 形状错误及跨字段矛盾 receipt", () => {
  const base = createPublicDecisionReceipt(build("campus_operations_insight", "rankingFacts", "campus_teacher_load_query", [{ rank: 1, entity: { id: "t-private", name: "教师001" }, metrics: { loadCount: 24 } }]));
  const invalidSchemaCases = [
    null,
    { ...base, extra: true },
    (() => { const value = { ...base }; delete value.nextAction; return value; })(),
    { ...base, decisionId: "not-a-content-hash" },
    { ...base, decision: "unknown" },
    { ...base, recommendation: { ...base.recommendation, internal: true } },
    { ...base, recommendation: { label: "" } },
    { ...base, nextAction: { ...base.nextAction, authority: "L3" } },
    { ...base, nextAction: { label: "", query: "继续" } },
  ];
  for (const invalid of invalidSchemaCases) {
    assert(schemaContractErrors(invalid).length > 0, JSON.stringify(invalid));
    assert.strictEqual(validatePublicDecisionReceipt(invalid).ok, false, JSON.stringify(invalid));
  }

  const contradictory = [
    { ...base, verified: false },
    { ...base, decision: "no_viable_option" },
    { ...base, decision: "no_viable_option", recommendation: null },
  ];
  for (const invalid of contradictory) {
    assert.strictEqual(validatePublicDecisionReceipt(invalid).ok, false, "跨字段矛盾必须拒绝");
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

test("DO6. receipt 生成与校验共享覆盖 Cookie/Basic/Bearer/password/session/API-key/token 泄漏类", () => {
  const leaks = [
    "Cookie: sid=abc123",
    "cookie=sessionid=abc123",
    "Authorization: Basic dXNlcjpwYXNz",
    "Authorization=Bearer secret-token",
    "password=hunter2",
    "session: abc123",
    "x-fosu-session=abc123",
    "api_key=abc123",
    "api-key: abc123",
    "access_token=abc123",
    "token: abc123",
  ];
  for (const leak of leaks) {
    const receipt = createPublicDecisionReceipt({
      verified: true,
      decision: "recommend",
      recommendation: { candidate: { label: "安全推荐" }, reasons: [{ text: leak }] },
      alternatives: [{ candidate: { label: leak }, reasons: [] }],
      nextAction: { type: "sys.chat", label: "继续", payload: { query: leak } },
    });
    assert.strictEqual(JSON.stringify(receipt).includes(leak), false, leak);
    assert.strictEqual(validatePublicDecisionReceipt(receipt).ok, true, leak);

    const malicious = {
      receiptVersion: "1.0",
      recommendation: { label: "安全推荐", reasons: [leak] },
      alternatives: [],
      nextAction: null,
      verified: true,
      decision: "recommend",
    };
    malicious.decisionId = decisionIdFor(malicious);
    const ordered = {
      receiptVersion: malicious.receiptVersion,
      decisionId: malicious.decisionId,
      recommendation: malicious.recommendation,
      alternatives: malicious.alternatives,
      nextAction: malicious.nextAction,
      verified: malicious.verified,
      decision: malicious.decision,
    };
    assert.strictEqual(validatePublicDecisionReceipt(ordered).ok, false, `validator: ${leak}`);
  }

  const credentialObject = (keyParts) => Object.fromEntries([[keyParts.join(""), "unit-credential"]]);
  for (const objectLeak of [
    credentialObject(["pass", "word"]),
    credentialObject(["session", "_id"]),
    credentialObject(["api", "_key"]),
    credentialObject(["access", "Token"]),
  ]) {
    assert.strictEqual(containsCredentialLeak(objectLeak), true, `object matcher: ${JSON.stringify(objectLeak)}`);
  }
});
