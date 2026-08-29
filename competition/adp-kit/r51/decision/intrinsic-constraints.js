"use strict";

// Intrinsic constraints are runtime invariants, not user preferences.  This is
// the single builder used by both production Controller and evaluation Judge.
// It consumes only trusted structured context and never restores constraints
// from a caller-supplied DecisionBundle profile.
const crypto = require("crypto");

const INTRINSIC_IDS = Object.freeze(new Set([
  "system-reschedule-feasible",
]));

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

function buildAuthoritativeIntrinsicConstraints(context = {}) {
  if (context.goalFamily !== "reschedule_simulation") return [];
  return [{
    id: "system-reschedule-feasible",
    kind: "hard",
    source: "system",
    field: "feasible",
    op: "eq",
    value: true,
    provenanceRefs: ["rescheduleSimFacts"],
  }];
}

function canonicalIntrinsicConstraints(constraints) {
  return (Array.isArray(constraints) ? constraints : [])
    .map((entry) => ({
      id: entry && entry.id,
      kind: entry && entry.kind,
      source: entry && entry.source,
      field: entry && entry.field,
      op: entry && entry.op,
      value: entry && entry.value,
      provenanceRefs: Array.isArray(entry && entry.provenanceRefs) ? entry.provenanceRefs.slice().sort() : [],
    }))
    .sort((left, right) => String(left.id).localeCompare(String(right.id), "en"));
}

function intrinsicConstraintFingerprint(constraints) {
  const canonical = canonicalIntrinsicConstraints(constraints);
  const digest = crypto.createHash("sha256").update(stableStringify(canonical), "utf8").digest("hex");
  return `sha256:${digest}`;
}

function isSystemClaim(entry) {
  return Boolean(entry && (entry.source === "system" || INTRINSIC_IDS.has(entry.id)));
}

function profileWithAuthoritativeIntrinsicConstraints(userProfile, context = {}) {
  const profile = userProfile && typeof userProfile === "object" ? userProfile : {};
  const errors = [];
  for (const kind of ["hard", "soft", "exclusions"]) {
    for (const entry of Array.isArray(profile[kind]) ? profile[kind] : []) {
      if (isSystemClaim(entry)) errors.push(`user profile 不能声明 intrinsic constraint：${entry && entry.id}`);
    }
  }
  const intrinsic = buildAuthoritativeIntrinsicConstraints(context);
  return {
    profile: {
      hard: [...(Array.isArray(profile.hard) ? profile.hard : []), ...intrinsic],
      soft: Array.isArray(profile.soft) ? profile.soft.slice() : [],
      exclusions: Array.isArray(profile.exclusions) ? profile.exclusions.slice() : [],
    },
    intrinsic,
    fingerprint: intrinsicConstraintFingerprint(intrinsic),
    errors,
  };
}

function verifyAuthoritativeIntrinsicProfile(profile, context = {}, claimedFingerprint) {
  const expected = buildAuthoritativeIntrinsicConstraints(context);
  const expectedFingerprint = intrinsicConstraintFingerprint(expected);
  const errors = [];
  const all = [];
  for (const kind of ["hard", "soft", "exclusions"]) {
    for (const entry of Array.isArray(profile && profile[kind]) ? profile[kind] : []) all.push({ kind, entry });
  }
  const claims = all.filter(({ entry }) => isSystemClaim(entry));
  if (claims.length !== expected.length) errors.push("intrinsic constraint count mismatch");
  const expectedById = new Map(expected.map((entry) => [entry.id, entry]));
  const seen = new Set();
  for (const claim of claims) {
    const id = claim.entry && claim.entry.id;
    if (seen.has(id)) errors.push(`duplicate intrinsic constraint：${id}`);
    seen.add(id);
    const canonical = expectedById.get(id);
    if (!canonical || claim.kind !== "hard" || stableStringify(claim.entry) !== stableStringify(canonical)) {
      errors.push(`intrinsic constraint semantics mismatch：${id}`);
    }
  }
  for (const entry of expected) {
    if (!seen.has(entry.id)) errors.push(`missing intrinsic constraint：${entry.id}`);
  }
  if (claimedFingerprint !== expectedFingerprint) errors.push("intrinsic constraint fingerprint mismatch");
  return { ok: errors.length === 0, errors, expected, expectedFingerprint };
}

module.exports = {
  INTRINSIC_IDS,
  buildAuthoritativeIntrinsicConstraints,
  canonicalIntrinsicConstraints,
  intrinsicConstraintFingerprint,
  profileWithAuthoritativeIntrinsicConstraints,
  verifyAuthoritativeIntrinsicProfile,
};
