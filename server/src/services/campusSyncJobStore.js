const crypto = require("crypto");

const JOB_TTL_MS = Math.max(30, Number(process.env.CAMPUS_SYNC_JOB_TTL_SECONDS || 120)) * 1000;
const HEARTBEAT_TTL_MS = 45000;
const RATE_WINDOW_MS = 600000;
const RATE_LIMIT = 5;

function createMemoryCampusSyncJobStore() {
  const jobs = new Map();
  const attempts = new Map();
  let heartbeatAt = 0;

  function wipe(job) {
    if (!job) return;
    job.password = "";
    job.studentId = "";
  }

  function expireOld(now) {
    jobs.forEach((job) => {
      if (job.expiresAt > now) return;
      if (job.status === "completed" || job.status === "failed" || job.status === "expired") return;
      job.status = "expired";
      job.errorCode = job.errorCode || "TIMEOUT";
      wipe(job);
    });
  }

  return {
    ttlMs: JOB_TTL_MS,
    put(input, now) {
      expireOld(now);
      const job = {
        jobId: crypto.randomBytes(16).toString("hex"),
        status: "queued",
        studentId: String(input.studentId || ""),
        password: String(input.password || ""),
        semester: String(input.semester || ""),
        ownerKey: String(input.ownerKey || ""),
        createdAt: now,
        expiresAt: now + JOB_TTL_MS,
        errorCode: "",
        preview: null,
      };
      jobs.set(job.jobId, job);
      return job;
    },
    get(jobId) {
      return jobs.get(jobId) || null;
    },
    hasActive(ownerKey) {
      return Array.from(jobs.values()).some((job) => job.ownerKey === ownerKey && (job.status === "queued" || job.status === "claimed" || job.status === "processing"));
    },
    allowAttempt(ownerKey, now) {
      const recent = (attempts.get(ownerKey) || []).filter((stamp) => now - stamp < RATE_WINDOW_MS);
      if (recent.length >= RATE_LIMIT) {
        attempts.set(ownerKey, recent);
        return false;
      }
      recent.push(now);
      attempts.set(ownerKey, recent);
      return true;
    },
    claim(agentId, now) {
      expireOld(now);
      const job = Array.from(jobs.values()).find((item) => item.status === "queued");
      if (!job) return null;
      job.status = "claimed";
      job.agentId = String(agentId || "");
      job.expiresAt = now + JOB_TTL_MS;
      return job;
    },
    markProcessing(jobId, now) {
      const job = jobs.get(jobId);
      if (!job) return null;
      job.status = "processing";
      job.expiresAt = now + JOB_TTL_MS;
      return job;
    },
    complete(jobId, preview, now) {
      const job = jobs.get(jobId);
      if (!job) return null;
      job.status = "completed";
      job.preview = preview;
      job.completedAt = now;
      wipe(job);
      return job;
    },
    fail(jobId, errorCode, now) {
      const job = jobs.get(jobId);
      if (!job) return null;
      job.status = "failed";
      job.errorCode = String(errorCode || "AGENT_OFFLINE");
      job.completedAt = now;
      wipe(job);
      return job;
    },
    heartbeat(now) {
      heartbeatAt = now;
    },
    agentOnline(now) {
      return heartbeatAt > 0 && now - heartbeatAt <= HEARTBEAT_TTL_MS;
    },
    reset() {
      jobs.clear();
      attempts.clear();
      heartbeatAt = 0;
    },
    expireAll(now) {
      jobs.forEach((job) => {
        job.expiresAt = now - 1;
      });
      expireOld(now);
    },
  };
}

module.exports = {
  HEARTBEAT_TTL_MS,
  JOB_TTL_MS,
  createMemoryCampusSyncJobStore,
};
