const { createMemoryCampusSyncJobStore } = require("./campusSyncJobStore");
const { createCampusAgentStudentSchedulePreview } = require("./fosuDirectPreviewService");
const { safeLog } = require("../utils/safeLogger");
const circuit = require("./campusSyncCircuitBreaker");
const control = require("./campusSyncControl");
const telemetry = require("./campusSyncTelemetryService");
const quota = require("./campusSyncQuotaStore");
const policy = require("./campusSyncPolicyService");
const challengeCooldown = require("./campusSyncChallengeCooldown");

const CLAIM_WAIT_MS = 25000;
const store = createMemoryCampusSyncJobStore({
  onTerminal(info) {
    const job = info && info.job || {};
    const code = info && info.code || "";
      circuit.observe(code, info && info.now);
    try { quota.noteTerminal(job.status); } catch (error) {}
    try { control.persistCircuit(); } catch (error) {}
    if (code === "INTERACTIVE_CHALLENGE_REQUIRED") challengeCooldown.note(job.ownerKey, info && info.now || Date.now());
    telemetry.record({
      t: info && info.now || Date.now(),
      jobId: job.jobId,
      ownerKey: job.ownerKey,
      principalHashPrefix: String(job.ownerKey || "").slice(0, 8),
      status: job.status,
      resultCode: code === "OK" ? "OK" : (job.errorCode || code),
      queueWaitMs: job.queueWaitMs || 0,
      durationMs: job.createdAt ? Math.max(0, (job.completedAt || info.now || Date.now()) - job.createdAt) : 0,
      jobQueuedAt: job.jobQueuedAt || job.createdAt || 0,
      agentClaimedAt: job.agentClaimedAt || job.claimedAt || 0,
      schoolLoginMs: job.schoolLoginMs,
      scheduleFetchMs: job.scheduleFetchMs,
      profileFetchMs: job.profileFetchMs,
      normalizeMs: job.normalizeMs,
      previewBuildMs: job.previewBuildMs,
      courseCount: job.courseCount || 0,
      retryCount: job.retryCount || 0,
      requestId: job.requestId || "",
      source: job.source || "campus-sync",
    });
  },
});
const waiters = [];

function ownerKeyFromRequest(req) {
  const session = req && req.fosuSession || {};
  return String(session.openidHash || session.sessionIdHash || "");
}

function publicJob(job) {
  const stage = ["connecting", "verifying", "reading", "organizing"].indexOf(job.stage) >= 0 ? job.stage : "";
  return {
    jobId: job.jobId,
    status: job.status,
    stage,
    errorCode: job.status === "failed" || job.status === "expired" ? job.errorCode || "TIMEOUT" : "",
    preview: job.status === "completed" ? rejectSecrets(job.preview) : null,
  };
}

function deliverWaiter() {
  const waiter = waiters.shift();
  if (!waiter) return;
  const job = store.claim(waiter.agentId, Date.now());
  if (!job) {
    waiters.unshift(waiter);
    return;
  }
  waiter.finish(job);
}

function rejectSecrets(value) {
  if (!value || typeof value !== "object") return value;
  const copy = Array.isArray(value) ? value.map(rejectSecrets) : Object.assign({}, value);
  if (!Array.isArray(copy)) {
    Object.keys(copy).forEach((key) => {
      if (/^(password|cookie|cookies|set-cookie|ticket|authorization|studentid)$/i.test(key)) delete copy[key];
      else copy[key] = rejectSecrets(copy[key]);
    });
  }
  return copy;
}

function createJob(req, body) {
  const studentId = String(body && body.studentId || "").trim();
  const password = String(body && body.password || "");
  if (!/^\d{6,20}$/.test(studentId) || !password) {
    const error = new Error("INVALID_CREDENTIALS");
    error.code = "INVALID_CREDENTIALS";
    throw error;
  }
  if (control.isPaused()) {
    const error = new Error("CAMPUS_SYNC_MAINTENANCE");
    error.code = "CAMPUS_SYNC_MAINTENANCE";
    throw error;
  }
  const gate = circuit.allow(Date.now());
  if (!gate.ok) {
    const error = new Error("CAMPUS_SYNC_DEGRADED");
    error.code = "CAMPUS_SYNC_DEGRADED";
    throw error;
  }
  const ownerKey = ownerKeyFromRequest(req);
  const now = Date.now();
  const cooled = challengeCooldown.check(ownerKey, now);
  if (cooled.blocked) {
    telemetry.record({
      t: now,
      status: "failed",
      resultCode: "INTERACTIVE_CHALLENGE_REQUIRED",
      ownerKey,
      principalHashPrefix: String(ownerKey || "").slice(0, 8),
      source: "campus-sync",
    });
    const error = new Error("INTERACTIVE_CHALLENGE_REQUIRED");
    error.code = "INTERACTIVE_CHALLENGE_REQUIRED";
    error.retryAfterSeconds = cooled.retryAfterSeconds;
    throw error;
  }
  try {
    if (store.hasActive(ownerKey)) {
      const error = new Error("CAMPUS_SYNC_CONCURRENT_LIMIT");
      error.code = "CAMPUS_SYNC_CONCURRENT_LIMIT";
      throw error;
    }
    const decision = quota.consume(ownerKey, now);
    if (!decision.ok) {
      telemetry.recordAttempt(decision.code);
      const error = new Error(decision.code);
      error.code = decision.code;
      error.quota = decision.public;
      throw error;
    }
    const job = store.put({
      studentId,
      password,
      semester: body && body.semester || "",
      ownerKey,
      requestId: body && body.requestId || "",
      source: "campus-sync",
    }, now);
    safeLog("campus-sync-job-queued", { jobId: job.jobId });
    deliverWaiter();
    return { jobId: job.jobId, status: "queued" };
  } catch (error) {
    if (gate.probe) circuit.observe("USER_REJECTED", now);
    if (error && error.code === "CAMPUS_SYNC_BUSY") telemetry.recordAttempt("CAMPUS_SYNC_BUSY");
    throw error;
  }
}

function readJob(req, jobId) {
  const job = store.get(jobId);
  if (!job || job.ownerKey !== ownerKeyFromRequest(req)) {
    const error = new Error("JOB_NOT_FOUND");
    error.code = "JOB_NOT_FOUND";
    throw error;
  }
  return publicJob(job);
}

function claimJob(agentId, waitMs) {
  const immediate = store.claim(agentId, Date.now());
  if (immediate) return Promise.resolve(immediate);
  if (waitMs === 0) return Promise.resolve(null);
  return new Promise((resolve) => {
    const waiter = { agentId };
    const timer = setTimeout(() => {
      const index = waiters.indexOf(waiter);
      if (index >= 0) waiters.splice(index, 1);
      resolve(null);
    }, CLAIM_WAIT_MS);
    waiter.finish = (job) => {
      clearTimeout(timer);
      resolve(job);
    };
    waiters.push(waiter);
  });
}

function claimPayload(job) {
  return store.takeCredential(job.jobId);
}

function finishJob(jobId, body) {
  const job = store.get(jobId);
  if (!job || (job.status !== "claimed" && job.status !== "processing")) {
    const error = new Error("JOB_NOT_FOUND");
    error.code = "JOB_NOT_FOUND";
    throw error;
  }
  if (body && body.stageTimings) store.rememberTimings(jobId, body.stageTimings);
  if (!body || body.success !== true) {
    store.fail(jobId, body && body.code || "AGENT_OFFLINE", Date.now());
    safeLog("campus-sync-job-failed", { jobId, code: body && body.code || "AGENT_OFFLINE" });
    return { jobId, status: "failed" };
  }
  try {
    const previewStarted = Date.now();
    const preview = createCampusAgentStudentSchedulePreview({
      fosuSession: { openidHash: job.ownerKey },
      clientIpInfo: { effectiveIp: "campus-agent" },
      ip: "campus-agent",
    }, {
      timetableBodyBase64: body.timetableBodyBase64,
      contentType: body.contentType || "text/html",
      semester: body.semester || job.semester || "",
      profileHint: body.profileHint || {},
    });
    store.rememberTimings(jobId, { previewBuildMs: Date.now() - previewStarted });
    store.complete(jobId, preview, Date.now());
    safeLog("campus-sync-job-completed", { jobId });
    return { jobId, status: "completed" };
  } catch (error) {
    store.fail(jobId, error && error.code || "UNKNOWN_SYNC_ERROR", Date.now());
    throw error;
  }
}

function heartbeat() {
  store.heartbeat(Date.now());
  return { ok: true };
}

function availability() {
  const now = Date.now();
  const online = store.agentOnline(now);
  const snapshot = store.snapshot(now);
  const breaker = circuit.snapshot(now);
  if (control.isPaused()) return { online, status: "maintenance" };
  let status = "unavailable";
  if (breaker.state === "OPEN") status = "degraded";
  else if (online && snapshot.queuedJobs + snapshot.processingJobs >= snapshot.activeCap) status = "busy";
  else if (online) status = "available";
  return { online, status };
}

function cancelJob(req, jobId) {
  const job = store.get(jobId);
  if (!job || job.ownerKey !== ownerKeyFromRequest(req)) {
    const error = new Error("JOB_NOT_FOUND");
    error.code = "JOB_NOT_FOUND";
    throw error;
  }
  const cancelled = store.cancel(jobId, Date.now());
  if (!cancelled) {
    const error = new Error("JOB_NOT_CANCELLABLE");
    error.code = "JOB_NOT_CANCELLABLE";
    throw error;
  }
  return { jobId, status: "cancelled" };
}

function discardJob(req, jobId) {
  const job = store.get(jobId);
  if (!job || job.ownerKey !== ownerKeyFromRequest(req)) {
    const error = new Error("JOB_NOT_FOUND");
    error.code = "JOB_NOT_FOUND";
    throw error;
  }
  if (job.status === "queued" || job.status === "claimed" || job.status === "processing") {
    const error = new Error("JOB_NOT_CANCELLABLE");
    error.code = "JOB_NOT_CANCELLABLE";
    throw error;
  }
  store.remove(jobId);
  return { jobId, status: "gone" };
}

function resetCampusSyncForTests() {
  jobsClear();
  waiters.length = 0;
  circuit.resetForTests();
  telemetry.resetForTests();
  control.resetForTests();
  try { policy.resetForTests(); } catch (error) {}
  try { quota.resetForTests(); } catch (error) {}
  try { challengeCooldown.resetForTests(); } catch (error) {}
}

function noteJobStage(jobId, stage) {
  return store.noteStage(jobId, stage);
}

function jobsClear() {
  store.reset();
}

module.exports = {
  availability,
  cancelJob,
  claimJob,
  claimPayload,
  createJob,
  discardJob,
  finishJob,
  heartbeat,
  noteJobStage,
  metrics() {
    return store.snapshot(Date.now());
  },
  inspectJob(jobId) {
    const job = store.get(jobId);
    if (!job) return null;
    return { status: job.status, password: job.password, studentId: job.studentId };
  },
  readJob,
  resetCampusSyncForTests,
  expireJobsForTests(now) {
    store.expireAll(now || Date.now());
  },
};
