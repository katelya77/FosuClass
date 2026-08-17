"use strict";
// R49.3 / G2-D Drilldown Rank Semantics —— 确定性语义参考实现（契约真源之一）
//
// 解决的问题（2026-08-17 真人控制台 CASE D 实测）：
//  1. 教师负载并列最高时，Main 错误把「业务指标并列第一」当成「Top1 不唯一」而发起澄清。
//     契约：Top1/Top2/Top3 是「有序返回列表的 position 语义」，与指标是否并列无关。
//  2. 「未来四周」（overviewWindow.count=4）被错误继承为 campus_schedule_query 的 week=4。
//     契约：overviewWindow 是聚合窗口，永远不得作为 academicWeek；跨域下钻默认
//     drilldownAcademicWeek=1（对齐 campus_overview actions 的「查看第1周校园课表 → week=1」）。
//
// 本模块只包含纯函数，不依赖任何 Agent 运行时；测试与 Prompt 共同约束同一语义。

const RANK_ALIASES = {
  1: ["Top1", "top1", "第一名", "排第一那个", "排第一的", "最高那个", "最高的那个", "最高的一位"],
  2: ["Top2", "top2", "第二名", "排第二那个", "排第二的", "第二个"],
  3: ["Top3", "top3", "第三名", "排第三那个", "排第三的", "第三个"],
};

const MULTI_OBJECT_PATTERNS = [
  "并列第一的两个",
  "并列第一都",
  "这两位",
  "那两位",
  "两个都",
  "两位都",
  "都给我看看",
  "一起看",
  "同时看",
  "他们都",
  "它们都",
  "他们",
  "她们",
];

/**
 * 多对象请求判定（必须先于 rank 别名判定）。
 * 「并列第一的两个/他们/这两位」等 → kind="multi"，绝不压缩为 Top1。
 */
function isMultiObjectRequest(text) {
  for (const pattern of MULTI_OBJECT_PATTERNS) {
    if (text.includes(pattern)) return true;
  }
  return false;
}

/**
 * 解析排位引用。
 * 返回：
 *   { kind: "single", rank: 1|2|3 }     —— 明确单排位（position 语义，与指标并列无关）
 *   { kind: "multi",  rank: null }       —— 多对象语义，需要双对象/多对象逻辑
 *   { kind: "none",   rank: null }       —— 未识别出排位引用
 */
function resolveRank(text) {
  if (isMultiObjectRequest(text)) return { kind: "multi", rank: null };
  for (const rank of [1, 2, 3]) {
    for (const alias of RANK_ALIASES[rank]) {
      if (text.includes(alias)) return { kind: "single", rank };
    }
  }
  return { kind: "none", rank: null };
}

/**
 * 跨域下钻教学周解析。
 * overviewWindow = { kind: "future_weeks", count: 4 }（聚合窗口，只描述聚合范围）。
 * 规则：
 *   - 用户显式指定教学周 → 用显式值；
 *   - 未指定 → drilldownAcademicWeek=1（对齐 overview actions week=1 语义）；
 *   - 任何情况下都不得返回 overviewWindow.count。
 */
function resolveDrilldownWeek(overviewWindow, explicitWeek) {
  if (Number.isInteger(explicitWeek) && explicitWeek >= 1 && explicitWeek <= 20) return explicitWeek;
  if (overviewWindow && overviewWindow.kind === "future_weeks") return 1;
  return null;
}

module.exports = { RANK_ALIASES, MULTI_OBJECT_PATTERNS, isMultiObjectRequest, resolveRank, resolveDrilldownWeek };