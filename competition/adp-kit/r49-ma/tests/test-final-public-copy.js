"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");

const D = path.join(__dirname, "..", "..", "r51", "decision");

function publicCopy() {
  return require(path.join(D, "public-copy.js"));
}

function receiptModule() {
  return require(path.join(D, "receipt.js"));
}

function capacityItem() {
  return {
    candidate: {
      label: "A1-201",
      attributes: { capacity: 120, campus: "校区A" },
      evidence: { verified: true, factKey: "spaceFacts" },
    },
    reasons: [{
      kind: "hard_constraint",
      text: "已核验：capacity 为 120，满足约束 capacity-min。",
      source: { constraintId: "capacity-min", attribute: "capacity", factKey: "spaceFacts" },
    }],
  };
}

const PROFILE = {
  hard: [{ id: "capacity-min", field: "capacity", op: "gte", value: 60 }],
  soft: [],
  exclusions: [],
};

test("PC1 structured capacity semantics become deterministic public Chinese copy", () => {
  const projected = publicCopy().projectPublicChoice(capacityItem(), PROFILE);
  assert.deepEqual(projected, { label: "A1-201", reasons: ["容量 120 人，满足 60 人需求"] });
});

test("PC2 raw internal reason text and unknown constraint IDs are omitted rather than translated", () => {
  const item = capacityItem();
  item.reasons.push({ kind: "hard_constraint", text: "capacity-min sourceIndex toolRank", source: { constraintId: "unknown-internal", attribute: "capacity", factKey: "spaceFacts" } });
  item.reasons.push("任意模型文案");
  const projected = publicCopy().projectPublicChoice(item, PROFILE);
  assert.deepEqual(projected.reasons, ["容量 120 人，满足 60 人需求"]);
  assert.doesNotMatch(JSON.stringify(projected), /capacity-min|sourceIndex|toolRank|unknown-internal/);
});

test("PC3 receipt and Widget-facing choice share the same projector", () => {
  const bundle = {
    verified: true,
    decision: "recommend",
    profile: PROFILE,
    recommendation: capacityItem(),
    alternatives: [],
    nextAction: { label: "查看备选", payload: { query: "查看其他符合人数需求的教室" } },
  };
  const receipt = receiptModule().createPublicDecisionReceipt(bundle);
  assert.deepEqual(receipt.recommendation, publicCopy().projectPublicChoice(bundle.recommendation, PROFILE));
  assert.deepEqual(receipt.recommendation.reasons, ["容量 120 人，满足 60 人需求"]);
});

test("PC4 no verified evidence means no public reason", () => {
  const item = capacityItem();
  item.candidate.evidence.verified = false;
  assert.deepEqual(publicCopy().projectPublicChoice(item, PROFILE).reasons, []);
});

test("PC5 no viable result cannot manufacture a recommendation or alternatives", () => {
  const receipt = receiptModule().createPublicDecisionReceipt({
    verified: true,
    decision: "no_viable_option",
    profile: PROFILE,
    recommendation: capacityItem(),
    alternatives: [capacityItem()],
  });
  assert.equal(receipt.recommendation, null);
  assert.deepEqual(receipt.alternatives, []);
});

test("PC6 common public semantics never expose constraint, score or tool ranking words", () => {
  const cases = [
    [{ id: "prefer-larger", field: "capacity", direction: "desc", weight: 1 }, { capacity: 120 }, "容量更充裕"],
    [{ id: "prefer-same-campus", field: "campus", direction: "prefer-value", value: "校区A", weight: 1 }, { campus: "校区A" }, "与目标校区一致"],
    [{ id: "prefer-earlier", field: "periodStart", direction: "asc", weight: 1 }, { periodStart: 1 }, "时间更早"],
  ];
  for (const [constraint, attributes, expected] of cases) {
    const item = {
      candidate: { label: "候选方案", attributes, evidence: { verified: true, factKey: "groupPlanFacts" } },
      reasons: [{ kind: "soft_preference", text: `internal ${constraint.id}`, source: { constraintId: constraint.id, attribute: constraint.field, factKey: "groupPlanFacts" } }],
    };
    const result = publicCopy().projectPublicChoice(item, { hard: [], soft: [constraint], exclusions: [] });
    assert.deepEqual(result.reasons, [expected]);
    assert.doesNotMatch(JSON.stringify(result), /constraint|score|toolRank|prefer-/i);
  }
});

