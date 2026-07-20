/**
 * In-memory Agent Run store with user-safe event timeline.
 * Runs are short-lived, capacity-bounded, principal-isolated, and not durable.
 */
const crypto = require("crypto");
const { publicEventSummary, loadingTextForEvent } = require("./runEventCatalog");

const DEFAULT_TTL_MS = Math.max(30_000, Number(process.env.AI_AGENT_RUN_TTL_MS || 180_000) || 180_000);
const DEFAULT_MAX_RUNS = Math.max(32, Number(process.env.AI_AGENT_RUN_MAX || 256) || 256);
const DEFAULT_TOTAL_TIMEOUT_MS = Math.max(5_000, Number(process.env.AI_AGENT_RUN_TOTAL_TIMEOUT_MS || 45_000) || 45_000);

const runs = new Map();

function nowIso() {
  return new Date().toISOString();
}

function createId(prefix) {
  return `${prefix}_${crypto.randomBytes(16).toString("hex")}`;
}

function hashToken(value) {
  return crypto.createHash("sha256").update(String(value || "")).digest("hex");
}

function principalFingerprint(serverSession = null) {
  if (!serverSession || !serverSession.openidHash) return "anonymous";
  return hashToken(`principal|${serverSession.openidHash}|${serverSession.appid || ""}`).slice(0, 32);
}

function pruneExpired(now = Date.now()) {
  for (const [id, run] of runs.entries()) {
    if (!run || run.expiresAtMs <= now) runs.delete(id);
  }
  if (runs.size <= DEFAULT_MAX_RUNS) return;
  const ordered = Array.from(runs.values()).sort((a, b) => a.createdAtMs - b.createdAtMs);
  const overflow = ordered.length - DEFAULT_MAX_RUNS;
  for (let i = 0; i < overflow; i += 1) {
    runs.delete(ordered[i].runId);
  }
}

function createRun(input = {}) {
  pruneExpired();
  const runId = input.runId || createId("run");
  const pollToken = createId("poll");
  const createdAtMs = Date.now();
  const run = {
    runId,
    pollTokenHash: hashToken(pollToken),
    principalFp: principalFingerprint(input.serverSession),
    runtimeMode: String(input.runtimeMode || "public"),
    status: "queued",
    sequence: 0,
    events: [],
    result: null,
    cancelled: false,
    createdAtMs,
    expiresAtMs: createdAtMs + DEFAULT_TTL_MS,
    totalTimeoutMs: DEFAULT_TOTAL_TIMEOUT_MS,
    requestId: String(input.requestId || "").slice(0, 96),
    conversationId: String(input.conversationId || "").slice(0, 96),
  };
  runs.set(runId, run);
  appendEvent(runId, {
    type: "run.accepted",
    label: loadingTextForEvent({ type: "run.accepted" }, run.runtimeMode),
    runtimeMode: run.runtimeMode,
  });
  return {
    runId,
    pollToken,
    status: run.status,
    nextPollMs: 400,
    expiresAt: new Date(run.expiresAtMs).toISOString(),
  };
}

function getRunRecord(runId) {
  pruneExpired();
  return runs.get(String(runId || "")) || null;
}

function authorizeRunAccess(run, options = {}) {
  if (!run) return { ok: false, code: "RUN_NOT_FOUND", status: 404 };
  if (run.expiresAtMs <= Date.now()) {
    runs.delete(run.runId);
    return { ok: false, code: "RUN_EXPIRED", status: 410 };
  }
  const pollToken = String(options.pollToken || "");
  if (pollToken && hashToken(pollToken) === run.pollTokenHash) {
    return { ok: true };
  }
  const fp = principalFingerprint(options.serverSession);
  if (run.principalFp === "anonymous") {
    // Anonymous runs require poll token.
    return pollToken ? { ok: false, code: "RUN_FORBIDDEN", status: 403 } : { ok: false, code: "RUN_POLL_TOKEN_REQUIRED", status: 401 };
  }
  if (fp !== run.principalFp) {
    return { ok: false, code: "RUN_FORBIDDEN", status: 403 };
  }
  return { ok: true };
}

function appendEvent(runId, event = {}) {
  const run = getRunRecord(runId);
  if (!run || run.cancelled && !String(event.type || "").startsWith("run.")) return null;
  run.sequence += 1;
  const payload = publicEventSummary(Object.assign({}, event, {
    sequence: run.sequence,
    at: event.at || nowIso(),
    runtimeMode: event.runtimeMode || run.runtimeMode,
  }));
  run.events.push(payload);
  if (run.events.length > 80) run.events = run.events.slice(-80);
  if (event.type === "run.completed") run.status = "completed";
  else if (event.type === "run.degraded") run.status = "degraded";
  else if (event.type === "run.failed") run.status = "failed";
  else if (event.type === "run.cancelled") run.status = "cancelled";
  else if (run.status === "queued") run.status = "running";
  return payload;
}

function setResult(runId, result, status) {
  const run = getRunRecord(runId);
  if (!run) return null;
  run.result = result || null;
  if (status) run.status = status;
  run.expiresAtMs = Date.now() + Math.min(DEFAULT_TTL_MS, 120_000);
  return run;
}

function cancelRun(runId, options = {}) {
  const run = getRunRecord(runId);
  const auth = authorizeRunAccess(run, options);
  if (!auth.ok) return auth;
  if (run.status === "completed" || run.status === "failed" || run.status === "cancelled" || run.status === "degraded") {
    return { ok: true, alreadyFinished: true, status: run.status };
  }
  run.cancelled = true;
  appendEvent(runId, {
    type: "run.cancelled",
    label: "已取消",
    runtimeMode: run.runtimeMode,
  });
  run.status = "cancelled";
  run.result = null;
  return { ok: true, status: "cancelled" };
}

function isCancelled(runId) {
  const run = getRunRecord(runId);
  return Boolean(run && run.cancelled);
}

function getRunView(runId, options = {}) {
  const run = getRunRecord(runId);
  const auth = authorizeRunAccess(run, options);
  if (!auth.ok) return auth;
  const afterSequence = Math.max(0, Number(options.afterSequence || 0) || 0);
  const events = run.events.filter((item) => item.sequence > afterSequence);
  return {
    ok: true,
    runId: run.runId,
    status: run.status,
    events,
    result: ["completed", "degraded", "failed"].includes(run.status) ? run.result : null,
    nextPollMs: ["completed", "degraded", "failed", "cancelled"].includes(run.status) ? 0 : 400,
    checkedAt: nowIso(),
  };
}

function createEventEmitter(runId, runtimeMode = "public") {
  return function onEvent(event = {}) {
    if (isCancelled(runId)) return null;
    return appendEvent(runId, Object.assign({}, event, { runtimeMode: event.runtimeMode || runtimeMode }));
  };
}

function resetForTests() {
  runs.clear();
}

module.exports = {
  DEFAULT_TTL_MS,
  DEFAULT_MAX_RUNS,
  DEFAULT_TOTAL_TIMEOUT_MS,
  appendEvent,
  authorizeRunAccess,
  cancelRun,
  createEventEmitter,
  createRun,
  getRunRecord,
  getRunView,
  isCancelled,
  principalFingerprint,
  resetForTests,
  setResult,
};
