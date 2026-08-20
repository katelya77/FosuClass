"use strict";
// Campus Decision Intelligence T2 —— 候选提取 + 确定性评估（2026-08-19）
const test = require("node:test");
const assert = require("node:assert");
const path = require("path");

const D = path.join(__dirname, "..", "..", "r51", "decision");
const { fromRanking, fromSpace, fromAvailability, fromGroupPlan, fromReschedule, candidatesForFact } = require(path.join(D, "candidate-source.js"));
const { evaluateCandidates } = require(path.join(D, "evaluator.js"));

function profile(overrides) {
  return { hard: [], soft: [], exclusions: [], ...overrides };
}

test("EV1. fromRanking 保留工具已有 rank 为 toolRank", () => {
  const raw = {
    items: [
      { rank: 1, entity: { id: "t-001", name: "教师001", type: "teacher" }, metrics: { loadCount: 24 } },
      { rank: 2, entity: { id: "t-002", name: "教师002", type: "teacher" }, metrics: { loadCount: 24 } },
    ],
    evidence: { verified: true },
  };
  const cs = fromRanking(raw, { factKey: "rankingFacts", toolName: "campus_teacher_load_query", verified: true });
  assert.strictEqual(cs.length, 2);
  assert.strictEqual(cs[0].toolRank, 1);
  assert.strictEqual(cs[1].toolRank, 2);
  assert.strictEqual(cs[0].label, "教师001");
  assert.strictEqual(cs[0].attributes.loadCount, 24);
});

test("EV2. fromSpace 提取 capacity/campus/building 属性", () => {
  const raw = {
    items: [{ roomId: "r-1", roomName: "A1-101", building: "A1", campusName: "校区A", capacity: 120, type: "多媒体教室" }],
    evidence: { verified: true },
  };
  const cs = fromSpace(raw, { factKey: "spaceFacts", toolName: "campus_classroom_search", verified: true });
  assert.strictEqual(cs[0].attributes.capacity, 120);
  assert.strictEqual(cs[0].attributes.campus, "校区A");
  assert.strictEqual(cs[0].attributes.building, "A1");
});

test("EV3. candidatesForFact 按 factKey 选择适配器并校验 verified，保留 Mission resultRef", () => {
  const toolResults = {
    campus_classroom_search: {
      success: true,
      items: [{ roomId: "r-9", roomName: "B2-202", building: "B2", campusName: "校区B", capacity: 90, type: "普通教室" }],
      evidence: { verified: true },
    },
  };
  const cs = candidatesForFact("spaceFacts", toolResults, { meta: { resultRef: "mission-space-1" } });
  assert.strictEqual(cs.length, 1);
  assert.strictEqual(cs[0].evidence.verified, true);
  assert.strictEqual(cs[0].evidence.resultRef, "mission-space-1");
});

test("EV3a. 缺失 Mission resultRef 时候选 evidence 显式为 null", () => {
  const cs = fromSpace({
    items: [{ roomId: "r-no-ref", roomName: "A1-102", capacity: 90 }],
    evidence: { verified: true },
  }, { factKey: "spaceFacts", toolName: "campus_classroom_search", verified: true });
  assert.strictEqual(cs[0].evidence.resultRef, null);
});

test("EV3b. 未核验 toolResults 不进入 Decision Core，绝不将其作为候选", () => {
  const toolResults = {
    campus_classroom_search: {
      items: [{ roomId: "r-unsafe", roomName: "未核验教室", capacity: 90 }],
      evidence: { verified: false },
    },
  };
  assert.deepStrictEqual(candidatesForFact("spaceFacts", toolResults), []);
});

test("EV3c. 各 structured adapter 保留事实字段；调课 checks 确定性折叠为 conflictCount/feasible", () => {
  const meta = { factKey: "testFacts", toolName: "test_tool", verified: true };
  const availability = fromAvailability({
    items: [{ week: 2, weekday: 3, weekdayName: "周三", periodStart: 3, periodEnd: 4, periodText: "第3-4节", freePeriodCount: 2 }],
  }, meta);
  assert.strictEqual(availability[0].attributes.week, 2);
  assert.strictEqual(availability[0].attributes.freePeriodCount, 2);

  const groupPlan = fromGroupPlan({
    items: [{ rank: 2, week: 2, weekday: 3, weekdayName: "周三", periodStart: 3, periodEnd: 4, periodText: "第3-4节", freePeriodCount: 2, roomCount: 1, rooms: [{ capacity: 120 }] }],
  }, meta);
  assert.strictEqual(groupPlan[0].toolRank, 2);
  assert.strictEqual(groupPlan[0].attributes.maxRoomCapacity, 120);
  assert.strictEqual(groupPlan[0].attributes.capacity, 120, "group-plan 必须暴露 canonical capacity alias");

  const reschedule = fromReschedule({
    items: [{
      target: { week: 2, weekday: 3, weekdayName: "周三", periodStart: 3, periodEnd: 4, periodText: "第3-4节" },
      checks: {
        teacherConflict: { conflict: true, details: [{ lessonId: "l-1" }, { lessonId: "l-2" }] },
        classConflict: { conflict: false, details: [] },
        roomConflict: { conflict: false, details: [] },
        capacity: { ok: true },
        feature: { ok: true },
      },
      warnings: [{ type: "continuous_load" }],
    }],
  }, meta);
  assert.strictEqual(reschedule[0].attributes.feasible, false);
  assert.strictEqual(reschedule[0].attributes.conflictCount, 2);
  assert.strictEqual(reschedule[0].attributes.warningCount, 1);
});

test("EV3d. verified 候选要求 canonical success:true + items 数组，非法 envelope 不得伪装 verified-empty", () => {
  const item = { roomId: "r-unsafe", roomName: "不得采用", capacity: 90 };
  const invalid = [
    { success: false, items: [item], evidence: { verified: true } },
    { items: [item], evidence: { verified: true } },
    { success: true, evidence: { verified: true } },
    { success: true, items: {}, evidence: { verified: true } },
    { success: true, items: [null], evidence: { verified: true } },
    { success: "true", items: [item], evidence: { verified: true } },
  ];
  for (const envelope of invalid) {
    assert.deepStrictEqual(candidatesForFact("spaceFacts", { campus_classroom_search: envelope }), [], JSON.stringify(envelope));
  }
});

test("EV3e. group-plan capacity 取 rooms 中最大已知容量；缺失容量时不得发明 0", () => {
  const meta = { factKey: "groupPlanFacts", toolName: "campus_group_plan", verified: true };
  const candidates = fromGroupPlan({
    items: [
      { planId: "known", rooms: [{ capacity: 60 }, { capacity: 120 }] },
      { planId: "unknown", rooms: [{ roomName: "缺容量教室" }] },
      { planId: "empty", rooms: [] },
    ],
  }, meta);
  assert.strictEqual(candidates[0].attributes.maxRoomCapacity, 120);
  assert.strictEqual(candidates[0].attributes.capacity, 120);
  for (const candidate of candidates.slice(1)) {
    assert.strictEqual(candidate.attributes.maxRoomCapacity, null);
    assert.strictEqual(candidate.attributes.capacity, null);
  }
});

test("EV4. hard gte 过滤低容量候选：违反 → infeasible 且保留违反清单（不静默放宽）", () => {
  const cs = [
    { id: "r-1", label: "A1-101", attributes: { capacity: 120, campus: "校区A" }, toolRank: null, evidence: { verified: true } },
    { id: "r-2", label: "A1-102", attributes: { capacity: 60, campus: "校区A" }, toolRank: null, evidence: { verified: true } },
  ];
  const r = evaluateCandidates(cs, profile({ hard: [{ id: "capacity-min", field: "capacity", op: "gte", value: 80 }] }));
  assert.strictEqual(r.feasible.length, 1);
  assert.strictEqual(r.feasible[0].candidate.id, "r-1");
  assert.strictEqual(r.infeasible.length, 1);
  assert.strictEqual(r.infeasible[0].hardViolations.length, 1);
  assert.strictEqual(r.relaxedCount, 0);
});

test("EV5. exclusions 命中楼栋 → excluded，候选被淘汰", () => {
  const cs = [
    { id: "r-1", label: "A1-101", attributes: { building: "A1", capacity: 120 }, toolRank: null, evidence: { verified: true } },
    { id: "r-2", label: "A2-201", attributes: { building: "A2", capacity: 120 }, toolRank: null, evidence: { verified: true } },
  ];
  const r = evaluateCandidates(cs, profile({ exclusions: [{ id: "no-a2", field: "building", op: "in", value: ["A2"] }] }));
  assert.strictEqual(r.feasible.length, 1);
  assert.strictEqual(r.infeasible[0].candidate.id, "r-2");
  assert.strictEqual(r.infeasible[0].excluded, true);
});

test("EV5b. hard nin 缺少 constrained attribute → infeasible，不能把缺失证据当作通过", () => {
  const cs = [{ id: "r-unknown", label: "未知楼栋", attributes: { capacity: 120 }, toolRank: null, evidence: { verified: true } }];
  const r = evaluateCandidates(cs, profile({ hard: [{ id: "exclude-building", field: "building", op: "nin", value: ["A2"] }] }));
  assert.strictEqual(r.feasible.length, 0);
  assert.strictEqual(r.infeasible.length, 1);
  assert.strictEqual(r.infeasible[0].hardViolations[0].id, "exclude-building");
});

test("EV6. soft 偏好产生可解释差异：prefer-larger → 容量更大 softScore 更高", () => {
  const cs = [
    { id: "r-1", label: "A1-101", attributes: { capacity: 120 }, toolRank: null, evidence: { verified: true } },
    { id: "r-2", label: "A1-102", attributes: { capacity: 60 }, toolRank: null, evidence: { verified: true } },
    { id: "r-3", label: "A1-103", attributes: { capacity: 80 }, toolRank: null, evidence: { verified: true } },
  ];
  const r = evaluateCandidates(cs, profile({ soft: [{ id: "prefer-larger", field: "capacity", weight: 1, direction: "desc" }] }));
  const byId = Object.fromEntries(r.items.map((x) => [x.candidate.id, x.softScore]));
  assert.strictEqual(byId["r-1"], 2, "120 优于另外两个 → 2");
  assert.strictEqual(byId["r-3"], 1, "80 优于 60 → 1");
  assert.strictEqual(byId["r-2"], 0);
});

test("EV6b. 非单位 soft weight 的 recorded contribution 与 softScore 精确一致", () => {
  const cs = [
    { id: "r-1", label: "A1-101", attributes: { capacity: 120 }, toolRank: null, evidence: { verified: true } },
    { id: "r-2", label: "A1-102", attributes: { capacity: 60 }, toolRank: null, evidence: { verified: true } },
  ];
  const r = evaluateCandidates(cs, profile({ soft: [{ id: "prefer-larger", field: "capacity", weight: 2, direction: "desc" }] }));
  const best = r.items.find((x) => x.candidate.id === "r-1");
  assert.strictEqual(best.softScore, 2);
  assert.strictEqual(best.softContributions[0].contribution, 2);
  assert.strictEqual(best.softContributions.reduce((sum, item) => sum + item.contribution, 0), best.softScore);
});

test("EV7. 评估确定性：同输入两次结果字节一致", () => {
  const cs = [
    { id: "r-1", label: "A1-101", attributes: { capacity: 120, campus: "校区A" }, toolRank: null, evidence: { verified: true } },
    { id: "r-2", label: "A1-102", attributes: { capacity: 60, campus: "校区B" }, toolRank: null, evidence: { verified: true } },
  ];
  const p = profile({
    hard: [{ id: "capacity-min", field: "capacity", op: "gte", value: 80 }],
    soft: [{ id: "prefer-larger", field: "capacity", weight: 1, direction: "desc" }],
  });
  const a = JSON.stringify(evaluateCandidates(cs, p));
  const b = JSON.stringify(evaluateCandidates(cs, p));
  assert.strictEqual(a, b);
});

test("EV8. 全部候选违反 hard → feasible 空，relaxedCount 仍为 0（绝不放宽）", () => {
  const cs = [
    { id: "r-1", label: "A1-101", attributes: { capacity: 30 }, toolRank: null, evidence: { verified: true } },
    { id: "r-2", label: "A1-102", attributes: { capacity: 20 }, toolRank: null, evidence: { verified: true } },
  ];
  const r = evaluateCandidates(cs, profile({ hard: [{ id: "capacity-min", field: "capacity", op: "gte", value: 80 }] }));
  assert.strictEqual(r.feasible.length, 0);
  assert.strictEqual(r.infeasible.length, 2);
  assert.strictEqual(r.relaxedCount, 0);
});

test("EV9. 非法 profile 被 fail-closed 拒绝，绝不进入评估", () => {
  assert.throws(
    () => evaluateCandidates([], profile({ soft: [{ id: "bad", field: "capacity", weight: 0, direction: "desc" }] })),
    /invalid profile/,
  );
});
