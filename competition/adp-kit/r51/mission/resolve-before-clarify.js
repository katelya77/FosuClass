"use strict";
// R51 Resolve-before-Clarify —— 缺失/歧义输入优先由现有 capability 确定性缩小。
// 仅当：多实质候选 / 无结果 / required value 不在任何可解析上下文 / 用户主观选择 时才向用户澄清。
function decideClarification({ requirement, candidates, resolvable = true, requiresChoice = false }) {
  if (requiresChoice) return { decision: "clarify", reason: "subjective" };
  if (!resolvable) return { decision: "clarify", reason: "not_resolvable" };
  const list = Array.isArray(candidates) ? candidates : [];
  if (list.length === 1) return { decision: "resolve", entityRef: list[0], reason: "resolved" };
  if (list.length > 1) return { decision: "clarify", reason: "multiple_candidates", candidates: list };
  return { decision: "clarify", reason: "no_result" };
}

// 有 resolver capability 且缺失项属于可解析类别（实体/时间 hint）→ 应尝试解析而非澄清
function shouldAttemptResolution({ requirement, hasResolverCapability }) {
  if (!hasResolverCapability) return false;
  const kind = requirement && requirement.kind;
  return kind === "entity" || kind === "temporal" || kind === "value";
}

module.exports = { decideClarification, shouldAttemptResolution };