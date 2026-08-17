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