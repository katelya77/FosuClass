const crypto = require("crypto");

const WINDOW_MS = 10 * 60 * 1000;
const DEFAULT_IP_LIMIT = 12;
const STRICT_LIMIT = 3;
const buckets = new Map();

function nowMs() {
  return Date.now();
}

function hashValue(value) {
  return crypto.createHash("sha256").update(String(value || "")).digest("hex").slice(0, 24);
}

function cleanup(now = nowMs()) {
  for (const [key, bucket] of buckets.entries()) {
    if (!bucket || Number(bucket.resetAtMs || 0) <= now) {
      buckets.delete(key);
    }
  }
}

function checkBucket(key, limit) {
  const now = nowMs();
  cleanup(now);
  let bucket = buckets.get(key);
  if (!bucket || bucket.resetAtMs <= now) {
    bucket = { count: 0, resetAtMs: now + WINDOW_MS };
    buckets.set(key, bucket);
  }
  bucket.count += 1;
  const allowed = bucket.count <= limit;
  return {
    allowed,
    count: bucket.count,
    limit,
    retryAfterSeconds: Math.max(1, Math.ceil((bucket.resetAtMs - now) / 1000)),
  };
}

function assertImportAttemptAllowed(input = {}) {
  if (String(process.env.FOSU_IMPORT_RATE_LIMIT_ENABLED || "true") === "false") {
    return { allowed: true };
  }

  const ipLimit = Math.max(3, Number(process.env.FOSU_IMPORT_IP_RATE_LIMIT_10M || DEFAULT_IP_LIMIT) || DEFAULT_IP_LIMIT);
  const checks = [
    ["user", input.userKey, STRICT_LIMIT],
    ["student", hashValue(input.studentId), STRICT_LIMIT],
    ["ip", hashValue(input.ip), ipLimit],
  ].filter((item) => item[1]);

  for (const [kind, keyPart, limit] of checks) {
    const result = checkBucket(`fosu-apaas-import:${kind}:${keyPart}`, limit);
    if (!result.allowed) {
      const error = new Error("IMPORT_RATE_LIMITED");
      error.code = "IMPORT_RATE_LIMITED";
      error.kind = kind;
      error.retryAfterSeconds = result.retryAfterSeconds;
      throw error;
    }
  }

  return { allowed: true };
}

function __resetForTest() {
  buckets.clear();
}

module.exports = {
  __resetForTest,
  assertImportAttemptAllowed,
};
