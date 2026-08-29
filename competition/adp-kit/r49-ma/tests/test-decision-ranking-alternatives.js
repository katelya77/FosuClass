"use strict";
// Campus Decision Intelligence T3 —— 稳定排序 + 备选策略（2026-08-19）
const test = require("node:test");
const assert = require("node:assert");
const path = require("path");

const D = path.join(__dirname, "..", "..", "r51", "decision");
const { rankFeasible } = require(path.join(D, "ranking.js"));
const { selectDecision } = require(path.join(D, "alternatives.js"));

function cand(id, label, attributes, toolRank = null, sourceIndex = 0) {
  return { id, label, attributes, toolRank, evidence: { verified: true }, sourceIndex };
}
function item(candidate, softScore = 0) {
  return { candidate, softScore, feasible: true, hardViolations: [], softContributions: [] };
}

test("RK1. 无额外证据（softScore 全 0）→ toolRank 保持工具已有排名", () => {
  const ranked = rankFeasible([
    item(cand("t-2", "教师002", {}, 2, 1)),
    item(cand("t-1", "教师001", {}, 1, 0)),
    item(cand("t-3", "教师003", {}, 3, 2)),
  ]);
  assert.deepStrictEqual(ranked.map((x) => x.candidate.toolRank), [1, 2, 3]);
});

test("RK2. soft 偏好优先于 toolRank：softScore 高者排前", () => {
  const ranked = rankFeasible([
    item(cand("t-1", "教师001", {}, 1, 0), 0),
    item(cand("t-2", "教师002", {}, 2, 1), 5),
    item(cand("t-3", "教师003", {}, 3, 2), 0),
  ]);
  assert.deepStrictEqual(ranked.map((x) => x.candidate.id), ["t-2", "t-1", "t-3"]);
});

test("RK3. tie 稳定：同 softScore 同 toolRank → 按 label 码元序（确定性）", () => {
  const ranked = rankFeasible([
    item(cand("b", "教室B", {}, 1, 1)),
    item(cand("a", "教室A", {}, 1, 0)),
  ]);
  assert.deepStrictEqual(ranked.map((x) => x.candidate.id), ["a", "b"]);
});

test("RK4. 无 toolRank 候选按 label 码元序稳定", () => {
  const ranked = rankFeasible([
    item(cand("r2", "b", {})),
    item(cand("r1", "a", {})),
  ]);
  assert.deepStrictEqual(ranked.map((x) => x.candidate.id), ["r1", "r2"]);
});

test("AL1. recommendation=feasible[0]，alternatives=后续 topN（不含推荐）", () => {
  const ranked = rankFeasible([
    item(cand("a", "a")), item(cand("b", "b")), item(cand("c", "c")), item(cand("d", "d")),
  ]);
  const d = selectDecision(ranked, { topN: 3 });
  assert.strictEqual(d.recommendation.candidate.id, "a");
  assert.deepStrictEqual(d.alternatives.map((x) => x.candidate.id), ["b", "c"]);
  assert.strictEqual(d.decision, "recommend");
});

test("AL2. 无候选 → 无推荐、无备选、绝不虚构", () => {
  const d = selectDecision([]);
  assert.strictEqual(d.recommendation, null);
  assert.deepStrictEqual(d.alternatives, []);
  assert.strictEqual(d.decision, "no_viable_option");
  assert.strictEqual(d.tieGroupCount, 0);
});

test("AL3. tieGroupCount：与推荐同 (softScore, toolRank) 的候选数（无并列=0）", () => {
  const ranked = rankFeasible([
    item(cand("a", "甲", {}, 1, 0)),
    item(cand("b", "乙", {}, 1, 1)),
    item(cand("c", "丙", {}, 2, 2)),
  ]);
  const d = selectDecision(ranked);
  assert.strictEqual(d.tieGroupCount, 1, "a 与 b 并列 → 1 个并列");
  const solo = selectDecision(rankFeasible([item(cand("a", "甲", {}, 1))]));
  assert.strictEqual(solo.tieGroupCount, 0);
});
