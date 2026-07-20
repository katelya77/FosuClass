const crypto = require("crypto");
const axios = require("axios");
const config = require("../config");
const { getClientIpInfo } = require("./clientIp");
const { safeLog } = require("./safeLogger");
const { recordSecurityEvent } = require("../services/securityEventService");
const { getSecurityMode, getSecurityStatus } = require("../services/securityModeService");

const BAD_USER_AGENT_PATTERN = /(curl|wget|python-requests|scrapy|httpclient|libwww-perl|go-http-client)/i;
const DEFAULT_DYNAMIC_BODY_LIMIT = 128 * 1024;
const SESSION_TOKEN_VERSION = 2;
const DEFAULT_SESSION_TTL_SECONDS = 2 * 60 * 60;
const MAX_SESSION_TTL_SECONDS = 24 * 60 * 60;
const CLOCK_SKEW_SECONDS = 60;

function base64url(input) {
  return Buffer.from(input)
    .toString("base64")
    .replace(/=/g, "")
    .replace(/\+/g, "-")
    .replace(/\//g, "_");
}

function fromBase64url(input) {
  const text = String(input || "").replace(/-/g, "+").replace(/_/g, "/");
  return Buffer.from(text, "base64").toString("utf-8");
}

function timingSafeEqualText(left, right) {
  const a = Buffer.from(String(left || ""));
  const b = Buffer.from(String(right || ""));
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

function getSessionSecrets() {
  const current = String(process.env.FOSU_SESSION_SECRET_CURRENT || process.env.FOSU_SESSION_SECRET || "").trim();
  const previous = String(process.env.FOSU_SESSION_SECRET_PREVIOUS || "").trim();
  const kid = String(process.env.FOSU_SESSION_SECRET_KID || "current").trim() || "current";
  const keys = [];
  if (current) keys.push({ kid, secret: current, current: true });
  if (previous) keys.push({ kid: "previous", secret: previous, current: false });
  if (!keys.length && config.NODE_ENV !== "production") {
    safeLog("security-session-dev-secret-warning", { reason: "FOSU_SESSION_SECRET_CURRENT is not configured in development" });
    keys.push({ kid: "dev", secret: "dev-fosu-session-secret", current: true, developmentFallback: true });
  }
  return keys;
}

function requireCurrentSessionSecret() {
  const keys = getSessionSecrets();
  const current = keys.find((key) => key.current);
  if (!current) {
    const error = new Error("FOSU_SESSION_SECRET_CURRENT is required");
    error.code = "FOSU_SESSION_SECRET_MISSING";
    error.statusCode = 503;
    throw error;
  }
  return current;
}

function signBody(body, secret) {
  return crypto.createHmac("sha256", secret).update(body).digest("base64url");
}

function hashOpenid(openid) {
  return crypto.createHash("sha256").update(String(openid || "")).digest("hex");
}

function hashSessionId(sessionId) {
  return crypto.createHash("sha256").update(String(sessionId || "")).digest("hex");
}

function normalizeTtl(input) {
  const requested = Number(input || process.env.FOSU_SESSION_TTL_SECONDS || DEFAULT_SESSION_TTL_SECONDS) || DEFAULT_SESSION_TTL_SECONDS;
  return Math.max(60, Math.min(MAX_SESSION_TTL_SECONDS, Math.floor(requested)));
}

function createSessionToken(session, options = {}) {
  const key = requireCurrentSessionSecret();
  const now = Math.floor(Date.now() / 1000);
  const ttlSeconds = normalizeTtl(options.ttlSeconds);
  const sessionId = options.sessionId || crypto.randomBytes(16).toString("hex");
  const appid = String(session.appid || process.env.WECHAT_APPID || process.env.WX_APPID || "").trim();
  const payload = {
    version: SESSION_TOKEN_VERSION,
    kid: key.kid,
    appid,
    openidHash: hashOpenid(session.openid || ""),
    sessionId,
    sessionIdHash: hashSessionId(sessionId),
    iat: now,
    nbf: now - CLOCK_SKEW_SECONDS,
    exp: now + ttlSeconds,
  };
  const body = base64url(JSON.stringify(payload));
  const signature = signBody(body, key.secret);
  return {
    token: `${body}.${signature}`,
    expiresIn: ttlSeconds,
    expiresAt: new Date(payload.exp * 1000).toISOString(),
    payload,
  };
}

function parseSessionToken(token) {
  if (!String(token || "").trim()) {
    return { valid: false, code: "FOSU_SESSION_REQUIRED" };
  }
  const parts = String(token || "").split(".");
  if (parts.length !== 2 || !parts[0] || !parts[1]) {
    return { valid: false, code: "FOSU_SESSION_MALFORMED" };
  }
  let payload;
  try {
    payload = JSON.parse(fromBase64url(parts[0]));
  } catch (error) {
    return { valid: false, code: "FOSU_SESSION_BAD_PAYLOAD" };
  }
  return { valid: true, body: parts[0], signature: parts[1], payload };
}

function verifySessionTokenDetailed(token, options = {}) {
  const parsed = parseSessionToken(token);
  if (!parsed.valid) return parsed;
  const keys = getSessionSecrets();
  if (!keys.length) return { valid: false, code: "FOSU_SESSION_SECRET_MISSING" };

  const matched = keys.find((key) => {
    const expected = signBody(parsed.body, key.secret);
    return timingSafeEqualText(parsed.signature, expected);
  });
  if (!matched) {
    return { valid: false, code: "FOSU_SESSION_BAD_SIGNATURE" };
  }

  const payload = parsed.payload || {};
  const now = Math.floor(Date.now() / 1000);
  if (Number(payload.version) !== SESSION_TOKEN_VERSION) {
    return { valid: false, code: "FOSU_SESSION_VERSION_UNSUPPORTED", payload };
  }
  if (!payload.exp || Number(payload.exp) <= now - CLOCK_SKEW_SECONDS) {
    return { valid: false, code: "FOSU_SESSION_EXPIRED", payload };
  }
  if (payload.nbf && Number(payload.nbf) > now + CLOCK_SKEW_SECONDS) {
    return { valid: false, code: "FOSU_SESSION_NOT_YET_VALID", payload };
  }
  if (payload.iat && payload.exp && Number(payload.exp) - Number(payload.iat) > MAX_SESSION_TTL_SECONDS + CLOCK_SKEW_SECONDS) {
    return { valid: false, code: "FOSU_SESSION_TTL_TOO_LONG", payload };
  }
  const expectedAppid = String(options.appid || process.env.WECHAT_APPID || process.env.WX_APPID || "").trim();
  if (expectedAppid && payload.appid && payload.appid !== expectedAppid) {
    return { valid: false, code: "FOSU_SESSION_WRONG_APPID", payload };
  }
  return { valid: true, payload: Object.assign({}, payload, { verifiedKid: matched.kid }) };
}

function verifySessionToken(token, options = {}) {
  const result = verifySessionTokenDetailed(token, options);
  return result.valid ? result.payload : null;
}

async function bootstrapFosuSession(code) {
  const jsCode = String(code || "").trim();
  if (!jsCode) {
    const error = new Error("WX_CODE_REQUIRED");
    error.statusCode = 400;
    throw error;
  }

  const appid = process.env.WECHAT_APPID || process.env.WX_APPID || "";
  const secret = process.env.WECHAT_APPSECRET || process.env.WX_APPSECRET || "";
  let openid = "";

  if (appid && secret) {
    const response = await axios.get("https://api.weixin.qq.com/sns/jscode2session", {
      params: {
        appid,
        secret,
        js_code: jsCode,
        grant_type: "authorization_code",
      },
      timeout: Number(process.env.WECHAT_SESSION_TIMEOUT_MS || 5000) || 5000,
    });
    if (!response.data || response.data.errcode || !response.data.openid) {
      const error = new Error("WECHAT_SESSION_FAILED");
      error.statusCode = 502;
      error.details = response.data || {};
      throw error;
    }
    openid = response.data.openid;
  } else if (config.NODE_ENV !== "production") {
    openid = `dev-${crypto.createHash("sha256").update(jsCode).digest("hex").slice(0, 24)}`;
  } else {
    const error = new Error("WECHAT_SESSION_NOT_CONFIGURED");
    error.statusCode = 503;
    throw error;
  }

  const created = createSessionToken({ appid, openid });
  const security = getSecurityMode();
  return {
    sessionToken: created.token,
    expiresIn: created.expiresIn,
    expiresAt: created.expiresAt,
    securityMode: security.mode,
    staticAccessMode: security.staticAccessMode,
    serverTime: new Date().toISOString(),
    payload: created.payload,
  };
}

function publicFosuGuard(req, res, next) {
  req.clientIpInfo = getClientIpInfo(req);
  const ua = String(req.headers["user-agent"] || "");
  const shouldBlockBadUa = process.env.FOSU_BLOCK_BAD_UA === "true";
  if (shouldBlockBadUa && BAD_USER_AGENT_PATTERN.test(ua)) {
    safeLog("fosu-api-bad-user-agent", { path: req.path, ua });
    return res.status(403).json({
      success: false,
      code: "BAD_USER_AGENT",
      message: "请求来源异常。",
    });
  }

  const contentLength = Number(req.headers["content-length"] || 0) || 0;
  const limit = Number(process.env.FOSU_DYNAMIC_BODY_LIMIT_BYTES || DEFAULT_DYNAMIC_BODY_LIMIT) || DEFAULT_DYNAMIC_BODY_LIMIT;
  if (contentLength > limit && req.path !== "/session/bootstrap") {
    recordSecurityEvent("security-suspicious-enumeration", {
      route: req.path,
      method: req.method,
      mode: getSecurityMode().mode,
      anonymizedIp: req.clientIpInfo.anonymizedIp,
      reasonCode: "DYNAMIC_API_BODY_TOO_LARGE",
    });
    return res.status(413).json({
      success: false,
      code: "DYNAMIC_API_BODY_TOO_LARGE",
      message: "请求体过大。",
    });
  }
  return next();
}

function validateJsonBody(allowedKeys) {
  const allowed = new Set(allowedKeys || []);
  return (req, res, next) => {
    if (!["POST", "PUT", "PATCH"].includes(req.method)) return next();
    const body = req.body || {};
    if (!body || typeof body !== "object" || Array.isArray(body)) {
      return res.status(400).json({ success: false, code: "INVALID_JSON_BODY", message: "请求体格式错误。" });
    }
    const unknown = Object.keys(body).filter((key) => !allowed.has(key));
    if (unknown.length) {
      return res.status(400).json({ success: false, code: "INVALID_JSON_SCHEMA", message: "请求字段不受支持。", fields: unknown });
    }
    return next();
  };
}

function optionalSessionGuard(req, res, next) {
  const security = getSecurityMode();
  const required = security.requireDynamicSession;
  const token = req.headers["x-fosu-session"];
  const result = verifySessionTokenDetailed(token);
  if (result.valid) {
    req.fosuSession = result.payload;
    return next();
  }

  recordSecurityEvent("security-session-invalid", {
    route: req.path,
    method: req.method,
    mode: security.mode,
    anonymizedIp: (req.clientIpInfo || getClientIpInfo(req)).anonymizedIp,
    reasonCode: result.code || "FOSU_SESSION_REQUIRED",
  });

  if (!required || security.observeOnly) {
    req.fosuSessionWarning = result.code || "FOSU_SESSION_REQUIRED";
    return next();
  }

  const code = result.code === "FOSU_SESSION_EXPIRED" ? "FOSU_SESSION_EXPIRED" : (token ? "FOSU_SESSION_INVALID" : "FOSU_SESSION_REQUIRED");
  return res.status(401).json({
    success: false,
    code,
    reasonCode: code,
    message: "会话已过期，请重新进入小程序。",
  });
}

module.exports = {
  bootstrapFosuSession,
  createSessionToken,
  getSecurityStatus,
  optionalSessionGuard,
  publicFosuGuard,
  validateJsonBody,
  verifySessionToken,
  verifySessionTokenDetailed,
};
