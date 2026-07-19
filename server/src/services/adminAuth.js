const crypto = require("crypto");
const rateLimit = require("express-rate-limit");
const config = require("../config");
const { safeLog } = require("../utils/safeLogger");
const { recordSecurityEvent } = require("./securityEventService");
const serviceTokenService = require("./serviceTokenService");
const adminRouteScopes = require("../security/adminRouteScopes");

const ADMIN_SESSION_COOKIE = "fosu_admin_session";
const SESSION_TTL_SECONDS = 12 * 60 * 60;
const CSRF_HEADER = "x-fosu-csrf";

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
  const explicit = process.env.FOSU_CSRF_SECRET || process.env.FOSU_ADMIN_SESSION_SECRET || "";
  return explicit || [
    config.ADMIN_TOKEN,
    config.ADMIN_PASSWORD,
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
  const sid = crypto.randomBytes(16).toString("hex");
  const payload = base64Url(JSON.stringify({
    sid,
    iat: now,
    exp: now + SESSION_TTL_SECONDS,
    scope: "admin",
  }));
  const signature = signPayload(payload);
  return `${payload}.${signature}`;
}

function createCsrfToken(sessionToken) {
  const nonce = crypto.randomBytes(12).toString("hex");
  const signature = crypto.createHmac("sha256", getSessionSecret())
    .update(`${sessionToken}.${nonce}`)
    .digest("base64url");
  return `${nonce}.${signature}`;
}

function verifyCsrfToken(sessionToken, csrfToken) {
  const parts = String(csrfToken || "").split(".");
  if (parts.length !== 2 || !parts[0] || !parts[1]) {
    return false;
  }
  const expected = crypto.createHmac("sha256", getSessionSecret())
    .update(`${sessionToken}.${parts[0]}`)
    .digest("base64url");
  return timingSafeEqualText(parts[1], expected);
}

function parseSessionPayload(token) {
  const parts = String(token || "").split(".");
  if (parts.length !== 2) {
    return null;
  }
  const [payload, signature] = parts;
  const expected = signPayload(payload);
  if (!expected || !timingSafeEqualText(signature, expected)) {
    return null;
  }

  try {
    const data = JSON.parse(fromBase64Url(payload));
    if (data.scope !== "admin" || Number(data.exp) <= Math.floor(Date.now() / 1000)) {
      return null;
    }
    return data;
  } catch (error) {
    return null;
  }
}

function verifySessionToken(token) {
  return Boolean(parseSessionPayload(token));
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
  return Boolean(serviceTokenService.resolveServiceToken(token));
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

function getAdminCookieToken(req) {
  const cookies = parseCookies(req);
  const token = cookies[ADMIN_SESSION_COOKIE] || "";
  return verifySessionToken(token) ? token : "";
}

function resolveAdminIdentity(req) {
  const cookieToken = getAdminCookieToken(req);
  if (cookieToken) {
    const session = parseSessionPayload(cookieToken);
    return {
      authMethod: "admin-cookie",
      kind: "session",
      name: "admin-session",
      scopes: [serviceTokenService.SCOPES.ADMIN_FULL],
      sessionIdPrefix: session && session.sid ? String(session.sid).slice(0, 8) : "",
      sessionToken: cookieToken,
    };
  }

  const bearer = getBearerToken(req);
  const tokenIdentity = serviceTokenService.resolveServiceToken(bearer);
  if (tokenIdentity) {
    return {
      ...tokenIdentity,
      authMethod: tokenIdentity.kind === "static-admin-token" ? "admin-token" : "service-token",
      rawTokenPresent: true,
    };
  }
  return null;
}

function getAdminAuthMethod(req) {
  const identity = resolveAdminIdentity(req);
  if (!identity) return "";
  if (identity.authMethod === "admin-cookie") return "admin-cookie";
  if (identity.kind === "static-admin-token") return "admin-token";
  if (identity.kind === "legacy-admin-api-token") return "admin-token";
  return "service-token";
}

function isAdminRequest(req) {
  return Boolean(resolveAdminIdentity(req));
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
    "SameSite=Strict",
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
    "SameSite=Strict",
    "Max-Age=0",
  ];
  if (config.NODE_ENV === "production") {
    parts.push("Secure");
  }
  res.setHeader("Set-Cookie", parts.join("; "));
}

/**
 * CSRF rules:
 * - Safe methods always pass.
 * - Cookie session writes always require CSRF.
 * - Browser-like requests (Origin present + credentials cookie) require CSRF.
 * - Pure machine service tokens without cookies may skip CSRF.
 */
function verifyAdminCsrf(req) {
  if (!isStateChangingMethod(req.method)) return true;

  const cookieToken = getAdminCookieToken(req);
  if (cookieToken) {
    return verifyCsrfToken(cookieToken, req.headers[CSRF_HEADER]);
  }

  const identity = resolveAdminIdentity(req);
  if (!identity) return false;

  // Machine clients: bearer/service token only, no session cookie.
  // If an Origin is present (browser fetch with token), still require CSRF header
  // bound to a session is impossible; reject browser token-only state changes
  // unless explicitly marked as service client.
  const origin = toText(req.headers.origin);
  const serviceClient = toText(req.headers["x-fosu-client"]).toLowerCase() === "service"
    || toText(req.headers["x-fosu-service-client"]).toLowerCase() === "1";
  if (origin && !serviceClient) {
    // Browser token-only write is rejected to force cookie+CSRF login path.
    return false;
  }
  return true;
}

function attachIdentity(req, identity) {
  req.adminIdentity = identity;
  req.adminScopes = identity && identity.scopes ? identity.scopes.slice() : [];
}

/**
 * Default-deny scope gate for mutating admin APIs.
 * Explicit route scopes win; undeclared mutations require admin:full.
 * GET/HEAD skip (authenticated identity already required by caller).
 */
function enforceRouteScopes(req, res, next) {
  if (!isStateChangingMethod(req.method)) {
    return next();
  }

  const routePath = adminRouteScopes.resolveRequestRoutePath(req);
  const required = adminRouteScopes.getRequiredScopesForRoute(req.method, routePath);
  if (required == null) {
    return next();
  }

  const identity = req.adminIdentity || resolveAdminIdentity(req);
  if (!identity) {
    return res.status(401).json({
      success: false,
      code: "ADMIN_AUTH_REQUIRED",
      message: "请先登录后台或提供有效服务令牌",
    });
  }

  if (!serviceTokenService.hasAnyScope(identity, required)) {
    safeLog("admin-scope-denied", {
      path: routePath,
      method: req.method,
      required,
      scopes: identity.scopes || [],
      operator: identity.name || "",
    });
    recordSecurityEvent("security-scope-denied", {
      route: routePath,
      method: req.method,
      reasonCode: "ADMIN_SCOPE_DENIED",
      sessionIdPrefix: identity.sessionIdPrefix || "",
    });
    return res.status(403).json({
      success: false,
      code: "ADMIN_SCOPE_DENIED",
      message: "当前令牌缺少所需权限范围",
      requiredScopes: required,
    });
  }
  return next();
}

function verifyAdminAccess(req, res, next) {
  if (!isAdminConfiguredForCurrentEnv()) {
    safeLog("admin-access-blocked", { reason: "ADMIN_TOKEN or ADMIN_PASSWORD not configured" });
    return res.status(503).json({
      success: false,
      message: "生产环境未配置 ADMIN_TOKEN 或 ADMIN_PASSWORD，后台已关闭",
    });
  }

  const identity = resolveAdminIdentity(req);
  if (!identity) {
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

  if (!verifyAdminCsrf(req)) {
    safeLog("admin-csrf-rejected", { path: req.path });
    return res.status(403).json({
      success: false,
      code: "ADMIN_CSRF_REJECTED",
      message: "Admin CSRF token is invalid.",
    });
  }

  attachIdentity(req, identity);
  return enforceRouteScopes(req, res, next);
}

function requireScopes(requiredScopes) {
  const required = serviceTokenService.normalizeScopes(requiredScopes);
  return function requireScopesMiddleware(req, res, next) {
    const identity = req.adminIdentity || resolveAdminIdentity(req);
    if (!identity) {
      return res.status(401).json({
        success: false,
        code: "ADMIN_AUTH_REQUIRED",
        message: "请先登录后台或提供有效服务令牌",
      });
    }
    if (!serviceTokenService.hasAnyScope(identity, required)) {
      safeLog("admin-scope-denied", {
        path: req.path,
        required,
        scopes: identity.scopes || [],
        operator: identity.name || "",
      });
      return res.status(403).json({
        success: false,
        code: "ADMIN_SCOPE_DENIED",
        message: "当前令牌缺少所需权限范围",
        requiredScopes: required,
      });
    }
    attachIdentity(req, identity);
    return next();
  };
}

function getAuditIdentity(req) {
  const identity = req.adminIdentity || resolveAdminIdentity(req);
  return serviceTokenService.describeIdentity(identity);
}

module.exports = {
  ADMIN_SESSION_COOKIE,
  CSRF_HEADER,
  adminLoginLimiter,
  attachIdentity,
  clearSessionCookie,
  createCsrfToken,
  createSessionToken,
  enforceRouteScopes,
  getAdminAuthMethod,
  getAdminCookieToken,
  getAuditIdentity,
  hasAdminLoginSecret,
  isAdminConfiguredForCurrentEnv,
  isAdminCookieValid,
  isAdminOriginAllowed,
  isAdminRequest,
  isLoginCredentialValid,
  isStaticAdminTokenValid,
  requireScopes,
  resolveAdminIdentity,
  setSessionCookie,
  verifyAdminCsrf,
  verifyAdminAccess,
};
