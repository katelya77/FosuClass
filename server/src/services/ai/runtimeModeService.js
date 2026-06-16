const crypto = require("crypto");
const protocol = require("./agentProtocol");

function boolEnv(name, fallback = false) {
  const value = process.env[name];
  if (value === undefined || value === null || value === "") return fallback;
  return String(value).toLowerCase() === "true";
}

function hashToken(value) {
  return crypto.createHash("sha256").update(String(value || "")).digest("hex");
}

function splitList(value) {
  return String(value || "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function isReleaseEnv(context = {}) {
  const envVersion = String(context.envVersion || context.miniprogramVersion || "").trim().toLowerCase();
  return envVersion === "release";
}

function isDevelopOrTrial(context = {}) {
  const envVersion = String(context.envVersion || context.miniprogramVersion || "").trim().toLowerCase();
  return envVersion === "develop" || envVersion === "trial" || envVersion === "devtools";
}

function sessionAllowed(session = {}) {
  const allowAll = boolEnv("AI_COMPETITION_ALLOW_ALL_SESSIONS", false) && process.env.NODE_ENV !== "production";
  if (allowAll) return true;
  const prefixes = splitList(process.env.AI_COMPETITION_OPENID_HASH_PREFIXES);
  if (!prefixes.length) return false;
  const openidHash = String(session.openidHash || "").toLowerCase();
  return prefixes.some((prefix) => openidHash.startsWith(prefix.toLowerCase()));
}

function tokenAllowed(token) {
  const configured = String(process.env.AI_COMPETITION_CAPABILITY_TOKEN_SHA256 || "").trim().toLowerCase();
  if (!configured) return false;
  const candidate = hashToken(token).toLowerCase();
  return candidate === configured;
}

function resolveRuntimeMode(input = {}) {
  const context = input.context || {};
  const session = input.serverSession || context.serverSession || {};
  const configured = protocol.normalizeRuntimeMode(process.env.AI_RUNTIME_MODE || "public");
  const requested = protocol.normalizeRuntimeMode(context.runtimeMode || input.runtimeMode || configured);
  if (configured !== "competition" || requested !== "competition") {
    return {
      runtimeMode: "public",
      requestedMode: requested,
      authorized: false,
      reason: configured !== "competition" ? "server_runtime_public" : "client_requested_public",
    };
  }
  if (isReleaseEnv(context)) {
    return {
      runtimeMode: "public",
      requestedMode: requested,
      authorized: false,
      reason: "release_env_fail_closed",
    };
  }
  if (!isDevelopOrTrial(context) && !boolEnv("AI_COMPETITION_ALLOW_UNKNOWN_ENV", false)) {
    return {
      runtimeMode: "public",
      requestedMode: requested,
      authorized: false,
      reason: "env_version_not_develop_or_trial",
    };
  }
  const capabilityToken = String(context.competitionCapabilityToken || "").trim();
  if (sessionAllowed(session) || tokenAllowed(capabilityToken)) {
    return {
      runtimeMode: "competition",
      requestedMode: requested,
      authorized: true,
      reason: sessionAllowed(session) ? "server_session_authorized" : "capability_token_authorized",
    };
  }
  return {
    runtimeMode: "public",
    requestedMode: requested,
    authorized: false,
    reason: "competition_not_authorized",
  };
}

module.exports = {
  isDevelopOrTrial,
  isReleaseEnv,
  resolveRuntimeMode,
  sessionAllowed,
  tokenAllowed,
};
