const crypto = require("crypto");

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

function getSecret(options = {}) {
  return String(options.secret || process.env.FOSU_STATIC_TICKET_SECRET || process.env.ADMIN_API_TOKEN || "").trim();
}

function normalizePrefix(prefix) {
  const text = String(prefix || "").trim().replace(/\\/g, "/");
  return text.startsWith("/") ? text : `/${text}`;
}

function signPayload(body, secret) {
  return crypto.createHmac("sha256", secret).update(body).digest("base64url");
}

function createStaticAccessTicket(input = {}, options = {}) {
  const secret = getSecret(options);
  if (!secret) {
    const error = new Error("FOSU_STATIC_TICKET_SECRET is required");
    error.code = "STATIC_TICKET_SECRET_MISSING";
    throw error;
  }
  const now = Math.floor(Date.now() / 1000);
  const ttlSeconds = Math.max(1, Number(input.ttlSeconds || options.ttlSeconds || 300) || 300);
  const payload = {
    releaseVersion: String(input.releaseVersion || "").trim(),
    pathPrefix: normalizePrefix(input.pathPrefix || "/"),
    exp: Math.floor(Number(input.exp || now + ttlSeconds)),
    iat: now,
    nonce: crypto.randomBytes(8).toString("hex"),
  };
  const body = base64url(JSON.stringify(payload));
  const signature = signPayload(body, secret);
  return `${body}.${signature}`;
}

function verifyStaticAccessTicket(ticket, request = {}, options = {}) {
  const secret = getSecret(options);
  if (!secret) {
    return { valid: false, code: "STATIC_TICKET_SECRET_MISSING" };
  }
  const parts = String(ticket || "").split(".");
  if (parts.length !== 2 || !parts[0] || !parts[1]) {
    return { valid: false, code: "STATIC_TICKET_MALFORMED" };
  }
  const [body, signature] = parts;
  const expected = signPayload(body, secret);
  const left = Buffer.from(signature);
  const right = Buffer.from(expected);
  if (left.length !== right.length || !crypto.timingSafeEqual(left, right)) {
    return { valid: false, code: "STATIC_TICKET_BAD_SIGNATURE" };
  }
  let payload;
  try {
    payload = JSON.parse(fromBase64url(body));
  } catch (error) {
    return { valid: false, code: "STATIC_TICKET_BAD_PAYLOAD" };
  }
  const now = Math.floor(Date.now() / 1000);
  if (!payload.exp || Number(payload.exp) <= now) {
    return { valid: false, code: "STATIC_TICKET_EXPIRED", payload };
  }
  const expectedRelease = String(request.releaseVersion || "").trim();
  if (expectedRelease && payload.releaseVersion && expectedRelease !== payload.releaseVersion) {
    return { valid: false, code: "STATIC_TICKET_WRONG_RELEASE", payload };
  }
  const requestPath = normalizePrefix(request.path || request.pathPrefix || "/");
  const allowedPrefix = normalizePrefix(payload.pathPrefix || "/");
  if (requestPath !== allowedPrefix && !requestPath.startsWith(`${allowedPrefix.replace(/\/+$/g, "")}/`)) {
    return { valid: false, code: "STATIC_TICKET_PATH_SCOPE", payload };
  }
  return { valid: true, payload };
}

module.exports = {
  createStaticAccessTicket,
  verifyStaticAccessTicket,
};
