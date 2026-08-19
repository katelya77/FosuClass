"use strict";
// R51 FreshToolCallGuard —— FreshFactPolicy
// 规则：当前用户改变任何动态查询槽位 → 必须 fresh capability execution；
// 历史结果只用于 reference/entity/temporal inheritance，不能代替新的动态 Tool query。
// 槽位清单派生自 13 个 operation 的 OpenAPI input schemas（见 preflight.loadOperationContracts）。

const { loadOperationContracts } = require("./preflight.js");

// 动态槽位 = 13 个 tool input schema 中会改变查询语义的参数（与 OpenAPI 并集一致，测试断言）
const DYNAMIC_SLOT_KEYS = Object.freeze([
  "week",
  "weekStart",
  "weekEnd",
  "weekday",
  "weekdays",
  "date",
  "dateText",
  "periodStart",
  "periodEnd",
  "campus",
  "building",
  "minCapacity",
  "entityType",
  "entityName",
  "groupBy",
  "sort",
  "topN",
  "mode",
  "secondEntityType",
  "secondEntityName",
  "sourceLessonId",
]);

function isBlank(v) {
  return v === null || v === undefined || v === "";
}

// 从 GoalSpec 抽取动态槽位快照（goal 级规范化：metric/position 等编排槽位一并纳入）
function slotSnapshotOf(goalSpec) {
  const t = (goalSpec && goalSpec.target) || {};
  const ts = (goalSpec && goalSpec.temporalScope) || {};
  const c = (goalSpec && goalSpec.constraints) || {};
  const sel = (goalSpec && goalSpec.selection) || {};
  return {
    week: ts.weekStart != null && ts.weekStart === ts.weekEnd ? ts.weekStart : undefined,
    weekStart: ts.weekStart,
    weekEnd: ts.weekEnd,
    weekday: ts.weekday,
    weekdays: ts.weekdays,
    date: ts.date,
    dateText: ts.dateText,
    periodStart: ts.periodStart,
    periodEnd: ts.periodEnd,
    campus: c.campus,
    building: c.building,
    minCapacity: c.minCapacity,
    entityType: t.entityType,
    entityName: t.name || c.entityName,
    groupBy: c.groupBy,
    sort: sel.sort,
    topN: sel.topN,
    mode: c.mode,
    secondEntityType: c.secondEntityType,
    secondEntityName: c.secondEntityName,
    sourceLessonId: c.sourceLessonId,
    metric: sel.metric,
  };
}

function providedEntries(querySlots) {
  return Object.entries(querySlots || {}).filter(([, v]) => !isBlank(v));
}

// 任一可用 verified fact 的槽位快照与请求槽位完全一致 → 可复用；否则 fresh 必填。
function freshToolRequired(querySlots, facts) {
  if (!facts || facts.length === 0) return true;
  const provided = providedEntries(querySlots);
  for (const fact of facts) {
    const slots = fact.slots || {};
    let match = true;
    for (const [k, v] of provided) {
      if (slots[k] !== v) {
        match = false;
        break;
      }
    }
    if (match) return false;
  }
  return true;
}

function isReusableFact(fact, querySlots) {
  const slots = (fact && fact.slots) || {};
  for (const [k, v] of providedEntries(querySlots)) {
    if (slots[k] !== v) return false;
  }
  return true;
}

module.exports = {
  DYNAMIC_SLOT_KEYS,
  slotSnapshotOf,
  freshToolRequired,
  isReusableFact,
  isBlank,
  _openapiSlots: (() => {
    // 惰性求值：确保 DYNAMIC_SLOT_KEYS 确实派生自 OpenAPI（供测试引用）
    const contracts = loadOperationContracts();
    return contracts;
  })(),
};