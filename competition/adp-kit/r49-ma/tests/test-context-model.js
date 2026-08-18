"use strict";
// R50.0 T1 — Generic Context Model 契约测试
//
// 设计目标：统一内部 Context，不围绕 Top1 单独设计整个架构。
//   context = { intentContext, entityContext, temporalContext, rankingContext, comparisonContext, taskContext }
// 跨域继承原则：只继承当前任务完成所必需的信息；domain-local 临时状态不得污染不相关新任务。
// 用户当前明确表达永远覆盖继承值。
//
// 本测试验证：
//  A. context 结构契约字段完整
//  B. FOLLOW_UP 同域继承 compatible slots
//  C. NEW_TASK 跨域自动 drop 不兼容 domain-local state
//  D. 用户显式新值覆盖继承值
//  E. rankingContext 仅在真正产生排序结果时存在
//  F. comparisonContext 仅显式比较任务需要
//  G. 不新增针对单一 Case 的特殊字段（不允许为特定 Case 加字段）

const test = require("node:test");
const assert = require("node:assert");

const context = require("../tools/context-model.js");

test("CTX-01 context 结构契约字段完整", () => {
  const c = context.buildContext();
  for (const key of ["intentContext", "entityContext", "temporalContext", "rankingContext", "comparisonContext", "taskContext"]) {
    assert.ok(key in c, `缺少字段 ${key}`);
  }
});

test("CTX-02 FOLLOW_UP 同域继承 compatible slots", () => {
  const previous = {
    intentContext: { domain: "schedule" },
    entityContext: { activeEntity: { type: "teacher", name: "T09" }, pendingCandidates: [] },
    temporalContext: { resolvedWeek: 1, resolvedWeekStart: 1, resolvedWeekEnd: 1 },
    rankingContext: null,
    comparisonContext: null,
    taskContext: {},
  };
  const c = context.buildContext({ previous, domain: "schedule" });
  assert.deepStrictEqual(c.entityContext.activeEntity, { type: "teacher", name: "T09" });
  assert.strictEqual(c.temporalContext.resolvedWeek, 1);
});

test("CTX-03 用户显式新值覆盖继承值", () => {
  const previous = {
    intentContext: { domain: "schedule" },
    entityContext: { activeEntity: { type: "teacher", name: "T09" }, pendingCandidates: [] },
    temporalContext: { resolvedWeek: 1, resolvedWeekStart: 1, resolvedWeekEnd: 1 },
    rankingContext: null,
    comparisonContext: null,
    taskContext: {},
  };
  const c = context.buildContext({
    previous,
    domain: "schedule",
    explicitEntity: { type: "teacher", name: "教师003" },
    explicitWeek: 4,
  });
  assert.deepStrictEqual(c.entityContext.activeEntity, { type: "teacher", name: "教师003" });
  assert.strictEqual(c.temporalContext.resolvedWeek, 4);
});

test("CTX-04 NEW_TASK 跨域自动 drop 不兼容 domain-local state", () => {
  const previous = {
    intentContext: { domain: "risk" },
    entityContext: { activeEntity: { type: "teacher", name: "T09" }, pendingCandidates: [] },
    temporalContext: { resolvedWeek: 1, resolvedWeekStart: 1, resolvedWeekEnd: 1 },
    rankingContext: null,
    comparisonContext: { mode: "two_object", secondPending: true },
    taskContext: { pendingSecondEntity: "T03" },
  };
  // 用户切换到 classroom（另一业务域）
  const c = context.buildContext({ previous, domain: "classroom" });
  // comparisonContext 是 risk-local state，跨域必须清除
  assert.strictEqual(c.comparisonContext, null);
  // taskContext 中 risk 的 pending 第二对象不得残留
  assert.strictEqual(c.taskContext.pendingSecondEntity, undefined);
});

test("CTX-05 rankingContext 仅在真正产生排序结果时存在", () => {
  const noRank = context.buildContext({ previous: null, domain: "schedule" });
  assert.strictEqual(noRank.rankingContext, null);

  const withRank = context.buildContext({
    previous: null,
    domain: "insight",
    ranking: {
      sourceTool: "campus_teacher_load_query",
      list: "teacherLoadTop",
      selectedRank: 1,
      entities: [{ type: "teacher", name: "教师009" }],
    },
  });
  assert.ok(withRank.rankingContext);
  assert.strictEqual(withRank.rankingContext.sourceTool, "campus_teacher_load_query");
  assert.strictEqual(withRank.rankingContext.selectedRank, 1);
});

test("CTX-06 comparisonContext 仅显式比较任务需要", () => {
  const noCompare = context.buildContext({ previous: null, domain: "schedule" });
  assert.strictEqual(noCompare.comparisonContext, null);

  const withCompare = context.buildContext({
    previous: null,
    domain: "risk",
    comparison: { mode: "two_object", secondEntity: { type: "teacher", name: "教师003" } },
  });
  assert.ok(withCompare.comparisonContext);
  assert.strictEqual(withCompare.comparisonContext.mode, "two_object");
});

test("CTX-07 确定性：同输入重复调用字节一致", () => {
  const previous = {
    intentContext: { domain: "schedule" },
    entityContext: { activeEntity: { type: "teacher", name: "T09" }, pendingCandidates: [] },
    temporalContext: { resolvedWeek: 1 },
    rankingContext: null,
    comparisonContext: null,
    taskContext: {},
  };
  const a = JSON.stringify(context.buildContext({ previous, domain: "schedule", explicitWeek: 2 }));
  const b = JSON.stringify(context.buildContext({ previous, domain: "schedule", explicitWeek: 2 }));
  assert.strictEqual(a, b);
});
