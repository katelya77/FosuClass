"use strict";

const MAX_WEEK = 20;
const MIN_WEEK = 1;

const ODD_FLAG = "(单)";
const EVEN_FLAG = "(双)";

function throwParseError(expr, detail) {
  throw new Error(`无法解析周次表达式「${expr}」：${detail}`);
}

function normalizeWeekNumber(value, expr, raw) {
  const n = Number(value);
  if (!Number.isInteger(n)) throwParseError(expr, `非法数字「${raw}」`);
  if (n < MIN_WEEK || n > MAX_WEEK) throwParseError(expr, `周次必须位于 ${MIN_WEEK}..${MAX_WEEK}`);
  return n;
}

function expandRange(start, end, step, expr, rawStart, rawEnd) {
  if (end < start) throwParseError(expr, `区间 start 不得大于 end（${rawStart}..${rawEnd}）`);
  const out = [];
  for (let w = start; w <= end; w += step) out.push(w);
  return out;
}

function parseToken(token, expr) {
  const t = token.trim();
  if (!t) throwParseError(expr, "空片段");

  const isOdd = t.includes(ODD_FLAG);
  const isEven = t.includes(EVEN_FLAG);
  const body = t.replace(ODD_FLAG, "").replace(EVEN_FLAG, "").trim();

  const rangeMatch = body.match(/^(\d+)\s*-\s*(\d+)$/);
  if (rangeMatch) {
    const start = normalizeWeekNumber(rangeMatch[1], expr, rangeMatch[1]);
    const end = normalizeWeekNumber(rangeMatch[2], expr, rangeMatch[2]);
    if (isOdd && isEven) throwParseError(expr, "单双标记互斥");
    if (isOdd) return expandRange(start, end, 2, expr, rangeMatch[1], rangeMatch[2]).filter((w) => w % 2 === 1);
    if (isEven) return expandRange(start, end, 2, expr, rangeMatch[1], rangeMatch[2]).filter((w) => w % 2 === 0);
    return expandRange(start, end, 1, expr, rangeMatch[1], rangeMatch[2]);
  }

  const singleMatch = body.match(/^(\d+)$/);
  if (singleMatch) {
    if (isOdd || isEven) throwParseError(expr, "单周不得带单双标记");
    return [normalizeWeekNumber(singleMatch[1], expr, singleMatch[1])];
  }

  throwParseError(expr, `未知片段「${t}」`);
}

/**
 * 解析中文课表周次表达式为排序去重后的周次数组（1..20）。
 * 支持：区间 "1-4周"，列表 "1,3,5周"，单双周 "1-8周(单)" / "2-8周(双)"，
 * 前缀 "第"、尾部 "周"、空白均可容忍。非法输入直接抛错（fail-closed）。
 */
function parseWeekExpression(expr) {
  if (typeof expr !== "string" || expr.trim() === "") throwParseError(String(expr), "空输入");
  const normalized = expr.replace(/第/g, "").replace(/周/g, "").trim();
  if (normalized === "") throwParseError(expr, "去除修饰后为空");

  const seen = new Set();
  const weeks = [];
  for (const token of normalized.split(",")) {
    for (const w of parseToken(token, expr)) {
      if (!seen.has(w)) {
        seen.add(w);
        weeks.push(w);
      }
    }
  }
  weeks.sort((a, b) => a - b);
  return weeks;
}

module.exports = { parseWeekExpression, MIN_WEEK, MAX_WEEK };
