"use strict";
// R50.0 Ranking Semantic Core —— 通用排名确定性机制（契约真源）
//
// 设计目标（见 r50/R50.0-SEMANTIC-CORE-DESIGN.md §3）：
//  - 排名规则抽象为通用机制，区分 metric semantics 与 position semantics。
//  - metric semantics：「最高/最低/最忙/最空闲/利用率最高」= 指标查询 → 按指标值排序。
//  - position semantics：Top1/第一名/排第一 = 有序列表的稳定位置，不因 metric tie 失效。
//  - 业务指标并列必须保留 tie metadata（tieGroupId/tieGroupSize/tiedWithPrevious），
//    同时仍具 deterministic position（rank 始终唯一 1..N）。
//  - 不只针对教师：teacher load / room utilization / campus load / building utilization
//    全部复用同一模型（entity.type 任意，如 teacher/room/building/campus）。
//
// 字段语义：
//  - rank            ：position 语义，1..N 唯一递增，永不因并列失效。
//  - metricRank      ：metric 语义，competition ranking（并列同档），业务指标同一级别
//                      共享相同 metricRank（例 30/30/30 → 1,1,1；27/27/20 → 1,1,3）。
//  - tiedWithPrevious：是否与排序中前一项业务指标完全并列。
//  - tieGroupId      ：并列组标识；单元素组为 null（无并列）。
//  - tieGroupSize    ：并列组内实体数；单元素组为 1。
//  - entity          ：{ id, name, type }，type 支持任意实体类型。
//  - metrics         ：请求指标的取值快照 { metric: value }。
//  - data            ：原样行透传（额外业务字段，如 utilization detail / lesson 聚合明细）。
//
// 排序规则（deterministic）：
//  1) 主键：请求的 metrics 依次比较（direction=desc 默认高→低，asc 低→高）。
//  2) 次键：tieBreak 字段（默认 ["name"]，zh-CN 码元序稳定）。
//  3) 末键：原始输入索引（稳定排序兜底，保证同输入字节一致）。
//  空值统一排末尾（不参与排序方向）。

const DEFAULT_METRICS = [];
const DEFAULT_TIE_BREAK = ["name"];

/** 码元序字符串比较（跨环境确定性，不依赖 locale 引擎）。 */
function strCmp(a, b) {
  const sa = a === undefined || a === null ? "" : String(a);
  const sb = b === undefined || b === null ? "" : String(b);
  if (sa < sb) return -1;
  if (sa > sb) return 1;
  return 0;
}

/**
 * 指标比较：数值按差比较；非数值回退码元序；空值（null/undefined）统一排末尾。
 * direction=desc 时高值在前，asc 时低值在前（空值恒在末尾，不参与方向翻转）。
 */
function cmpMetric(a, b, direction) {
  const va = a === undefined || a === null ? null : a;
  const vb = b === undefined || b === null ? null : b;
  if (va === null && vb === null) return 0;
  if (va === null) return 1;
  if (vb === null) return -1;
  let diff;
  if (typeof va === "number" && typeof vb === "number") {
    diff = va - vb;
  } else {
    diff = strCmp(va, vb);
  }
  return direction === "asc" ? diff : -diff;
}

/**
 * 构造通用 RankingResult。
 *
 * @param {Array<object>} rows 实体行，每行至少含 id/name/type 与指标字段。
 * @param {object} opts
 *   metrics   {string[]}  参与排序的指标字段（决定 metric 并列判定）。
 *   tieBreak  {string[]}  指标并列时的稳定次键（默认 ["name"]）。
 *   direction {string}    "desc"（默认，高→低）| "asc"（低→高）。
 * @returns {{ items: Array<{rank, metricRank, tiedWithPrevious, tieGroupId, tieGroupSize, entity, metrics}> }}
 */
function buildRankingResult(rows, opts = {}) {
  const metrics = Array.isArray(opts.metrics) && opts.metrics.length ? opts.metrics : DEFAULT_METRICS;
  const tieBreak = Array.isArray(opts.tieBreak) && opts.tieBreak.length ? opts.tieBreak : DEFAULT_TIE_BREAK;
  const direction = opts.direction === "asc" ? "asc" : "desc";
  const input = Array.isArray(rows) ? rows : [];

  // 1) 预展开（metric 元组 + 原始行），保持原始索引用于稳定兜底
  const prepared = input.map((row, index) => ({
    index,
    row,
    tuple: JSON.stringify(metrics.map((m) => (row[m] === undefined ? null : row[m]))),
  }));

  // 2) 稳定排序：主键 metrics（direction）→ 次键 tieBreak → 末键原始索引
  prepared.sort((a, b) => {
    for (const m of metrics) {
      const c = cmpMetric(a.row[m], b.row[m], direction);
      if (c !== 0) return c;
    }
    for (const key of tieBreak) {
      const c = strCmp(a.row[key], b.row[key]);
      if (c !== 0) return c;
    }
    return a.index - b.index;
  });

  // 3) 按指标元组划分并列组（competition ranking）
  const items = [];
  let nextMetricRank = 1;
  let groupStart = 0;
  for (let i = 0; i <= prepared.length; i++) {
    const boundary = i === prepared.length || prepared[i].tuple !== prepared[groupStart].tuple;
    if (!boundary) continue;
    const size = i - groupStart;
    for (let j = groupStart; j < i; j++) {
      const p = prepared[j];
      const metricValues = {};
      for (const m of metrics) metricValues[m] = p.row[m] === undefined ? null : p.row[m];
      items.push({
        rank: j + 1, // position 语义：唯一 1..N
        metricRank: nextMetricRank, // metric 语义：competition ranking，并列同档
        tiedWithPrevious: j > groupStart,
        tieGroupId: size > 1 ? `tie:${groupStart}` : null,
        tieGroupSize: size,
        entity: { id: p.row.id, name: p.row.name, type: p.row.type },
        metrics: metricValues,
        data: p.row, // 原样行透传（额外业务字段）
      });
    }
    nextMetricRank += size;
    groupStart = i;
  }

  return { items };
}

module.exports = { buildRankingResult };
