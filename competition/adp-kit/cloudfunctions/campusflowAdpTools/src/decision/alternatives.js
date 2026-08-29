"use strict";
// Campus Decision Intelligence —— 备选策略（2026-08-19）
// recommendation = feasible 排序首项；alternatives = 后续 topN 项。
// 无候选 → 无推荐、无备选，绝不虚构。

const DEFAULT_TOP_N = 3;

function tieKeyOf(item) {
  return `${item && item.softScore != null ? item.softScore : 0}|${item && item.candidate ? item.candidate.toolRank : null}`;
}

function selectDecision(ranked, opts = {}) {
  const topN = Number.isInteger(opts.topN) && opts.topN >= 1 ? opts.topN : DEFAULT_TOP_N;
  const list = Array.isArray(ranked) ? ranked : [];
  if (list.length === 0) {
    return { recommendation: null, alternatives: [], decision: "no_viable_option", tieGroupCount: 0 };
  }
  const recommendation = list[0];
  const alternatives = list.slice(1, topN);
  const recKey = tieKeyOf(recommendation);
  const tieGroupSize = list.filter((x) => tieKeyOf(x) === recKey).length;
  return {
    recommendation,
    alternatives,
    decision: "recommend",
    tieGroupCount: Math.max(0, tieGroupSize - 1),
  };
}

module.exports = { DEFAULT_TOP_N, tieKeyOf, selectDecision };