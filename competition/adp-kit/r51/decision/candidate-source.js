"use strict";
// Campus Decision Intelligence —— 候选提取（2026-08-19）
// 只从 verified facts / toolResults 提取候选，绝不凭空造候选。
// 规范化候选：{ id, label, attributes, toolRank, evidence:{factKey,toolName,verified}, sourceIndex }

function asNum(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function makeCandidate(id, label, attributes, meta, sourceIndex, toolRank = null) {
  return {
    id: String(id),
    label: String(label == null ? "" : label),
    attributes: attributes || {},
    toolRank,
    evidence: { factKey: meta.factKey, toolName: meta.toolName, verified: meta.verified === true },
    sourceIndex,
  };
}

function itemsOf(raw) {
  return Array.isArray(raw && raw.items) ? raw.items : [];
}

function verifiedOf(raw, meta = {}) {
  if (raw && raw.evidence && Object.prototype.hasOwnProperty.call(raw.evidence, "verified")) {
    return raw.evidence.verified === true;
  }
  return meta.verified === true;
}

function verifiedItems(raw, meta) {
  return verifiedOf(raw, meta) ? itemsOf(raw) : [];
}

// 排名工具（教师负载 / 教室利用率）：items[].rank → toolRank（保留工具已有排名）
function fromRanking(raw, meta) {
  const verified = verifiedOf(raw, meta);
  return verifiedItems(raw, meta).map((item, index) => {
    const entity = item.entity || item.teacher || {};
    const attributes = Object.assign({}, item.metrics || {}, {
      rank: item.rank,
      metricRank: item.metricRank,
      type: entity.type || item.type,
      lessonOccurrences: asNum(item.lessonOccurrences),
      periodUnits: asNum(item.periodUnits),
      utilizationRate: asNum(item.utilizationRate),
      occupiedPeriodUnits: asNum(item.occupiedPeriodUnits),
      availablePeriodUnits: asNum(item.availablePeriodUnits),
      campus: item.campusName,
      building: item.building,
      capacity: asNum(item.capacity),
    });
    return makeCandidate(entity.id || item.id || `rank-${index}`, entity.name || item.name || item.label || `#${item.rank}`, attributes, { ...meta, verified }, index, asNum(item.rank));
  });
}

// 空教室 / 容量搜索：教室候选
function fromSpace(raw, meta) {
  const verified = verifiedOf(raw, meta);
  return verifiedItems(raw, meta).map((item, index) => {
    const attributes = {
      capacity: asNum(item.capacity),
      campus: item.campusName,
      building: item.building,
      type: item.type,
      roomId: item.roomId,
    };
    return makeCandidate(item.roomId || `room-${index}`, item.roomName || item.label, attributes, { ...meta, verified }, index);
  });
}

// 共同空闲：空闲时段候选
function fromAvailability(raw, meta) {
  const verified = verifiedOf(raw, meta);
  return verifiedItems(raw, meta).map((item, index) => {
    const rooms = Array.isArray(item.rooms) ? item.rooms : [];
    const maxRoomCapacity = rooms.reduce((max, r) => Math.max(max, asNum(r.capacity) || 0), 0);
    const attributes = {
      week: asNum(item.week),
      weekday: asNum(item.weekday),
      weekdayName: item.weekdayName,
      periodStart: asNum(item.periodStart),
      periodEnd: asNum(item.periodEnd),
      freePeriodCount: asNum(item.freePeriodCount),
      roomCount: asNum(item.roomCount),
      maxRoomCapacity,
    };
    const label = `${item.weekdayName || ""} ${item.periodText || ""}`.trim() || `slot-${index}`;
    return makeCandidate(`slot-${attributes.week ?? index}-${attributes.weekday ?? index}-${attributes.periodStart ?? index}-${attributes.periodEnd ?? index}`, label, attributes, { ...meta, verified }, index);
  });
}

// 群体排优方案：方案候选（保留 rank 若存在）
function fromGroupPlan(raw, meta) {
  const verified = verifiedOf(raw, meta);
  return verifiedItems(raw, meta).map((item, index) => {
    const rooms = Array.isArray(item.rooms) ? item.rooms : [];
    const maxRoomCapacity = rooms.reduce((max, room) => Math.max(max, asNum(room.capacity) || 0), 0);
    const attributes = {
      weekday: asNum(item.weekday),
      weekdayName: item.weekdayName,
      periodStart: asNum(item.periodStart),
      periodEnd: asNum(item.periodEnd),
      freePeriodCount: asNum(item.freePeriodCount),
      roomCount: asNum(item.roomCount),
      maxRoomCapacity,
      rooms,
    };
    const id = item.planId || item.id || `plan-${item.week ?? ""}-${attributes.weekday ?? index}-${attributes.periodStart ?? index}-${attributes.periodEnd ?? index}`;
    const label = item.planName || item.label || item.title || `${item.weekdayName || ""} ${item.periodText || ""}`.trim() || `方案${index + 1}`;
    return makeCandidate(id, label, attributes, { ...meta, verified }, index, asNum(item.rank));
  });
}

// 调课可行性：目标时段候选（feasible / conflictCount 折叠）
function fromReschedule(raw, meta) {
  const verified = verifiedOf(raw, meta);
  return verifiedItems(raw, meta).map((item, index) => {
    const target = item.target || {};
    const checks = item.checks || {};
    const conflictChecks = [checks.teacherConflict, checks.classConflict, checks.roomConflict];
    const conflictCount = conflictChecks.reduce((count, check) => {
      if (!check || check.conflict !== true) return count;
      return count + (Array.isArray(check.details) && check.details.length ? check.details.length : 1);
    }, 0);
    const capabilityChecks = [checks.capacity, checks.feature];
    const checksPresent = conflictChecks.every((check) => check && typeof check.conflict === "boolean")
      && capabilityChecks.every((check) => check && typeof check.ok === "boolean");
    const feasible = checksPresent
      ? conflictCount === 0 && capabilityChecks.every((check) => check.ok === true)
      : raw && raw.summary && raw.summary.feasible === true;
    const warningCount = Array.isArray(item.warnings)
      ? item.warnings.length
      : (asNum(raw && raw.summary && raw.summary.warningCount) || 0);
    const attributes = {
      week: asNum(target.week),
      weekday: asNum(target.weekday),
      weekdayName: target.weekdayName,
      periodStart: asNum(target.periodStart),
      periodEnd: asNum(target.periodEnd),
      feasible,
      conflictCount,
      warningCount,
    };
    const label = `${target.weekdayName || ""} ${target.periodText || ""}`.trim() || `target-${index}`;
    return makeCandidate(`target-${attributes.week ?? index}-${attributes.weekday ?? index}-${attributes.periodStart ?? index}-${attributes.periodEnd ?? index}`, label, attributes, { ...meta, verified }, index);
  });
}

const FACT_ADAPTORS = Object.freeze({
  rankingFacts: { tool: "campus_teacher_load_query", adapt: fromRanking },
  spaceUtilFacts: { tool: "campus_room_utilization_query", adapt: fromRanking },
  availabilityFacts: { tool: "campus_common_free_time_query", adapt: fromAvailability },
  spaceFacts: { tool: "campus_classroom_search", adapt: fromSpace },
  groupPlanFacts: { tool: "campus_group_plan", adapt: fromGroupPlan },
  rescheduleSimFacts: { tool: "campus_reschedule_feasibility", adapt: fromReschedule },
});

// 按 factKey 选择适配器并从 toolResults 提取候选；无事实/无 items → []。
function candidatesForFact(factKey, toolResults, opts = {}) {
  const def = FACT_ADAPTORS[factKey];
  if (!def) return [];
  const toolName = opts.toolName || def.tool;
  const raw = toolResults && toolResults[toolName];
  if (!raw || !Array.isArray(raw.items)) return [];
  if (!verifiedOf(raw)) return [];
  return def.adapt(raw, { factKey, toolName, verified: true });
}

module.exports = {
  makeCandidate,
  itemsOf,
  verifiedOf,
  verifiedItems,
  fromRanking,
  fromSpace,
  fromAvailability,
  fromGroupPlan,
  fromReschedule,
  FACT_ADAPTORS,
  candidatesForFact,
};
