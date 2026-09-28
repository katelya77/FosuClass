const jobStore = require("./campusSyncJobStore");
const broker = require("./campusSyncBroker");
const circuit = require("./campusSyncCircuitBreaker");
const control = require("./campusSyncControl");
const telemetry = require("./campusSyncTelemetryService");
const abuse = require("./campusSyncAbuseGuard");
const policy = require("./campusSyncPolicyService");
const quota = require("./campusSyncQuotaStore");
const challengeCooldown = require("./campusSyncChallengeCooldown");
const { getSecurityEventSummary } = require("./securityEventService");

let diagnoseAt = 0;

function secretState(name) {
  return String(process.env[name] || "").trim() ? "Configured" : "Not configured";
}

function numberEnv(name, fallback) {
  const parsed = Number(process.env[name]);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function runtimeConfig() {
  const now = Date.now();
  const metrics = broker.metrics();
  const durations = [];
  const rules = policy.snapshot();
  return {
    perUserConcurrency: 1,
    rateLimit: rules.rateLimit,
    rateWindowSeconds: rules.rateWindowSeconds,
    dailyLimit: rules.dailyLimit,
    globalCap: rules.globalActiveCap,
    policySource: rules.source,
    jobTtlSeconds: Math.round(jobStore.JOB_TTL_MS / 1000),
    previewRetentionSeconds: Math.round(jobStore.PREVIEW_TTL_MS / 1000),
    heartbeatIntervalMs: numberEnv("CAMPUS_AGENT_HEARTBEAT_INTERVAL_MS", 30000),
    offlineTtlMs: jobStore.HEARTBEAT_TTL_MS,
    workerConcurrency: 1,
    circuit: circuit.snapshot(now),
    secrets: {
      campusAgentToken: secretState("CAMPUS_AGENT_TOKEN"),
      campusAgentSigningSecret: secretState("CAMPUS_AGENT_SIGNING_SECRET"),
      wechatAppSecret: secretState("WECHAT_APPSECRET"),
      sessionSecret: secretState("FOSU_SESSION_SECRET_CURRENT") === "Configured" || secretState("FOSU_SESSION_SECRET") === "Configured" ? "Configured" : "Not configured",
    },
    queue: {
      queued: metrics.queuedJobs,
      processing: metrics.processingJobs,
      activeCap: policy.current().globalActiveCap,
      oldestQueuedMs: metrics.queueOldestAge || 0,
      activeWorker: metrics.processingJobs > 0 ? 1 : 0,
    },
    durations,
  };
}

function serviceStatus(metrics, breaker, maintenance) {
  if (maintenance.paused) return "maintenance";
  if (!metrics.agentOnline) return "offline";
  if (breaker.state === "OPEN") return "degraded";
  if (metrics.queuedJobs + metrics.processingJobs >= policy.current().globalActiveCap) return "busy";
  return "normal";
}

function pipeline(metrics, summary) {
  const now = Date.now();
  const agentAge = metrics.lastHeartbeatAge;
  const schoolErrors = (summary.errors && (summary.errors.TIMEOUT || 0) + (summary.errors.AUTH_PAGE_CHANGED || 0) + (summary.errors.STRUCTURE_CHANGED || 0) + (summary.errors.AGENT_OFFLINE || 0)) || 0;
  return [
    { id: "miniprogram", label: "小程序接口", technical: "Mini Program API", status: "ok", lastSuccessAt: metrics.lastSuccessAt, lastError: "", latencyMs: summary.avgDurationMs || 0, errors: 0 },
    { id: "broker", label: "同步调度服务", technical: "Campus Sync Broker", status: control.snapshot().paused ? "maintenance" : "ok", lastSuccessAt: metrics.lastSuccessAt, lastError: "", latencyMs: summary.avgDurationMs || 0, errors: summary.systemFailures || 0 },
    { id: "agent", label: "校内同步节点", technical: "WYZ Agent", status: metrics.agentOnline ? "online" : "offline", lastSuccessAt: agentAge == null ? null : now - agentAge, lastError: metrics.agentOnline ? "" : "AGENT_OFFLINE", latencyMs: agentAge, errors: summary.errors.AGENT_OFFLINE || 0 },
    { id: "school", label: "学校系统", technical: "School Gateway", status: metrics.lastSuccessAt ? "inferred" : "unknown", schoolNote: metrics.lastSuccessAt ? "最近真实任务正常" : "暂无近期真实任务", lastSuccessAt: metrics.lastSuccessAt, lastError: schoolErrors ? "SYSTEM" : "", latencyMs: summary.avgDurationMs || 0, errors: schoolErrors },
  ];
}

function estimatedWait(metrics, summary) {
  const median = summary.p50DurationMs || summary.avgDurationMs || 0;
  return Math.max(0, (metrics.queuedJobs || 0) * median);
}

function queueSafety(p95DurationMs) {
  const cap = policy.current().globalActiveCap;
  const jobTtlMs = jobStore.JOB_TTL_MS;
  const p95 = Math.max(0, Number(p95DurationMs) || 0);
  const estimatedWorstTailMs = Math.max(0, cap - 1) * p95;
  return {
    workerConcurrency: 1,
    jobTtlMs,
    p95DurationMs: p95,
    globalActiveCap: cap,
    estimatedWorstTailMs,
    tailExceedsTtl: p95 > 0 && estimatedWorstTailMs > jobTtlMs,
  };
}

function deploymentShort() {
  const raw = String(process.env.FOSU_DEPLOY_COMMIT_SHA || process.env.DEPLOY_SHA || "").trim().toLowerCase();
  return /^[a-f0-9]{7,40}$/.test(raw) ? raw.slice(0, 7) : "";
}

function recommendation(input) {
  const action = [];
  const heartbeatAgeMs = Number(input.heartbeatAgeMs);
  if (input.agentOnline === false) action.push("agent_offline");
  if (Number.isFinite(heartbeatAgeMs) && heartbeatAgeMs > 90000) action.push("heartbeat_stale");
  if (input.circuit === "OPEN") action.push("circuit_open");
  if (Number(input.systemFailureRate) > 15) action.push("system_failure_rate");
  if (input.tailExceedsTtl) action.push("tail_exceeds_ttl");
  if (Number(input.p95DurationMs) > 15000) action.push("p95_slow");
  if (input.storageFailed) action.push("storage_failure");
  if (input.policyInvalid) action.push("policy_invalid");
  if (action.length) return { level: "action", label: "需处理", reasons: action };
  const watch = [];
  if (input.paused) watch.push("paused");
  if (Number(input.systemFailureRate) > 5) watch.push("system_failure_watch");
  const challengeAttempts = Number(input.attempts || 0);
  if (challengeAttempts >= 8 && Number(input.schoolChallengeRate) >= 30) watch.push("challenge_rate");
  if (watch.length) return { level: "watch", label: "观察", reasons: watch };
  return { level: "normal", label: "正常", reasons: [] };
}

function criticalSnapshot() {
  const now = Date.now();
  const metrics = broker.metrics();
  const breaker = circuit.snapshot(now);
  const maintenance = control.snapshot();
  const rules = policy.snapshot();
  const summary = { avgDurationMs: 0, systemFailures: 0, errors: {} };
  telemetry.observeRuntime({ queued: metrics.queuedJobs + metrics.processingJobs, heartbeatAgeMs: metrics.lastHeartbeatAge || 0 });
  const safety = queueSafety(telemetry.memoryP95());
  return {
    generatedAt: new Date(now).toISOString(),
    service: {
      status: serviceStatus(metrics, breaker, maintenance),
      maintenance,
      agent: {
        online: metrics.agentOnline,
        lastHeartbeatAgeMs: metrics.lastHeartbeatAge,
        workerConcurrency: 1,
        deploymentShort: deploymentShort(),
      },
      queue: {
        queued: metrics.queuedJobs,
        processing: metrics.processingJobs,
        active: metrics.queuedJobs + metrics.processingJobs,
        cap: rules.globalActiveCap,
        oldestQueuedMs: metrics.queueOldestAge || 0,
        activeWorker: metrics.processingJobs > 0 ? 1 : 0,
      },
      circuit: { state: breaker.state },
      pipeline: pipeline(metrics, summary),
      securityPosture: breaker.state === "OPEN" ? "circuit_open" : "normal",
      lastSuccessAt: metrics.lastSuccessAt || null,
    },
    queueSafety: safety,
    recommendation: recommendation({
      agentOnline: metrics.agentOnline,
      heartbeatAgeMs: metrics.lastHeartbeatAge,
      circuit: breaker.state,
      paused: maintenance.paused === true,
      tailExceedsTtl: safety.tailExceedsTtl,
      storageFailed: maintenance.storageStatus === "invalid",
      policyInvalid: rules.storageStatus === "invalid",
    }),
    policy: {
      rateLimit: rules.rateLimit,
      rateWindowSeconds: rules.rateWindowSeconds,
      dailyLimit: rules.dailyLimit,
      globalActiveCap: rules.globalActiveCap,
      revision: rules.revision,
      source: rules.source,
      updatedAt: rules.updatedAt,
      updatedBy: rules.updatedBy,
      storageStatus: rules.storageStatus,
      jobTtlSeconds: rules.jobTtlSeconds,
    },
  };
}

function overview() {
  const now = Date.now();
  const metrics = broker.metrics();
  const day = telemetry.overview("24h", now);
  const breaker = circuit.snapshot(now);
  const maintenance = control.snapshot();
  const status = serviceStatus(metrics, breaker, maintenance);
  telemetry.observeRuntime({ queued: metrics.queuedJobs + metrics.processingJobs, heartbeatAgeMs: metrics.lastHeartbeatAge || 0 });
  const safety = queueSafety(day.p95DurationMs);
  return {
    status,
    maintenance,
    agent: {
      online: metrics.agentOnline,
      lastHeartbeatAgeMs: metrics.lastHeartbeatAge,
      workerConcurrency: 1,
      deploymentShort: deploymentShort(),
    },
    queue: {
      queued: metrics.queuedJobs,
      processing: metrics.processingJobs,
      active: metrics.queuedJobs + metrics.processingJobs,
      cap: policy.current().globalActiveCap,
      oldestQueuedMs: metrics.queueOldestAge || 0,
      activeWorker: metrics.processingJobs > 0 ? 1 : 0,
      estimatedWaitMs: estimatedWait(metrics, day),
      estimateOnly: true,
    },
    window24h: day,
    performance: {
      avgDurationMs: day.avgDurationMs,
      p50DurationMs: day.p50DurationMs,
      p95DurationMs: day.p95DurationMs,
      p99DurationMs: day.p99DurationMs,
      queueWaitP95Ms: day.queueWaitP95Ms,
      stageLatency: day.stageLatency || null,
      schoolChallenges: day.schoolChallenges || 0,
      lastSuccessAt: metrics.lastSuccessAt,
    },
    circuit: breaker,
    pipeline: pipeline(metrics, day),
    errors: day.errors || {},
    securityPosture: securityPosture(breaker),
    queueSafety: safety,
    challengeCooldowns: challengeCooldown.activeCount(now),
    recommendation: recommendation({
      agentOnline: metrics.agentOnline,
      heartbeatAgeMs: metrics.lastHeartbeatAge,
      circuit: breaker.state,
      systemFailureRate: day.systemFailureRate,
      attempts: day.attempts,
      schoolChallengeRate: day.schoolChallengeRate,
      p95DurationMs: day.stageLatency && day.stageLatency.total ? day.stageLatency.total.p95 : null,
      paused: maintenance.paused === true,
      tailExceedsTtl: safety.tailExceedsTtl,
      storageFailed: maintenance.storageStatus === "invalid",
      policyInvalid: policy.snapshot().storageStatus === "invalid",
    }),
  };
}

function securityPosture(breaker) {
  const summary = securitySummary();
  const limited = (summary.reasons.CAMPUS_SYNC_RATE_LIMITED || 0) + (summary.reasons.IMPORT_RATE_LIMITED || 0);
  if (breaker.state === "OPEN") return "circuit_open";
  if (limited > 0) return "rate_limit";
  if (summary.total > 0) return "watch";
  return "normal";
}

function securitySummary() {
  const summary = getSecurityEventSummary();
  const recent = (summary.recentEvents || []).filter((item) => item.event === "campus-sync-security" || String(item.reasonCode || "").indexOf("CAMPUS_") === 0);
  const reasons = {};
  recent.forEach((item) => {
    const code = item.reasonCode || "UNSPECIFIED";
    reasons[code] = (reasons[code] || 0) + (item.count || 1);
  });
  return {
    total: recent.reduce((sum, item) => sum + (item.count || 1), 0),
    reasons,
    recent: recent.slice(0, 30).map((item) => ({
      time: item.time,
      reasonCode: item.reasonCode,
      requestId: item.requestId || "",
      principalHashPrefix: item.openidHashPrefix || "",
      anonymizedIp: item.anonymizedIp || "",
      count: item.count || 1,
    })),
    suspensions: abuse.listSuspensions(Date.now()),
  };
}

function diagnose() {
  const now = Date.now();
  const cooldownMs = Math.max(5000, numberEnv("CAMPUS_SYNC_DIAGNOSE_COOLDOWN_MS", 30000));
  if (diagnoseAt && now - diagnoseAt < cooldownMs) {
    const error = new Error("DIAGNOSE_COOLDOWN");
    error.code = "DIAGNOSE_COOLDOWN";
    error.retryAfterMs = cooldownMs - (now - diagnoseAt);
    throw error;
  }
  diagnoseAt = now;
  const metrics = broker.metrics();
  const storage = telemetry.storageStats();
  const rules = policy.snapshot();
  const maintenance = control.snapshot();
  const writable = quota.diskWritable();
  const quotaHealth = quota.health();
  return {
    name: "Campus Sync Production Diagnostics",
    checkedAt: new Date(now).toISOString(),
    schoolContact: false,
    miniprogramApi: "ok",
    broker: maintenance.paused ? "maintenance" : "ok",
    agentHeartbeat: metrics.agentOnline ? "online" : "offline",
    lastHeartbeatAgeMs: metrics.lastHeartbeatAge,
    workerConcurrency: 1,
    queue: metrics.queuedJobs,
    processing: metrics.processingJobs,
    circuit: circuit.snapshot(now).state,
    maintenance: maintenance.paused ? "paused" : "running",
    policyStorage: rules.storageStatus === "invalid" ? "invalid" : "ok",
    quotaStorage: quotaHealth && quotaHealth.healthy ? "ok" : "invalid",
    telemetryStorage: storage.diskBytes > storage.storageCapBytes ? "over-cap" : "ok",
    writable: writable ? "writable" : "read-only",
    deployment: deploymentShort(),
    wyzProtocol: "compatible",
    runtimeConfig: "ok",
    telemetry: {
      queuedWrites: storage.queuedWrites,
      diskBytes: storage.diskBytes,
      storageCapBytes: storage.storageCapBytes,
    },
    policy: { source: rules.source, healthy: rules.storageStatus !== "invalid" },
    quota: { healthy: quotaHealth.healthy === true },
    diskWritable: writable,
    lastSuccessAt: metrics.lastSuccessAt,
    schoolGateway: "未访问",
  };
}

function resetDiagnoseForTests() {
  diagnoseAt = 0;
}

module.exports = {
  criticalSnapshot,
  diagnose,
  queueSafety,
  recommendation,
  overview,
  resetDiagnoseForTests,
  runtimeConfig,
  securitySummary,
};
