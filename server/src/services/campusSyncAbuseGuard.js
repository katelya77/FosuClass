const { getClientIpInfo } = require("../utils/clientIp");

function numberEnv(name, fallback) {
  const parsed = Number(process.env[name]);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return parsed;
}

const principals = new Map();
const sessions = new Map();
const ips = new Map();
const polls = new Map();

function bucket(map, key, now, windowMs) {
  const current = map.get(key) || { stamps: [], suspendUntil: 0 };
  current.stamps = current.stamps.filter((stamp) => now - stamp < windowMs);
  map.set(key, current);
  return current;
}

function pruneMap(map, now, windowMs) {
  map.forEach((value, key) => {
    value.stamps = (value.stamps || []).filter((stamp) => now - stamp < windowMs);
    if (!value.stamps.length && !(value.suspendUntil > now)) map.delete(key);
  });
}

function noteSecurityFailure(principal, now) {
  const key = String(principal || "");
  if (!key) return { suspended: false };
  const current = Number(now || Date.now());
  const windowMs = numberEnv("CAMPUS_SYNC_ABUSE_WINDOW_MS", 600000);
  const limit = Math.floor(numberEnv("CAMPUS_SYNC_ABUSE_FAILS", 40));
  const suspendMs = numberEnv("CAMPUS_SYNC_ABUSE_SUSPEND_MS", 900000);
  const item = bucket(principals, key, current, windowMs);
  item.stamps.push(current);
  if (item.stamps.length >= limit) item.suspendUntil = current + suspendMs;
  return { suspended: item.suspendUntil > current, until: item.suspendUntil || 0 };
}

function suspension(principal, now) {
  const key = String(principal || "");
  if (!key) return null;
  const item = principals.get(key);
  const current = Number(now || Date.now());
  if (!item || !(item.suspendUntil > current)) return null;
  return { principalHashPrefix: key.slice(0, 8), until: item.suspendUntil };
}

function noteAnonymous(req, now) {
  const info = req && req.clientIpInfo || getClientIpInfo(req || {});
  const key = info.effectiveIp || info.socketIp || "unknown";
  const current = Number(now || Date.now());
  const windowMs = numberEnv("CAMPUS_SYNC_ANON_WINDOW_MS", 60000);
  const limit = Math.floor(numberEnv("CAMPUS_SYNC_ANON_IP_LIMIT", 30));
  const item = bucket(ips, key, current, windowMs);
  item.stamps.push(current);
  return {
    limited: item.stamps.length > limit,
    anonymizedIp: info.anonymizedIp || "",
    count: item.stamps.length,
  };
}

function noteSession(sessionIdHash, now) {
  const key = String(sessionIdHash || "");
  if (!key) return { limited: false };
  const current = Number(now || Date.now());
  const item = bucket(sessions, key, current, 600000);
  item.stamps.push(current);
  return { limited: item.stamps.length > Math.floor(numberEnv("CAMPUS_SYNC_SESSION_FAILS", 60)) };
}

function notePoll(principal, now) {
  const key = String(principal || "");
  if (!key) return { limited: false };
  const current = Number(now || Date.now());
  const item = bucket(polls, key, current, 60000);
  item.stamps.push(current);
  const limit = Math.floor(numberEnv("CAMPUS_SYNC_POLL_LIMIT", 120));
  return { limited: item.stamps.length > limit };
}

function listSuspensions(now) {
  const current = Number(now || Date.now());
  const rows = [];
  principals.forEach((item, key) => {
    if (item.suspendUntil > current) {
      rows.push({
        principalHashPrefix: String(key).slice(0, 8),
        until: item.suspendUntil,
        reasonCode: "ABUSE_TEMPORARY_BLOCK",
      });
    }
  });
  return rows;
}

function resetForTests() {
  principals.clear();
  sessions.clear();
  ips.clear();
  polls.clear();
}

function compact(now) {
  const current = Number(now || Date.now());
  pruneMap(principals, current, numberEnv("CAMPUS_SYNC_ABUSE_WINDOW_MS", 600000));
  pruneMap(sessions, current, 600000);
  pruneMap(ips, current, numberEnv("CAMPUS_SYNC_ANON_WINDOW_MS", 60000));
  pruneMap(polls, current, 60000);
}

module.exports = {
  compact,
  listSuspensions,
  noteAnonymous,
  notePoll,
  noteSecurityFailure,
  noteSession,
  resetForTests,
  suspension,
};
