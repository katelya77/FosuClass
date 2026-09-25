const crypto = require("crypto");

function seconds(name, fallback) {
  const parsed = Number(process.env[name]);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return parsed;
}

const JOB_TTL_MS = Math.max(30, seconds("CAMPUS_SYNC_JOB_TTL_SECONDS", 90)) * 1000;
const PREVIEW_TTL_MS = seconds("CAMPUS_SYNC_PREVIEW_TTL_SECONDS", 900) * 1000;
const FAILED_TTL_MS = seconds("CAMPUS_SYNC_FAILED_TTL_SECONDS", 120) * 1000;
const HEARTBEAT_TTL_MS = Math.max(1000, Number(process.env.CAMPUS_AGENT_OFFLINE_TTL_MS || 90000));
const RATE_WINDOW_MS = seconds("CAMPUS_SYNC_RATE_WINDOW_SECONDS", 600) * 1000;
const RATE_LIMIT = Math.max(1, seconds("CAMPUS_SYNC_RATE_LIMIT", 5));
const DAILY_LIMIT = Math.max(1, seconds("CAMPUS_SYNC_DAILY_LIMIT", 10));
const DAILY_WINDOW_MS = 86400000;
const GLOBAL_ACTIVE_CAP = Math.max(1, seconds("CAMPUS_SYNC_GLOBAL_ACTIVE_CAP", 10));
const MAX_JOBS = Math.max(GLOBAL_ACTIVE_CAP, seconds("CAMPUS_SYNC_MAX_JOBS", 200));

function createMemoryCampusSyncJobStore() {
  const jobs = new Map();
  const attempts = new Map();
  const daily = new Map();
  let heartbeatAt = 0;
  const metrics = {
    completed: 0,
    failed: 0,
    expired: 0,
    rateLimited: 0,
    busy: 0,
    durations: [],
    errors: {},
    lastSuccessAt: 0,
  };

  function wipe(job) {
    if (!job) return;
    job.password = "";
    job.studentId = "";
  }

  function active(job) {
    return job && (job.status === "queued" || job.status === "claimed" || job.status === "processing");
  }

  function noteError(code) {
    const key = String(code || "UNKNOWN");
    metrics.errors[key] = (metrics.errors[key] || 0) + 1;
  }

  function noteDuration(job, now) {
    if (!job || !job.createdAt) return;
    metrics.durations.push(Math.max(0, now - job.createdAt));
    if (metrics.durations.length > 200) metrics.durations.shift();
  }

  function gc(now) {
    const drop = [];
    jobs.forEach((job, jobId) => {
      if (active(job) && job.expiresAt <= now) {
        job.status = "expired";
        job.errorCode = job.errorCode || "TIMEOUT";
        job.completedAt = now;
        wipe(job);
        metrics.expired += 1;
        noteError("TIMEOUT");
      }
      const terminal = job.status === "completed" || job.status === "failed" || job.status === "expired" || job.status === "cancelled";
      if (!terminal) return;
      const keep = job.status === "completed" ? PREVIEW_TTL_MS : FAILED_TTL_MS;
      if (now - (job.completedAt || job.expiresAt || now) >= keep) drop.push(jobId);
    });
    drop.forEach((jobId) => jobs.delete(jobId));
    if (jobs.size > MAX_JOBS) {
      const terminal = Array.from(jobs.entries())
        .filter((entry) => !active(entry[1]))
        .sort((a, b) => (a[1].completedAt || a[1].createdAt) - (b[1].completedAt || b[1].createdAt));
      while (jobs.size > MAX_JOBS && terminal.length) jobs.delete(terminal.shift()[0]);
    }
    attempts.forEach((stamps, key) => {
      const recent = stamps.filter((stamp) => now - stamp < RATE_WINDOW_MS);
      if (recent.length) attempts.set(key, recent);
      else attempts.delete(key);
    });
    daily.forEach((stamps, key) => {
      const recent = stamps.filter((stamp) => now - stamp < DAILY_WINDOW_MS);
      if (recent.length) daily.set(key, recent);
      else daily.delete(key);
    });
  }

  return {
    ttlMs: JOB_TTL_MS,
    heartbeatTtlMs: HEARTBEAT_TTL_MS,
    put(input, now) {
      gc(now);
      const activeCount = Array.from(jobs.values()).filter(active).length;
      if (activeCount >= GLOBAL_ACTIVE_CAP) {
        metrics.busy += 1;
        const error = new Error("CAMPUS_SYNC_BUSY");
        error.code = "CAMPUS_SYNC_BUSY";
        throw error;
      }
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
      gc(Date.now());
      return jobs.get(jobId) || null;
    },
    remove(jobId) {
      const job = jobs.get(jobId);
      if (job) wipe(job);
      jobs.delete(jobId);
    },
    hasActive(ownerKey) {
      gc(Date.now());
      return Array.from(jobs.values()).some((job) => job.ownerKey === ownerKey && active(job));
    },
    allowAttempt(ownerKey, now) {
      gc(now);
      const recent = (attempts.get(ownerKey) || []).filter((stamp) => now - stamp < RATE_WINDOW_MS);
      const today = (daily.get(ownerKey) || []).filter((stamp) => now - stamp < DAILY_WINDOW_MS);
      if (recent.length >= RATE_LIMIT || today.length >= DAILY_LIMIT) {
        attempts.set(ownerKey, recent);
        daily.set(ownerKey, today);
        metrics.rateLimited += 1;
        return false;
      }
      recent.push(now);
      today.push(now);
      attempts.set(ownerKey, recent);
      daily.set(ownerKey, today);
      return true;
    },
    claim(agentId, now) {
      gc(now);
      const job = Array.from(jobs.values()).find((item) => item.status === "queued" && item.expiresAt > now);
      if (!job) return null;
      job.status = "claimed";
      job.agentId = String(agentId || "");
      return job;
    },
    takeCredential(jobId) {
      const job = jobs.get(jobId);
      if (!job) return null;
      const payload = {
        jobId: job.jobId,
        studentId: job.studentId,
        password: job.password,
        semester: job.semester || "",
      };
      job.status = "processing";
      wipe(job);
      return payload;
    },
    cancel(jobId, now) {
      const job = jobs.get(jobId);
      if (!job || job.status !== "queued") return null;
      job.status = "cancelled";
      job.completedAt = now;
      wipe(job);
      return job;
    },
    complete(jobId, preview, now) {
      const job = jobs.get(jobId);
      if (!job) return null;
      job.status = "completed";
      job.preview = preview;
      job.completedAt = now;
      wipe(job);
      metrics.completed += 1;
      metrics.lastSuccessAt = now;
      noteDuration(job, now);
      return job;
    },
    fail(jobId, errorCode, now) {
      const job = jobs.get(jobId);
      if (!job) return null;
      job.status = "failed";
      job.errorCode = String(errorCode || "AGENT_OFFLINE");
      job.completedAt = now;
      wipe(job);
      metrics.failed += 1;
      noteError(job.errorCode);
      noteDuration(job, now);
      return job;
    },
    heartbeat(now) {
      heartbeatAt = now;
    },
    agentOnline(now) {
      return heartbeatAt > 0 && now - heartbeatAt <= HEARTBEAT_TTL_MS;
    },
    snapshot(now) {
      gc(now);
      const list = Array.from(jobs.values());
      const queued = list.filter((job) => job.status === "queued");
      const durations = metrics.durations.slice().sort((a, b) => a - b);
      const average = durations.length ? Math.round(durations.reduce((sum, item) => sum + item, 0) / durations.length) : 0;
      const p95Index = durations.length ? Math.min(durations.length - 1, Math.ceil(durations.length * 0.95) - 1) : -1;
      return {
        agentOnline: heartbeatAt > 0 && now - heartbeatAt <= HEARTBEAT_TTL_MS,
        lastHeartbeatAge: heartbeatAt > 0 ? Math.max(0, now - heartbeatAt) : null,
        queuedJobs: queued.length,
        processingJobs: list.filter((job) => job.status === "claimed" || job.status === "processing").length,
        queueOldestAge: queued.length ? Math.max(0, now - Math.min.apply(null, queued.map((job) => job.createdAt))) : 0,
        completed: metrics.completed,
        failed: metrics.failed,
        expired: metrics.expired,
        errorCodes: Object.assign({}, metrics.errors),
        averageDurationMs: average,
        p95DurationMs: p95Index >= 0 ? durations[p95Index] : 0,
        rateLimited: metrics.rateLimited,
        busy: metrics.busy,
        lastSuccessAt: metrics.lastSuccessAt || null,
        activeCap: GLOBAL_ACTIVE_CAP,
      };
    },
    reset() {
      jobs.clear();
      attempts.clear();
      daily.clear();
      heartbeatAt = 0;
      metrics.completed = 0;
      metrics.failed = 0;
      metrics.expired = 0;
      metrics.rateLimited = 0;
      metrics.busy = 0;
      metrics.durations = [];
      metrics.errors = {};
      metrics.lastSuccessAt = 0;
    },
    expireAll(now) {
      jobs.forEach((job) => {
        job.expiresAt = now - 1;
      });
      gc(now);
    },
  };
}

module.exports = {
  HEARTBEAT_TTL_MS,
  JOB_TTL_MS,
  createMemoryCampusSyncJobStore,
};
