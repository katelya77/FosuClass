"use strict";

// Deterministic public-copy boundary. Internal evaluator text is never reused.
// Only a verified candidate, canonical reason source, and matching profile entry
// can produce user-visible copy.

function hasOwn(object, key) {
  return Boolean(object) && Object.prototype.hasOwnProperty.call(object, key);
}

function finiteNumber(value) {
  return typeof value === "number" && Number.isFinite(value);
}

function verifiedCandidate(item) {
  return Boolean(item
    && item.candidate
    && item.candidate.evidence
    && item.candidate.evidence.verified === true
    && typeof item.candidate.evidence.factKey === "string"
    && item.candidate.attributes
    && typeof item.candidate.attributes === "object"
    && !Array.isArray(item.candidate.attributes));
}

function findConstraint(profile, source) {
  if (!source || typeof source.constraintId !== "string" || typeof source.attribute !== "string") return null;
  for (const kind of ["hard", "soft", "exclusions"]) {
    const list = Array.isArray(profile && profile[kind]) ? profile[kind] : [];
    const constraint = list.find((entry) => entry
      && entry.id === source.constraintId
      && entry.field === source.attribute);
    if (constraint) return { kind, constraint };
  }
  return null;
}

function projectKnownReason(reason, item, profile) {
  if (!verifiedCandidate(item) || !reason || typeof reason !== "object" || Array.isArray(reason)) return null;
  const source = reason.source;
  const evidence = item.candidate.evidence;
  if (!source || source.factKey !== evidence.factKey) return null;
  const match = findConstraint(profile, source);
  if (!match) return null;
  const constraint = match.constraint;
  const attributes = item.candidate.attributes;
  if (!hasOwn(attributes, constraint.field)) return null;
  const actual = attributes[constraint.field];

  switch (constraint.id) {
    case "capacity-min":
      if (constraint.op !== "gte" || !finiteNumber(actual) || !finiteNumber(constraint.value) || actual < constraint.value) return null;
      return `容量 ${actual} 人，满足 ${constraint.value} 人需求`;
    case "campus-eq":
      return constraint.op === "eq" && actual === constraint.value ? `位于${actual}，符合校区要求` : null;
    case "building-eq":
      return constraint.op === "eq" && actual === constraint.value ? `位于${actual}，符合楼栋要求` : null;
    case "system-reschedule-feasible":
      return constraint.op === "eq" && constraint.value === true && actual === true ? "目标安排已通过可行性检查" : null;
    case "prefer-larger":
      return match.kind === "soft" && constraint.direction === "desc" && finiteNumber(actual) ? "容量更充裕" : null;
    case "prefer-same-campus":
      return match.kind === "soft" && constraint.direction === "prefer-value" && actual === constraint.value ? "与目标校区一致" : null;
    case "prefer-earlier":
      return match.kind === "soft" && constraint.direction === "asc" && finiteNumber(actual) ? "时间更早" : null;
    case "prefer-weekdays":
      return match.kind === "soft" && constraint.direction === "prefer-set" && Array.isArray(constraint.value) && constraint.value.includes(actual)
        ? "符合优先日期" : null;
    default:
      return null;
  }
}

function projectPublicReasons(item, profile = {}) {
  if (!verifiedCandidate(item)) return [];
  const reasons = Array.isArray(item.reasons) ? item.reasons : [];
  const out = [];
  for (const reason of reasons) {
    const text = projectKnownReason(reason, item, profile);
    if (text && !out.includes(text)) out.push(text);
  }
  return out;
}

function projectPublicChoice(item, profile = {}) {
  if (!item || !item.candidate || typeof item.candidate.label !== "string" || !item.candidate.label.trim()) return null;
  return {
    label: item.candidate.label.trim(),
    reasons: projectPublicReasons(item, profile),
  };
}

module.exports = {
  verifiedCandidate,
  findConstraint,
  projectKnownReason,
  projectPublicReasons,
  projectPublicChoice,
};

