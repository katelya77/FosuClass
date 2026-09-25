const fs = require("fs");
const path = require("path");

const SECRET_KEY_PATTERN = /(password|passwd|pwd|cookie|ticket|session|authorization|jsessionid)/i;
const SECRET_VALUE_PATTERN = /(JSESSIONID|CASTGC|password=|Authorization:|Bearer\s+[A-Za-z0-9._-]{8,})/i;
const STAGES = ["idle", "auth-check", "catalog", "schedule", "normalize", "hash", "upload", "validate", "publish", "mirror"];
const BACKOFF_MS = [30 * 60 * 1000, 2 * 60 * 60 * 1000, 6 * 60 * 60 * 1000];
const SCHOOL_CONCURRENCY = 2;
const HEARTBEAT_TTL_MS = 90000;

let state = emptyState();
let loaded = false;

function ensureLoaded() {
  if (!loaded) {
    load();
    loaded = true;
  }
}

function emptyState() {
  return {
    paused: false,
    lastHeartbeat: null,
    lastRunAt: null,
    lastSuccessAt: null,
    failureCount: 0,
    stopForDay: false,
    sessionExpired: false,
    lock: null,
    current: null,
    runs: [],
    previousCounts: null,
  };
}

function opsDir() {
  return path.resolve(process.env.SCHEDULE_COLLECTOR_DIR || path.join(__dirname, "../../storage/ops/schedule-collector"));
}

function statePath() {
  return path.join(opsDir(), "state.json");
}

function persist() {
  fs.mkdirSync(opsDir(), { recursive: true });
  const temp = statePath() + ".tmp";
  fs.writeFileSync(temp, JSON.stringify(state));
  fs.renameSync(temp, statePath());
}

function load() {
  try {
    state = Object.assign(emptyState(), JSON.parse(fs.readFileSync(statePath(), "utf8")));
  } catch (error) {
    state = emptyState();
  }
  return state;
}

function resetForTests() {
  state = emptyState();
  loaded = true;
  try { fs.rmSync(opsDir(), { recursive: true, force: true }); } catch (error) {}
}

function shanghaiParts(now) {
  const shifted = new Date(Number(now) + 8 * 60 * 60 * 1000);
  return {
    year: shifted.getUTCFullYear(),
    month: shifted.getUTCMonth(),
    date: shifted.getUTCDate(),
    day: shifted.getUTCDay(),
  };
}

function shanghaiToUtc(year, month, date, hour, minute) {
  return Date.UTC(year, month, date, hour - 8, minute, 0);
}

function nextDaily(now, hour, minute) {
  const parts = shanghaiParts(now);
  let when = shanghaiToUtc(parts.year, parts.month, parts.date, hour, minute);
  if (when <= now) when = shanghaiToUtc(parts.year, parts.month, parts.date + 1, hour, minute);
  return when;
}

function nextWeekly(now, weekday, hour, minute) {
  const parts = shanghaiParts(now);
  let delta = (weekday - parts.day + 7) % 7;
  let when = shanghaiToUtc(parts.year, parts.month, parts.date + delta, hour, minute);
  if (when <= now) when = shanghaiToUtc(parts.year, parts.month, parts.date + delta + 7, hour, minute);
  return when;
}

function nextSchedule(now) {
  return {
    routineAt: new Date(nextDaily(now, 4, 30)).toISOString(),
    fullAt: new Date(nextWeekly(now, 0, 5, 0)).toISOString(),
    timezone: "Asia/Shanghai",
  };
}

function collectorCommand(mode) {
  return {
    script: "tools/fosu-sync-client/sync.js",
    args: mode === "full" ? ["crawl:scopes"] : ["crawl:daily"],
    concurrency: SCHOOL_CONCURRENCY,
    publishesRelease: false,
  };
}

function findSensitive(value, hits) {
  const found = hits || [];
  if (!value || typeof value !== "object") {
    if (typeof value === "string" && SECRET_VALUE_PATTERN.test(value)) found.push("value");
    return found;
  }
  Object.keys(value).forEach((key) => {
    if (SECRET_KEY_PATTERN.test(key)) found.push(key);
    else findSensitive(value[key], found);
  });
  return found;
}

function classifyRelease(previous, next) {
  const prior = previous || {};
  const incoming = next || {};
  if (prior.canonicalHash && prior.canonicalHash === incoming.canonicalHash) {
    return { result: "NO CHANGE", autoPublish: false, reasons: [] };
  }
  const reasons = [];
  if (prior.term && incoming.term && prior.term !== incoming.term) reasons.push("semester-change");
  if (prior.sourceMode && incoming.sourceMode && prior.sourceMode !== incoming.sourceMode) reasons.push("source-mismatch");
  if (incoming.coverageValid === false) reasons.push("coverage-invalid");
  ["class", "teacher", "classroom", "course"].forEach((key) => {
    const before = Number(prior.counts && prior.counts[key]);
    const after = Number(incoming.counts && incoming.counts[key]);
    if (before > 0 && Number.isFinite(after) && after < before * 0.9) reasons.push(key + "-drop");
  });
  if (reasons.length) return { result: "PENDING REVIEW", autoPublish: false, reasons };
  return {
    result: "PENDING REVIEW",
    recommendation: "AUTO SAFE PUBLISH",
    autoPublish: false,
    reasons: ["auto-publish-disabled"],
  };
}

function backoffFor(failureCount, code) {
  if (code === "SESSION_EXPIRED" || code === "INVALID_CREDENTIALS") {
    return { stop: true, delayMs: null, message: "校内采集会话已失效，请人工刷新" };
  }
  if (failureCount >= 4) return { stop: true, delayMs: null, message: "当天连续异常，已停止自动重试" };
  const index = Math.max(0, Math.min(failureCount - 1, BACKOFF_MS.length - 1));
  return { stop: false, delayMs: BACKOFF_MS[index], message: "" };
}

function publicRun(run) {
  if (!run) return null;
  return {
    id: run.id,
    mode: run.mode,
    stage: run.stage,
    result: run.result || "",
    startedAt: run.startedAt,
    finishedAt: run.finishedAt || null,
    durationMs: run.durationMs || 0,
    schoolRequestCount: run.schoolRequestCount || 0,
    cacheHit: run.cacheHit || 0,
    uploadBytes: run.uploadBytes || 0,
    canonicalHashChanged: Boolean(run.canonicalHashChanged),
    failureCode: run.failureCode || "",
    counts: run.counts || null,
    recommendation: run.recommendation || "",
  };
}

function snapshot(now) {
  ensureLoaded();
  const currentNow = Number(now || Date.now());
  const schedule = nextSchedule(currentNow);
  return {
    enabled: !state.paused,
    collectorOnline: Boolean(state.lastHeartbeat && currentNow - Date.parse(state.lastHeartbeat) < HEARTBEAT_TTL_MS),
    lastHeartbeat: state.lastHeartbeat,
    lastRunAt: state.lastRunAt,
    lastSuccessAt: state.lastSuccessAt,
    nextRoutineAt: schedule.routineAt,
    nextFullAt: schedule.fullAt,
    sessionExpired: state.sessionExpired,
    sessionMessage: state.sessionExpired ? "校内采集会话已失效，请人工刷新" : "",
    stopForDay: state.stopForDay,
    current: publicRun(state.current),
    recent: state.runs.slice(0, 8).map(publicRun),
    autoPublish: false,
  };
}

function requestRun(mode, actor, now) {
  ensureLoaded();
  if (mode !== "routine" && mode !== "full") {
    const error = new Error("mode");
    error.code = "COLLECTOR_MODE_REJECTED";
    throw error;
  }
  if (state.current && !state.current.finishedAt) {
    return { skipped: true, reason: "already-running", status: snapshot(now) };
  }
  const run = {
    id: "sc-" + Date.now().toString(36),
    mode,
    stage: "idle",
    actor: String(actor || "admin").slice(0, 64),
    startedAt: new Date(Number(now || Date.now())).toISOString(),
    command: collectorCommand(mode),
  };
  state.current = run;
  state.lastRunAt = run.startedAt;
  state.runs.unshift(run);
  state.runs = state.runs.slice(0, 20);
  persist();
  return { skipped: false, run: publicRun(run), status: snapshot(now) };
}

function setPaused(paused) {
  ensureLoaded();
  state.paused = Boolean(paused);
  persist();
  return snapshot();
}

function cancelCurrent() {
  ensureLoaded();
  if (state.current && !state.current.finishedAt) {
    state.current.finishedAt = new Date().toISOString();
    state.current.result = "FAILED";
    state.current.failureCode = "CANCELLED";
    state.current.stage = "idle";
  }
  state.lock = null;
  persist();
  return snapshot();
}

function heartbeat(agentId, now) {
  ensureLoaded();
  state.lastHeartbeat = new Date(Number(now || Date.now())).toISOString();
  state.agentId = String(agentId || "").slice(0, 64);
  persist();
  return { ok: true, paused: state.paused };
}

function claim(agentId, now) {
  ensureLoaded();
  if (!state.current || state.current.finishedAt) return null;
  if (state.lock && state.lock.runId === state.current.id) return null;
  state.lock = { runId: state.current.id, agentId: String(agentId || ""), at: new Date(Number(now || Date.now())).toISOString() };
  state.current.stage = "auth-check";
  persist();
  return publicRun(state.current);
}

function applyReport(runId, body) {
  ensureLoaded();
  const sensitive = findSensitive(body);
  if (sensitive.length) {
    const error = new Error("sensitive");
    error.code = "STAGING_SENSITIVE";
    throw error;
  }
  const run = state.runs.find((item) => item.id === runId);
  if (!run) {
    const error = new Error("missing");
    error.code = "RUN_NOT_FOUND";
    throw error;
  }
  if (body.stage && STAGES.indexOf(body.stage) >= 0) run.stage = body.stage;
  run.schoolRequestCount = Number(body.schoolRequestCount) || 0;
  run.cacheHit = Number(body.cacheHit) || 0;
  run.uploadBytes = Number(body.uploadBytes) || 0;
  run.durationMs = Number(body.durationMs) || 0;
  run.counts = body.counts || null;
  if (body.failureCode) {
    const plan = backoffFor(state.failureCount + 1, body.failureCode);
    state.failureCount += 1;
    run.result = "FAILED";
    run.failureCode = String(body.failureCode).slice(0, 64);
    run.finishedAt = new Date().toISOString();
    run.stage = "idle";
    state.lock = null;
    if (plan.stop) {
      state.stopForDay = true;
      if (body.failureCode === "SESSION_EXPIRED" || body.failureCode === "INVALID_CREDENTIALS") state.sessionExpired = true;
    }
  } else if (body.complete) {
    const decision = classifyRelease(state.previousCounts, body);
    run.result = decision.result;
    run.recommendation = decision.recommendation || "";
    run.canonicalHashChanged = decision.result !== "NO CHANGE";
    run.finishedAt = new Date().toISOString();
    run.stage = decision.result === "NO CHANGE" ? "hash" : "validate";
    if (decision.result !== "FAILED") state.lastSuccessAt = run.finishedAt;
    state.failureCount = 0;
    state.stopForDay = false;
    state.previousCounts = {
      canonicalHash: body.canonicalHash || "",
      term: body.term || "",
      sourceMode: body.sourceMode || "",
      counts: body.counts || {},
    };
    state.lock = null;
  }
  if (state.current && state.current.id === run.id) state.current = run;
  persist();
  return publicRun(run);
}

module.exports = {
  BACKOFF_MS,
  SCHOOL_CONCURRENCY,
  applyReport,
  backoffFor,
  cancelCurrent,
  claim,
  classifyRelease,
  collectorCommand,
  findSensitive,
  heartbeat,
  load,
  nextSchedule,
  requestRun,
  resetForTests,
  setPaused,
  snapshot,
};
