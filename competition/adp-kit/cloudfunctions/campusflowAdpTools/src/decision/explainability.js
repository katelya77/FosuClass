"use strict";
// Campus Decision Intelligence —— 可核验解释（2026-08-19）
// 理由只使用已核验 candidate.evidence、candidate.attributes 及 evaluator / constraint 记录。
// 候选未核验时必须返回空数组，绝不以 label 或猜测补充原因。
const { evalHard } = require("./evaluator.js");

function hasOwn(object, key) {
  return Boolean(object) && Object.prototype.hasOwnProperty.call(object, key);
}

function sameFactValue(left, right) {
  return left === right || (typeof left === "number" && typeof right === "number" && Number.isNaN(left) && Number.isNaN(right));
}

function displayFactValue(value) {
  if (typeof value === "string") return JSON.stringify(value);
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  return null;
}

function sourceFor(constraintId, attribute, factKey) {
  return { constraintId, attribute, factKey };
}

function isVerifiedCandidate(item) {
  return Boolean(item
    && item.candidate
    && item.candidate.evidence
    && item.candidate.evidence.verified === true
    && item.candidate.attributes
    && typeof item.candidate.attributes === "object"
    && !Array.isArray(item.candidate.attributes));
}

function hardReasons(item, profile, evidence) {
  const violations = Array.isArray(item.hardViolations) ? item.hardViolations : [];
  const hard = Array.isArray(profile && profile.hard) ? profile.hard : [];
  const attributes = item.candidate.attributes;
  const out = [];

  for (const constraint of hard) {
    if (!constraint || typeof constraint.id !== "string" || typeof constraint.field !== "string") continue;
    if (violations.some((violation) => violation && violation.id === constraint.id)) continue;
    if (!hasOwn(attributes, constraint.field)) continue;
    // 聚合 hardSatisfied 可能来自过期评估；理由必须按当前属性重跑同一条硬约束。
    if (!evalHard(item.candidate, constraint).ok) continue;
    const value = displayFactValue(attributes[constraint.field]);
    if (value === null) continue;
    out.push({
      kind: "hard_constraint",
      text: `已核验：${constraint.field} 为 ${value}，满足约束 ${constraint.id}。`,
      source: sourceFor(constraint.id, constraint.field, evidence.factKey),
    });
  }
  return out;
}

function softReasons(item, profile, evidence) {
  const soft = Array.isArray(profile && profile.soft) ? profile.soft : [];
  const contributions = Array.isArray(item.softContributions) ? item.softContributions : [];
  const attributes = item.candidate.attributes;
  const out = [];

  for (const contribution of contributions) {
    if (!contribution || typeof contribution.id !== "string" || typeof contribution.field !== "string") continue;
    if (typeof contribution.contribution !== "number" || !Number.isFinite(contribution.contribution) || contribution.contribution === 0) continue;
    const constraint = soft.find((entry) => entry && entry.id === contribution.id && entry.field === contribution.field);
    if (!constraint || !hasOwn(attributes, contribution.field)) continue;
    const actual = attributes[contribution.field];
    if (hasOwn(contribution, "value") && !sameFactValue(actual, contribution.value)) continue;
    const value = displayFactValue(actual);
    if (value === null) continue;
    out.push({
      kind: "soft_preference",
      text: `已核验：${contribution.field} 为 ${value}；偏好 ${constraint.id} 贡献 ${contribution.contribution} 分。`,
      source: sourceFor(constraint.id, contribution.field, evidence.factKey),
    });
  }
  return out;
}

function violationReasons(item, evidence) {
  const attributes = item.candidate.attributes;
  const records = [
    ...(Array.isArray(item.hardViolations) ? item.hardViolations : []).map((record) => ({ record, kind: "hard_violation", prefix: "不满足约束" })),
    ...(Array.isArray(item.exclusionViolations) ? item.exclusionViolations : []).map((record) => ({ record, kind: "exclusion", prefix: "命中排除条件" })),
  ];
  const out = [];
  for (const entry of records) {
    const record = entry.record;
    if (!record || typeof record.id !== "string" || typeof record.field !== "string") continue;
    if (!hasOwn(attributes, record.field) || !sameFactValue(attributes[record.field], record.actual)) continue;
    const value = displayFactValue(record.actual);
    if (value === null) continue;
    out.push({
      kind: entry.kind,
      text: `已核验：${record.field} 为 ${value}，${entry.prefix} ${record.id}。`,
      source: sourceFor(record.id, record.field, evidence.factKey),
    });
  }
  return out;
}

function explainCandidate(item, profile = {}) {
  if (!isVerifiedCandidate(item)) return [];
  const evidence = item.candidate.evidence;
  if (typeof evidence.factKey !== "string" || evidence.factKey.length === 0) return [];
  return [
    ...hardReasons(item, profile, evidence),
    ...softReasons(item, profile, evidence),
    ...violationReasons(item, evidence),
  ];
}

function explainCandidates(items, profile = {}) {
  return (Array.isArray(items) ? items : []).map((item) => ({ item, reasons: explainCandidate(item, profile) }));
}

module.exports = {
  isVerifiedCandidate,
  explainCandidate,
  explainCandidates,
};
