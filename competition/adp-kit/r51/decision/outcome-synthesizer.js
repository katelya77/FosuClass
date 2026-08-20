"use strict";
// Campus Decision Intelligence —— DecisionBundle 的现有 result-card 投影（2026-08-20）
const path = require("path");
const { projectViewModel } = require(path.join(__dirname, "..", "..", "r50.2", "widget", "view-model.js"));
const { normalizeEnvelope } = require(path.join(__dirname, "..", "..", "r50.2", "widget", "envelope.js"));
const { createPublicDecisionReceipt } = require("./receipt.js");

const VARIANT_BY_GOAL_FAMILY = Object.freeze({
  collaboration_planning: "collaboration",
  reschedule_simulation: "reschedule",
  teaching_assurance: "risk",
  campus_operations_insight: "ranking",
});
const CARD_TITLE = "小序-校园智序结果卡";

function choiceRows(choice, prefix) {
  return choice ? [{ label: prefix, value: choice.label }] : [];
}

function reasonRows(choice) {
  return choice && Array.isArray(choice.reasons)
    ? choice.reasons.map((text, index) => ({ label: `理由${index + 1}`, value: text }))
    : [];
}

function alternativeRows(alternatives) {
  return (Array.isArray(alternatives) ? alternatives : []).map((choice, index) => ({
    label: `备选${index + 1}`,
    value: choice.label,
    ...(choice.reasons.length ? { hint: choice.reasons.join("；") } : {}),
  }));
}

function widgetAction(action) {
  if (!action) return [];
  return [{
    id: "decision-next-action",
    type: "sys.chat",
    label: action.label,
    payload: { query: action.query },
  }];
}

function buildDecisionEnvelope(bundle, receipt = createPublicDecisionReceipt(bundle)) {
  const variant = VARIANT_BY_GOAL_FAMILY[bundle && bundle.goalFamily];
  if (!variant) return { ok: false, errors: ["非 eligible goalFamily 无决策 Widget 变体"], envelope: null };

  if (receipt.verified !== true) {
    return normalizeEnvelope({
      variant: "error",
      status: "error",
      title: CARD_TITLE,
      verified: false,
      summary: "缺少已核验事实，暂不能生成决策结果。",
      sections: [],
      actions: widgetAction(receipt.nextAction),
      displayMeta: { recoverable: true },
    });
  }

  const displayMeta = {};
  if (variant === "reschedule") displayMeta.simulated = true;
  if (variant === "ranking" && Number.isInteger(bundle.tieGroupCount) && bundle.tieGroupCount >= 0) {
    displayMeta.tieGroupCount = bundle.tieGroupCount;
  }
  const envelope = {
    variant,
    status: "success",
    title: CARD_TITLE,
    subtitle: "",
    verified: true,
    summary: receipt.recommendation ? `推荐：${receipt.recommendation.label}` : "暂无可行候选。",
    context: "",
    sections: [
      { title: "推荐", rows: choiceRows(receipt.recommendation, "推荐方案") },
      { title: "理由", rows: reasonRows(receipt.recommendation) },
      { title: "备选", rows: alternativeRows(receipt.alternatives) },
    ],
    actions: widgetAction(receipt.nextAction),
    displayMeta,
  };
  return normalizeEnvelope(envelope);
}

function synthesizeOutcome(bundle) {
  const receipt = createPublicDecisionReceipt(bundle || {});
  const built = buildDecisionEnvelope(bundle, receipt);
  if (!built.ok) return { ok: false, errors: built.errors, envelope: null, viewModel: null, receipt };
  // 决策变体均强制走现有 result-card；raw/toolName 不参与决策投影。
  const projected = projectViewModel(null, null, built.envelope);
  return {
    ok: projected.ok,
    errors: projected.errors,
    envelope: built.envelope,
    viewModel: projected.viewModel,
    receipt,
  };
}

module.exports = {
  VARIANT_BY_GOAL_FAMILY,
  CARD_TITLE,
  buildDecisionEnvelope,
  synthesizeOutcome,
  synthesizeDecisionOutcome: synthesizeOutcome,
};
