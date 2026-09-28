const DEFAULT_MIN_DISTANCE = 60;
const DEFAULT_DOMINANCE_RATIO = 1.25;

function normalizePoint(point) {
  const source = point || {};
  const x = Number(source.clientX);
  const y = Number(source.clientY);
  if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
  return { x, y };
}

function resolveWeekSwipeDirection(startPoint, endPoint, options) {
  const start = normalizePoint(startPoint);
  const end = normalizePoint(endPoint);
  if (!start || !end) return "";

  const config = options || {};
  const minDistance = Number(config.minDistance) || DEFAULT_MIN_DISTANCE;
  const dominanceRatio = Number(config.dominanceRatio) || DEFAULT_DOMINANCE_RATIO;
  const deltaX = end.x - start.x;
  const deltaY = end.y - start.y;
  const horizontalDistance = Math.abs(deltaX);
  const verticalDistance = Math.abs(deltaY);

  if (horizontalDistance <= minDistance) return "";
  if (horizontalDistance <= verticalDistance * dominanceRatio) return "";
  return deltaX < 0 ? "next" : "prev";
}

function resolveAdjacentWeek(currentWeek, totalWeeks, direction) {
  const total = Math.max(1, Math.floor(Number(totalWeeks) || 1));
  const current = Math.max(1, Math.min(total, Math.floor(Number(currentWeek) || 1)));
  let week = current;
  if (direction === "next") week = Math.min(total, current + 1);
  if (direction === "prev") week = Math.max(1, current - 1);
  return {
    changed: week !== current,
    week,
  };
}

module.exports = {
  DEFAULT_DOMINANCE_RATIO,
  DEFAULT_MIN_DISTANCE,
  resolveAdjacentWeek,
  resolveWeekSwipeDirection,
};
