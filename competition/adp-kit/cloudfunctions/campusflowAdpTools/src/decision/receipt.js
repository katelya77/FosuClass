"use strict";
// Campus Decision Intelligence —— 脱敏公开 PublicDecisionReceipt（2026-08-20）
const crypto = require("crypto");
const { containsCredentialLeak } = require("./credential-leak.js");
const { projectPublicChoice } = require("./public-copy.js");

const RECEIPT_VERSION = "1.0";
const EXACT_KEYS = Object.freeze([
  "receiptVersion", "decisionId", "recommendation", "alternatives", "nextAction", "verified", "decision",
]);
const DECISIONS = new Set(["recommend", "no_viable_option"]);

const FORBIDDEN_VALUE_PATTERNS = Object.freeze([
  /\b(?:queryid|datahash|dataversion|evidence|resultref|computedat|sourcetool|toolname|authority|requiresconfirm|internalurl)\b/i,
  /\bcampus_[a-z0-9_]+\b/i,
  /https?:\/\//i,
  /\b(?:internal|file|app):\/\//i,
  /\b(?:localhost|127\.0\.0\.1|\[::1\])(?::\d+)?\b/i,
  /\bbearer\s+[a-z0-9._~+/=-]+/i,
  /\bsk-[a-z0-9._-]+/i,
  /\bq-[a-z0-9_-]+\b/i,
  /\bsha(?:256)?\s*[:=]/i,
  /\b(?:entity|teacher|class|course|room|grp|group|t|r)-[a-z0-9_-]+\b/i,
  /\d{4}-\d{2}-\d{2}t\d{2}:\d{2}:\d{2}/i,
  /[{}]/,
]);

function safePublicText(value) {
  if (typeof value !== "string") return null;
  const text = value.trim();
  if (!text || containsCredentialLeak(text) || FORBIDDEN_VALUE_PATTERNS.some((pattern) => pattern.test(text))) return null;
  return text;
}

function publicChoice(item, profile) {
  const projected = projectPublicChoice(item, profile);
  const label = safePublicText(projected && projected.label);
  const reasons = projected && Array.isArray(projected.reasons)
    ? projected.reasons.map(safePublicText).filter(Boolean)
    : [];
  return label ? { label, reasons } : null;
}

function publicNextAction(action) {
  const label = safePublicText(action && action.label);
  const query = safePublicText(action && action.payload && action.payload.query);
  return label && query ? { label, query } : null;
}

function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === "object") {
    const out = {};
    for (const key of Object.keys(value).sort()) out[key] = canonicalize(value[key]);
    return out;
  }
  return value;
}

function stableStringify(value) {
  return JSON.stringify(canonicalize(value));
}

function decisionIdFor(content) {
  return `decision-${crypto.createHash("sha256").update(stableStringify(content), "utf8").digest("hex")}`;
}

function createPublicDecisionReceipt(bundle) {
  const verified = bundle && bundle.verified === true;
  const profile = bundle && bundle.profile;
  const safeRecommendation = publicChoice(bundle && bundle.recommendation, profile);
  const safeAlternatives = (Array.isArray(bundle && bundle.alternatives) ? bundle.alternatives : [])
    .slice(0, 5)
    .map((item) => publicChoice(item, profile))
    .filter(Boolean);
  const nextAction = publicNextAction(bundle && bundle.nextAction);
  const decision = bundle && bundle.decision === "recommend" && verified && safeRecommendation
    ? "recommend"
    : "no_viable_option";
  const recommendation = decision === "recommend" ? safeRecommendation : null;
  const alternatives = decision === "recommend" ? safeAlternatives : [];
  const content = {
    receiptVersion: RECEIPT_VERSION,
    recommendation,
    alternatives,
    nextAction,
    verified,
    decision,
  };
  return {
    receiptVersion: content.receiptVersion,
    decisionId: decisionIdFor(content),
    recommendation: content.recommendation,
    alternatives: content.alternatives,
    nextAction: content.nextAction,
    verified: content.verified,
    decision: content.decision,
  };
}

function keysExactly(object, expected) {
  return object && typeof object === "object" && !Array.isArray(object)
    && Object.keys(object).length === expected.length
    && expected.every((key) => Object.hasOwn(object, key));
}

function validateChoice(choice, nullable) {
  if (choice === null) return nullable;
  return keysExactly(choice, ["label", "reasons"])
    && safePublicText(choice.label) === choice.label
    && Array.isArray(choice.reasons)
    && choice.reasons.every((reason) => safePublicText(reason) === reason);
}

function validatePublicDecisionReceipt(receipt) {
  const errors = [];
  if (!keysExactly(receipt, EXACT_KEYS)) errors.push("receipt 字段必须与冻结契约完全一致");
  if (!receipt || receipt.receiptVersion !== RECEIPT_VERSION) errors.push("receiptVersion 必须为 1.0");
  if (!receipt || typeof receipt.decisionId !== "string" || !/^decision-[a-f0-9]{64}$/.test(receipt.decisionId)) errors.push("decisionId 必须是稳定内容哈希");
  if (!validateChoice(receipt && receipt.recommendation, true)) errors.push("recommendation 非法");
  if (!receipt || !Array.isArray(receipt.alternatives) || !receipt.alternatives.every((choice) => validateChoice(choice, false))) errors.push("alternatives 非法");
  const action = receipt && receipt.nextAction;
  if (action !== null && !(keysExactly(action, ["label", "query"]) && safePublicText(action.label) === action.label && safePublicText(action.query) === action.query)) errors.push("nextAction 非法");
  if (!receipt || typeof receipt.verified !== "boolean") errors.push("verified 必须是布尔值");
  if (!receipt || !DECISIONS.has(receipt.decision)) errors.push("decision 非法");
  if (receipt && receipt.decision === "recommend" && (receipt.verified !== true || receipt.recommendation === null)) {
    errors.push("recommend 必须已核验且含安全 recommendation");
  }
  if (receipt && receipt.decision === "no_viable_option" && (receipt.recommendation !== null || !Array.isArray(receipt.alternatives) || receipt.alternatives.length !== 0)) {
    errors.push("no_viable_option 必须清空 recommendation / alternatives");
  }
  if (errors.length === 0) {
    const { decisionId, ...content } = receipt;
    if (decisionIdFor(content) !== decisionId) errors.push("decisionId 与公开内容不一致");
  }
  return { ok: errors.length === 0, errors };
}

module.exports = {
  RECEIPT_VERSION,
  EXACT_KEYS,
  DECISIONS,
  FORBIDDEN_VALUE_PATTERNS,
  safePublicText,
  stableStringify,
  decisionIdFor,
  createPublicDecisionReceipt,
  validatePublicDecisionReceipt,
};
