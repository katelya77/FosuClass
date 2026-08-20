"use strict";
// Campus Decision Intelligence —— 稳定排序（2026-08-19）
// 排序键：softScore desc → toolRank asc（null 最后）→ label 码元序 → id 码元序 → 原始输入序。
// 无额外证据（softScore 全相等）时 toolRank 保持工具已有排名；tie 稳定。

function numKey(v) {
  return typeof v === "number" && Number.isFinite(v) ? v : Infinity;
}

function strCmp(a, b) {
  const sa = String(a == null ? "" : a);
  const sb = String(b == null ? "" : b);
  if (sa < sb) return -1;
  if (sa > sb) return 1;
  return 0;
}

function rankFeasible(evaluatedItems) {
  const list = Array.isArray(evaluatedItems) ? evaluatedItems : [];
  const feasible = list.filter((x) => x && x.feasible);
  return feasible.slice().sort((a, b) => {
    const scoreA = Number.isFinite(a.softScore) ? a.softScore : 0;
    const scoreB = Number.isFinite(b.softScore) ? b.softScore : 0;
    const byScore = scoreB - scoreA;
    if (byScore !== 0) return byScore;
    const rankA = numKey(a.candidate.toolRank);
    const rankB = numKey(b.candidate.toolRank);
    if (rankA !== rankB) return rankA - rankB;
    const byLabel = strCmp(a.candidate.label, b.candidate.label);
    if (byLabel !== 0) return byLabel;
    const byId = strCmp(a.candidate.id, b.candidate.id);
    if (byId !== 0) return byId;
    const indexA = Number.isFinite(a.candidate.sourceIndex) ? a.candidate.sourceIndex : 0;
    const indexB = Number.isFinite(b.candidate.sourceIndex) ? b.candidate.sourceIndex : 0;
    return indexA - indexB;
  });
}

module.exports = { numKey, strCmp, rankFeasible };
