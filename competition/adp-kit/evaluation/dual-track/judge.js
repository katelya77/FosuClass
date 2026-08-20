"use strict";
// CSF P6 评测双轨制（2026-08-19）
// Track A = 业务结果（任务完成、事实正确、恢复、安全、可核验）
// Track B = 表达呈现（结构化、可读、可渲染、后续动作、零内部泄漏）
// 规则：Widget 不可渲染 ≠ 业务失败 —— B 轨失败绝不清零 A 轨业务分；
// 安全违规与事实矛盾属于硬门禁，直接清零 A 轨。
const { stableStringify, validatePublicDecisionReceipt } = require("../../r51/decision/receipt.js");
const { validateProfile } = require("../../r51/decision/constraint-profile.js");
const { evaluateCandidates } = require("../../r51/decision/evaluator.js");
const { rankFeasible } = require("../../r51/decision/ranking.js");
const { explainCandidate } = require("../../r51/decision/explainability.js");
const { confirmationOnlyAction } = require("../../r51/decision/authority-action.js");
const { containsCredentialLeak } = require("../../r51/decision/credential-leak.js");
const { verifyAuthoritativeIntrinsicProfile } = require("../../r51/decision/intrinsic-constraints.js");

const GOAL_FAMILIES_BY_FACT = Object.freeze({
  groupPlanFacts: ["collaboration_planning"],
  availabilityFacts: ["collaboration_planning"],
  spaceFacts: ["collaboration_planning", "teaching_assurance"],
  riskFacts: ["teaching_assurance"],
  rankingFacts: ["campus_operations_insight"],
  spaceUtilFacts: ["campus_operations_insight"],
  rescheduleSimFacts: ["reschedule_simulation"],
});

const TRACK_A_ITEMS = Object.freeze([
  "intent_complete",
  "facts_verified",
  "no_contradiction",
  "recovery_on_failure",
  "safety",
]);

const TRACK_B_ITEMS = Object.freeze([
  "structured_output",
  "readable_text",
  "widget_renderable",
  "follow_up",
  "no_internal_leak",
]);

const HARD_GATES = Object.freeze(["safety", "no_contradiction"]);

const DECISION_TRACK_A_ITEMS = Object.freeze([
  "eligibility_shape",
  "verified_recommendation_reasons",
  "hard_constraints_preserved",
  "no_invented_alternatives",
  "stable_public_projection",
  "no_contradiction",
  "recovery_on_failure",
  "safety",
]);

const DECISION_GOAL_FAMILIES = Object.freeze([
  "collaboration_planning",
  "reschedule_simulation",
  "teaching_assurance",
  "campus_operations_insight",
]);

const DECISION_STATES = Object.freeze(["recommend", "no_viable_option"]);

const DECISION_VARIANTS = Object.freeze({
  collaboration_planning: "collaboration",
  reschedule_simulation: "reschedule",
  teaching_assurance: "risk",
  campus_operations_insight: "ranking",
});

const PUBLIC_LEAK_PATTERN = /(queryid|datahash|dataversion|sourcetool|toolname|rankcontext|evidence|resultref|computedat|authority|requiresconfirm|internalurl|system prompt|推理过程|authorization\s*:|bearer\s+|\btoken\b|cookie|password|https?:\/\/)/i;

function safeJsonParse(serialized) {
  if (typeof serialized !== "string") return { ok: false };
  const trimmed = serialized.trim();
  if (!trimmed.startsWith("{") && !trimmed.startsWith("[")) return { ok: false };
  try {
    return { ok: true, value: JSON.parse(trimmed) };
  } catch {
    const start = trimmed.indexOf("{");
    const end = trimmed.lastIndexOf("}");
    if (start >= 0 && end > start) {
      try {
        return { ok: true, value: JSON.parse(trimmed.slice(start, end + 1)) };
      } catch {
        return { ok: false };
      }
    }
    return { ok: false };
  }
}

function checkWidgetContract(payload) {
  if (!payload || typeof payload !== "object") return { ok: false, reasons: ["payload 非对象"] };
  const reasons = [];
  if (payload.version != null && payload.version !== "1.0") reasons.push("version 非 1.0");
  if (payload.actions) {
    if (!Array.isArray(payload.actions)) reasons.push("actions 非数组");
    else {
      for (const a of payload.actions) {
        if (!a || a.type !== "sys.chat") reasons.push("存在非 sys.chat 动作");
        if (a.payload && (typeof a.payload !== "object" || Object.keys(a.payload).some((k) => k !== "query"))) {
          reasons.push("动作 payload 仅允许 { query }");
        }
      }
    }
  }
  if (payload.displayMeta && payload.displayMeta.tieGroupCount != null) {
    if (!Number.isInteger(payload.displayMeta.tieGroupCount) || payload.displayMeta.tieGroupCount < 0) {
      reasons.push("tieGroupCount 必须 ≥0 整数");
    }
  }
  const leakKeys = ["queryid", "datahash", "sourcetool", "rankcontext", "token"];
  if (payload) {
    for (const k of Object.keys(payload)) {
      if (leakKeys.includes(String(k).toLowerCase())) reasons.push(`内部字段泄漏: ${k}`);
    }
  }
  return { ok: reasons.length === 0, reasons };
}

function scoreTrackA(payload, expected) {
  const items = {};
  const factsVerified =
    payload &&
    (payload.verified === true || /已核验|verified/i.test(String(payload.summary || "")));
  const contradiction =
    payload && expected && expected.mustMatch &&
    !String(payload.summary || "").includes(expected.mustMatch) &&
    !(JSON.stringify(payload) || "").includes(expected.mustMatch);
  const safetyOk =
    !(JSON.stringify(payload) || "").match(/(密码|口令|token|cookie|session)/i) &&
    !(JSON.stringify(payload) || "").match(/x-fosu-session|authorization\s*:/i);
  items.intent_complete = Boolean(payload && payload.title && payload.summary);
  items.facts_verified = Boolean(factsVerified);
  items.no_contradiction = !contradiction;
  items.recovery_on_failure =
    !payload ||
    payload.status === "recoverable_error" ||
    (payload.sections && Array.isArray(payload.sections) && payload.sections.length > 0) ||
    (payload.status === "verified_empty");
  items.safety = Boolean(safetyOk);
  let score = 0;
  for (const k of TRACK_A_ITEMS) if (items[k]) score += 1;
  const gateFailed = HARD_GATES.some((k) => !items[k]);
  return { items, score, pass: !gateFailed };
}

function scoreTrackB(serialized, payload, parsed) {
  const items = {};
  const hasText = typeof serialized === "string" && serialized.trim().length > 10;
  const plainFallback = hasText && !/^\s*[{[]/.test(serialized);
  const readable = parsed.ok || plainFallback;
  const structured = parsed.ok && payload && (payload.title || payload.summary || payload.sections);
  const contract = checkWidgetContract(payload);
  items.structured_output = Boolean(structured);
  items.readable_text = Boolean(readable && (structured || plainFallback));
  items.widget_renderable = contract.ok;
  items.follow_up =
    Boolean(payload && payload.actions && Array.isArray(payload.actions) && payload.actions.length > 0) ||
    Boolean(payload && payload.nextSteps && Array.isArray(payload.nextSteps) && payload.nextSteps.length > 0) ||
    /下一步|可查看/.test(typeof serialized === "string" ? serialized : "");
  const serializedText = typeof serialized === "string" ? serialized : JSON.stringify(serialized || {});
  items.no_internal_leak = !/queryid|datahash|sourcetool|rankcontext|system prompt|推理过程/i.test(serializedText);
  let score = 0;
  for (const k of TRACK_B_ITEMS) if (items[k]) score += 1;
  return { items, score, pass: score >= 4, contractReasons: contract.reasons };
}

function scoreResponse(serialized, expected) {
  const parsed = safeJsonParse(serialized);
  const payload = parsed.ok ? parsed.value : null;
  const trackA = scoreTrackA(payload, expected);
  const trackB = scoreTrackB(serialized, payload, parsed);
  const renderOnlyFail = !trackB.items.widget_renderable && trackA.items.intent_complete && trackA.items.no_contradiction;
  return {
    trackA,
    trackB,
    renderOnlyFail,
    // Widget 不可渲染绝不代表业务失败：B 轨 renderable 失败时业务分保持原值
    businessScore: trackA.pass ? trackA.score : 0,
    verdict: trackA.pass && trackB.pass ? "pass" : trackA.pass ? "pass_with_presentation_issues" : "fail",
  };
}

function isObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function publicReasonTexts(choice) {
  return (Array.isArray(choice && choice.reasons) ? choice.reasons : [])
    .map((reason) => typeof reason === "string" ? reason : reason && reason.text)
    .filter((reason) => typeof reason === "string" && reason.length > 0);
}

function publicChoiceOf(choice) {
  const label = choice && choice.candidate && choice.candidate.label;
  return typeof label === "string" && label.length > 0
    ? { label, reasons: publicReasonTexts(choice) }
    : null;
}

function publicActionOf(action) {
  if (!actionShapeIsExact(action)) return null;
  const label = action && action.label;
  const query = action && action.payload && action.payload.query;
  return typeof label === "string" && label.length > 0 && typeof query === "string" && query.length > 0
    ? { label, query }
    : null;
}

function sameJson(left, right) {
  return stableStringify(left) === stableStringify(right);
}

function exactKeys(object, keys) {
  return isObject(object)
    && Object.keys(object).length === keys.length
    && keys.every((key) => Object.hasOwn(object, key));
}

function actionShapeIsExact(action) {
  if (!isObject(action) || action.type !== "sys.chat") return false;
  const keys = action.requiresConfirm === true
    ? ["type", "label", "payload", "requiresConfirm"]
    : ["type", "label", "payload"];
  return exactKeys(action, keys)
    && typeof action.label === "string"
    && action.label.length > 0
    && exactKeys(action.payload, ["query"])
    && typeof action.payload.query === "string"
    && action.payload.query.length > 0;
}

function authorityActionIsValid(bundle) {
  const action = bundle && bundle.nextAction;
  const authority = bundle && bundle.authority;
  if (action === null) return authority == null;
  if (!actionShapeIsExact(action)) return false;
  if (authority == null) return false;
  if (!exactKeys(authority, ["level", "requiresConfirm"])) return false;
  if (!["L0", "L1", "L2", "L3"].includes(authority.level)) return false;
  if (authority.level === "L3") {
    return authority.requiresConfirm === true && sameJson(action, confirmationOnlyAction());
  }
  return authority.requiresConfirm === false && action.requiresConfirm !== true;
}

function candidateIdOf(item) {
  return item && item.candidate && item.candidate.id;
}

function authoritativeContextFromVerifiedFacts(bundle, candidates) {
  const sourceFactKey = bundle && bundle.sourceFactKey;
  if (sourceFactKey == null) {
    return candidates.length === 0 ? { ok: true, goalFamily: bundle && bundle.goalFamily } : { ok: false, goalFamily: null };
  }
  const allowedFamilies = GOAL_FAMILIES_BY_FACT[sourceFactKey];
  if (!allowedFamilies || !allowedFamilies.includes(bundle && bundle.goalFamily)) return { ok: false, goalFamily: null };
  const provenanceMatches = candidates.every((candidate) => candidate
    && candidate.evidence
    && candidate.evidence.verified === true
    && candidate.evidence.factKey === sourceFactKey);
  if (!provenanceMatches) return { ok: false, goalFamily: null };
  // rescheduleSimFacts is itself the trusted intrinsic trigger.  The profile
  // and its claimed fingerprint never decide whether feasibility is required.
  const goalFamily = sourceFactKey === "rescheduleSimFacts" ? "reschedule_simulation" : bundle.goalFamily;
  return { ok: true, goalFamily };
}

function canonicalDecisionOracle(bundle) {
  const profile = bundle && bundle.profile;
  const candidates = Array.isArray(bundle && bundle.candidates) ? bundle.candidates : null;
  const context = candidates ? authoritativeContextFromVerifiedFacts(bundle, candidates) : { ok: false, goalFamily: null };
  const intrinsic = verifyAuthoritativeIntrinsicProfile(
    profile,
    { goalFamily: context.goalFamily },
    bundle && bundle.intrinsicConstraintFingerprint,
  );
  if (!candidates || !context.ok || !validateProfile(profile).ok || !intrinsic.ok) {
    return { ok: false, profile: null, evaluation: null, ranked: [], byId: new Map(), intrinsic };
  }
  const ids = candidates.map((candidate) => candidate && candidate.id);
  if (ids.some((id) => typeof id !== "string" || id.length === 0) || new Set(ids).size !== ids.length) {
    return { ok: false, profile, evaluation: null, ranked: [], byId: new Map() };
  }
  try {
    const evaluation = evaluateCandidates(candidates, profile);
    const ranked = rankFeasible(evaluation.items);
    return {
      ok: true,
      profile,
      evaluation,
      ranked,
      byId: new Map(evaluation.items.map((item) => [item.candidate.id, item])),
      intrinsic,
    };
  } catch {
    return { ok: false, profile, evaluation: null, ranked: [], byId: new Map() };
  }
}

function hardRecordMatches(claim, canonical) {
  return isObject(claim)
    && canonical
    && candidateIdOf(claim) === canonical.candidate.id
    && claim.hardSatisfied === canonical.hardSatisfied
    && sameJson(Array.isArray(claim.hardViolations) ? claim.hardViolations : [], canonical.hardViolations)
    && claim.excluded === canonical.excluded
    && sameJson(Array.isArray(claim.exclusionViolations) ? claim.exclusionViolations : [], canonical.exclusionViolations)
    && claim.feasible === canonical.feasible;
}

function evaluationMatchesOracle(bundle, oracle) {
  const supplied = bundle && bundle.evaluation;
  if (!oracle.ok || !isObject(supplied) || supplied.relaxedCount !== 0 || !Array.isArray(supplied.items)) return false;
  if (supplied.items.length !== oracle.evaluation.items.length) return false;
  const seen = new Set();
  for (const claim of supplied.items) {
    const id = candidateIdOf(claim);
    const canonical = oracle.byId.get(id);
    if (seen.has(id) || !hardRecordMatches(claim, canonical)) return false;
    seen.add(id);
  }
  for (const key of ["feasible", "infeasible"]) {
    if (supplied[key] !== undefined) {
      if (!Array.isArray(supplied[key])) return false;
      const actualIds = supplied[key].map(candidateIdOf);
      const expectedIds = oracle.evaluation[key].map(candidateIdOf);
      if (!sameJson(actualIds, expectedIds)) return false;
    }
  }
  return true;
}

function canonicalReasonsFor(choice, oracle) {
  const id = candidateIdOf(choice);
  const canonical = oracle.byId.get(id);
  return canonical ? explainCandidate(canonical, oracle.profile) : null;
}

function choiceReasonsMatchOracle(choice, oracle) {
  if (!choice) return true;
  const expected = canonicalReasonsFor(choice, oracle);
  return Array.isArray(expected)
    && Array.isArray(choice.reasons)
    && sameJson(choice.reasons, expected);
}

function selectedCandidatesMatchOracle(bundle, oracle) {
  if (!oracle.ok) return false;
  const recommendation = bundle && bundle.recommendation;
  const alternatives = Array.isArray(bundle && bundle.alternatives) ? bundle.alternatives : [];
  if (bundle.decision === "no_viable_option") {
    return oracle.ranked.length === 0 && recommendation === null && alternatives.length === 0;
  }
  if (bundle.decision !== "recommend" || !recommendation || oracle.ranked.length === 0) return false;
  const selected = [recommendation, ...alternatives];
  const expected = oracle.ranked.slice(0, selected.length);
  return expected.length === selected.length
    && selected.every((choice, index) => {
      const canonical = expected[index];
      return canonical
        && sameJson(choice.candidate, canonical.candidate)
        && canonical.feasible === true;
    });
}

function reasonEvidenceIsValid(choice) {
  if (!choice) return true;
  const candidate = choice.candidate;
  const evidence = candidate && candidate.evidence;
  const reasons = Array.isArray(choice.reasons) ? choice.reasons : null;
  if (!reasons) return false;
  if (!evidence || evidence.verified !== true) return reasons.length === 0;
  return reasons.every((reason) => isObject(reason)
    && typeof reason.text === "string"
    && reason.text.length > 0
    && isObject(reason.source)
    && typeof reason.source.factKey === "string"
    && reason.source.factKey === evidence.factKey);
}

function selectedHardStateIsValid(choice) {
  if (!choice) return true;
  return choice.hardSatisfied !== false
    && choice.excluded !== true
    && (!Array.isArray(choice.hardViolations) || choice.hardViolations.length === 0)
    && (!Array.isArray(choice.exclusionViolations) || choice.exclusionViolations.length === 0);
}

function decisionShapeIsValid(bundle) {
  return isObject(bundle)
    && bundle.eligible === true
    && bundle.bundleType === "DecisionBundle"
    && DECISION_GOAL_FAMILIES.includes(bundle.goalFamily)
    && DECISION_STATES.includes(bundle.decision)
    && Array.isArray(bundle.candidates)
    && isObject(bundle.evaluation)
    && Array.isArray(bundle.evaluation.items)
    && Array.isArray(bundle.alternatives);
}

function verifiedRecommendationReasonsAreValid(bundle, oracle = canonicalDecisionOracle(bundle)) {
  const recommendation = bundle && bundle.recommendation;
  const alternatives = Array.isArray(bundle && bundle.alternatives) ? bundle.alternatives : [];
  if (bundle && bundle.decision === "recommend") {
    if (bundle.verified !== true || !recommendation) return false;
  } else if (recommendation !== null || alternatives.length !== 0) {
    return false;
  }
  const selected = [recommendation, ...alternatives].filter(Boolean);
  return oracle.ok
    && selectedCandidatesMatchOracle(bundle, oracle)
    && selected.every((choice) => choice.candidate
    && choice.candidate.evidence
    && choice.candidate.evidence.verified === true)
    && choiceReasonsMatchOracle(recommendation, oracle)
    && alternatives.every((choice) => choiceReasonsMatchOracle(choice, oracle));
}

function hardConstraintsArePreserved(bundle, oracle = canonicalDecisionOracle(bundle)) {
  const evaluation = bundle && bundle.evaluation;
  if (!evaluation || evaluation.relaxedCount !== 0 || !evaluationMatchesOracle(bundle, oracle)) return false;
  const selected = [bundle.recommendation, ...(Array.isArray(bundle.alternatives) ? bundle.alternatives : [])];
  if (!selected.every(selectedHardStateIsValid)) return false;
  return evaluation.items.every((item) => !item || item.feasible !== true || selectedHardStateIsValid(item));
}

function choicesComeFromCandidates(bundle, oracle = canonicalDecisionOracle(bundle)) {
  const candidates = Array.isArray(bundle && bundle.candidates) ? bundle.candidates : [];
  const canonicalById = new Map(candidates
    .filter((candidate) => candidate && typeof candidate.id === "string" && candidate.id.length > 0)
    .map((candidate) => [candidate.id, candidate]));
  const selected = [bundle && bundle.recommendation, ...(Array.isArray(bundle && bundle.alternatives) ? bundle.alternatives : [])]
    .filter(Boolean);
  const selectedIds = selected.map((choice) => choice && choice.candidate && choice.candidate.id);
  if (bundle && bundle.decision === "no_viable_option") {
    return bundle.recommendation === null && selected.length === 0;
  }
  return selectedIds.length > 0
    && selectedCandidatesMatchOracle(bundle, oracle)
    && selected.every((choice) => {
      const candidate = choice && choice.candidate;
      const canonical = candidate && canonicalById.get(candidate.id);
      return Boolean(canonical
        && candidate.evidence
        && candidate.evidence.verified === true
        && sameJson(candidate, canonical));
    })
    && new Set(selectedIds).size === selectedIds.length;
}

function receiptSemanticsMatchBundle(bundle) {
  const receipt = bundle && bundle.receipt;
  if (!isObject(receipt)
    || receipt.receiptVersion !== "1.0"
    || receipt.verified !== (bundle.verified === true)
    || receipt.decision !== bundle.decision
    || !Array.isArray(receipt.alternatives)) return false;
  const recommendation = publicChoiceOf(bundle.recommendation);
  const alternatives = (Array.isArray(bundle.alternatives) ? bundle.alternatives : []).map(publicChoiceOf);
  return sameJson(receipt.recommendation, recommendation)
    && sameJson(receipt.alternatives, alternatives)
    && sameJson(receipt.nextAction, publicActionOf(bundle.nextAction));
}

function receiptMatchesBundle(bundle) {
  return receiptSemanticsMatchBundle(bundle)
    && validatePublicDecisionReceipt(bundle.receipt).ok === true;
}

function sectionRows(viewModel, title) {
  const matching = (Array.isArray(viewModel && viewModel.sections) ? viewModel.sections : [])
    .filter((section) => section && section.title === title);
  if (matching.length > 1) return null;
  if (matching.length === 0) return { present: false, rows: [] };
  return Array.isArray(matching[0].rows) ? { present: true, rows: matching[0].rows } : null;
}

function widgetActionMatches(viewModel, action) {
  const actions = Array.isArray(viewModel && viewModel.actions) ? viewModel.actions : [];
  const expected = publicActionOf(action);
  if (!expected) return actions.length === 0;
  if (actions.length !== 1) return false;
  const actual = actions[0];
  return actual
    && actual.type === "sys.chat"
    && actual.label === expected.label
    && actual.payload
    && sameJson(actual.payload, { query: expected.query });
}

function viewModelMatchesBundle(bundle) {
  const viewModel = bundle && bundle.viewModel;
  const receipt = bundle && bundle.receipt;
  if (!isObject(viewModel) || !isObject(receipt) || viewModel.verified !== (bundle.verified === true)) return false;
  const expectedVariant = bundle.verified === true ? DECISION_VARIANTS[bundle.goalFamily] : "error";
  if (viewModel.variant !== expectedVariant || !widgetActionMatches(viewModel, bundle.nextAction)) return false;
  const recommendationRows = sectionRows(viewModel, "推荐");
  const reasonRows = sectionRows(viewModel, "理由");
  const alternativeRows = sectionRows(viewModel, "备选");
  if (recommendationRows === null || reasonRows === null || alternativeRows === null) return false;
  if (bundle.verified === true && (!recommendationRows.present || !reasonRows.present || !alternativeRows.present)) return false;
  const receiptReasons = receipt.recommendation && Array.isArray(receipt.recommendation.reasons)
    ? receipt.recommendation.reasons
    : [];
  const expectedReasonRows = receiptReasons.map((reason, index) => ({ label: `理由${index + 1}`, value: reason }));
  const expectedAlternativeRows = (Array.isArray(receipt.alternatives) ? receipt.alternatives : []).map((choice, index) => ({
    label: `备选${index + 1}`,
    value: choice.label,
    ...(Array.isArray(choice.reasons) && choice.reasons.length ? { hint: choice.reasons.join("；") } : {}),
  }));
  if (!sameJson(reasonRows.rows, expectedReasonRows) || !sameJson(alternativeRows.rows, expectedAlternativeRows)) {
    return false;
  }
  if (bundle.decision === "recommend") {
    const label = bundle.recommendation && bundle.recommendation.candidate && bundle.recommendation.candidate.label;
    return typeof label === "string"
      && viewModel.summary === `推荐：${label}`
      && sameJson(recommendationRows.rows, [{ label: "推荐方案", value: label }]);
  }
  const expectedSummary = bundle.verified === true
    ? "暂无可行候选。"
    : "缺少已核验事实，暂不能生成决策结果。";
  return viewModel.summary === expectedSummary
    && recommendationRows.rows.length === 0
    && reasonRows.rows.length === 0
    && alternativeRows.rows.length === 0;
}

function decisionIsNonContradictory(bundle) {
  if (!decisionShapeIsValid(bundle)) return false;
  const oracle = canonicalDecisionOracle(bundle);
  const recommendation = bundle.recommendation;
  const alternatives = Array.isArray(bundle.alternatives) ? bundle.alternatives : [];
  const stateConsistent = bundle.decision === "recommend"
    ? bundle.verified === true && Boolean(recommendation)
    : recommendation === null && alternatives.length === 0;
  return stateConsistent
    && selectedCandidatesMatchOracle(bundle, oracle)
    && [recommendation, ...alternatives].filter(Boolean).every((choice) => choiceReasonsMatchOracle(choice, oracle))
    && authorityActionIsValid(bundle)
    && receiptSemanticsMatchBundle(bundle)
    && viewModelMatchesBundle(bundle);
}

function recoveryIsControlled(bundle) {
  if (!bundle) return false;
  if (bundle.decision === "recommend") return true;
  if (bundle.recommendation !== null || !Array.isArray(bundle.alternatives) || bundle.alternatives.length !== 0) return false;
  if (bundle.verified === true) return true;
  const viewModel = bundle.viewModel;
  return Boolean(viewModel
    && (viewModel.status === "error" || viewModel.status === "recoverable_error")
    && viewModel.displayMeta
    && viewModel.displayMeta.recoverable === true);
}

function decisionSafetyIsValid(bundle) {
  return !containsCredentialLeak(bundle || {});
}

function publicProjectionHasNoInternalLeak(bundle) {
  const projection = {
    receipt: bundle && bundle.receipt,
    viewModel: bundle && bundle.viewModel,
  };
  return !containsCredentialLeak(projection) && !PUBLIC_LEAK_PATTERN.test(JSON.stringify(projection));
}

function scoreDecisionTrackA(bundle) {
  const oracle = canonicalDecisionOracle(bundle);
  const items = {
    eligibility_shape: decisionShapeIsValid(bundle),
    verified_recommendation_reasons: verifiedRecommendationReasonsAreValid(bundle, oracle),
    hard_constraints_preserved: hardConstraintsArePreserved(bundle, oracle),
    no_invented_alternatives: choicesComeFromCandidates(bundle, oracle),
    stable_public_projection: receiptMatchesBundle(bundle) && viewModelMatchesBundle(bundle),
    no_contradiction: decisionIsNonContradictory(bundle),
    recovery_on_failure: recoveryIsControlled(bundle),
    safety: decisionSafetyIsValid(bundle),
  };
  const score = DECISION_TRACK_A_ITEMS.reduce((total, key) => total + (items[key] ? 1 : 0), 0);
  const gateFailed = HARD_GATES.some((key) => !items[key]);
  return { items, score, pass: !gateFailed && DECISION_TRACK_A_ITEMS.every((key) => items[key]) };
}

function scoreDecisionTrackB(bundle) {
  const viewModel = bundle && bundle.viewModel;
  const serialized = JSON.stringify(viewModel || {});
  const base = scoreTrackB(serialized, viewModel, { ok: isObject(viewModel), value: viewModel });
  const items = { ...base.items, no_internal_leak: publicProjectionHasNoInternalLeak(bundle) };
  const score = TRACK_B_ITEMS.reduce((total, key) => total + (items[key] ? 1 : 0), 0);
  return { ...base, items, score, pass: TRACK_B_ITEMS.every((key) => items[key]) };
}

// DecisionBundle 双轨评分只读取调用方提供的结构化 bundle / receipt / viewModel；
// 不调用 Provider、CampusTools、网络或运行时 Controller，也不修改输入。
function scoreDecisionBundle(bundle) {
  const trackA = scoreDecisionTrackA(bundle);
  const trackB = scoreDecisionTrackB(bundle);
  const gateFailed = HARD_GATES.some((key) => !trackA.items[key]);
  const renderOnlyFail = trackA.pass
    && !trackB.items.widget_renderable
    && TRACK_B_ITEMS.filter((key) => key !== "widget_renderable").every((key) => trackB.items[key]);
  return {
    trackA,
    trackB,
    renderOnlyFail,
    businessScore: gateFailed ? 0 : trackA.score,
    verdict: !trackA.pass ? "fail" : trackB.pass ? "pass" : "pass_with_presentation_issues",
  };
}

module.exports = {
  TRACK_A_ITEMS,
  TRACK_B_ITEMS,
  HARD_GATES,
  DECISION_TRACK_A_ITEMS,
  DECISION_GOAL_FAMILIES,
  safeJsonParse,
  checkWidgetContract,
  scoreResponse,
  scoreDecisionBundle,
};
