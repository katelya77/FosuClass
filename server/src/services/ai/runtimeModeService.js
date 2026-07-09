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

function trialEnvironmentAllowed(context = {}) {
  return isDevelopOrTrial(context) && boolEnv("AI_COMPETITION_ALLOW_TRIAL_ENV", true);
}

function sessionAllowed(session = {}) {
  if (session && session.adminProviderVerification === true) return true;
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
  if (isCompetitionCapabilityExpired()) return false;
  const candidate = hashToken(token).toLowerCase();
  return candidate === configured;
}

function getCompetitionCapabilityExpiry() {
  const expiresAt = String(process.env.AI_COMPETITION_CAPABILITY_EXPIRES_AT || "").trim();
  const expiresMs = expiresAt ? Date.parse(expiresAt) : NaN;
  return {
    expiresAt,
    expiresMs,
    configured: Boolean(expiresAt),
    valid: Boolean(expiresAt) && Number.isFinite(expiresMs),
    expired: Boolean(expiresAt) && Number.isFinite(expiresMs) && expiresMs <= Date.now(),
  };
}

function isCompetitionCapabilityExpired() {
  const expiry = getCompetitionCapabilityExpiry();
  return !expiry.valid || expiry.expired;
}

function getAuthorizationStatus() {
  const expiry = getCompetitionCapabilityExpiry();
  const openidPrefixCount = splitList(process.env.AI_COMPETITION_OPENID_HASH_PREFIXES).length;
  const tokenConfigured = Boolean(String(process.env.AI_COMPETITION_CAPABILITY_TOKEN_SHA256 || "").trim());
  return {
    trialEnhancedMode: protocol.normalizeRuntimeMode(process.env.AI_RUNTIME_MODE || "public") === "competition",
    sessionAuthorizationConfigured: openidPrefixCount > 0,
    shortCredentialConfigured: tokenConfigured,
    shortCredentialExpiresAt: expiry.expiresAt,
    shortCredentialExpiryValid: tokenConfigured ? expiry.valid : false,
    shortCredentialExpired: tokenConfigured ? expiry.expired || !expiry.valid : false,
    allowUnknownEnv: boolEnv("AI_COMPETITION_ALLOW_UNKNOWN_ENV", false),
    allowTrialEnv: boolEnv("AI_COMPETITION_ALLOW_TRIAL_ENV", true),
    allowAllSessionsNonProduction: boolEnv("AI_COMPETITION_ALLOW_ALL_SESSIONS", false) && process.env.NODE_ENV !== "production",
    authorizedAccountRuleCount: openidPrefixCount,
  };
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
  if (trialEnvironmentAllowed(context)) {
    return {
      runtimeMode: "competition",
      requestedMode: requested,
      authorized: true,
      reason: "trial_env_authorized",
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
  getAuthorizationStatus,
  isDevelopOrTrial,
  isReleaseEnv,
  resolveRuntimeMode,
  sessionAllowed,
  trialEnvironmentAllowed,
  tokenAllowed,
};
