const jobStore = require("./campusSyncJobStore");
const broker = require("./campusSyncBroker");
const circuit = require("./campusSyncCircuitBreaker");
const control = require("./campusSyncControl");
const telemetry = require("./campusSyncTelemetryService");
const abuse = require("./campusSyncAbuseGuard");
const policy = require("./campusSyncPolicyService");
const quota = require("./campusSyncQuotaStore");
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

function recommendation(input) {
  const action = [];
  if (input.agentOnline === false) action.push("agent_offline");
  if (input.circuit === "OPEN") action.push("circuit_open");
  if (Number(input.systemFailureRate) > 15) action.push("system_failure_rate");
  if (input.tailExceedsTtl) action.push("tail_exceeds_ttl");
  if (action.length) return { level: "action", label: "需处理", reasons: action };
  const watch = [];
  if (input.paused) watch.push("paused");
  if (Number(input.systemFailureRate) > 5) watch.push("system_failure_watch");
  if (Number(input.credentialFailureRate) > 20) watch.push("credential_failure_watch");
  if (Number(input.rateLimited) > 0) watch.push("rate_limited");
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
      circuit: breaker.state,
      paused: maintenance.paused === true,
      tailExceedsTtl: safety.tailExceedsTtl,
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
      lastSuccessAt: metrics.lastSuccessAt,
    },
    circuit: breaker,
    pipeline: pipeline(metrics, day),
    errors: day.errors || {},
    securityPosture: securityPosture(breaker),
    queueSafety: safety,
    recommendation: recommendation({
      agentOnline: metrics.agentOnline,
      circuit: breaker.state,
      systemFailureRate: day.systemFailureRate,
      credentialFailureRate: day.credentialFailureRate,
      rateLimited: day.rateLimited,
      paused: maintenance.paused === true,
      tailExceedsTtl: safety.tailExceedsTtl,
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
  return {
    checkedAt: new Date(now).toISOString(),
    miniprogramApi: "ok",
    broker: control.snapshot().paused ? "maintenance" : "ok",
    agentHeartbeat: metrics.agentOnline ? "online" : "offline",
    lastHeartbeatAgeMs: metrics.lastHeartbeatAge,
    runtimeConfig: "ok",
    telemetry: {
      queuedWrites: storage.queuedWrites,
      diskBytes: storage.diskBytes,
      storageCapBytes: storage.storageCapBytes,
    },
    circuit: circuit.snapshot(now).state,
    queue: {
      queued: metrics.queuedJobs,
      processing: metrics.processingJobs,
      active: metrics.queuedJobs + metrics.processingJobs,
    },
    policy: { source: policy.snapshot().source, healthy: true },
    quota: quota.health(),
    diskWritable: quota.diskWritable(),
    lastSuccessAt: metrics.lastSuccessAt,
    schoolGateway: metrics.lastSuccessAt ? "最近真实任务正常" : "暂无近期真实任务",
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
