"use strict";

const CATEGORIES = Object.freeze(["mind", "fraud", "campus"]);
const STRATEGIES = new Set(["balanced", "sequential"]);

function normalizePolicy(input) {
  const source = input && typeof input === "object" ? input : {};
  const rawOffset = Math.floor(Number(source.rotationOffset) || 0);
  return {
    enabled: source.enabled !== false,
    strategy: STRATEGIES.has(source.strategy) ? source.strategy : "balanced",
    rotationOffset: Math.min(999999, Math.max(0, rawOffset)),
  };
}

function categoryFor(item) {
  if (item && CATEGORIES.includes(item.category)) return item.category;
  if (item && item.type === "warning") return "fraud";
  if (item && item.type === "success") return "mind";
  return "campus";
}

function stableSort(items) {
  return (Array.isArray(items) ? items : []).slice().sort((left, right) =>
    String(left && left.id || "").localeCompare(String(right && right.id || ""))
  );
}

function balancePool(items) {
  const groups = new Map(CATEGORIES.map((category) => [category, []]));
  stableSort(items).forEach((item) => groups.get(categoryFor(item)).push(item));
  const result = [];
  let index = 0;
  while (result.length < items.length) {
    CATEGORIES.forEach((category) => {
      const item = groups.get(category)[index];
      if (item) result.push(item);
    });
    index += 1;
  }
  return result;
}

function orderPool(items, strategy) {
  return strategy === "sequential" ? stableSort(items) : balancePool(items);
}

function isActiveManaged(item, now = new Date()) {
  if (!item || item.enabled !== true || item.displayMode !== "daily-tip" || !["home", "all"].includes(item.targetPage)) {
    return false;
  }
  const time = now.getTime();
  const start = item.startAt ? new Date(item.startAt).getTime() : NaN;
  const end = item.endAt ? new Date(item.endAt).getTime() : NaN;
  return !(Number.isFinite(start) && time < start) && !(Number.isFinite(end) && time > end);
}

function resolvePool({ managed, builtin, policy, now = new Date() }) {
  const normalizedPolicy = normalizePolicy(policy);
  const activeManaged = (Array.isArray(managed) ? managed : []).filter((item) => isActiveManaged(item, now));
  const source = activeManaged.length ? "managed" : "builtin";
  const base = activeManaged.length ? activeManaged : (Array.isArray(builtin) ? builtin : []);
  return {
    activeManaged,
    items: orderPool(base, normalizedPolicy.strategy),
    policy: normalizedPolicy,
    source,
  };
}

function shanghaiDateKey(now) {
  const value = now instanceof Date ? now.getTime() : Number(now);
  const timestamp = Number.isFinite(value) ? value : Date.now();
  return new Date(timestamp + (8 * 60 * 60 * 1000)).toISOString().slice(0, 10);
}

function slotForDate(dateKey, count, rotationOffset = 0) {
  const day = Math.floor(Date.parse(`${dateKey}T00:00:00Z`) / 86400000);
  const safeCount = Math.max(1, Number(count) || 1);
  return (((day + rotationOffset) % safeCount) + safeCount) % safeCount;
}

module.exports = {
  CATEGORIES,
  balancePool,
  categoryFor,
  isActiveManaged,
  normalizePolicy,
  orderPool,
  resolvePool,
  shanghaiDateKey,
  slotForDate,
};
