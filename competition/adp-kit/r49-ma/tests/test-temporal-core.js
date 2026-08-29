"use strict";
// R50.0 T1/T2 — Temporal Semantic Core 契约测试
//
// 设计目标：Agent 不再靠 Prompt 猜「未来第一周是不是第1教学周/当前是否学期内」。
// 自然语言由 Agent 提取为结构化 temporal intent，最终日期/教学周/窗口全部由
// deterministic temporal-core.js 计算。
//
// 本测试验证：
//  A. 绝对日期 / 相对天 / 周内星期 / 第N周 / 第N周周X / 周窗口 / 未来N周 / 最近N周
//  B. 学期前（pre-semester）/ 学期后（post-semester）边界
//  C. 当前日期是否学期内、当前教学周
//  D. 确定性：同一 intent + 同一 referenceDate 重复调用结果一致
//  E. 不依赖 demo 当前日期：所有用例显式传入 referenceDate/baseDate

const test = require("node:test");
const assert = require("node:assert");

const temporal = require("../tools/temporal-core.js");

// 2026-2027-1 学期（与 competition-demo-v3 对齐）
const SEMESTER = {
  id: "2026-2027-1",
  startDate: "2026-08-31", // 周一
  endDate: "2027-01-17",
  totalWeeks: 20,
};

// 参考日期：2026-08-18（周一，开学前 13 天）
const PRE_DATE = "2026-08-18";
// 参考日期：2026-09-28（第 5 教学周周一，学期内）
const IN_DATE = "2026-09-28";
// 参考日期：2027-02-01（学期后）
const POST_DATE = "2027-02-01";

function resolve(intent, referenceDate) {
  return temporal.resolveTemporalIntent(intent, { referenceDate, semester: SEMESTER });
}

test("TEMP-01 绝对日期解析", () => {
  const c = resolve({ kind: "absolute", date: "2026-09-03" }, IN_DATE);
  assert.strictEqual(c.inSemester, true);
  assert.strictEqual(c.resolvedDate, "2026-09-03");
  assert.strictEqual(c.resolvedWeek, 1); // 2026-08-31 起第1周
  assert.strictEqual(c.resolutionKind, "absolute");
});

test("TEMP-02 相对天：今天/明天/后天/昨天（不依赖 demo 日期）", () => {
  const base = "2026-09-28"; // 周一
  assert.strictEqual(resolve({ kind: "relative_day", offset: 0 }, base).resolvedDate, "2026-09-28");
  assert.strictEqual(resolve({ kind: "relative_day", offset: 1 }, base).resolvedDate, "2026-09-29");
  assert.strictEqual(resolve({ kind: "relative_day", offset: 2 }, base).resolvedDate, "2026-09-30");
  assert.strictEqual(resolve({ kind: "relative_day", offset: -1 }, base).resolvedDate, "2026-09-27");
});

test("TEMP-03 周内星期：本周X/下周X/上周X", () => {
  const base = "2026-09-30"; // 周三
  // 本周三
  const w = resolve({ kind: "relative_weekday", weekday: 3, offset: 0 }, base);
  assert.strictEqual(w.resolvedDate, "2026-09-30");
  // 下周五（offset +1 周，weekday 5）
  const nw = resolve({ kind: "relative_weekday", weekday: 5, offset: 1 }, base);
  assert.strictEqual(nw.resolvedDate, "2026-10-09");
  // 上周一（offset -1 周，weekday 1）
  const pw = resolve({ kind: "relative_weekday", weekday: 1, offset: -1 }, base);
  assert.strictEqual(pw.resolvedDate, "2026-09-21");
});

test("TEMP-04 第N教学周 → 周窗口", () => {
  const c = resolve({ kind: "academic_week", week: 3 }, IN_DATE);
  assert.strictEqual(c.resolvedWeek, 3);
  assert.strictEqual(c.resolvedWeekStart, 3);
  assert.strictEqual(c.resolvedWeekEnd, 3);
  assert.strictEqual(c.inSemester, true);
});

test("TEMP-05 第N周周X → 日期", () => {
  const c = resolve({ kind: "academic_week_weekday", week: 2, weekday: 5 }, IN_DATE);
  // 第2周周五 = 2026-09-11
  assert.strictEqual(c.resolvedDate, "2026-09-11");
  assert.strictEqual(c.resolvedWeek, 2);
});

test("TEMP-06 周窗口：第N到第M周", () => {
  const c = resolve({ kind: "week_range", weekStart: 2, weekEnd: 5 }, IN_DATE);
  assert.strictEqual(c.resolvedWeekStart, 2);
  assert.strictEqual(c.resolvedWeekEnd, 5);
});

test("TEMP-07 未来N个教学周：学期内从当前教学周开始", () => {
  // referenceDate = 2026-09-28 第5周周一 → 未来3个教学周 = 5..7
  const c = resolve({ kind: "future_weeks", count: 3 }, IN_DATE);
  assert.strictEqual(c.resolvedWeekStart, 5);
  assert.strictEqual(c.resolvedWeekEnd, 7);
});

test("TEMP-08 未来N个教学周：开学前从第1周开始", () => {
  // referenceDate = 2026-08-18 开学前 → 未来4个教学周 = 1..4
  const c = resolve({ kind: "future_weeks", count: 4 }, PRE_DATE);
  assert.strictEqual(c.resolvedWeekStart, 1);
  assert.strictEqual(c.resolvedWeekEnd, 4);
  assert.strictEqual(c.inSemester, false);
});

test("TEMP-09 未来第一个教学周 = 窗口第1个有效教学周（开学前=1）", () => {
  const c = resolve({ kind: "future_weeks", count: 1 }, PRE_DATE);
  assert.strictEqual(c.resolvedWeekStart, 1);
  assert.strictEqual(c.resolvedWeekEnd, 1);
  assert.strictEqual(c.resolvedWeek, 1);
});

test("TEMP-10 未来N周超界截断（学期后段）", () => {
  // 学期内第 19 周（2027-01-10）未来 3 周 → 19..20（截断，note 标记）
  const c = resolve({ kind: "future_weeks", count: 3 }, "2027-01-10");
  assert.strictEqual(c.resolvedWeekStart, 19);
  assert.strictEqual(c.resolvedWeekEnd, 20);
  assert.ok(c.note, "超界截断应有 note");
});

test("TEMP-11 最近N个教学周：学期内", () => {
  // 第5周周一 → 最近3个教学周 = 3..5
  const c = resolve({ kind: "recent_weeks", count: 3 }, IN_DATE);
  assert.strictEqual(c.resolvedWeekStart, 3);
  assert.strictEqual(c.resolvedWeekEnd, 5);
});

test("TEMP-12 最近N个教学周：学期后", () => {
  const c = resolve({ kind: "recent_weeks", count: 3 }, POST_DATE);
  assert.strictEqual(c.resolvedWeekStart, 18);
  assert.strictEqual(c.resolvedWeekEnd, 20);
});

test("TEMP-13 最近N个教学周：开学前（无已开展教学周）", () => {
  const c = resolve({ kind: "recent_weeks", count: 3 }, PRE_DATE);
  assert.strictEqual(c.resolvedWeekStart, null);
  assert.strictEqual(c.resolvedWeekEnd, null);
  assert.strictEqual(c.resolutionKind, "pre_semester");
});

test("TEMP-14 下一教学周 / 上一教学周", () => {
  // 第5周周一 → 下一教学周 = 6；上一教学周 = 4
  const n = resolve({ kind: "next_week" }, IN_DATE);
  assert.strictEqual(n.resolvedWeek, 6);
  const p = resolve({ kind: "prev_week" }, IN_DATE);
  assert.strictEqual(p.resolvedWeek, 4);
});

test("TEMP-15 当前（current）→ 落在 referenceDate 所在教学周", () => {
  const c = resolve({ kind: "current" }, IN_DATE);
  assert.strictEqual(c.resolvedWeek, 5);
  assert.strictEqual(c.currentAcademicWeek, 5);
});

test("TEMP-16 学期后 current → inSemester=false + post_semester", () => {
  const c = resolve({ kind: "current" }, POST_DATE);
  assert.strictEqual(c.inSemester, false);
  assert.strictEqual(c.resolutionKind, "post_semester");
});

test("TEMP-17 确定性：同一输入重复调用字节一致", () => {
  const a = JSON.stringify(resolve({ kind: "future_weeks", count: 4 }, PRE_DATE));
  const b = JSON.stringify(resolve({ kind: "future_weeks", count: 4 }, PRE_DATE));
  assert.strictEqual(a, b);
});

test("TEMP-18 temporalContext 必须包含契约字段", () => {
  const c = resolve({ kind: "future_weeks", count: 2 }, IN_DATE);
  for (const key of [
    "referenceDate", "semesterId", "inSemester", "currentAcademicWeek",
    "resolvedDate", "resolvedWeek", "resolvedWeekStart", "resolvedWeekEnd", "resolutionKind",
  ]) {
    assert.ok(key in c, `缺少字段 ${key}`);
  }
  assert.strictEqual(c.semesterId, SEMESTER.id);
});

test("TEMP-19 非法 intent → fail-closed（不猜测）", () => {
  const c = resolve({ kind: "unknown_kind" }, IN_DATE);
  assert.strictEqual(c.resolutionKind, "none");
  assert.strictEqual(c.resolvedWeekStart, null);
  assert.strictEqual(c.resolvedWeekEnd, null);
});
