"use strict";
// R49.4 WindowContext Semantics 回归（2026-08-17）
//
// 取代 R49.3 的「聚合窗口后下钻默认 week=1」语义：
//  - rankingWindow（排名/聚合窗口）可被继承为 detailWindow（下钻窗口）；
//  - 「看Top1课表」→ detailWindow=1..4（保留四周，绝不默认 week=1，绝不误成 week=4）；
//  - 「只看第一周」→ detailWindow=1..1（显式收窄，fresh tool call）；
//  - 显式范围 > 显式单周 > rankingWindow > null；
//  - 非法窗口一律 fail closed，不猜测。
//
// 模拟决策核心 = tools/window-semantics.js 纯函数，与 Agent Prompt 同源同语义。

const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const path = require("path");

const R49_MA = path.join(__dirname, "..");
const MAIN = fs.readFileSync(path.join(R49_MA, "agents", "main-orchestrator.md"), "utf8");
const INSIGHT = fs.readFileSync(path.join(R49_MA, "agents", "campus-insight.md"), "utf8");
const SCHEDULE = fs.readFileSync(path.join(R49_MA, "agents", "schedule-space.md"), "utf8");
const RISK = fs.readFileSync(path.join(R49_MA, "agents", "risk-planning.md"), "utf8");
const HANDOFF = fs.readFileSync(path.join(R49_MA, "03-HANDOFF-POLICY.md"), "utf8");
const CONTEXT = fs.readFileSync(path.join(R49_MA, "04-CONTEXT-POLICY.md"), "utf8");
const CONTRACTS = fs.readFileSync(path.join(R49_MA, "05-TOOL-CONTRACTS.md"), "utf8");

const {
  normalizeWeekRange,
  resolveDetailWindow,
  shouldUseRangeSchedule,
} = require("../tools/window-semantics.js");

// ---------------------------------------------------------------------------
// resolveDetailWindow：显式 > 继承
// ---------------------------------------------------------------------------
test("resolveDetailWindow：四周排名后无显式指定 → 继承 rankingWindow 1..4", () => {
  assert.deepStrictEqual(
    resolveDetailWindow({ rankingWindow: { weekStart: 1, weekEnd: 4 } }),
    { weekStart: 1, weekEnd: 4 },
  );
});

test("resolveDetailWindow：「只看第一周」显式收窄为 1..1", () => {
  assert.deepStrictEqual(
    resolveDetailWindow({ rankingWindow: { weekStart: 1, weekEnd: 4 }, explicitWeek: 1 }),
    { weekStart: 1, weekEnd: 1 },
  );
});

test("resolveDetailWindow：显式范围 2..3 优先于 rankingWindow 1..4", () => {
  assert.deepStrictEqual(
    resolveDetailWindow({ rankingWindow: { weekStart: 1, weekEnd: 4 }, explicitRange: { weekStart: 2, weekEnd: 3 } }),
    { weekStart: 2, weekEnd: 3 },
  );
});

test("resolveDetailWindow：无任何窗口 → null（不猜）", () => {
  assert.strictEqual(resolveDetailWindow(), null);
  assert.strictEqual(resolveDetailWindow({}), null);
  assert.strictEqual(resolveDetailWindow({ rankingWindow: null }), null);
  assert.strictEqual(resolveDetailWindow({ rankingWindow: { weekStart: 1, weekEnd: 4 } }).weekEnd, 4);
});

test("resolveDetailWindow：显式非法输入 fail closed，不回退继承窗口", () => {
  assert.strictEqual(
    resolveDetailWindow({ rankingWindow: { weekStart: 1, weekEnd: 4 }, explicitRange: { weekStart: 4, weekEnd: 1 } }),
    null,
    "显式倒置范围必须 fail closed，不得悄悄回退为 1..4",
  );
  assert.strictEqual(
    resolveDetailWindow({ rankingWindow: { weekStart: 1, weekEnd: 4 }, explicitRange: { weekStart: 0, weekEnd: 4 } }),
    null,
    "显式越界范围必须 fail closed",
  );
  assert.strictEqual(
    resolveDetailWindow({ rankingWindow: { weekStart: 1, weekEnd: 4 }, explicitWeek: 0 }),
    null,
    "显式非法单周必须 fail closed，不得回退继承",
  );
});

// ---------------------------------------------------------------------------
// shouldUseRangeSchedule：窗口跨度决定工具形态
// ---------------------------------------------------------------------------
test("shouldUseRangeSchedule：1..4 用范围课表，1..1 用单周课表", () => {
  assert.strictEqual(shouldUseRangeSchedule({ weekStart: 1, weekEnd: 4 }), true);
  assert.strictEqual(shouldUseRangeSchedule({ weekStart: 1, weekEnd: 1 }), false);
  assert.strictEqual(shouldUseRangeSchedule({ weekStart: 2, weekEnd: 2 }), false);
  assert.strictEqual(shouldUseRangeSchedule(null), false);
  assert.strictEqual(shouldUseRangeSchedule(undefined), false);
});

// ---------------------------------------------------------------------------
// normalizeWeekRange：确定性校验
// ---------------------------------------------------------------------------
test("normalizeWeekRange：合法窗口原样返回", () => {
  assert.deepStrictEqual(normalizeWeekRange(1, 4), { ok: true, window: { weekStart: 1, weekEnd: 4 } });
  assert.deepStrictEqual(normalizeWeekRange(1, 20), { ok: true, window: { weekStart: 1, weekEnd: 20 } });
  assert.deepStrictEqual(normalizeWeekRange(3, 3), { ok: true, window: { weekStart: 3, weekEnd: 3 } });
});

test("normalizeWeekRange：非法窗口 fail closed（0..4 / 4..1 / 1..21 / 非整数）", () => {
  assert.strictEqual(normalizeWeekRange(0, 4).ok, false, "0..4 越界必须拒绝");
  assert.strictEqual(normalizeWeekRange(4, 1).ok, false, "4..1 倒置必须拒绝");
  assert.strictEqual(normalizeWeekRange(1, 21).ok, false, "1..21 越界必须拒绝");
  assert.strictEqual(normalizeWeekRange(21, 21).ok, false, "21..21 越界必须拒绝");
  assert.strictEqual(normalizeWeekRange(0, 0).ok, false, "0..0 越界必须拒绝");
  assert.strictEqual(normalizeWeekRange("1", 4).ok, false, "非整数必须拒绝");
  assert.strictEqual(normalizeWeekRange(1.5, 4).ok, false, "小数必须拒绝");
  assert.strictEqual(normalizeWeekRange(1, null).ok, false, "缺失边界必须拒绝");
  const failed = normalizeWeekRange(4, 1);
  assert.ok(failed.code && failed.message, "失败结果必须带 code 与 message");
});

// ---------------------------------------------------------------------------
// 契约：prompt / handoff / context / tool-contracts 已同步 R49.4 窗口语义
// ---------------------------------------------------------------------------
test("契约 1：Main/Insight 必须声明 rankingWindow 语义并拒绝 drilldownAcademicWeek 默认", () => {
  assert.ok(MAIN.includes("rankingWindow") && MAIN.includes("detailWindow") && MAIN.includes("windowContext"), "Main 必须携带 windowContext(rankingWindow/detailWindow)");
  assert.ok(MAIN.includes("campus_teacher_load_query") && MAIN.includes("campus_schedule_range_query"), "Main 必须认识两个 R49.4 新工具");
  assert.ok(INSIGHT.includes("campus_teacher_load_query") && INSIGHT.includes("rankingWindow"), "Insight 必须使用排名窗口负载工具");
  assert.ok(!MAIN.includes("drilldownAcademicWeek"), "Main 不得再声明 drilldownAcademicWeek 默认");
  assert.ok(!INSIGHT.includes("drilldownAcademicWeek"), "Insight 不得再声明 drilldownAcademicWeek 默认");
});

test("契约 2：Schedule 按 detailWindow 选择工具；Risk 须显式周次", () => {
  assert.ok(SCHEDULE.includes("campus_schedule_range_query") && SCHEDULE.includes("detailWindow"), "schedule-space 必须按 detailWindow 选择范围/单周工具");
  assert.ok(!SCHEDULE.includes("drilldownAcademicWeek"), "schedule-space 不得再声明 drilldownAcademicWeek 默认");
  assert.ok(!RISK.includes("drilldownAcademicWeek"), "risk-planning 不得再声明 drilldownAcademicWeek 默认");
  assert.ok(RISK.includes("澄清"), "risk-planning 未显式周次时必须澄清");
});

test("契约 3：03/04/05 已发布 R49.4 窗口与工具契约", () => {
  assert.ok(HANDOFF.includes("windowContext") && HANDOFF.includes("rankingWindow") && HANDOFF.includes("detailWindow"), "03 必须声明 windowContext");
  assert.ok(!HANDOFF.includes("drilldownAcademicWeek"), "03 不得再声明 drilldownAcademicWeek 默认");
  assert.ok(CONTEXT.includes("rankingWindow") && CONTEXT.includes("detailWindow"), "04 必须声明 rankingWindow/detailWindow 解析");
  assert.ok(!CONTEXT.includes("drilldownAcademicWeek"), "04 不得再声明 drilldownAcademicWeek");
  assert.ok(CONTRACTS.includes("campus_teacher_load_query") && CONTRACTS.includes("campus_schedule_range_query"), "05 必须登记 7 个 Agent Tool");
  assert.ok(CONTRACTS.includes("七个 Agent Tool") || CONTRACTS.includes("7 个 Agent Tool"), "05 总览必须为 7 个工具");
});