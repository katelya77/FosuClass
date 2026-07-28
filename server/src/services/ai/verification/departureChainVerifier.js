/**
 * Departure-chain cross verifier (M2-T3).
 *
 * Cross-checks the chained goal "我下一节课在哪，什么时候该出发？"
 * (manifest intent/goal `course_action_advice`): the schedule-side tool result
 * (get_next_course / get_today_courses / get_tomorrow_courses) and the
 * route/departure tool result (get_course_route) must tell one consistent
 * story. Per-tool policies (toolResultVerifier) check each result in
 * isolation; this verifier checks the chain BETWEEN the two results.
 *
 * verifyDepartureChain({ toolResults, intent, goalContract }) →
 *   { status: "verified" | "partial" | "failed" | "skipped",
 *     ok: boolean,
 *     violations: [{ code, detail, field? }],
 *     approximateFlags: [{ field, label }] }
 *
 * Rules (violation codes):
 *   ① CHAIN_NEXT_COURSE_MISSING  (hard) schedule side found a next course
 *   ② CHAIN_CLASSROOM_MISSING    (soft) target course classroom is non-empty
 *   ③ CHAIN_START_TIME_MISMATCH  (hard) route startTime == schedule course start
 *   ④ CHAIN_DESTINATION_MISMATCH (hard) route destination ~ course classroom
 *   ⑤ CHAIN_DEPARTURE_NOT_EARLIER(soft) departureTime strictly before course start
 *   ⑥ (approximate flag, advisory) departure time derived from a generic
 *      buffer (preciseRouteAvailable !== true) must be surfaced with a Chinese
 *      "非精确导航" label; never changes the status.
 *
 * Hard violations ⇒ failed; soft-only ⇒ partial; none ⇒ verified.
 * ok === (status !== "failed").
 *
 * The chain is only evaluated when BOTH sides are usable; anything missing
 * (not a chain goal, one side absent, upstream-failed, needContext legal
 * empty, or perTool empty_accepted/failed) yields "skipped" — the chain
 * verifier never fabricates violations on incomplete evidence (不误报).
 *
 * A tool result is chain-usable when: the tool call did not fail upstream,
 * result.success === true, result.needContext !== true, and — when the caller
 * passes perToolStatus (coordinator wiring) — the per-tool verdict was
 * "verified" or "partial" (empty_accepted is a legal empty state without
 * chain content; failed must not be re-punished by the chain layer).
 *
 * Violation details reference rule/field names only — never raw schedule,
 * place or time values (脱敏边界). Pure and defensive: never mutates inputs,
 * never throws on malformed input.
 */

// Departure-chain goals (manifest intents keys, see goalContractV2 GOAL_IDS).
const CHAIN_GOAL_IDS = Object.freeze(["course_action_advice"]);

// Schedule-side tools, in selection priority order (mirrors the real
// course_action_advice flow: next-course first, day lists as fallback).
const SCHEDULE_TOOL_IDS = Object.freeze([
  "get_next_course",
  "get_today_courses",
  "get_tomorrow_courses",
]);

const ROUTE_TOOL_ID = "get_course_route";

// Label used for the folded violations / kernel errors in the coordinator.
const CHAIN_TOOL_LABEL = "departure_chain";

// ⑥ advisory label (Chinese, per manifest partialCompletionPolicy note:
// "缺少精确定位时仍返回通用缓冲建议，但必须标注近似。").
const APPROXIMATE_DEPARTURE_FLAG = Object.freeze({
  field: "departureTime",
  label: "建议出发时间基于通用缓冲估算，非精确导航耗时",
});

const TIME_VALUE_RE = /^([01]?\d|2[0-3]):[0-5]\d(?::[0-5]\d)?$/;
const TIME_SEARCH_RE = /([01]?\d|2[0-3]):[0-5]\d/;
// Same building-code convention as campusMapService.extractBuildingCode.
const BUILDING_CODE_RE = /\b([A-Z]\d{1,2})(?:[-\s]?\d{0,4})?/i;

function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function safeText(value) {
  return typeof value === "string" ? value.trim() : "";
}

/** Minutes-of-day for a valid HH:MM(:SS) string, else null. */
function timeToMinutes(value) {
  const text = safeText(value);
  if (!TIME_VALUE_RE.test(text)) return null;
  const parts = text.split(":").map(Number);
  return parts[0] * 60 + parts[1];
}

/**
 * Course start time: prefer an explicit startTime field, else the first
 * HH:MM inside timeText ("10:00-11:40" → "10:00"), mirroring
 * scheduleAnalysisService.buildDepartureAdvice.
 */
function courseStartMinutes(course) {
  const direct = timeToMinutes(course.startTime);
  if (direct !== null) return direct;
  const match = safeText(course.timeText).match(TIME_SEARCH_RE);
  return match ? timeToMinutes(match[0]) : null;
}

/** Whitespace-insensitive, case-insensitive place key (现有 trim 惯例的延伸). */
function normalizePlaceName(value) {
  return safeText(value).replace(/\s+/g, "").toLowerCase();
}

function buildingCode(value) {
  const match = safeText(value).match(BUILDING_CODE_RE);
  return match ? match[1].toUpperCase() : "";
}

/**
 * Place tolerance, kept simple per existing conventions (campusMapService):
 * exact normalized equality, shared building code (C5-201 ~ 仙溪C5-201), or
 * containment of one normalized name in the other (≥2 chars to stay sane).
 */
function placesMatch(left, right) {
  const a = normalizePlaceName(left);
  const b = normalizePlaceName(right);
  if (!a || !b) return false;
  if (a === b) return true;
  const codeA = buildingCode(left);
  const codeB = buildingCode(right);
  if (codeA && codeB && codeA === codeB) return true;
  const shorter = a.length <= b.length ? a : b;
  const longer = a.length <= b.length ? b : a;
  return shorter.length >= 2 && longer.indexOf(shorter) >= 0;
}

/** goalContract may be V2 ({ goalId }) or legacy V1 ({ goal }). */
function isDepartureChainGoal(intent, goalContract) {
  const contract = isPlainObject(goalContract) ? goalContract : {};
  const goalId = safeText(contract.goalId) || safeText(contract.goal);
  if (goalId && CHAIN_GOAL_IDS.includes(goalId)) return true;
  const intentName = isPlainObject(intent) ? safeText(intent.name) : "";
  return Boolean(intentName) && CHAIN_GOAL_IDS.includes(intentName);
}

/**
 * A collected tool result ({ toolId, status, result, perToolStatus? }) is
 * chain-usable only when it carries verifiable content.
 */
function isChainUsable(item) {
  if (!isPlainObject(item) || item.status === "failed") return false;
  const result = item.result;
  if (!isPlainObject(result) || result.success !== true) return false;
  if (result.needContext === true) return false; // tool-declared legal empty
  if (item.perToolStatus !== undefined) {
    return item.perToolStatus === "verified" || item.perToolStatus === "partial";
  }
  return true;
}

function pickToolResult(toolResults, toolId) {
  return asArray(toolResults).find((item) => isPlainObject(item) && item.toolId === toolId) || null;
}

/**
 * Pick the schedule side of the chain. Real flows run exactly one schedule
 * tool; when several are present prefer the one whose date matches the route
 * result date (getCourseRoute copies the schedule date into its advice),
 * else fall back to SCHEDULE_TOOL_IDS priority order.
 */
function pickScheduleResult(toolResults, routeResult) {
  const candidates = SCHEDULE_TOOL_IDS
    .map((toolId) => pickToolResult(toolResults, toolId))
    .filter((item) => isChainUsable(item));
  if (!candidates.length) return null;
  const routeDate = safeText(routeResult.date);
  if (routeDate) {
    const dated = candidates.find((item) => safeText(item.result.date) === routeDate);
    if (dated) return dated;
  }
  return candidates[0];
}

/** Target course, mirroring toolRegistry.getCourseRoute's own selection. */
function pickTargetCourse(scheduleResult) {
  if (isPlainObject(scheduleResult.nextCourse)) return scheduleResult.nextCourse;
  return asArray(scheduleResult.courses).find(isPlainObject) || null;
}

function skippedOutcome() {
  return { status: "skipped", ok: true, violations: [], approximateFlags: [] };
}

function violation(code, field, detail, hard) {
  return { code, field, detail: `departure_chain: ${detail}`, hard };
}

/**
 * Cross-verify the departure chain. Never throws; never mutates inputs.
 * @param {{ toolResults?: Array, intent?: object, goalContract?: object }} input
 */
function verifyDepartureChain(input = {}) {
  const source = isPlainObject(input) ? input : {};
  if (!isDepartureChainGoal(source.intent, source.goalContract)) return skippedOutcome();

  const toolResults = asArray(source.toolResults);
  const routeItem = pickToolResult(toolResults, ROUTE_TOOL_ID);
  if (!isChainUsable(routeItem)) return skippedOutcome();
  const route = routeItem.result;
  const scheduleItem = pickScheduleResult(toolResults, route);
  if (!scheduleItem) return skippedOutcome();
  const schedule = scheduleItem.result;

  const violations = [];
  const approximateFlags = [];

  // ⑥ Advisory: generic-buffer departure advice must be labelled as such.
  // Independent of the course-side checks; never affects the status.
  if (route.preciseRouteAvailable !== true) {
    approximateFlags.push({ field: APPROXIMATE_DEPARTURE_FLAG.field, label: APPROXIMATE_DEPARTURE_FLAG.label });
  }

  // ① The schedule side must actually yield a next course for the chain.
  const course = pickTargetCourse(schedule);
  if (!course) {
    violations.push(violation(
      "CHAIN_NEXT_COURSE_MISSING",
      "nextCourse",
      "schedule result carries no next course while the route result claims one",
      true
    ));
    return buildOutcome(violations, approximateFlags);
  }

  // ② The "在哪" half of the goal needs a usable classroom on the course.
  const courseClassroom = safeText(course.classroom) || safeText(course.roomName);
  if (!courseClassroom) {
    violations.push(violation(
      "CHAIN_CLASSROOM_MISSING",
      "classroom",
      "target course classroom is missing or empty",
      false
    ));
  }

  // ③ Route startTime must be the schedule course's start time. Only
  // evaluated when both sides parse — unparseable/missing time fields are the
  // per-tool layer's job, the chain must not double-report them.
  const courseStart = courseStartMinutes(course);
  const routeStart = timeToMinutes(route.startTime);
  if (courseStart !== null && routeStart !== null && courseStart !== routeStart) {
    violations.push(violation(
      "CHAIN_START_TIME_MISMATCH",
      "startTime",
      "route startTime does not match the schedule course start time",
      true
    ));
  }

  // ④ Route destination must match the course place. Only meaningful when the
  // course names a place (② otherwise); a route without any destination, or a
  // destination that does not match, breaks the chain.
  if (courseClassroom) {
    const routeDestination = safeText(route.classroom);
    if (!routeDestination || !placesMatch(routeDestination, courseClassroom)) {
      violations.push(violation(
        "CHAIN_DESTINATION_MISMATCH",
        "classroom",
        "route destination does not match the course classroom",
        true
      ));
    }
  }

  // ⑤ The suggested departure must be strictly earlier than the class start
  // (课表上课时间为准, route startTime as fallback). Equality is tolerated by
  // the per-tool timeOrder but leaves zero walking buffer, hence soft.
  const departure = timeToMinutes(route.departureTime);
  const classStart = courseStart !== null ? courseStart : routeStart;
  if (departure !== null && classStart !== null && departure >= classStart) {
    violations.push(violation(
      "CHAIN_DEPARTURE_NOT_EARLIER",
      "departureTime",
      "suggested departureTime is not earlier than the course start time",
      false
    ));
  }

  return buildOutcome(violations, approximateFlags);
}

function buildOutcome(violations, approximateFlags) {
  const hasHard = violations.some((item) => item.hard);
  const status = violations.length ? (hasHard ? "failed" : "partial") : "verified";
  return {
    status,
    ok: status !== "failed",
    violations: violations.map((item) => {
      const output = { code: item.code, detail: item.detail };
      if (item.field !== undefined) output.field = item.field;
      return output;
    }),
    approximateFlags: approximateFlags.map((flag) => ({ field: flag.field, label: flag.label })),
  };
}

module.exports = {
  CHAIN_GOAL_IDS,
  CHAIN_TOOL_LABEL,
  ROUTE_TOOL_ID,
  SCHEDULE_TOOL_IDS,
  isDepartureChainGoal,
  verifyDepartureChain,
};
