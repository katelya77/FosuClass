const crypto = require("crypto");

const MAX_SKEW_MS = 60000;
const NONCE_TTL_MS = 120000;
const seenNonces = new Map();

function sha256(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function bodyHash(body) {
  const bytes = Buffer.isBuffer(body) ? body : Buffer.from(String(body || ""));
  return sha256(bytes);
}

function signingBase(method, pathname, timestamp, nonce, hash) {
  return [String(method || "").toUpperCase(), pathname, String(timestamp), String(nonce), hash].join("\n");
}

function signRequest(secret, input) {
  const hash = input.bodyHash || bodyHash(input.body || "");
  const base = signingBase(input.method, input.path, input.timestamp, input.nonce, hash);
  return crypto.createHmac("sha256", String(secret || "")).update(base).digest("hex");
}

function rememberNonce(nonce, now) {
  const current = Number(now || Date.now());
  seenNonces.forEach((seenAt, key) => {
    if (current - seenAt > NONCE_TTL_MS) seenNonces.delete(key);
  });
  if (seenNonces.has(nonce)) return false;
  seenNonces.set(nonce, current);
  return true;
}

function resetNonces() {
  seenNonces.clear();
}

function secretsConfigured() {
  const token = String(process.env.FULL_SYNC_AGENT_TOKEN || "");
  const secret = String(process.env.FULL_SYNC_SIGNING_SECRET || "");
  const agentId = String(process.env.FULL_SYNC_AGENT_ID || "wyz-schedule-collector");
  if (token.length < 32 || secret.length < 32) return null;
  if (token === secret) return null;
  if (token === String(process.env.CAMPUS_AGENT_TOKEN || "")) return null;
  if (secret === String(process.env.CAMPUS_AGENT_SIGNING_SECRET || "")) return null;
  return { token, secret, agentId };
}

function tokenMatches(presented, expected) {
  const left = sha256(String(presented || ""));
  const right = sha256(String(expected || ""));
  return crypto.timingSafeEqual(Buffer.from(left), Buffer.from(right));
}

function headerValue(headers, name) {
  const source = headers || {};
  const found = Object.keys(source).find((key) => key.toLowerCase() === name);
  return found ? String(source[found] || "") : "";
}

function verifySignedRequest(req, now) {
  const secrets = secretsConfigured();
  if (!secrets) return { ok: false, status: 404 };
  const header = headerValue(req.headers, "authorization");
  const presented = header.startsWith("Bearer ") ? header.slice(7) : "";
  if (!presented || !tokenMatches(presented, secrets.token)) return { ok: false, status: 404 };
  const agentId = headerValue(req.headers, "x-full-sync-agent-id");
  if (!agentId || agentId !== secrets.agentId) return { ok: false, status: 404 };
  const timestamp = headerValue(req.headers, "x-full-sync-timestamp");
  const nonce = headerValue(req.headers, "x-full-sync-nonce");
  const signature = headerValue(req.headers, "x-full-sync-signature");
  const stamp = Number(timestamp);
  if (!nonce || !signature || !Number.isFinite(stamp) || Math.abs(now - stamp) > MAX_SKEW_MS) {
    return { ok: false, status: 403 };
  }
  const pathname = String(req.originalUrl || req.url || "").split("?")[0];
  const expected = signRequest(secrets.secret, {
    method: req.method,
    path: pathname,
    timestamp,
    nonce,
    body: req.rawBody || Buffer.alloc(0),
  });
  const left = Buffer.from(sha256(signature));
  const right = Buffer.from(sha256(expected));
  if (!crypto.timingSafeEqual(left, right)) return { ok: false, status: 403 };
  if (!rememberNonce(nonce, now)) return { ok: false, status: 403 };
  return { ok: true, agentId };
}

module.exports = {
  bodyHash,
  resetNonces,
  secretsConfigured,
  signRequest,
  verifySignedRequest,
};
