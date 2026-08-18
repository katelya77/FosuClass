"use strict";
// R50.0 T1/T3 — Ranking Semantic Core 契约测试
//
// 设计目标：排名规则抽象为通用机制，区分 metric semantics 与 position semantics。
//  - metric semantics：「最高/最忙/最空闲/利用率最高」= 指标查询
//  - position semantics：Top1/第一名/排第一 = 有序列表的稳定位置，不因 metric tie 失效
//  - 业务指标并列必须保留 tie metadata，同时仍具 deterministic position
//  - 不只针对教师：teacher load / room utilization / campus load / building utilization 全部复用
//
// 本测试验证：
//  A. RankingResult 结构（rank/metricRank/tiedWithPrevious/tieGroupId/tieGroupSize/entity/metrics）
//  B. position 语义不因 metric tie 失效（并列仍可确定 Top1/Top2）
//  C. 通用实体类型（teacher/room/building/campus）复用同一排名模型
//  D. metric 排序（highest/lowest）
//  E. deterministic（同输入同输出）

const test = require("node:test");
const assert = require("node:assert");

const ranking = require("../tools/ranking-core.js");

test("RANK-01 buildRankingResult 输出契约字段完整", () => {
  const rows = [
    { id: "t-001", name: "教师001", type: "teacher", lessonOccurrences: 27, periodUnits: 54 },
    { id: "t-002", name: "教师002", type: "teacher", lessonOccurrences: 27, periodUnits: 54 },
    { id: "t-003", name: "教师003", type: "teacher", lessonOccurrences: 20, periodUnits: 40 },
  ];
  const out = ranking.buildRankingResult(rows, {
    metrics: ["lessonOccurrences", "periodUnits"],
    tieBreak: ["name"],
  });
  assert.ok(Array.isArray(out.items));
  assert.strictEqual(out.items.length, 3);
  for (const item of out.items) {
    for (const key of ["rank", "metricRank", "tiedWithPrevious", "tieGroupId", "tieGroupSize", "entity", "metrics"]) {
      assert.ok(key in item, `缺少字段 ${key}`);
    }
  }
});

test("RANK-02 position 语义：业务指标并列不导致 Top1 不唯一", () => {
  const rows = [
    { id: "t-001", name: "教师001", type: "teacher", lessonOccurrences: 27, periodUnits: 54 },
    { id: "t-002", name: "教师002", type: "teacher", lessonOccurrences: 27, periodUnits: 54 },
    { id: "t-003", name: "教师003", type: "teacher", lessonOccurrences: 20, periodUnits: 40 },
  ];
  const out = ranking.buildRankingResult(rows, {
    metrics: ["lessonOccurrences", "periodUnits"],
    tieBreak: ["name"], // 稳定 tie-break（zh-CN name）
  });
  const [a, b] = out.items;
  // 两者指标并列 → tiedWithPrevious
  assert.strictEqual(a.metrics.lessonOccurrences, 27);
  assert.strictEqual(b.metrics.lessonOccurrences, 27);
  assert.strictEqual(a.tiedWithPrevious, false);
  assert.strictEqual(b.tiedWithPrevious, true);
  assert.strictEqual(a.tieGroupId, b.tieGroupId); // 同一并列组
  assert.strictEqual(a.tieGroupSize, 2);
  assert.strictEqual(b.tieGroupSize, 2);
  // 但 position 仍然确定：rank 1 / rank 2
  assert.strictEqual(a.rank, 1);
  assert.strictEqual(b.rank, 2);
});

test("RANK-03 并列组不跨越不同指标值的实体", () => {
  const rows = [
    { id: "t-001", name: "教师001", type: "teacher", load: 30 },
    { id: "t-002", name: "教师002", type: "teacher", load: 30 },
    { id: "t-003", name: "教师003", type: "teacher", load: 25 },
  ];
  const out = ranking.buildRankingResult(rows, { metrics: ["load"], tieBreak: ["name"] });
  const [, , third] = out.items;
  assert.strictEqual(third.tieGroupId, null);
  assert.strictEqual(third.tieGroupSize, 1);
  assert.strictEqual(third.tiedWithPrevious, false);
});

test("RANK-04 通用实体：room utilization 复用同一模型", () => {
  const rooms = [
    { id: "r-a1-101", name: "A1-101", type: "room", utilizationRate: 0.82, occupiedPeriodUnits: 66 },
    { id: "r-a1-102", name: "A1-102", type: "room", utilizationRate: 0.82, occupiedPeriodUnits: 66 },
    { id: "r-a1-201", name: "A1-201", type: "room", utilizationRate: 0.45, occupiedPeriodUnits: 36 },
  ];
  const out = ranking.buildRankingResult(rooms, { metrics: ["utilizationRate"], tieBreak: ["name"] });
  assert.strictEqual(out.items[0].entity.type, "room");
  assert.strictEqual(out.items[0].rank, 1);
  assert.strictEqual(out.items[1].rank, 2);
  assert.strictEqual(out.items[1].tiedWithPrevious, true);
  assert.strictEqual(out.items[2].rank, 3);
});

test("RANK-05 通用实体：building / campus 可排序", () => {
  const rows = [
    { id: "b1", name: "综合教学楼", type: "building", load: 88 },
    { id: "b2", name: "工程实践楼", type: "building", load: 71 },
    { id: "b3", name: "人文教学楼", type: "building", load: 52 },
  ];
  const out = ranking.buildRankingResult(rows, { metrics: ["load"], tieBreak: ["name"] });
  assert.strictEqual(out.items[0].entity.type, "building");
  assert.strictEqual(out.items[0].metrics.load, 88);
  assert.strictEqual(out.items[2].entity.name, "人文教学楼");
});

test("RANK-06 metric 排序 direction=asc（最低/最空闲）", () => {
  const rows = [
    { id: "r1", name: "教室1", type: "room", utilizationRate: 0.9 },
    { id: "r2", name: "教室2", type: "room", utilizationRate: 0.3 },
    { id: "r3", name: "教室3", type: "room", utilizationRate: 0.5 },
  ];
  const out = ranking.buildRankingResult(rows, { metrics: ["utilizationRate"], tieBreak: ["name"], direction: "asc" });
  // asc → 最低在前
  assert.strictEqual(out.items[0].metrics.utilizationRate, 0.3);
  assert.strictEqual(out.items[0].rank, 1);
  assert.strictEqual(out.items[2].metrics.utilizationRate, 0.9);
});

test("RANK-07 确定性：同输入重复调用字节一致", () => {
  const rows = [
    { id: "t-001", name: "教师001", type: "teacher", load: 30 },
    { id: "t-002", name: "教师002", type: "teacher", load: 30 },
    { id: "t-003", name: "教师003", type: "teacher", load: 25 },
  ];
  const a = JSON.stringify(ranking.buildRankingResult(rows, { metrics: ["load"], tieBreak: ["name"] }));
  const b = JSON.stringify(ranking.buildRankingResult(rows, { metrics: ["load"], tieBreak: ["name"] }));
  assert.strictEqual(a, b);
});

test("RANK-08 metricRank 反映并列组内排序", () => {
  const rows = [
    { id: "t-001", name: "教师001", type: "teacher", load: 30 },
    { id: "t-002", name: "教师002", type: "teacher", load: 30 },
    { id: "t-003", name: "教师003", type: "teacher", load: 30 },
  ];
  const out = ranking.buildRankingResult(rows, { metrics: ["load"], tieBreak: ["name"] });
  // 三人并列 → 同一组，metricRank 1,1,1（同一业务指标级别）
  assert.strictEqual(out.items[0].metricRank, 1);
  assert.strictEqual(out.items[1].metricRank, 1);
  assert.strictEqual(out.items[2].metricRank, 1);
  assert.strictEqual(out.items[0].tieGroupSize, 3);
});

test("RANK-09 空输入 → 空 items（fail-safe）", () => {
  const out = ranking.buildRankingResult([], { metrics: ["load"], tieBreak: ["name"] });
  assert.ok(Array.isArray(out.items));
  assert.strictEqual(out.items.length, 0);
});
