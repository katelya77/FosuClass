const crypto = require("crypto");

const AUTH_FAILURE_WINDOW_MS = 10 * 60 * 1000;
const DEFAULT_IP_LIMIT = 12;
const STRICT_LIMIT = 3;
const NETWORK_FAILURE_LIMIT = 2;
const CAPTCHA_LIMIT = 1;
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

function networkCooldownMs() {
  return Math.max(10_000, Number(process.env.FOSU_IMPORT_NETWORK_COOLDOWN_SECONDS || 60) * 1000 || 60_000);
}

function captchaCooldownMs() {
  return Math.max(30_000, Number(process.env.FOSU_IMPORT_CAPTCHA_COOLDOWN_SECONDS || 180) * 1000 || 180_000);
}

function checkBucket(key, limit, windowMs = AUTH_FAILURE_WINDOW_MS) {
  const now = nowMs();
  cleanup(now);
  let bucket = buckets.get(key);
  if (!bucket || bucket.resetAtMs <= now) {
    bucket = { count: 0, resetAtMs: now + windowMs };
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

function peekBucket(key, limit) {
  const now = nowMs();
  cleanup(now);
  const bucket = buckets.get(key);
  if (!bucket || bucket.resetAtMs <= now) {
    return {
      allowed: true,
      count: 0,
      limit,
      retryAfterSeconds: 0,
    };
  }
  return {
    allowed: bucket.count < limit,
    count: bucket.count,
    limit,
    retryAfterSeconds: Math.max(1, Math.ceil((bucket.resetAtMs - now) / 1000)),
  };
}

function scopedKeys(input = {}) {
  const studentKey = input.studentId ? hashValue(input.studentId) : "";
  return [
    ["user", input.userKey],
    ["student", studentKey],
  ].filter((item) => item[1]);
}

function cooldownError(kind, result) {
  const error = new Error("IMPORT_RATE_LIMITED");
  error.code = "IMPORT_RATE_LIMITED";
  error.kind = kind;
  error.retryAfterSeconds = result.retryAfterSeconds;
  return error;
}

function assertBucketAvailable(prefix, input, limit, kind) {
  for (const [scope, keyPart] of scopedKeys(input)) {
    const result = peekBucket(`fosu-apaas-import:${prefix}:${scope}:${keyPart}`, limit);
    if (!result.allowed) {
      throw cooldownError(kind || prefix, result);
    }
  }
}

function normalizeFailureCode(code) {
  return String(code || "").trim().toUpperCase();
}

function isNetworkFailureCode(code) {
  return [
    "NETWORK_TIMEOUT",
    "SCHOOL_SYSTEM_TIMEOUT",
    "UPSTREAM_TIMEOUT",
    "CONNECTION_FAILED",
    "CLOUDBASE_SERVICE_UNAVAILABLE",
  ].includes(normalizeFailureCode(code));
}

function isCredentialFailureCode(code) {
  return normalizeFailureCode(code) === "INVALID_CREDENTIALS";
}

function isCaptchaFailureCode(code) {
  return ["CAPTCHA_REQUIRED", "RISK_CONTROL_REQUIRED"].includes(normalizeFailureCode(code));
}

function assertImportAttemptAllowed(input = {}) {
  if (String(process.env.FOSU_IMPORT_RATE_LIMIT_ENABLED || "true") === "false") {
    return { allowed: true };
  }

  const ipLimit = Math.max(3, Number(process.env.FOSU_IMPORT_IP_RATE_LIMIT_10M || DEFAULT_IP_LIMIT) || DEFAULT_IP_LIMIT);
  assertBucketAvailable("auth-failed", input, STRICT_LIMIT, "credential");
  assertBucketAvailable("captcha-required", input, CAPTCHA_LIMIT, "verification");
  assertBucketAvailable("network-failed", input, NETWORK_FAILURE_LIMIT, "network");

  const ipKey = hashValue(input.ip);
  if (ipKey) {
    const result = checkBucket(`fosu-apaas-import:request:ip:${ipKey}`, ipLimit, AUTH_FAILURE_WINDOW_MS);
    if (!result.allowed) {
      throw cooldownError("ip", result);
    }
  }

  return { allowed: true };
}

function recordImportCredentialFailure(input = {}) {
  return recordImportFailure(input, "INVALID_CREDENTIALS");
}

function recordImportFailure(input = {}, code = "") {
  if (String(process.env.FOSU_IMPORT_RATE_LIMIT_ENABLED || "true") === "false") {
    return { recorded: false };
  }
  let prefix = "";
  let limit = 0;
  let windowMs = 0;
  if (isCredentialFailureCode(code)) {
    prefix = "auth-failed";
    limit = STRICT_LIMIT;
    windowMs = AUTH_FAILURE_WINDOW_MS;
  } else if (isCaptchaFailureCode(code)) {
    prefix = "captcha-required";
    limit = CAPTCHA_LIMIT;
    windowMs = captchaCooldownMs();
  } else if (isNetworkFailureCode(code)) {
    prefix = "network-failed";
    limit = NETWORK_FAILURE_LIMIT;
    windowMs = networkCooldownMs();
  } else {
    return { recorded: false, code: normalizeFailureCode(code) };
  }
  scopedKeys(input).forEach(([scope, keyPart]) => {
    checkBucket(`fosu-apaas-import:${prefix}:${scope}:${keyPart}`, limit, windowMs);
  });
  return { recorded: true, code: normalizeFailureCode(code), bucket: prefix };
}

function __resetForTest() {
  buckets.clear();
}

module.exports = {
  __resetForTest,
  assertImportAttemptAllowed,
  recordImportFailure,
  recordImportCredentialFailure,
};
