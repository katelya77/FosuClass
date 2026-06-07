const crypto = require("crypto");
const path = require("path");
const config = require("../config");

const TICKET_VERSION = 2;
const DEFAULT_TTL_SECONDS = 600;
const MAX_TTL_SECONDS = 15 * 60;
const CLOCK_SKEW_SECONDS = 60;
const RELEASE_VERSION_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,96}$/;

function base64url(input) {
  return Buffer.from(input)
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

function fromBase64url(input) {
  const normalized = String(input || "").replace(/-/g, "+").replace(/_/g, "/");
  return Buffer.from(normalized, "base64").toString("utf-8");
}

function timingSafeEqualText(left, right) {
  const a = Buffer.from(String(left || ""));
  const b = Buffer.from(String(right || ""));
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

function getSecrets(options = {}) {
  const current = String(options.secret || process.env.FOSU_STATIC_TICKET_SECRET_CURRENT || process.env.FOSU_STATIC_TICKET_SECRET || "").trim();
  const previous = String(process.env.FOSU_STATIC_TICKET_SECRET_PREVIOUS || "").trim();
  const kid = String(process.env.FOSU_STATIC_TICKET_SECRET_KID || "current").trim() || "current";
  const keys = [];
  if (current) keys.push({ kid, secret: current, current: true });
  if (previous) keys.push({ kid: "previous", secret: previous, current: false });
  if (!keys.length && config.NODE_ENV !== "production" && options.allowDevSecret) {
    keys.push({ kid: "dev", secret: "dev-fosu-static-ticket-secret", current: true, developmentFallback: true });
  }
  return keys;
}

function requireCurrentSecret(options = {}) {
  const key = getSecrets(options).find((item) => item.current);
  if (!key) {
    const error = new Error("FOSU_STATIC_TICKET_SECRET_CURRENT is required");
    error.code = "STATIC_TICKET_SECRET_MISSING";
    throw error;
  }
  if (config.NODE_ENV === "production" && key.secret === process.env.ADMIN_API_TOKEN) {
    const error = new Error("FOSU_STATIC_TICKET_SECRET_CURRENT must not reuse ADMIN_API_TOKEN");
    error.code = "STATIC_TICKET_SECRET_INSECURE";
    throw error;
  }
  return key;
}

function normalizePrefix(prefix) {
  const text = String(prefix || "/").trim().replace(/\\/g, "/");
  const normalized = text.startsWith("/") ? text : `/${text}`;
  return normalized.replace(/\/+/g, "/").replace(/\/+$/g, "") || "/";
}

function assertSafeReleaseVersion(releaseVersion) {
  const value = String(releaseVersion || "").trim();
  if (!RELEASE_VERSION_PATTERN.test(value) || value.includes("..") || value.includes("/") || value.includes("\\")) {
    const error = new Error("Invalid releaseVersion");
    error.code = "STATIC_TICKET_BAD_RELEASE";
    throw error;
  }
  return value;
}

function hasRepeatedEncoding(value) {
  const text = String(value || "");
  try {
    const once = decodeURIComponent(text);
    const twice = decodeURIComponent(once);
    return once !== twice;
  } catch (error) {
    return true;
  }
}

function normalizeRequestPath(value) {
  const raw = String(value || "/");
  if (raw.includes("\0") || raw.includes("\\") || hasRepeatedEncoding(raw)) {
    return { ok: false, code: "STATIC_PATH_UNSAFE_ENCODING" };
  }
  let decoded;
  try {
    decoded = decodeURIComponent(raw);
  } catch (error) {
    return { ok: false, code: "STATIC_PATH_BAD_ENCODING" };
  }
  if (decoded.includes("\0") || decoded.includes("\\") || decoded.includes("..")) {
    return { ok: false, code: "STATIC_PATH_TRAVERSAL" };
  }
  const withSlash = decoded.startsWith("/") ? decoded : `/${decoded}`;
  const normalized = path.posix.normalize(withSlash).replace(/\/+/g, "/");
  if (normalized.includes("..")) {
    return { ok: false, code: "STATIC_PATH_TRAVERSAL" };
  }
  return { ok: true, path: normalized };
}

function signPayload(body, secret) {
  return crypto.createHmac("sha256", secret).update(body).digest("base64url");
}

function createStaticAccessTicket(input = {}, options = {}) {
  const key = requireCurrentSecret(options);
  const now = Math.floor(Date.now() / 1000);
  const ttlSeconds = Math.max(1, Math.min(MAX_TTL_SECONDS, Number(input.ttlSeconds || options.ttlSeconds || DEFAULT_TTL_SECONDS) || DEFAULT_TTL_SECONDS));
  const releaseVersion = assertSafeReleaseVersion(input.releaseVersion || options.releaseVersion || "");
  const pathPrefix = normalizePrefix(input.pathPrefix || options.pathPrefix || `/static/releases/${releaseVersion}/`);
  const payload = {
    version: TICKET_VERSION,
    kid: key.kid,
    releaseVersion,
    pathPrefix,
    method: String(input.method || "GET").toUpperCase() === "HEAD" ? "HEAD" : "GET",
    exp: Math.floor(Number(input.exp || now + ttlSeconds)),
    nbf: Math.floor(Number(input.nbf || now - CLOCK_SKEW_SECONDS)),
    iat: now,
    nonce: crypto.randomBytes(12).toString("hex"),
  };
  if (payload.exp - payload.iat > MAX_TTL_SECONDS + CLOCK_SKEW_SECONDS) {
    payload.exp = payload.iat + MAX_TTL_SECONDS;
  }
  const body = base64url(JSON.stringify(payload));
  const signature = signPayload(body, key.secret);
  return `${body}.${signature}`;
}

function verifyStaticAccessTicket(ticket, request = {}, options = {}) {
  const keys = getSecrets(options);
  if (!keys.length) {
    return { valid: false, code: "STATIC_TICKET_SECRET_MISSING" };
  }
  const parts = String(ticket || "").split(".");
  if (parts.length !== 2 || !parts[0] || !parts[1]) {
    return { valid: false, code: "STATIC_TICKET_MALFORMED" };
  }
  const [body, signature] = parts;
  const matched = keys.find((key) => timingSafeEqualText(signature, signPayload(body, key.secret)));
  if (!matched) {
    return { valid: false, code: "STATIC_TICKET_BAD_SIGNATURE" };
  }
  let payload;
  try {
    payload = JSON.parse(fromBase64url(body));
  } catch (error) {
    return { valid: false, code: "STATIC_TICKET_BAD_PAYLOAD" };
  }
  if (Number(payload.version || 1) !== TICKET_VERSION) {
    return { valid: false, code: "STATIC_TICKET_VERSION_UNSUPPORTED", payload };
  }
  const now = Math.floor(Date.now() / 1000);
  if (payload.nbf && Number(payload.nbf) > now + CLOCK_SKEW_SECONDS) {
    return { valid: false, code: "STATIC_TICKET_NOT_YET_VALID", payload };
  }
  if (!payload.exp || Number(payload.exp) <= now) {
    return { valid: false, code: "STATIC_TICKET_EXPIRED", payload };
  }
  if (payload.iat && payload.exp && Number(payload.exp) - Number(payload.iat) > MAX_TTL_SECONDS + CLOCK_SKEW_SECONDS) {
    return { valid: false, code: "STATIC_TICKET_TTL_TOO_LONG", payload };
  }
  const method = String(request.method || "GET").toUpperCase();
  if (!["GET", "HEAD"].includes(method)) {
    return { valid: false, code: "STATIC_TICKET_METHOD_NOT_ALLOWED", payload };
  }
  if (payload.method && !["GET", "HEAD"].includes(String(payload.method).toUpperCase())) {
    return { valid: false, code: "STATIC_TICKET_METHOD_NOT_ALLOWED", payload };
  }
  const expectedRelease = String(request.releaseVersion || "").trim();
  if (expectedRelease && payload.releaseVersion && expectedRelease !== payload.releaseVersion) {
    return { valid: false, code: "STATIC_TICKET_WRONG_RELEASE", payload };
  }
  try {
    assertSafeReleaseVersion(payload.releaseVersion);
  } catch (error) {
    return { valid: false, code: error.code || "STATIC_TICKET_BAD_RELEASE", payload };
  }
  const normalizedRequest = normalizeRequestPath(request.path || request.pathPrefix || "/");
  if (!normalizedRequest.ok) {
    return { valid: false, code: normalizedRequest.code, payload };
  }
  const normalizedPrefix = normalizeRequestPath(payload.pathPrefix || "/");
  if (!normalizedPrefix.ok) {
    return { valid: false, code: "STATIC_TICKET_BAD_PREFIX", payload };
  }
  const requestPath = normalizedRequest.path;
  const allowedPrefix = normalizePrefix(normalizedPrefix.path);
  if (requestPath !== allowedPrefix && !requestPath.startsWith(`${allowedPrefix.replace(/\/+$/g, "")}/`)) {
    return { valid: false, code: "STATIC_TICKET_PATH_SCOPE", payload };
  }
  return { valid: true, payload: Object.assign({}, payload, { verifiedKid: matched.kid }) };
}

module.exports = {
  createStaticAccessTicket,
  normalizeRequestPath,
  verifyStaticAccessTicket,
};
