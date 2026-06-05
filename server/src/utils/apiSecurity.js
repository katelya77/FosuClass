const crypto = require("crypto");
const axios = require("axios");
const config = require("../config");
const { safeLog } = require("./safeLogger");

const BAD_USER_AGENT_PATTERN = /(curl|wget|python-requests|scrapy|httpclient|libwww-perl|go-http-client)/i;
const DEFAULT_DYNAMIC_BODY_LIMIT = 128 * 1024;

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

function getSessionSecret() {
  return process.env.FOSU_SESSION_SECRET || config.ADMIN_API_TOKEN || "dev-fosu-session-secret";
}

function createSessionToken(session, options = {}) {
  const now = Math.floor(Date.now() / 1000);
  const ttlSeconds = Number(options.ttlSeconds || process.env.FOSU_SESSION_TTL_SECONDS || 7200) || 7200;
  const payload = {
    appid: session.appid || process.env.WECHAT_APPID || "",
    openidHash: crypto.createHash("sha256").update(String(session.openid || "")).digest("hex"),
    nonce: crypto.randomBytes(12).toString("hex"),
    iat: now,
    exp: now + ttlSeconds,
  };
  const body = base64url(JSON.stringify(payload));
  const signature = crypto.createHmac("sha256", getSessionSecret()).update(body).digest("base64url");
  return {
    token: `${body}.${signature}`,
    expiresIn: ttlSeconds,
    payload,
  };
}

function verifySessionToken(token) {
  const [body, signature] = String(token || "").split(".");
  if (!body || !signature) return null;
  const expected = crypto.createHmac("sha256", getSessionSecret()).update(body).digest("base64url");
  const signatureBuffer = Buffer.from(signature);
  const expectedBuffer = Buffer.from(expected);
  if (signatureBuffer.length !== expectedBuffer.length) return null;
  if (!crypto.timingSafeEqual(signatureBuffer, expectedBuffer)) return null;
  const payload = JSON.parse(fromBase64url(body));
  if (!payload.exp || payload.exp < Math.floor(Date.now() / 1000)) return null;
  return payload;
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
  return {
    sessionToken: created.token,
    expiresIn: created.expiresIn,
    appid,
    openidHash: created.payload.openidHash,
  };
}

function publicFosuGuard(req, res, next) {
  const ua = String(req.headers["user-agent"] || "");
  const shouldBlockBadUa = process.env.FOSU_BLOCK_BAD_UA === "true" || config.NODE_ENV === "production";
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
    safeLog("fosu-api-body-too-large", { path: req.path, contentLength, limit });
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
    if (req.method !== "POST") return next();
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
  const required = process.env.FOSU_DYNAMIC_API_SESSION_REQUIRED === "true";
  if (!required) return next();
  const token = req.headers["x-fosu-session"];
  try {
    const payload = verifySessionToken(token);
    if (!payload) {
      return res.status(401).json({ success: false, code: "FOSU_SESSION_REQUIRED", message: "会话已过期，请重新进入小程序。" });
    }
    req.fosuSession = payload;
    return next();
  } catch (error) {
    safeLog("fosu-session-verify-failed", { path: req.path, message: error.message });
    return res.status(401).json({ success: false, code: "FOSU_SESSION_INVALID", message: "会话校验失败。" });
  }
}

module.exports = {
  bootstrapFosuSession,
  createSessionToken,
  optionalSessionGuard,
  publicFosuGuard,
  validateJsonBody,
  verifySessionToken,
};
