"use strict";
// Campus Decision Intelligence —— 确定性候选评估（2026-08-19）
// hard 违反 → infeasible（保留违反清单），绝不静默放宽；
// exclusions 命中 → excluded；soft 计分确定性（rank-based competition，可解释差异）。
const { validateProfile } = require("./constraint-profile.js");

function attrValue(candidate, field) {
  return candidate && candidate.attributes ? candidate.attributes[field] : undefined;
}

function sameValue(a, b) {
  if (a === b) return true;
  if (a === undefined || a === null || b === undefined || b === null) return false;
  if (typeof a === "number" && typeof b === "number") return a === b;
  return String(a) === String(b);
}

function compareValues(a, b) {
  if (typeof a === "number" && typeof b === "number") {
    if (a < b) return -1;
    if (a > b) return 1;
    return 0;
  }
  const sa = String(a);
  const sb = String(b);
  if (sa < sb) return -1;
  if (sa > sb) return 1;
  return 0;
}

function evalHard(candidate, entry) {
  const actual = attrValue(candidate, entry.field);
  const value = entry.value;
  const missing = actual === undefined || actual === null;
  let ok;
  switch (entry.op) {
    case "eq": ok = !missing && sameValue(actual, value); break;
    case "neq": ok = !missing && !sameValue(actual, value); break;
    case "gte": ok = !missing && compareValues(actual, value) >= 0; break;
    case "lte": ok = !missing && compareValues(actual, value) <= 0; break;
    case "in": ok = !missing && Array.isArray(value) && value.some((v) => sameValue(actual, v)); break;
    case "nin": ok = !missing && Array.isArray(value) && !value.some((v) => sameValue(actual, v)); break;
    default: ok = false;
  }
  return { ok, actual };
}

function evalExclusion(candidate, entry) {
  const actual = attrValue(candidate, entry.field);
  const value = entry.value;
  const missing = actual === undefined || actual === null;
  let hit;
  switch (entry.op) {
    case "eq": hit = !missing && sameValue(actual, value); break;
    case "in": hit = !missing && Array.isArray(value) && value.some((v) => sameValue(actual, v)); break;
    default: hit = false;
  }
  return { hit, actual };
}

// soft 计分：asc/desc 用 rank-based competition（优于几个候选）；prefer-value/set 用 0/1 命中。
function softScoreFor(candidates, softEntries) {
  const scores = candidates.map(() => ({ score: 0, contributions: [] }));
  for (const entry of softEntries) {
    const direction = entry.direction;
    if (direction === "prefer-value" || direction === "prefer-set") {
      for (let i = 0; i < candidates.length; i++) {
        const v = attrValue(candidates[i], entry.field);
        if (v === undefined || v === null) continue;
        const hit = direction === "prefer-value"
          ? sameValue(v, entry.value)
          : (Array.isArray(entry.value) && entry.value.some((x) => sameValue(v, x)));
        if (hit) {
          scores[i].score += entry.weight;
          scores[i].contributions.push({ id: entry.id, field: entry.field, value: v, contribution: entry.weight });
        }
      }
      continue;
    }
    // asc / desc
    const present = [];
    for (let i = 0; i < candidates.length; i++) {
      const v = attrValue(candidates[i], entry.field);
      if (v !== undefined && v !== null) present.push({ i, v });
    }
    for (const p of present) {
      let worse = 0;
      for (const q of present) {
        const c = compareValues(q.v, p.v);
        const qWorse = direction === "asc" ? c > 0 : c < 0;
        if (qWorse) worse += 1;
      }
      scores[p.i].score += entry.weight * worse;
      scores[p.i].contributions.push({ id: entry.id, field: entry.field, value: p.v, contribution: entry.weight * worse });
    }
  }
  return scores;
}

function evaluateCandidates(candidates, profile) {
  const v = validateProfile(profile);
  if (!v.ok) throw new Error(`invalid profile: ${v.errors.join("; ")}`);
  const list = Array.isArray(candidates) ? candidates : [];

  const items = list.map((candidate) => {
    const hardViolations = [];
    let hardSatisfied = true;
    for (const entry of profile.hard) {
      const r = evalHard(candidate, entry);
      if (!r.ok) {
        hardSatisfied = false;
        hardViolations.push({ id: entry.id, field: entry.field, op: entry.op, value: entry.value, actual: r.actual });
      }
    }
    const exclusionViolations = [];
    let excluded = false;
    for (const entry of profile.exclusions) {
      const r = evalExclusion(candidate, entry);
      if (r.hit) {
        excluded = true;
        exclusionViolations.push({ id: entry.id, field: entry.field, op: entry.op, value: entry.value, actual: r.actual });
      }
    }
    return {
      candidate,
      hardSatisfied,
      hardViolations,
      excluded,
      exclusionViolations,
      feasible: hardSatisfied && !excluded,
      softScore: 0,
      softContributions: [],
    };
  });

  const scores = softScoreFor(list, profile.soft);
  for (let i = 0; i < items.length; i++) {
    items[i].softScore = scores[i].score;
    items[i].softContributions = scores[i].contributions;
  }

  return {
    items,
    feasible: items.filter((x) => x.feasible),
    infeasible: items.filter((x) => !x.feasible),
    totalCount: items.length,
    // hard 约束 0 次静默放宽：本实现从不移除/放行任何 hard 约束。
    relaxedCount: 0,
  };
}

module.exports = {
  attrValue,
  sameValue,
  compareValues,
  evalHard,
  evalExclusion,
  softScoreFor,
  evaluateCandidates,
};
