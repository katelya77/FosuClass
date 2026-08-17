"use strict";
// R49.4 WindowContext Semantics —— 确定性语义参考实现（契约真源之一）
//
// 解决的问题（2026-08-17 真人控制台 CASE D 实测 + R49.4 评审）：
//  1. R49.3 的「聚合窗口后下钻默认 week=1」语义退役。callers 必须携带显式
//     WindowContext：rankingWindow（排名/聚合窗口）与 detailWindow（下钻窗口）。
//  2. 「未来四周教师负载最高是谁」→ rankingWindow={weekStart:1,weekEnd:4}。
//  3. 「看Top1课表」→ 继承 rankingWindow 为 detailWindow 1..4（不得默认 week=1，
//     不得误成 week=4）。
//  4. 「只看第一周」→ detailWindow=1..1（显式收窄，fresh tool call）。
//  5. 多周排名后「检查Top1风险」未指定时间 → 不得自动 week=1（当前 risk 无范围
//     工具，Main 必须澄清时间窗口）。
//
// 本模块只包含纯函数，不依赖任何 Agent 运行时；测试与 Prompt 共同约束同一语义。

const TOTAL_WEEKS = 20;

/**
 * 规范化周范围（确定性校验）。
 * 返回 { ok:true, window:{weekStart,weekEnd} } 或 { ok:false, code, message }。
 * 校验规则：均为整数；均在 1..totalWeeks；weekStart <= weekEnd。
 */
function normalizeWeekRange(weekStart, weekEnd, totalWeeks = TOTAL_WEEKS) {
  if (!Number.isInteger(weekStart) || !Number.isInteger(weekEnd)) {
    return { ok: false, code: "INVALID_WEEK", message: "weekStart/weekEnd 必须是整数" };
  }
  if (weekStart < 1 || weekEnd < 1 || weekStart > totalWeeks || weekEnd > totalWeeks) {
    return { ok: false, code: "OUT_OF_RANGE", message: `周次必须在 1..${totalWeeks} 之间` };
  }
  if (weekEnd < weekStart) {
    return { ok: false, code: "REVERSED_RANGE", message: "weekEnd 不得小于 weekStart" };
  }
  return { ok: true, window: { weekStart, weekEnd } };
}

/**
 * 解析下钻时间窗口。优先级固定：explicitRange > explicitWeek > rankingWindow > null。
 *
 *  - rankingWindow = { weekStart, weekEnd }：排名/聚合窗口，可被继承为 detailWindow；
 *  - explicitWeek   = 1..20：用户显式单周（「只看第一周」→ {1,1}）；
 *  - explicitRange  = { weekStart, weekEnd }：用户显式范围（优先于单周与继承）。
 *
 * 显式输入非法（越界/倒置/0）时 fail closed 返回 null，绝不回退到继承窗口：
 * 用户显式给出的窗口不可解析时，宁可要求澄清，也不悄悄换成另一个窗口。
 */
function resolveDetailWindow({ rankingWindow = null, explicitWeek = null, explicitRange = null } = {}) {
  if (explicitRange != null) {
    const normalized = normalizeWeekRange(explicitRange.weekStart, explicitRange.weekEnd);
    if (normalized.ok) return normalized.window;
    return null;
  }
  if (Number.isInteger(explicitWeek) && explicitWeek >= 1 && explicitWeek <= TOTAL_WEEKS) {
    return { weekStart: explicitWeek, weekEnd: explicitWeek };
  }
  if (explicitWeek != null) return null; // 显式但非法的单周 → fail closed
  if (rankingWindow != null) {
    const normalized = normalizeWeekRange(rankingWindow.weekStart, rankingWindow.weekEnd);
    if (normalized.ok) return normalized.window;
  }
  return null;
}

/**
 * 是否需要范围课表工具：窗口跨度 > 1 周（1..4 → true；1..1 → false）。
 */
function shouldUseRangeSchedule(window) {
  return Boolean(window && window.weekStart !== window.weekEnd);
}

module.exports = { normalizeWeekRange, resolveDetailWindow, shouldUseRangeSchedule };