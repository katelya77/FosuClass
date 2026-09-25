const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const policy = require("./campusSyncPolicyService");

const MAX_USERS = 4000;
const days = new Map();
const windows = new Map();
let loaded = false;
let flushTimer = null;
let dirty = false;

function opsDir() {
  return path.resolve(process.env.CAMPUS_SYNC_OPS_DIR || path.join(__dirname, "../../storage/ops/campus-sync"));
}

function quotaPath() {
  return path.join(opsDir(), "quota.json");
}

function shanghaiDate(now) {
  return new Date(Number(now) + 8 * 3600000).toISOString().slice(0, 10);
}

function nextReset(now) {
  const [year, month, day] = shanghaiDate(now).split("-").map(Number);
  return Date.UTC(year, month - 1, day) - 8 * 3600000 + 86400000;
}

function hashKey(ownerKey) {
  return crypto.createHash("sha256").update(String(ownerKey || "")).digest("hex");
}

function emptyDay() {
  return { users: {}, attempts: 0, success: 0, failed: 0, rateLimited: 0, dailyLimited: 0, shortUsers: {}, dailyUsers: {} };
}

function load() {
  days.clear();
  try {
    const parsed = JSON.parse(fs.readFileSync(quotaPath(), "utf8"));
    const source = parsed && parsed.days && typeof parsed.days === "object" ? parsed.days : {};
    Object.keys(source).forEach((date) => {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return;
      const item = source[date] || {};
      const day = emptyDay();
      day.attempts = Number(item.attempts) || 0;
      day.success = Number(item.success) || 0;
      day.failed = Number(item.failed) || 0;
      day.rateLimited = Number(item.rateLimited) || 0;
      day.dailyLimited = Number(item.dailyLimited) || 0;
      Object.keys(item.users || {}).slice(0, MAX_USERS).forEach((key) => {
        if (/^[a-f0-9]{64}$/.test(key)) day.users[key] = Math.max(0, Number(item.users[key]) || 0);
      });
      ["shortUsers", "dailyUsers"].forEach((field) => {
        Object.keys(item[field] || {}).slice(0, MAX_USERS).forEach((key) => {
          if (/^[a-f0-9]{64}$/.test(key)) day[field][key] = 1;
        });
      });
      days.set(date, day);
    });
  } catch (error) {
    if (error && error.code !== "ENOENT") days.clear();
  }
  loaded = true;
  gc(Date.now());
}

function ensure() {
  if (!loaded) load();
}

function dayOf(date) {
  ensure();
  if (!days.has(date)) days.set(date, emptyDay());
  return days.get(date);
}

function gc(now) {
  const keep = shanghaiDate(now - 3 * 86400000);
  Array.from(days.keys()).forEach((date) => {
    if (date < keep) days.delete(date);
  });
}

function schedule() {
  dirty = true;
  if (flushTimer) return;
  flushTimer = setTimeout(() => {
    flushTimer = null;
    try { flushNow(); } catch (error) { dirty = false; }
  }, 1500);
  if (flushTimer.unref) flushTimer.unref();
}

function flushNow() {
  if (flushTimer) {
    clearTimeout(flushTimer);
    flushTimer = null;
  }
  if (!dirty) return;
  try {
    const dir = opsDir();
    fs.mkdirSync(dir, { recursive: true });
    const payload = { days: {} };
    days.forEach((day, date) => { payload.days[date] = day; });
    const temp = `${quotaPath()}.tmp`;
    fs.writeFileSync(temp, JSON.stringify(payload));
    fs.renameSync(temp, quotaPath());
    dirty = false;
  } catch (error) {
    dirty = false;
  }
}

function publicQuota(used, limit, now, retryAfterSeconds) {
  return {
    dailyLimit: limit,
    dailyUsed: used,
    dailyRemaining: Math.max(0, limit - used),
    resetAt: new Date(nextReset(now)).toISOString(),
    retryAfterSeconds: Math.max(0, Number(retryAfterSeconds) || 0),
  };
}

function consume(ownerKey, now) {
  const current = Number(now || Date.now());
  const rules = policy.current();
  const key = hashKey(ownerKey);
  const date = shanghaiDate(current);
  const day = dayOf(date);
  const windowMs = rules.rateWindowSeconds * 1000;
  const stamps = (windows.get(key) || []).filter((stamp) => current - stamp < windowMs);
  const used = Number(day.users[key] || 0);
  if (stamps.length >= rules.rateLimit) {
    day.rateLimited += 1;
    if (Object.keys(day.shortUsers).length < MAX_USERS) day.shortUsers[key] = 1;
    windows.set(key, stamps);
    schedule();
    const retry = stamps.length ? Math.ceil((stamps[0] + windowMs - current) / 1000) : rules.rateWindowSeconds;
    return { ok: false, code: "CAMPUS_SYNC_RATE_LIMITED", public: publicQuota(used, rules.dailyLimit, current, retry) };
  }
  if (used >= rules.dailyLimit) {
    day.dailyLimited += 1;
    if (Object.keys(day.dailyUsers).length < MAX_USERS) day.dailyUsers[key] = 1;
    schedule();
    return { ok: false, code: "CAMPUS_SYNC_DAILY_LIMIT", public: publicQuota(used, rules.dailyLimit, current, Math.ceil((nextReset(current) - current) / 1000)) };
  }
  if (Object.keys(day.users).length >= MAX_USERS && day.users[key] == null) {
    return { ok: false, code: "CAMPUS_SYNC_BUSY", public: publicQuota(used, rules.dailyLimit, current, 30) };
  }
  stamps.push(current);
  windows.set(key, stamps);
  day.users[key] = used + 1;
  day.attempts += 1;
  schedule();
  return { ok: true, public: publicQuota(used + 1, rules.dailyLimit, current, 0) };
}

function noteTerminal(status) {
  try {
    const day = dayOf(shanghaiDate(Date.now()));
    if (status === "completed") day.success += 1;
    else if (status === "failed" || status === "expired") day.failed += 1;
    schedule();
  } catch (error) {}
}

function usage(now) {
  const current = Number(now || Date.now());
  const rules = policy.current();
  const date = shanghaiDate(current);
  const day = dayOf(date);
  const counts = Object.keys(day.users).map((key) => Number(day.users[key]) || 0);
  const buckets = { zero: 0, oneToThree: 0, fourToSeven: 0, eightPlus: 0 };
  let maxAccepted = 0;
  let top = "";
  Object.keys(day.users).forEach((key) => {
    const accepted = Number(day.users[key]) || 0;
    const remaining = Math.max(0, rules.dailyLimit - accepted);
    if (remaining === 0) buckets.zero += 1;
    else if (remaining <= 3) buckets.oneToThree += 1;
    else if (remaining <= 7) buckets.fourToSeven += 1;
    else buckets.eightPlus += 1;
    if (accepted >= maxAccepted) {
      maxAccepted = accepted;
      top = key.slice(0, 6);
    }
  });
  return {
    date,
    timezone: "Asia/Shanghai",
    resetLabel: "北京时间每日 00:00 重置",
    resetAt: new Date(nextReset(current)).toISOString(),
    attempts: day.attempts,
    success: day.success,
    failed: day.failed,
    rateLimited: day.rateLimited,
    dailyLimited: day.dailyLimited,
    activeUsers: counts.length,
    shortLimitedUsers: Object.keys(day.shortUsers).length,
    dailyLimitedUsers: Object.keys(day.dailyUsers).length,
    maxAccepted,
    topUserPrefix: top ? `${top}xx` : "",
    remaining: buckets,
  };
}

function acceptedFor(ownerKey, now) {
  const day = dayOf(shanghaiDate(now || Date.now()));
  return Number(day.users[hashKey(ownerKey)] || 0);
}

function health() {
  ensure();
  return { healthy: true, date: shanghaiDate(Date.now()), writable: true };
}

function diskWritable() {
  try {
    const dir = opsDir();
    fs.mkdirSync(dir, { recursive: true });
    const probe = path.join(dir, ".quota-probe");
    fs.writeFileSync(probe, "ok");
    fs.rmSync(probe, { force: true });
    return true;
  } catch (error) {
    return false;
  }
}

function reload() {
  if (flushTimer) clearTimeout(flushTimer);
  flushTimer = null;
  dirty = false;
  loaded = false;
  load();
}

function resetForTests() {
  if (flushTimer) clearTimeout(flushTimer);
  flushTimer = null;
  dirty = false;
  days.clear();
  windows.clear();
  loaded = true;
  try { fs.rmSync(quotaPath(), { force: true }); } catch (error) {}
}

process.once("exit", () => {
  try { flushNow(); } catch (error) {}
});

module.exports = {
  acceptedFor,
  consume,
  diskWritable,
  flushNow,
  hashKey,
  health,
  nextReset,
  noteTerminal,
  reload,
  resetForTests,
  shanghaiDate,
  usage,
};
