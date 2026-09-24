const { createMemoryCampusSyncJobStore } = require("./campusSyncJobStore");
const { createCampusAgentStudentSchedulePreview } = require("./fosuDirectPreviewService");
const { safeLog } = require("../utils/safeLogger");

const CLAIM_WAIT_MS = 25000;
const store = createMemoryCampusSyncJobStore();
const waiters = [];

function ownerKeyFromRequest(req) {
  const session = req && req.fosuSession || {};
  return String(session.openidHash || session.sessionIdHash || "");
}

function publicJob(job) {
  return {
    jobId: job.jobId,
    status: job.status,
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
  const ownerKey = ownerKeyFromRequest(req);
  const now = Date.now();
  if (store.hasActive(ownerKey)) {
    const error = new Error("JOB_ALREADY_ACTIVE");
    error.code = "JOB_ALREADY_ACTIVE";
    throw error;
  }
  if (!store.allowAttempt(ownerKey, now)) {
    const error = new Error("IMPORT_RATE_LIMITED");
    error.code = "IMPORT_RATE_LIMITED";
    throw error;
  }
  const job = store.put({
    studentId,
    password,
    semester: body && body.semester || "",
    ownerKey: ownerKeyFromRequest(req),
  }, Date.now());
  safeLog("campus-sync-job-queued", { jobId: job.jobId });
  deliverWaiter();
  return { jobId: job.jobId, status: "queued" };
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
  store.markProcessing(job.jobId, Date.now());
  return {
    jobId: job.jobId,
    studentId: job.studentId,
    password: job.password,
    semester: job.semester || "",
  };
}

function finishJob(jobId, body) {
  const job = store.get(jobId);
  if (!job || (job.status !== "claimed" && job.status !== "processing")) {
    const error = new Error("JOB_NOT_FOUND");
    error.code = "JOB_NOT_FOUND";
    throw error;
  }
  if (!body || body.success !== true) {
    store.fail(jobId, body && body.code || "AGENT_OFFLINE", Date.now());
    safeLog("campus-sync-job-failed", { jobId, code: body && body.code || "AGENT_OFFLINE" });
    return { jobId, status: "failed" };
  }
  try {
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
    store.complete(jobId, preview, Date.now());
    safeLog("campus-sync-job-completed", { jobId });
    return { jobId, status: "completed" };
  } catch (error) {
    store.fail(jobId, error && error.code || "SCHEDULE_ROWS_EMPTY", Date.now());
    throw error;
  }
}

function heartbeat() {
  store.heartbeat(Date.now());
  return { ok: true };
}

function availability() {
  return { online: store.agentOnline(Date.now()) };
}

function resetCampusSyncForTests() {
  jobsClear();
  waiters.length = 0;
}

function jobsClear() {
  store.reset();
}

module.exports = {
  availability,
  claimJob,
  claimPayload,
  createJob,
  finishJob,
  heartbeat,
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
