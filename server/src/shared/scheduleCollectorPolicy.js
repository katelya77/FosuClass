"use strict";

const MINUTE = 60000;
const DAY = 24 * 60 * MINUTE;
const POLICY = "four-source-v1";

function parts(now) {
  const date = new Date(now + 8 * 60 * MINUTE);
  return { year: date.getUTCFullYear(), month: date.getUTCMonth(), date: date.getUTCDate(), weekday: date.getUTCDay() };
}
function at(p, hour, minute, offset = 0) {
  return Date.UTC(p.year, p.month, p.date + offset, hour - 8, minute);
}
function dayKey(now) {
  const p = parts(now);
  return [p.year, String(p.month + 1).padStart(2, "0"), String(p.date).padStart(2, "0")].join("-");
}
function config(env = process.env) {
  const name = env.FOSU_COLLECTOR_SCHEDULE_POLICY || "legacy-daily";
  const window = env.FOSU_COLLECTOR_SCHEDULE_WINDOW_MINUTES || "30";
  const valid = ["legacy-daily", POLICY].includes(name) && /^\d+$/.test(window) && Number(window) >= 30 && Number(window) <= 180;
  return { name, valid, weeklyFull: name === POLICY, windowMs: Number(window) * MINUTE };
}
function todaySlot(now, policy) {
  const p = parts(now);
  const mode = policy.weeklyFull && p.weekday === 0 ? "full" : "routine";
  const dueAt = mode === "full" ? at(p, 5, 0) : at(p, 4, 30);
  return { mode, day: dayKey(now), key: mode + ":" + dayKey(now), dueAt, expiresAt: dueAt + policy.windowMs };
}
function nextSchedule(now, policy = config()) {
  if (!policy.valid) return { routineAt: null, fullAt: null, timezone: "Asia/Shanghai", policy: policy.name };
  const p = parts(now);
  let routineAt;
  for (let offset = 0; offset <= 7; offset++) {
    const candidate = at(p, 4, 30, offset);
    if (candidate > now && (!policy.weeklyFull || parts(candidate).weekday !== 0)) { routineAt = candidate; break; }
  }
  const sundayOffset = (7 - p.weekday) % 7;
  const sunday = at(p, 5, 0, sundayOffset);
  return { routineAt: new Date(routineAt).toISOString(), fullAt: policy.weeklyFull ? new Date(sunday > now ? sunday : sunday + 7 * DAY).toISOString() : null, timezone: "Asia/Shanghai", policy: policy.name };
}
function decision(state, now, env = process.env) {
  const policy = config(env), slot = todaySlot(now, policy);
  const reject = reason => ({ allowed: false, reason, policy: policy.name, slot });
  if (!policy.valid) return reject("schedule-config-invalid");
  if (env.FOSU_COLLECTOR_TIMER_VERIFIED !== "1") return reject("manual-approval-required");
  if (state.paused) return reject("paused");
  if (state.sessionExpired) return reject("school-session-blocked");
  if (state.stopForDay) return reject("day-or-manual-stop");
  const accepted = (state.runs || []).filter(run => acceptedRun(run, policy.weeklyFull));
  const count = policy.weeklyFull ? new Set(accepted.map(run => run.id)).size : accepted.length;
  if (count < 3) return reject("three-accepted-runs-required");
  if (state.current && !state.current.finishedAt) return reject("already-running");
  if (state.retryNotBefore && now < state.retryNotBefore) return reject("failure-cooldown");
  if (now < slot.dueAt || now >= slot.expiresAt) return reject("outside-approved-window");
  // lastScheduledDay is retained for upgrades from the existing daily policy.
  const legacyDay = parts(now);
  if (state.lastScheduledKey === slot.key || state.lastScheduledDay === [legacyDay.year, legacyDay.month + 1, legacyDay.date].join("-")) return reject("already-scheduled");
  return { allowed: true, reason: "due", policy: policy.name, slot };
}
function acceptedRun(run, requireDirectEvidence = false) {
  if (!run.finishedAt || !["PENDING REVIEW", "NO CHANGE"].includes(run.result) || run.qualityBlocked || run.reviewClass === "blocked") return false;
  if (requireDirectEvidence) {
    if (!run.id || !run.term || !Number.isFinite(Date.parse(run.finishedAt)) || run.qualityBlocked !== false) return false;
    for (const kind of ["class", "teacher", "classroom", "course"]) {
      const stat = run.directSourceSummary && run.directSourceSummary[kind];
      if (!stat || stat.sourceMode !== "network-direct" || stat.coverageValid !== true || stat.failed || stat.parserErrors) return false;
      if (["discoveredEntities", "requestedEntities", "success", "empty", "failed", "scheduleDocuments", "courseEvents"].some(key => !Number.isSafeInteger(stat[key]) || stat[key] < 0)) return false;
      if (!stat.discoveredEntities || !stat.scheduleDocuments || stat.requestedEntities !== stat.discoveredEntities || stat.success + stat.empty !== stat.requestedEntities) return false;
    }
  }
  return !(run.reasons || []).some(reason => /^(coverage-invalid|(class|teacher|classroom|course)-(source-invalid|empty|empty-rate|drop))$/.test(reason));
}

module.exports = { POLICY, acceptedRun, config, dayKey, decision, nextSchedule, todaySlot };
