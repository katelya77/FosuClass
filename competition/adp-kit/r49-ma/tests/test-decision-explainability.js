"use strict";
// Campus Decision Intelligence 可核验解释门禁：理由只来自已核验候选事实与评估记录。
const test = require("node:test");
const assert = require("node:assert");
const path = require("path");

const { explainCandidate } = require(path.join(__dirname, "..", "..", "r51", "decision", "explainability.js"));

const profile = {
  hard: [{ id: "capacity-min", field: "capacity", op: "gte", value: 60, description: "容量下限" }],
  soft: [{ id: "prefer-larger", field: "capacity", weight: 1, direction: "desc", description: "更大容量优先" }],
  exclusions: [],
};

function evaluated(overrides = {}) {
  return {
    candidate: {
      id: "room-internal-17",
      label: "北区教学楼 401",
      attributes: { capacity: 80 },
      evidence: { factKey: "spaceFacts", toolName: "campus_classroom_search", verified: true, resultRef: "result-1" },
    },
    hardSatisfied: true,
    hardViolations: [],
    excluded: false,
    exclusionViolations: [],
    feasible: true,
    softScore: 1,
    softContributions: [{ id: "prefer-larger", field: "capacity", value: 80, contribution: 1 }],
    ...overrides,
  };
}

test("D4. 无已核验证据时不得生成任何理由", () => {
  const item = evaluated({
    candidate: {
      ...evaluated().candidate,
      evidence: { factKey: "spaceFacts", toolName: "campus_classroom_search", verified: false, resultRef: "result-1" },
    },
  });
  assert.deepStrictEqual(explainCandidate(item, profile), []);
});

test("D5. 已核验的 hard/soft 理由带 constraint、attribute 与 fact 来源", () => {
  const reasons = explainCandidate(evaluated(), profile);
  const hard = reasons.find((reason) => reason.kind === "hard_constraint");
  const soft = reasons.find((reason) => reason.kind === "soft_preference");

  assert.deepStrictEqual(hard.source, {
    constraintId: "capacity-min",
    attribute: "capacity",
    factKey: "spaceFacts",
  });
  assert.deepStrictEqual(soft.source, {
    constraintId: "prefer-larger",
    attribute: "capacity",
    factKey: "spaceFacts",
  });
  assert.match(hard.text, /80/);
  assert.match(soft.text, /1/);
});

test("D6. 理由不得借候选标签或未核验信息编造事实", () => {
  const reasons = explainCandidate(evaluated(), profile);
  const text = reasons.map((reason) => reason.text).join(" ");

  assert.ok(!text.includes("北区教学楼 401"), "label 不是理由事实来源");
  assert.ok(!text.includes("最适合"), "不得加入无依据因果结论");
  assert.ok(!text.includes("空调"), "不得补全候选属性中不存在的事实");
});

test("D6a. profile/evaluation 不一致或属性被修改时不得声称满足 hard 约束", () => {
  const profileMismatch = evaluated({
    candidate: { ...evaluated().candidate, attributes: { capacity: 40 } },
    // 模拟上游聚合字段过期；解释层必须重验准确的 op/value。
    hardSatisfied: true,
    hardViolations: [],
    softContributions: [],
  });
  const reasons = explainCandidate(profileMismatch, profile);
  assert.strictEqual(reasons.some((reason) => reason.kind === "hard_constraint"), false);

  const mutatedAfterEvaluation = evaluated({
    candidate: { ...evaluated().candidate, attributes: { capacity: 20 } },
    softContributions: [],
  });
  assert.strictEqual(explainCandidate(mutatedAfterEvaluation, profile).some((reason) => reason.kind === "hard_constraint"), false);
});
