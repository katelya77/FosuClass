const crypto = require("crypto");

function toText(value) {
  return String(value == null ? "" : value).trim();
}

function normalizeIp(value) {
  const text = toText(value);
  if (!text) return "";
  if (text.startsWith("::ffff:")) return text.slice(7);
  return text;
}

function isLoopback(ip) {
  const value = normalizeIp(ip);
  return value === "::1" || value === "127.0.0.1" || value.startsWith("127.");
}

function isPrivateIpv4(ip) {
  const value = normalizeIp(ip);
  const parts = value.split(".").map((part) => Number(part));
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) return false;
  return parts[0] === 10 ||
    (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) ||
    (parts[0] === 192 && parts[1] === 168);
}

function isTrustedProxyIp(ip) {
  const value = normalizeIp(ip);
  if (!value) return false;
  if (isLoopback(value) || isPrivateIpv4(value)) return true;
  const configured = String(process.env.FOSU_TRUSTED_PROXY_IPS || "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
  return configured.includes(value);
}

function getFirstForwardedIp(header) {
  return String(header || "")
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean)[0] || "";
}

function anonymizeIp(ip) {
  const value = normalizeIp(ip);
  if (!value) return "";
  const parts = value.split(".");
  if (parts.length === 4) {
    return `${parts[0]}.${parts[1]}.${parts[2]}.0`;
  }
  return crypto.createHash("sha256").update(value).digest("hex").slice(0, 12);
}

function getClientIpInfo(req = {}) {
  const socketIp = normalizeIp(req.ip || req.socket?.remoteAddress || req.connection?.remoteAddress || "");
  const upstreamTrusted = isTrustedProxyIp(socketIp);
  let effectiveIp = socketIp;
  let proxySource = "socket";

  if (upstreamTrusted) {
    const cfIp = normalizeIp(req.headers && req.headers["cf-connecting-ip"]);
    const forwardedIp = normalizeIp(getFirstForwardedIp(req.headers && req.headers["x-forwarded-for"]));
    const realIp = normalizeIp(req.headers && req.headers["x-real-ip"]);
    if (cfIp) {
      effectiveIp = cfIp;
      proxySource = "cf-connecting-ip";
    } else if (forwardedIp) {
      effectiveIp = forwardedIp;
      proxySource = "x-forwarded-for";
    } else if (realIp) {
      effectiveIp = realIp;
      proxySource = "x-real-ip";
    }
  }

  return {
    socketIp,
    effectiveIp: normalizeIp(effectiveIp),
    upstreamTrusted,
    proxySource,
    anonymizedIp: anonymizeIp(effectiveIp),
  };
}

module.exports = {
  anonymizeIp,
  getClientIpInfo,
  isTrustedProxyIp,
};
