"use strict";
// R49.3 / G2-D Drilldown Rank Semantics —— 确定性语义参考实现（契约真源之一）
//
// 解决的问题（2026-08-17 真人控制台 CASE D 实测）：
//  1. 教师负载并列最高时，Main 错误把「业务指标并列第一」当成「Top1 不唯一」而发起澄清。
//     契约：Top1/Top2/Top3 是「有序返回列表的 position 语义」，与指标是否并列无关。
//  2. 「未来四周」（overviewWindow.count=4）被错误继承为 campus_schedule_query 的 week=4。
//
// R49.4 更新：旧的「聚合窗口后下钻默认 drilldownAcademicWeek=1」语义已退役。
//     下钻时间窗口一律由显式 WindowContext 决定（tools/window-semantics.js）：
//     rankingWindow 继承为 detailWindow（「看Top1课表」→ 1..4），显式「只看第一周」→ 1..1。
//     resolveDrilldownWeek 仅保留「用户显式指定教学周」的解析，绝不猜测默认周。
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
 * 跨域下钻教学周解析（R49.4：不再提供默认周）。
 * 规则：
 *   - 用户显式指定教学周 → 用显式值；
 *   - 未显式指定 → null（fail closed，绝不猜测；下钻窗口由 window-semantics.js 的
 *     WindowContext 决定，聚合窗口 count 永远不得推导为教学周）。
 */
function resolveDrilldownWeek(overviewWindow, explicitWeek) {
  if (Number.isInteger(explicitWeek) && explicitWeek >= 1 && explicitWeek <= 20) return explicitWeek;
  return null;
}

module.exports = { RANK_ALIASES, MULTI_OBJECT_PATTERNS, isMultiObjectRequest, resolveRank, resolveDrilldownWeek };