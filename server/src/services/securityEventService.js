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
  return {
    success: true,
    windowMs: RETENTION_MS,
    maxEvents: MAX_EVENTS,
    totalEvents: events.length,
    counts,
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
