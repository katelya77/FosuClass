const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

const EDGES = [100, 250, 500, 1000, 2000, 4000, 8000, 15000, 30000, 60000, 120000];
const QUEUE_MAX = 800;
const RING_MAX = 400;
const EVENT_RETENTION_MS = 14 * 86400000;
const HOUR_RETENTION_MS = 90 * 86400000;
const STORAGE_CAP_BYTES = 100 * 1024 * 1024;

const queue = [];
const ring = [];
const hours = new Map();
const minutes = new Map();
let dropped = 0;
let flushTimer = null;
let lastDiskBytes = 0;

function opsDir() {
  return path.resolve(process.env.CAMPUS_SYNC_OPS_DIR || path.join(__dirname, "../../storage/ops/campus-sync"));
}

function emptyBucket() {
  return {
    attempts: 0,
    success: 0,
    failed: 0,
    rateLimited: 0,
    busy: 0,
    timeout: 0,
    credentialFailures: 0,
    systemFailures: 0,
    durationCount: 0,
    durationSum: 0,
    queueWaitCount: 0,
    queueWaitSum: 0,
    histogram: EDGES.map(() => 0),
    errors: {},
  };
}

function hourKey(time) {
  return new Date(time).toISOString().slice(0, 13);
}

function minuteKey(time) {
  return Math.floor(Number(time) / 60000);
}

function addSample(bucket, fieldCount, fieldSum, value) {
  const sample = Math.max(0, Number(value) || 0);
  if (!sample && value !== 0) return;
  bucket[fieldCount] += 1;
  bucket[fieldSum] += sample;
}

function addDuration(bucket, value) {
  const sample = Math.max(0, Number(value) || 0);
  bucket.durationCount += 1;
  bucket.durationSum += sample;
  let index = EDGES.findIndex((edge) => sample <= edge);
  if (index < 0) index = EDGES.length - 1;
  bucket.histogram[index] += 1;
}

function percentile(bucket, ratio) {
  const total = bucket.durationCount || 0;
  if (!total) return 0;
  const target = Math.ceil(total * ratio);
  let seen = 0;
  for (let index = 0; index < bucket.histogram.length; index += 1) {
    seen += bucket.histogram[index];
    if (seen >= target) return EDGES[index];
  }
  return EDGES[EDGES.length - 1];
}

function touch(time) {
  const hour = hourKey(time);
  const minute = minuteKey(time);
  if (!hours.has(hour)) hours.set(hour, emptyBucket());
  if (!minutes.has(minute)) minutes.set(minute, emptyBucket());
  const minKeep = minuteKey(Date.now()) - 180;
  minutes.forEach((value, key) => {
    if (key < minKeep) minutes.delete(key);
  });
  return { hour: hours.get(hour), minute: minutes.get(minute), hourName: hour };
}

function classify(event) {
  const code = String(event.resultCode || event.errorCode || "");
  const status = String(event.status || "");
  if (code === "INVALID_CREDENTIALS") return "credential";
  if (code === "IMPORT_RATE_LIMITED") return "rate";
  if (code === "CAMPUS_SYNC_BUSY" || code === "CAMPUS_SYNC_DEGRADED") return "busy";
  if (code === "TIMEOUT" || status === "expired") return "timeout";
  if (status === "completed" || code === "OK") return "success";
  if (status === "failed" || status === "expired") return "system";
  return "";
}

function apply(bucket, event) {
  const kind = classify(event);
  if (!kind) return;
  bucket.attempts += 1;
  if (kind === "success") bucket.success += 1;
  if (kind === "credential") bucket.credentialFailures += 1;
  if (kind === "system" || kind === "timeout") {
    bucket.failed += 1;
    bucket.systemFailures += 1;
  }
  if (kind === "timeout") bucket.timeout += 1;
  if (kind === "rate") {
    bucket.rateLimited += 1;
    bucket.attempts += 0;
  }
  if (kind === "busy") bucket.busy += 1;
  if (event.durationMs != null) addDuration(bucket, event.durationMs);
  if (event.queueWaitMs != null) addSample(bucket, "queueWaitCount", "queueWaitSum", event.queueWaitMs);
  if (event.resultCode) bucket.errors[event.resultCode] = (bucket.errors[event.resultCode] || 0) + 1;
}

function record(event) {
  const item = Object.assign({ t: Date.now() }, event || {});
  delete item.password;
  delete item.studentId;
  delete item.openid;
  delete item.cookie;
  delete item.ticket;
  const buckets = touch(item.t);
  apply(buckets.hour, item);
  apply(buckets.minute, item);
  ring.push(item);
  if (ring.length > RING_MAX) ring.shift();
  if (queue.length >= QUEUE_MAX) {
    dropped += 1;
    return item;
  }
  queue.push(item);
  scheduleFlush();
  return item;
}

function recordAttempt(code) {
  return record({
    status: code === "IMPORT_RATE_LIMITED" ? "rejected" : "rejected",
    resultCode: code,
    durationMs: 0,
    queueWaitMs: 0,
  });
}

function scheduleFlush() {
  if (flushTimer) return;
  flushTimer = setTimeout(() => {
    flushTimer = null;
    try {
      flushNow();
    } catch (error) {
      dropped += queue.length;
      queue.length = 0;
    }
  }, 1500);
  if (flushTimer.unref) flushTimer.unref();
}

function dayStamp(time) {
  return new Date(time).toISOString().slice(0, 10);
}

function flushNow() {
  if (!queue.length && !hours.size) return { wrote: 0 };
  const dir = opsDir();
  fs.mkdirSync(dir, { recursive: true });
  const batch = queue.splice(0, queue.length);
  const groups = new Map();
  batch.forEach((item) => {
    const day = dayStamp(item.t);
    if (!groups.has(day)) groups.set(day, []);
    groups.get(day).push(`${JSON.stringify(item)}\n`);
  });
  groups.forEach((lines, day) => {
    fs.appendFileSync(path.join(dir, `events-${day}.jsonl`), lines.join(""));
  });
  const hourGroups = new Map();
  hours.forEach((bucket, key) => {
    const day = key.slice(0, 10);
    if (!hourGroups.has(day)) hourGroups.set(day, {});
    hourGroups.get(day)[key] = bucket;
  });
  hourGroups.forEach((payload, day) => {
    const file = path.join(dir, `hours-${day}.json`);
    let existing = {};
    try {
      existing = JSON.parse(fs.readFileSync(file, "utf8"));
    } catch (error) {
      existing = {};
    }
    Object.keys(payload).forEach((key) => {
      existing[key] = payload[key];
    });
    fs.writeFileSync(file, JSON.stringify(existing));
  });
  enforceCap(dir);
  return { wrote: batch.length };
}

function fileTime(name) {
  const match = String(name).match(/(\d{4}-\d{2}-\d{2})/);
  return match ? Date.parse(`${match[1]}T00:00:00.000Z`) : 0;
}

function enforceCap(dir) {
  let entries = [];
  try {
    entries = fs.readdirSync(dir).map((name) => {
      const full = path.join(dir, name);
      const stat = fs.statSync(full);
      return { name, full, size: stat.size, time: fileTime(name) || stat.mtimeMs };
    });
  } catch (error) {
    return;
  }
  const now = Date.now();
  entries.forEach((entry) => {
    const eventFile = entry.name.startsWith("events-");
    const hourFile = entry.name.startsWith("hours-");
    if (eventFile && entry.time && now - entry.time > EVENT_RETENTION_MS) fs.rmSync(entry.full, { force: true });
    if (hourFile && entry.time && now - entry.time > HOUR_RETENTION_MS) fs.rmSync(entry.full, { force: true });
  });
  entries = entries.filter((entry) => fs.existsSync(entry.full));
  let total = entries.reduce((sum, entry) => sum + entry.size, 0);
  lastDiskBytes = total;
  const removable = entries
    .filter((entry) => entry.name.startsWith("events-") || entry.name.startsWith("hours-"))
    .sort((left, right) => left.time - right.time);
  while (total > STORAGE_CAP_BYTES && removable.length) {
    const oldest = removable.shift();
    total -= oldest.size;
    fs.rmSync(oldest.full, { force: true });
  }
  lastDiskBytes = Math.max(0, total);
}

function mergeBuckets(list) {
  const merged = emptyBucket();
  list.forEach((bucket) => {
    if (!bucket) return;
    ["attempts", "success", "failed", "rateLimited", "busy", "timeout", "credentialFailures", "systemFailures", "durationCount", "durationSum", "queueWaitCount", "queueWaitSum"].forEach((key) => {
      merged[key] += Number(bucket[key] || 0);
    });
    EDGES.forEach((edge, index) => {
      merged.histogram[index] += Number(bucket.histogram && bucket.histogram[index] || 0);
    });
    Object.keys(bucket.errors || {}).forEach((code) => {
      merged.errors[code] = (merged.errors[code] || 0) + Number(bucket.errors[code] || 0);
    });
  });
  return merged;
}

function diskHours() {
  const dir = opsDir();
  const found = new Map();
  let names = [];
  try {
    names = fs.readdirSync(dir).filter((name) => name.startsWith("hours-") && name.endsWith(".json"));
  } catch (error) {
    return found;
  }
  names.forEach((name) => {
    try {
      const parsed = JSON.parse(fs.readFileSync(path.join(dir, name), "utf8"));
      Object.keys(parsed || {}).forEach((key) => found.set(key, parsed[key]));
    } catch (error) {
      // Skip a damaged aggregate file.
    }
  });
  return found;
}

function bucketsForRange(range, now) {
  const current = Number(now || Date.now());
  const span = range === "1h" ? 3600000 : (range === "7d" ? 7 * 86400000 : (range === "30d" ? 30 * 86400000 : 86400000));
  const start = current - span;
  if (range === "1h") {
    const list = [];
    minutes.forEach((bucket, key) => {
      if (key * 60000 >= start) list.push({ key: new Date(key * 60000).toISOString(), bucket });
    });
    return list.sort((left, right) => left.key.localeCompare(right.key));
  }
  const disk = diskHours();
  hours.forEach((bucket, key) => disk.set(key, bucket));
  return Array.from(disk.entries())
    .filter(([key]) => Date.parse(`${key}:00:00.000Z`) >= start - 3600000)
    .sort((left, right) => left[0].localeCompare(right[0]))
    .map(([key, bucket]) => ({ key, bucket }));
}

function summarize(bucket) {
  const attempts = bucket.attempts || 0;
  const system = bucket.systemFailures || 0;
  const credential = bucket.credentialFailures || 0;
  const success = bucket.success || 0;
  const relevant = Math.max(0, attempts - credential);
  return {
    attempts,
    success,
    failed: bucket.failed || 0,
    rateLimited: bucket.rateLimited || 0,
    busy: bucket.busy || 0,
    timeout: bucket.timeout || 0,
    credentialFailures: credential,
    systemFailures: system,
    successRate: relevant ? Math.round((success / relevant) * 1000) / 10 : (success ? 100 : 0),
    systemFailureRate: relevant ? Math.round((system / relevant) * 1000) / 10 : 0,
    credentialFailureRate: attempts ? Math.round((credential / attempts) * 1000) / 10 : 0,
    avgDurationMs: bucket.durationCount ? Math.round(bucket.durationSum / bucket.durationCount) : 0,
    p50DurationMs: percentile(bucket, 0.5),
    p95DurationMs: percentile(bucket, 0.95),
    p99DurationMs: percentile(bucket, 0.99),
    queueWaitP95Ms: bucket.queueWaitCount ? Math.round(bucket.queueWaitSum / bucket.queueWaitCount) : 0,
    errors: bucket.errors || {},
  };
}

function overview(range, now) {
  const series = bucketsForRange(range || "24h", now);
  return summarize(mergeBuckets(series.map((item) => item.bucket)));
}

function timeseries(range, now) {
  return bucketsForRange(range || "24h", now).map((item) => Object.assign({ bucket: item.key }, summarize(item.bucket)));
}

function listRecent(options) {
  const limit = Math.min(50, Math.max(1, Number(options && options.limit || 50)));
  const status = options && options.status || "";
  const errorCode = options && options.errorCode || "";
  const from = options && options.from ? Date.parse(options.from) : 0;
  const to = options && options.to ? Date.parse(options.to) : 0;
  const cursor = options && options.cursor ? String(options.cursor) : "";
  let rows = ring.filter((item) => {
    if (status && item.status !== status) return false;
    if (errorCode && item.resultCode !== errorCode) return false;
    if (from && item.t < from) return false;
    if (to && item.t > to) return false;
    return true;
  });
  if (cursor) {
    const cursorTime = Number(cursor.split(":")[0] || 0);
    rows = rows.filter((item) => item.t < cursorTime);
  }
  rows.sort((left, right) => right.t - left.t);
  const page = rows.slice(0, limit).map(publicEvent);
  const next = rows.length > limit ? `${page[page.length - 1].t}:${page[page.length - 1].jobIdShort}` : "";
  return { events: page, nextCursor: next };
}

function publicEvent(item) {
  return {
    t: item.t,
    jobIdShort: String(item.jobId || "").slice(0, 8),
    principalHashPrefix: String(item.principalHashPrefix || item.ownerKey || "").slice(0, 8),
    status: item.status || "",
    queueWaitMs: item.queueWaitMs || 0,
    durationMs: item.durationMs || 0,
    courseCount: Number(item.courseCount || 0) || 0,
    retryCount: Number(item.retryCount || 0) || 0,
    resultCode: item.resultCode || "",
    source: item.source || "campus-sync",
    requestId: String(item.requestId || "").slice(0, 32),
  };
}

function storageStats() {
  return {
    dir: opsDir(),
    queuedWrites: queue.length,
    dropped,
    ring: ring.length,
    diskBytes: lastDiskBytes,
    eventRetentionDays: 14,
    hourRetentionDays: 90,
    storageCapBytes: STORAGE_CAP_BYTES,
  };
}

function resetForTests() {
  queue.length = 0;
  ring.length = 0;
  hours.clear();
  minutes.clear();
  dropped = 0;
  lastDiskBytes = 0;
  if (flushTimer) clearTimeout(flushTimer);
  flushTimer = null;
}

module.exports = {
  flushNow,
  listRecent,
  overview,
  record,
  recordAttempt,
  resetForTests,
  storageStats,
  timeseries,
};
