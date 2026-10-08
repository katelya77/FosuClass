"use strict";
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const termRegistry = require("./termRegistryService");
const { assertPublicData } = require("../shared/fourDirectSourceContract");

const STAGES = ["idle", "auth-check", "catalog", "class", "teacher", "classroom", "course", "schedule", "normalize", "hash", "upload", "validate", "publish", "mirror"];
const BACKOFF_MS = [30 * 60 * 1000, 2 * 60 * 60 * 1000, 6 * 60 * 60 * 1000];
const SCHOOL_CONCURRENCY = 1;
const HEARTBEAT_TTL_MS = 90000, LEASE_TTL_MS = 120000;
let state, loaded = false;
function emptyState() { return { paused: false, lastHeartbeat: null, lastRunAt: null, lastSuccessAt: null, failureCount: 0, stopForDay: false, sessionExpired: false, lock: null, current: null, runs: [] }; }
function opsDir() { return path.resolve(process.env.SCHEDULE_COLLECTOR_DIR || path.join(__dirname, "../../storage/ops/schedule-collector")); }
function statePath() { return path.join(opsDir(), "state.json"); }
function persist() {
  fs.mkdirSync(opsDir(), { recursive: true });
  const temp = statePath() + ".tmp";
  fs.writeFileSync(temp, JSON.stringify(state), { mode: 0o600 });
  fs.renameSync(temp, statePath());
}
function load() { try { state = Object.assign(emptyState(), JSON.parse(fs.readFileSync(statePath(), "utf8"))); } catch (_) { state = emptyState(); } loaded = true; return state; }
function ensureLoaded() { if (!loaded) load(); }
function resetForTests() { state = emptyState(); loaded = true; if (fs.existsSync(statePath())) fs.unlinkSync(statePath()); }
function fail(code, statusCode = 409) { throw Object.assign(new Error(code), { code, statusCode }); }
function shanghaiParts(now) { const shifted = new Date(Number(now) + 8 * 60 * 60 * 1000); return { year: shifted.getUTCFullYear(), month: shifted.getUTCMonth(), date: shifted.getUTCDate(), day: shifted.getUTCDay() }; }
function shanghaiToUtc(year, month, date, hour, minute) { return Date.UTC(year, month, date, hour - 8, minute, 0); }
function nextDaily(now, hour, minute) { const p = shanghaiParts(now); const when = shanghaiToUtc(p.year, p.month, p.date, hour, minute); return when <= now ? shanghaiToUtc(p.year, p.month, p.date + 1, hour, minute) : when; }
function nextWeekly(now, weekday, hour, minute) { const p = shanghaiParts(now); const delta = (weekday - p.day + 7) % 7; const when = shanghaiToUtc(p.year, p.month, p.date + delta, hour, minute); return when <= now ? shanghaiToUtc(p.year, p.month, p.date + delta + 7, hour, minute) : when; }
function nextSchedule(now) { return { routineAt: new Date(nextDaily(now, 4, 30)).toISOString(), fullAt: new Date(nextWeekly(now, 0, 5, 0)).toISOString(), timezone: "Asia/Shanghai" }; }
function collectorCommand(mode) { return { script: "tools/fosu-sync-client/sync.js", args: ["crawl:daily", "--allow-derived=false", "--resource-source=direct", "--catalog-policy=" + (mode === "full" ? "network-only" : "reuse-validated"), "--schedule-policy=network-only", "--progress-policy=resume", "--negative-cache-policy=ignore"], concurrency: 1, publishesRelease: false }; }
function findSensitive(value) { try { assertPublicData(value); return []; } catch (_) { return ["sensitive"]; } }
function activeBaseline() {
  const release = require("./releaseService");
  const info = release.getActiveReleaseInfo() || {};
  return { canonicalHash: info.canonicalHash || info.manifest && info.manifest.canonicalHash || "", term: info.term || info.semester || "", resourceCounts: info.resourceCounts || info.manifest && info.manifest.resourceCounts || null };
}
function classifyRelease(previous, incoming) {
  const prior = previous || {}, next = incoming || {};
  const reasons = [];
  if (prior.term && next.term !== prior.term) reasons.push("semester-change");
  if (next.coverageValid !== true) reasons.push("coverage-invalid");
  for (const kind of ["class", "teacher", "classroom", "course"]) {
    const stat = next.directSourceSummary && next.directSourceSummary[kind];
    if (!stat || stat.sourceMode !== "network-direct" || stat.coverageValid !== true || stat.failed || stat.parserErrors) reasons.push(kind + "-source-invalid");
    if (stat && stat.empty / Math.max(1, stat.success + stat.empty) > 0.5) reasons.push(kind + "-empty-rate");
    const before = Number(prior.resourceCounts && prior.resourceCounts[kind] && prior.resourceCounts[kind].scheduleDocuments || prior.counts && prior.counts[kind]);
    const after = Number(next.resourceCounts && next.resourceCounts[kind] && next.resourceCounts[kind].scheduleDocuments || stat && stat.scheduleDocuments || next.counts && next.counts[kind]);
    if (!after) reasons.push(kind + "-empty");
    if (before > 0 && after < before * 0.9) reasons.push(kind + "-drop");
  }
  if (!reasons.length && prior.canonicalHash && next.canonicalHash === prior.canonicalHash) return { result: "NO CHANGE", autoPublish: false, reasons: [] };
  return { result: "PENDING REVIEW", autoPublish: false, reasons: reasons.length ? reasons : ["auto-publish-disabled"] };
}
function backoffFor(failureCount, code) {
  if (["SESSION_EXPIRED", "INVALID_CREDENTIALS", "SCHOOL_SECURITY_CHALLENGE"].includes(code)) return { stop: true, delayMs: null, message: "校内采集会话已失效，请人工刷新" };
  if (failureCount >= 4) return { stop: true, delayMs: null, message: "当天连续异常，已停止自动重试" };
  return { stop: false, delayMs: BACKOFF_MS[Math.max(0, Math.min(failureCount - 1, 2))], message: "" };
}
function publicRun(run) {
  if (!run) return null;
  const result = {};
  for (const key of ["id", "mode", "term", "stage", "result", "startedAt", "finishedAt", "durationMs", "schoolRequestCount", "cacheHit", "uploadBytes", "canonicalHashChanged", "failureCode", "counts", "resourceCounts", "directSourceSummary", "stagingRawBytes", "stagingGzipBytes", "reasons", "uploadId"]) if (run[key] !== undefined) result[key] = run[key];
  return result;
}
function snapshot(now) {
  ensureLoaded(); const current = Number(now || Date.now()), schedule = nextSchedule(current);
  return { enabled: !state.paused, timerVerified: process.env.FOSU_COLLECTOR_TIMER_VERIFIED === "1", collectorOnline: Boolean(state.lastHeartbeat && current - Date.parse(state.lastHeartbeat) < HEARTBEAT_TTL_MS), lastHeartbeat: state.lastHeartbeat, lastRunAt: state.lastRunAt, lastSuccessAt: state.lastSuccessAt, nextRoutineAt: schedule.routineAt, nextFullAt: schedule.fullAt, sessionExpired: state.sessionExpired, sessionMessage: state.sessionExpired ? "校内采集会话已失效，请人工刷新" : "", stopForDay: state.stopForDay, current: publicRun(state.current), recent: state.runs.slice(0, 8).map(publicRun), autoPublish: false };
}
function requestRun(mode, actor, now, options = {}) {
  ensureLoaded();
  if (!["routine", "full"].includes(mode)) fail("COLLECTOR_MODE_REJECTED", 400);
  if (state.current && !state.current.finishedAt) return { skipped: true, reason: "already-running", status: snapshot(now) };
  let run;
  if (options.runId) {
    run = state.runs.find((item) => item.id === options.runId);
    if (!run || run.result !== "FAILED" || run.failureCode === "CANCELLED") fail("RESUME_RUN_REJECTED");
    delete run.finishedAt; delete run.failureCode; delete run.result;
    run.stage = "idle";
  } else {
    const record = options.term ? termRegistry.getTerm(options.term) : termRegistry.getActiveTerm();
    if (!record || !record.termStartDate || !Number.isInteger(record.totalWeeks)) fail("COLLECTOR_TERM_CONFIG_MISSING", 400);
    const termConfig = { term: record.term, semesterText: record.semesterText, termStartDate: record.termStartDate, totalWeeks: record.totalWeeks, weekStart: record.weekStart || "monday" };
    run = { id: "sc-" + crypto.randomBytes(12).toString("hex"), mode, term: termConfig.term, termConfig, stage: "idle", actor: String(actor || "admin").slice(0, 64), startedAt: new Date(Number(now || Date.now())).toISOString() };
    state.runs.unshift(run); state.runs = state.runs.slice(0, 20);
  }
  state.current = run; state.lock = null; state.lastRunAt = run.startedAt; state.stopForDay = false; state.sessionExpired = false;
  persist(); return { skipped: false, run: publicRun(run), status: snapshot(now) };
}
function setPaused(paused) { ensureLoaded(); state.paused = Boolean(paused); persist(); return snapshot(); }
function cancelCurrent() { ensureLoaded(); if (state.current && !state.current.finishedAt) { state.current.finishedAt = new Date().toISOString(); state.current.result = "FAILED"; state.current.failureCode = "CANCELLED"; state.current.stage = "idle"; } state.lock = null; persist(); return snapshot(); }
function requireRun(runId, agentId, claimId, now = Date.now()) {
  ensureLoaded(); const run = state.current, lock = state.lock;
  if (!run || run.id !== runId || run.finishedAt || !lock || lock.agentId !== agentId || !claimId || lock.claimId !== claimId || now > lock.expiresAt) fail("RUN_LEASE_REJECTED");
  return run;
}
function heartbeat(agentId, now, body = {}) {
  ensureLoaded(); const stamp = Number(now || Date.now());
  state.lastHeartbeat = new Date(stamp).toISOString(); state.agentId = String(agentId || "").slice(0, 64);
  let cancelled = false;
  if (body.runId) { try { requireRun(body.runId, agentId, body.claimId, stamp); state.lock.expiresAt = stamp + LEASE_TTL_MS; } catch (_) { cancelled = true; } }
  const p = shanghaiParts(stamp), dayKey = [p.year, p.month + 1, p.date].join("-");
  const slot = shanghaiToUtc(p.year, p.month, p.date, 4, 30);
  const due = stamp >= slot && stamp < slot + 30 * 60 * 1000;
  const successes = state.runs.filter((run) => run.finishedAt && ["PENDING REVIEW", "NO CHANGE"].includes(run.result)).length;
  if (!state.paused && !state.stopForDay && process.env.FOSU_COLLECTOR_TIMER_VERIFIED === "1" && successes >= 3 && due && state.lastScheduledDay !== dayKey && (!state.current || state.current.finishedAt)) {
    state.lastScheduledDay = dayKey;
    requestRun("routine", "verified-timer", stamp);
  }
  persist(); return { ok: true, paused: state.paused, cancelled };
}
function claim(agentId, now) {
  ensureLoaded(); const stamp = Number(now || Date.now());
  if (state.paused || state.stopForDay || !state.current || state.current.finishedAt || state.lock && state.lock.expiresAt > stamp) return null;
  state.lock = { runId: state.current.id, agentId, claimId: crypto.randomBytes(24).toString("hex"), expiresAt: stamp + LEASE_TTL_MS };
  state.current.stage = "auth-check";
  state.current.baseline = activeBaseline();
  persist();
  return Object.assign(publicRun(state.current), { claimId: state.lock.claimId, termConfig: state.current.termConfig, activeCanonicalHash: state.current.baseline.canonicalHash });
}
function associateUpload(run, uploadId) { run.uploadId = uploadId; persist(); }
function associateJob(run, jobId) { run.finalizeJobId = jobId; persist(); }
function applyReport(runId, body, agentId, now = Date.now()) {
  if (findSensitive(body).length) fail("STAGING_SENSITIVE", 400);
  const run = requireRun(runId, agentId, body.claimId, now);
  if (body.stage) { if (!STAGES.includes(body.stage)) fail("COLLECTOR_STAGE_REJECTED", 400); run.stage = body.stage; }
  for (const key of ["schoolRequestCount", "cacheHit", "uploadBytes", "durationMs", "stagingRawBytes", "stagingGzipBytes"]) if (body[key] !== undefined) { if (!Number.isSafeInteger(body[key]) || body[key] < 0) fail("COLLECTOR_METRIC_REJECTED", 400); run[key] = body[key]; }
  if (body.directSourceSummary) {
    const summary = {};
    for (const kind of ["class", "teacher", "classroom", "course"]) {
      const source = body.directSourceSummary[kind]; if (!source) continue;
      const stat = {};
      for (const key of ["discoveredEntities", "requestedEntities", "success", "empty", "failed", "scheduleDocuments", "courseEvents", "parserErrors", "requestCount", "elapsedMs", "estimatedRemainingMs", "completedEntities"]) if (source[key] !== undefined) { if (!Number.isSafeInteger(source[key]) || source[key] < 0) fail("COLLECTOR_METRIC_REJECTED", 400); stat[key] = source[key]; }
      stat.sourceMode = source.sourceMode === "network-direct" ? "network-direct" : "unknown";
      if (source.entityUnit === "major-request-group") stat.entityUnit = source.entityUnit;
      stat.coverageValid = source.coverageValid === true; summary[kind] = stat;
    }
    run.directSourceSummary = summary;
  }
  if (body.failureCode) {
    if (!/^[A-Z0-9_:-]{1,80}$/.test(body.failureCode)) fail("COLLECTOR_FAILURE_REJECTED", 400);
    const plan = backoffFor(++state.failureCount, body.failureCode);
    run.result = "FAILED"; run.failureCode = body.failureCode; run.finishedAt = new Date(now).toISOString(); state.lock = null;
    if (plan.stop) { state.stopForDay = true; state.sessionExpired = ["SESSION_EXPIRED", "INVALID_CREDENTIALS"].includes(body.failureCode); }
  } else if (body.complete) {
    let verified;
    const baseline = activeBaseline();
    if (body.noChange && body.canonicalHash && body.canonicalHash === baseline.canonicalHash) {
      verified = { canonicalHash: body.canonicalHash, term: run.term, directSourceSummary: run.directSourceSummary, coverageValid: true };
    } else {
      if (!run.uploadId || body.uploadId !== run.uploadId) fail("COLLECTOR_FINALIZE_REQUIRED");
      const upload = require("./stagingUploadService").getUploadStatus(run.uploadId, { type: "full-sync", id: run.id });
      if (!["pending-review", "unchanged"].includes(upload.status)) fail("COLLECTOR_FINALIZE_REQUIRED");
      const summary = upload.summary || {};
      verified = Object.assign({}, summary, { coverageValid: true, directSourceSummary: summary.directSourceSummary });
      if (body.canonicalHash !== verified.canonicalHash) fail("CANONICAL_HASH_MISMATCH", 400);
      run.resourceCounts = summary.resourceCounts; run.counts = summary.counts;
    }
    const decision = classifyRelease(baseline, verified);
    run.result = decision.result; run.reasons = decision.reasons; run.canonicalHashChanged = decision.result !== "NO CHANGE"; run.finishedAt = new Date(now).toISOString(); run.stage = decision.result === "NO CHANGE" ? "hash" : "validate";
    state.lastSuccessAt = run.finishedAt; state.failureCount = 0; state.stopForDay = false; state.sessionExpired = false; state.lock = null;
  }
  persist(); return publicRun(run);
}
module.exports = { BACKOFF_MS, SCHOOL_CONCURRENCY, LEASE_TTL_MS, applyReport, associateJob, associateUpload, backoffFor, cancelCurrent, claim, classifyRelease, collectorCommand, findSensitive, heartbeat, load, nextSchedule, publicRun, requestRun, requireRun, resetForTests, setPaused, snapshot };
