const { getClientIpInfo } = require("../utils/clientIp");
const { recordSecurityEvent } = require("./securityEventService");
const { getSecurityMode } = require("./securityModeService");

const DEFAULT_PROFILES = {
  "session-bootstrap": { windowMs: 10 * 60 * 1000, limit: 10, burst: 3 },
  "static-ticket": { windowMs: 10 * 60 * 1000, limit: 20, burst: 5 },
  "dynamic-read": { windowMs: 60 * 1000, limit: 180, burst: 60 },
  search: { windowMs: 60 * 1000, limit: 60, burst: 20 },
  detail: { windowMs: 60 * 1000, limit: 240, burst: 80 },
  "feedback-write": { windowMs: 60 * 60 * 1000, limit: 10, burst: 3 },
  "admin-login": { windowMs: 10 * 60 * 1000, limit: 12, burst: 4 },
};

const MAX_KEYS = Math.max(100, Number(process.env.FOSU_RATE_LIMIT_MAX_KEYS || 5000) || 5000);
const buckets = new Map();

function getProfile(name) {
  const defaults = DEFAULT_PROFILES[name] || DEFAULT_PROFILES["dynamic-read"];
  const prefix = `FOSU_RATE_${String(name || "dynamic-read").toUpperCase().replace(/[^A-Z0-9]+/g, "_")}`;
  return {
    windowMs: Math.max(1000, Number(process.env[`${prefix}_WINDOW_MS`] || defaults.windowMs) || defaults.windowMs),
    limit: Math.max(1, Number(process.env[`${prefix}_LIMIT`] || defaults.limit) || defaults.limit),
    burst: Math.max(1, Number(process.env[`${prefix}_BURST`] || defaults.burst) || defaults.burst),
  };
}

function cleanup(now = Date.now()) {
  for (const [key, bucket] of buckets.entries()) {
    if (bucket.resetAt <= now) {
      buckets.delete(key);
    }
  }
  if (buckets.size <= MAX_KEYS) return;
  const overflow = buckets.size - MAX_KEYS;
  Array.from(buckets.entries())
    .sort((left, right) => left[1].resetAt - right[1].resetAt)
    .slice(0, overflow)
    .forEach(([key]) => buckets.delete(key));
}

function getDimension(req, dimension) {
  if (dimension === "session") {
    return req.fosuSession && (req.fosuSession.sessionId || req.fosuSession.sessionIdHash || req.fosuSession.openidHash);
  }
  if (dimension === "openid") {
    return req.fosuSession && req.fosuSession.openidHash;
  }
  const ipInfo = req.clientIpInfo || getClientIpInfo(req);
  req.clientIpInfo = ipInfo;
  return ipInfo.effectiveIp || "unknown";
}

function checkRateLimit(profileName, keyPart, options = {}) {
  const profile = getProfile(profileName);
  const now = Date.now();
  cleanup(now);
  const key = `${profileName}:${keyPart || "anonymous"}`;
  let bucket = buckets.get(key);
  if (!bucket || bucket.resetAt <= now) {
    bucket = { count: 0, resetAt: now + profile.windowMs };
    buckets.set(key, bucket);
  }
  bucket.count += 1;
  const allowed = bucket.count <= (options.burstOnly ? profile.burst : profile.limit + profile.burst);
  return {
    allowed,
    count: bucket.count,
    limit: profile.limit,
    burst: profile.burst,
    resetAt: bucket.resetAt,
    retryAfterSeconds: Math.max(1, Math.ceil((bucket.resetAt - now) / 1000)),
  };
}

function rateLimitMiddleware(profileName, options = {}) {
  const dimension = options.dimension || "ip";
  return (req, res, next) => {
    const mode = getSecurityMode();
    const keyPart = getDimension(req, dimension) || getDimension(req, "ip");
    const result = checkRateLimit(profileName, keyPart);
    if (!result.allowed) {
      recordSecurityEvent(mode.observeOnly ? "security-rate-limit-observed" : "security-rate-limit-enforced", {
        route: req.path,
        method: req.method,
        mode: mode.mode,
        anonymizedIp: (req.clientIpInfo || getClientIpInfo(req)).anonymizedIp,
        reasonCode: `RATE_LIMIT_${profileName}`,
      });
      if (mode.observeOnly || options.observeOnly) {
        return next();
      }
      res.setHeader("Retry-After", String(result.retryAfterSeconds));
      return res.status(429).json({
        success: false,
        code: "RATE_LIMITED",
        reasonCode: `RATE_LIMIT_${profileName}`,
        retryAfter: result.retryAfterSeconds,
        message: "请求过于频繁，请稍后再试。",
      });
    }
    return next();
  };
}

function getRateLimitStats() {
  cleanup();
  return {
    keyCount: buckets.size,
    maxKeys: MAX_KEYS,
    profiles: Object.keys(DEFAULT_PROFILES),
  };
}

module.exports = {
  checkRateLimit,
  getRateLimitStats,
  getProfile,
  rateLimitMiddleware,
};
