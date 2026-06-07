const { safeLog } = require("../utils/safeLogger");

const MAX_EVENTS = Math.max(100, Number(process.env.FOSU_SECURITY_EVENT_MAX || 500) || 500);
const RETENTION_MS = Math.max(60_000, Number(process.env.FOSU_SECURITY_EVENT_RETENTION_MS || 24 * 60 * 60 * 1000) || 24 * 60 * 60 * 1000);
const events = [];

function nowIso() {
  return new Date().toISOString();
}

function redactPrefix(value, length = 8) {
  const text = String(value || "");
  return text ? text.slice(0, length) : "";
}

function prune(now = Date.now()) {
  const minTime = now - RETENTION_MS;
  while (events.length && Date.parse(events[0].time || 0) < minTime) {
    events.shift();
  }
  while (events.length > MAX_EVENTS) {
    events.shift();
  }
}

function recordSecurityEvent(event, payload = {}) {
  const item = {
    event,
    time: payload.time || nowIso(),
    requestId: payload.requestId || "",
    route: payload.route || payload.path || "",
    method: payload.method || "",
    mode: payload.mode || "",
    anonymizedIp: payload.anonymizedIp || "",
    openidHashPrefix: redactPrefix(payload.openidHashPrefix || payload.openidHash),
    sessionIdPrefix: redactPrefix(payload.sessionIdPrefix || payload.sessionIdHash),
    reasonCode: payload.reasonCode || payload.code || "",
    latencyMs: Number(payload.latencyMs || 0) || 0,
  };
  if (payload.clientBuildId) item.clientBuildId = String(payload.clientBuildId).slice(0, 96);
  if (payload.gitCommitShortSha) item.gitCommitShortSha = String(payload.gitCommitShortSha).slice(0, 24);
  if (payload.releaseVersion) item.releaseVersion = String(payload.releaseVersion).slice(0, 96);
  if (payload.miniprogramVersion) item.miniprogramVersion = String(payload.miniprogramVersion).slice(0, 24);
  if (payload.requestPipelineVersion) item.requestPipelineVersion = String(payload.requestPipelineVersion).slice(0, 48);
  if (Object.prototype.hasOwnProperty.call(payload, "sessionHeaderAttached")) item.sessionHeaderAttached = payload.sessionHeaderAttached === true;
  if (Object.prototype.hasOwnProperty.call(payload, "staticTicketAttached")) item.staticTicketAttached = payload.staticTicketAttached === true;
  if (payload.platform) item.platform = String(payload.platform).slice(0, 32);
  events.push(item);
  prune();
  safeLog(event, item);
  return item;
}

function getSecurityEventSummary() {
  prune();
  const counts = events.reduce((acc, item) => {
    acc[item.event] = (acc[item.event] || 0) + 1;
    return acc;
  }, {});
  const reasonCounts = events.reduce((acc, item) => {
    const reason = item.reasonCode || "UNSPECIFIED";
    acc[reason] = (acc[reason] || 0) + 1;
    return acc;
  }, {});
  const bootstrapLatencies = events
    .filter((item) => item.event === "security-session-bootstrap-success" && item.latencyMs > 0)
    .map((item) => item.latencyMs)
    .sort((left, right) => left - right);
  const percentile = (values, ratio) => {
    if (!values.length) return 0;
    const index = Math.min(values.length - 1, Math.max(0, Math.ceil(values.length * ratio) - 1));
    return values[index];
  };
  const clientChecks = events.filter((item) => item.event === "security-client-check-success");
  const latestClientCheck = clientChecks.length ? clientChecks[clientChecks.length - 1] : null;
  const buildMap = {};
  clientChecks.forEach((item) => {
    const key = item.clientBuildId || "unknown";
    if (!buildMap[key]) {
      buildMap[key] = {
        clientBuildId: item.clientBuildId,
        gitCommitShortSha: item.gitCommitShortSha,
        releaseVersion: item.releaseVersion,
        miniprogramVersion: item.miniprogramVersion,
        requestPipelineVersion: item.requestPipelineVersion,
        count: 0,
        latestAt: item.time,
      };
    }
    buildMap[key].count += 1;
    buildMap[key].latestAt = item.time;
  });
  return {
    success: true,
    windowMs: RETENTION_MS,
    maxEvents: MAX_EVENTS,
    totalEvents: events.length,
    counts,
    reasonCounts,
    bootstrapLatency: {
      count: bootstrapLatencies.length,
      p50: percentile(bootstrapLatencies, 0.5),
      p95: percentile(bootstrapLatencies, 0.95),
    },
    clientCheck: {
      successCount: clientChecks.length,
      latest: latestClientCheck,
      builds: Object.values(buildMap)
        .sort((left, right) => String(right.latestAt).localeCompare(String(left.latestAt)))
        .slice(0, 20),
    },
    recentEvents: events.slice(-20).reverse(),
  };
}

function clearExpiredSecurityEvents() {
  const before = events.length;
  prune();
  return {
    success: true,
    removed: before - events.length,
    retained: events.length,
  };
}

module.exports = {
  clearExpiredSecurityEvents,
  getSecurityEventSummary,
  recordSecurityEvent,
};
