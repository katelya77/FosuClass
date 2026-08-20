"use strict";
// Campus Decision Intelligence —— ConstraintProfile（2026-08-19）
// 只读结构化约束，绝不读取原始 query。三类约束：
//   hard       必须满足（违反 → infeasible，绝不静默放宽）
//   soft       偏好（产生可解释差异，违反不淘汰）
//   exclusions 必须排除（命中 → infeasible）
const HARD_OPS = Object.freeze(["eq", "neq", "gte", "lte", "in", "nin"]);
const SOFT_DIRECTIONS = Object.freeze(["asc", "desc", "prefer-value", "prefer-set"]);
const EXCLUSION_OPS = Object.freeze(["eq", "in"]);

function isNonEmptyString(v) {
  return typeof v === "string" && v.length > 0;
}

function isFiniteNumber(v) {
  return typeof v === "number" && Number.isFinite(v);
}

function isConstraintScalar(v) {
  return (typeof v === "string" && v.length > 0)
    || isFiniteNumber(v)
    || typeof v === "boolean";
}

function validateEntry(entry, kind) {
  if (!entry || typeof entry !== "object" || Array.isArray(entry)) return `${kind} 条目必须是对象`;
  if (!isNonEmptyString(entry.id)) return `${kind} 条目缺少 id`;
  if (!isNonEmptyString(entry.field)) return `${kind} ${entry.id} 缺少 field`;
  if (kind === "hard") {
    if (!HARD_OPS.includes(entry.op)) return `hard ${entry.id} 非法 op：${entry.op}`;
    if (entry.value === undefined) return `hard ${entry.id} 缺少 value`;
    if ((entry.op === "gte" || entry.op === "lte") && !isFiniteNumber(entry.value)) {
      return `hard ${entry.id} op=${entry.op} value 必须为有限数`;
    }
    if ((entry.op === "in" || entry.op === "nin") && (!Array.isArray(entry.value) || entry.value.length === 0 || !entry.value.every(isConstraintScalar))) {
      return `hard ${entry.id} op=${entry.op} value 必须为非空数组`;
    }
  } else if (kind === "exclusions") {
    if (!EXCLUSION_OPS.includes(entry.op)) return `exclusions ${entry.id} 非法 op：${entry.op}`;
    if (entry.value === undefined) return `exclusions ${entry.id} 缺少 value`;
    if (entry.op === "in" && (!Array.isArray(entry.value) || entry.value.length === 0 || !entry.value.every(isConstraintScalar))) {
      return `exclusions ${entry.id} op=in value 必须为非空数组`;
    }
  } else if (kind === "soft") {
    if (!isFiniteNumber(entry.weight) || entry.weight <= 0) return `soft ${entry.id} weight 必须为正有限数`;
    if (!SOFT_DIRECTIONS.includes(entry.direction)) return `soft ${entry.id} 非法 direction：${entry.direction}`;
    if (entry.direction === "prefer-value" && entry.value === undefined) return `soft ${entry.id} prefer-value 需要 value`;
    if (entry.direction === "prefer-set" && (!Array.isArray(entry.value) || entry.value.length === 0)) {
      return `soft ${entry.id} prefer-set 需要非空 value 数组`;
    }
  }
  return null;
}

function normalizeProfile(raw) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return { profile: null, errors: ["profile 必须是对象"] };
  }
  const out = { hard: [], soft: [], exclusions: [] };
  const errors = [];
  for (const kind of ["hard", "soft", "exclusions"]) {
    const list = raw[kind];
    if (list === undefined) continue;
    if (!Array.isArray(list)) {
      errors.push(`${kind} 必须是数组`);
      continue;
    }
    for (const entry of list) {
      const err = validateEntry(entry, kind);
      if (err) errors.push(err);
      else out[kind].push(entry);
    }
  }
  if (errors.length) return { profile: null, errors };
  return { profile: out, errors: [] };
}

function validateProfile(profile) {
  if (!profile || typeof profile !== "object" || Array.isArray(profile)) {
    return { ok: false, errors: ["profile 必须是对象"] };
  }
  const errors = [];
  for (const kind of ["hard", "soft", "exclusions"]) {
    if (!Array.isArray(profile[kind])) {
      errors.push(`${kind} 必须是数组`);
      continue;
    }
    for (const entry of profile[kind]) {
      const err = validateEntry(entry, kind);
      if (err) errors.push(err);
    }
  }
  return { ok: errors.length === 0, errors };
}

function isPresent(v) {
  return v !== undefined && v !== null && v !== "";
}

function toFiniteNumber(v) {
  if (isFiniteNumber(v)) return v;
  // 只接受规范数值字符串；禁止 Number() 将 true、[]、空白等伪装成硬约束值。
  if (typeof v !== "string" || v.length === 0 || v.trim() !== v) return null;
  const n = Number(v);
  return Number.isFinite(n) && String(n) === v ? n : null;
}

// goalSpec.constraints / preferences → ConstraintProfile（确定性，不注入默认值）。
function profileFromGoalSpec(goalSpec) {
  const c = (goalSpec && goalSpec.constraints) || {};
  const p = (goalSpec && goalSpec.preferences) || {};
  const hard = [];
  const soft = [];
  const exclusions = [];

  const addHard = (id, field, op, value, description) => {
    if (isPresent(value)) hard.push({ id, field, op, value, description });
  };
  const addNumericHard = (id, field, op, value, description) => {
    const numericValue = toFiniteNumber(value);
    // 保留无效的、但确实提供过的值，让 profile 校验在评估前 fail-closed；
    // 绝不能因无法转换就悄悄移除硬约束。
    addHard(id, field, op, numericValue === null ? value : numericValue, description);
  };

  if (isPresent(c.minCapacity)) addNumericHard("capacity-min", "capacity", "gte", c.minCapacity, "容量下限");
  if (isPresent(c.campus)) addHard("campus-eq", "campus", "eq", String(c.campus), "校区要求");
  if (isPresent(c.building)) addHard("building-eq", "building", "eq", String(c.building), "楼栋要求");
  if (Array.isArray(c.excludeBuilding)) {
    if (c.excludeBuilding.length) {
      const canonical = c.excludeBuilding.every((value) => typeof value === "string" && value.length > 0 && value.trim() === value)
        ? c.excludeBuilding.slice()
        : c.excludeBuilding;
      addHard("exclude-building", "building", "nin", canonical, "排除楼栋");
    }
  } else if (isPresent(c.excludeBuilding)) {
    const canonical = typeof c.excludeBuilding === "string"
      && c.excludeBuilding.length > 0
      && c.excludeBuilding.trim() === c.excludeBuilding
      ? [c.excludeBuilding]
      : c.excludeBuilding;
    addHard("exclude-building", "building", "nin", canonical, "排除楼栋");
  }

  if (p.preferEarlier === true) soft.push({ id: "prefer-earlier", field: "periodStart", weight: 1, direction: "asc", description: "更早时段优先" });
  if (p.preferLarger === true) soft.push({ id: "prefer-larger", field: "capacity", weight: 1, direction: "desc", description: "更大容量优先" });
  if (p.preferSameCampus === true && isPresent(c.campus)) {
    soft.push({ id: "prefer-same-campus", field: "campus", weight: 1, direction: "prefer-value", value: String(c.campus), description: "同校区优先" });
  }
  if (Array.isArray(p.preferWeekdays) && p.preferWeekdays.length) {
    const weekdays = p.preferWeekdays.map(toFiniteNumber).filter(Number.isFinite);
    if (weekdays.length) {
      soft.push({ id: "prefer-weekdays", field: "weekday", weight: 1, direction: "prefer-set", value: weekdays, description: "优先星期" });
    }
  }

  return { hard, soft, exclusions };
}

module.exports = {
  HARD_OPS,
  SOFT_DIRECTIONS,
  EXCLUSION_OPS,
  validateEntry,
  normalizeProfile,
  validateProfile,
  profileFromGoalSpec,
};
