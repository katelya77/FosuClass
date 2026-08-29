"use strict";
// R50.0 Generic Context Model —— 统一内部上下文（契约真源）
//
// 设计目标（见 r50/R50.0-SEMANTIC-CORE-DESIGN.md §2）：
//  - 统一内部 Context，不围绕 Top1 单独设计整个架构：
//      context = { intentContext, entityContext, temporalContext,
//                  rankingContext, comparisonContext, taskContext }
//  - entityContext   ：当前明确/继承实体。
//  - temporalContext ：由统一时间语义层解析（temporal-core.js）。
//  - rankingContext  ：仅在当前/历史任务真正产生排序结果时存在（下钻「看Top1课表」沿用）。
//  - comparisonContext：只有显式比较任务需要。
//  - taskContext     ：跟踪复合请求仍未完成的子任务。
//
// 跨域继承原则：
//  - FOLLOW_UP（同 domain）：只继承当前任务完成所必需的信息（实体/时间/排序/比较/子任务）。
//  - NEW_TASK（跨 domain）：domain-local 临时状态自动 drop（实体、时间、排序、比较、
//    子任务全部重置为默认，绝不污染不相关新任务）。
//  - 用户当前明确表达（explicitEntity / explicitWeek / ranking / comparison / task）
//    永远覆盖继承值。
//  - 不新增针对单一 Case 的特殊字段。

const DEFAULT_ENTITY = () => ({ activeEntity: null, pendingCandidates: [] });
const DEFAULT_TEMPORAL = () => ({});
const DEFAULT_TASK = () => ({});

/**
 * 构造统一 Context。
 *
 * @param {object} opts
 *   previous        {object|null} 上一轮 context（用于 FOLLOW_UP 继承 / NEW_TASK 重置）。
 *   domain          {string}      当前业务域（schedule/risk/insight/classroom/...）。
 *   explicitEntity  {object|null} 用户当前明确实体 { type, name, ... }（覆盖继承）。
 *   explicitWeek    {number|null} 用户当前明确教学周（覆盖继承 temporal）。
 *   ranking         {object|null} 当前真正产生的排序结果上下文。
 *   comparison      {object|null} 显式比较任务上下文。
 *   task            {object|null} 复合请求子任务跟踪上下文。
 * @returns {object} context 六段完整契约字段。
 */
function buildContext({
  previous = null,
  domain = "general",
  explicitEntity = null,
  explicitWeek = null,
  ranking = null,
  comparison = null,
  task = null,
} = {}) {
  const prevIntent = previous && previous.intentContext ? previous.intentContext : null;
  const sameDomain = Boolean(prevIntent && domain && prevIntent.domain === domain);

  const intentContext = { domain, mode: sameDomain ? "follow_up" : "new_task" };

  // entityContext：用户显式 → 覆盖；同域 FOLLOW_UP → 继承必需实体；否则重置。
  let entityContext;
  if (explicitEntity) {
    entityContext = { activeEntity: explicitEntity, pendingCandidates: [], explicit: true };
  } else if (sameDomain && previous.entityContext) {
    entityContext = {
      activeEntity: previous.entityContext.activeEntity ?? null,
      pendingCandidates: Array.isArray(previous.entityContext.pendingCandidates)
        ? previous.entityContext.pendingCandidates
        : [],
    };
  } else {
    entityContext = DEFAULT_ENTITY();
  }

  // temporalContext：用户显式教学周 → 覆盖（单周窗口）；同域 FOLLOW_UP → 继承；否则重置。
  let temporalContext;
  if (Number.isInteger(explicitWeek)) {
    temporalContext = {
      resolvedWeek: explicitWeek,
      resolvedWeekStart: explicitWeek,
      resolvedWeekEnd: explicitWeek,
      explicit: true,
    };
  } else if (sameDomain && previous.temporalContext && previous.temporalContext.resolvedWeek != null) {
    temporalContext = { ...previous.temporalContext };
  } else {
    temporalContext = DEFAULT_TEMPORAL();
  }

  // rankingContext：仅真正产生排序结果时存在；同域下钻沿用历史；否则 null。
  let rankingContext;
  if (ranking) {
    rankingContext = { ...ranking };
  } else if (sameDomain && previous.rankingContext) {
    rankingContext = { ...previous.rankingContext };
  } else {
    rankingContext = null;
  }

  // comparisonContext：仅显式比较任务需要；同域沿用；否则 null。
  let comparisonContext;
  if (comparison) {
    comparisonContext = { ...comparison };
  } else if (sameDomain && previous.comparisonContext) {
    comparisonContext = { ...previous.comparisonContext };
  } else {
    comparisonContext = null;
  }

  // taskContext：显式子任务跟踪 → 采用；同域沿用；否则重置（跨域 domain-local 不残留）。
  let taskContext;
  if (task) {
    taskContext = { ...task };
  } else if (sameDomain && previous.taskContext) {
    taskContext = { ...previous.taskContext };
  } else {
    taskContext = DEFAULT_TASK();
  }

  return { intentContext, entityContext, temporalContext, rankingContext, comparisonContext, taskContext };
}

module.exports = { buildContext };
