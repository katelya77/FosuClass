const crypto = require("crypto");
const rateLimit = require("express-rate-limit");
const config = require("../config");
const { safeLog } = require("../utils/safeLogger");

const ADMIN_SESSION_COOKIE = "fosu_admin_session";
const SESSION_TTL_SECONDS = 12 * 60 * 60;

const adminLoginLimiter = rateLimit({
  windowMs: 10 * 60 * 1000,
  max: 12,
  message: {
    success: false,
    message: "登录尝试过于频繁，请稍后再试",
  },
  standardHeaders: true,
  legacyHeaders: false,
});

function toText(value) {
  return String(value == null ? "" : value).trim();
}

function base64Url(input) {
  return Buffer.from(input)
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

function fromBase64Url(input) {
  const normalized = String(input || "")
    .replace(/-/g, "+")
    .replace(/_/g, "/");
  return Buffer.from(normalized, "base64").toString("utf-8");
}

function timingSafeEqualText(left, right) {
  const a = Buffer.from(String(left || ""));
  const b = Buffer.from(String(right || ""));
  if (a.length !== b.length) {
    return false;
  }
  return crypto.timingSafeEqual(a, b);
}

function getSessionSecret() {
  return [
    config.ADMIN_TOKEN,
    config.ADMIN_PASSWORD,
    config.ADMIN_API_TOKEN,
    config.NODE_ENV,
  ].filter(Boolean).join("|");
}

function hasAdminLoginSecret() {
  return Boolean(config.ADMIN_TOKEN || config.ADMIN_PASSWORD);
}

function isAdminConfiguredForCurrentEnv() {
  if (config.NODE_ENV !== "production") {
    return true;
  }
  return hasAdminLoginSecret();
}

function signPayload(payloadText) {
  const secret = getSessionSecret();
  if (!secret) {
    return "";
  }
  return crypto.createHmac("sha256", secret).update(payloadText).digest("base64url");
}

function createSessionToken() {
  const now = Math.floor(Date.now() / 1000);
  const payload = base64Url(JSON.stringify({
    iat: now,
    exp: now + SESSION_TTL_SECONDS,
    scope: "admin",
  }));
  const signature = signPayload(payload);
  return `${payload}.${signature}`;
}

function verifySessionToken(token) {
  const parts = String(token || "").split(".");
  if (parts.length !== 2) {
    return false;
  }
  const [payload, signature] = parts;
  const expected = signPayload(payload);
  if (!expected || !timingSafeEqualText(signature, expected)) {
    return false;
  }

  try {
    const data = JSON.parse(fromBase64Url(payload));
    return data.scope === "admin" && Number(data.exp) > Math.floor(Date.now() / 1000);
  } catch (error) {
    return false;
  }
}

function parseCookies(req) {
  const header = String(req.headers.cookie || "");
  return header.split(";").reduce((cookies, pair) => {
    const index = pair.indexOf("=");
    if (index < 0) {
      return cookies;
    }
    const key = pair.slice(0, index).trim();
    const value = decodeURIComponent(pair.slice(index + 1).trim());
    cookies[key] = value;
    return cookies;
  }, {});
}

function getBearerToken(req) {
  const authHeader = String(req.headers.authorization || "");
  const bearerMatch = authHeader.match(/^Bearer\s+(.+)$/i);
  return toText(req.headers["x-admin-token"] || (bearerMatch ? bearerMatch[1] : ""));
}

function isStaticAdminTokenValid(token) {
  const value = toText(token);
  if (!value) {
    return false;
  }
  return Boolean(
    (config.ADMIN_TOKEN && timingSafeEqualText(value, config.ADMIN_TOKEN)) ||
    (config.ADMIN_API_TOKEN && timingSafeEqualText(value, config.ADMIN_API_TOKEN))
  );
}

function isLoginCredentialValid(input) {
  const credential = toText(input);
  if (!credential || !hasAdminLoginSecret()) {
    return false;
  }
  return Boolean(
    (config.ADMIN_PASSWORD && timingSafeEqualText(credential, config.ADMIN_PASSWORD)) ||
    (config.ADMIN_TOKEN && timingSafeEqualText(credential, config.ADMIN_TOKEN))
  );
}

function isAdminCookieValid(req) {
  const cookies = parseCookies(req);
  return verifySessionToken(cookies[ADMIN_SESSION_COOKIE]);
}

function isAdminRequest(req) {
  return isStaticAdminTokenValid(getBearerToken(req)) || isAdminCookieValid(req);
}

function isStateChangingMethod(method) {
  return !["GET", "HEAD", "OPTIONS"].includes(String(method || "GET").toUpperCase());
}

function isAdminOriginAllowed(req) {
  const origin = toText(req.headers.origin);
  if (!origin || config.NODE_ENV === "development") {
    return true;
  }
  const allowed = (config.FOSU_ALLOWED_ADMIN_ORIGINS || [])
    .filter((item) => item && item !== "*");
  if (allowed.length === 0) {
    return true;
  }
  return allowed.includes(origin);
}

function setSessionCookie(res, token) {
  const parts = [
    `${ADMIN_SESSION_COOKIE}=${encodeURIComponent(token)}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    `Max-Age=${SESSION_TTL_SECONDS}`,
  ];
  if (config.NODE_ENV === "production") {
    parts.push("Secure");
  }
  res.setHeader("Set-Cookie", parts.join("; "));
}

function clearSessionCookie(res) {
  const parts = [
    `${ADMIN_SESSION_COOKIE}=`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    "Max-Age=0",
  ];
  if (config.NODE_ENV === "production") {
    parts.push("Secure");
  }
  res.setHeader("Set-Cookie", parts.join("; "));
}

function verifyAdminAccess(req, res, next) {
  if (!isAdminConfiguredForCurrentEnv()) {
    safeLog("admin-access-blocked", { reason: "ADMIN_TOKEN or ADMIN_PASSWORD not configured" });
    return res.status(503).json({
      success: false,
      message: "生产环境未配置 ADMIN_TOKEN 或 ADMIN_PASSWORD，后台已关闭",
    });
  }

  if (!isAdminRequest(req)) {
    return res.status(401).json({
      success: false,
      message: "请先登录后台",
    });
  }

  if (isStateChangingMethod(req.method) && !isAdminOriginAllowed(req)) {
    safeLog("admin-origin-rejected", { origin: req.headers.origin || "", path: req.path });
    return res.status(403).json({
      success: false,
      code: "ADMIN_ORIGIN_REJECTED",
      message: "Admin request origin is not allowed.",
    });
  }

  return next();
}

module.exports = {
  ADMIN_SESSION_COOKIE,
  adminLoginLimiter,
  clearSessionCookie,
  createSessionToken,
  hasAdminLoginSecret,
  isAdminConfiguredForCurrentEnv,
  isAdminCookieValid,
  isAdminOriginAllowed,
  isAdminRequest,
  isLoginCredentialValid,
  setSessionCookie,
  verifyAdminAccess,
};
