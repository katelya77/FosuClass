const crypto = require("crypto");
const capabilityManifestService = require("./capabilityManifestService");

function boolEnv(name, fallback = false) {
  const value = process.env[name];
  if (value === undefined || value === null || value === "") return fallback;
  return String(value).toLowerCase() === "true";
}

function hashToken(value) {
  return crypto.createHash("sha256").update(String(value || "")).digest("hex");
}

function splitList(value) {
  return String(value || "").split(",").map((item) => item.trim()).filter(Boolean);
}

function isReleaseEnv(context = {}) {
  const envVersion = String(context.envVersion || context.miniprogramVersion || "").trim().toLowerCase();
  return envVersion === "release" || envVersion === "public" || envVersion === "production";
}

function isDevelopOrTrial(context = {}) {
  const envVersion = String(context.envVersion || context.miniprogramVersion || "").trim().toLowerCase();
  return ["develop", "development", "dev", "trial", "devtools"].includes(envVersion);
}

function resolveConfiguredMode() {
  const raw = String(process.env.AI_RUNTIME_MODE || "public").trim().toLowerCase();
  if (raw === "competition") {
    const active = String(process.env.AI_PROVIDER_ACTIVE_ENV || "").trim().toLowerCase();
    if (active === "trial" || active === "dev") return active;
    return "public";
  }
  return capabilityManifestService.normalizeRuntimeMode(raw);
}

function trialEnvironmentAllowed(context = {}) {
  return resolveConfiguredMode() !== "public" && isDevelopOrTrial(context) && boolEnv("AI_COMPETITION_ALLOW_TRIAL_ENV", false);
}

function sessionAllowed(session = {}) {
  if (session && session.adminProviderVerification === true) return true;
  const allowAll = boolEnv("AI_COMPETITION_ALLOW_ALL_SESSIONS", false) && process.env.NODE_ENV !== "production";
  const hasServerSession = Boolean(session && (session.openidHash || session.sessionIdHash));
  if (allowAll && hasServerSession) return true;
  const prefixes = splitList(process.env.AI_COMPETITION_OPENID_HASH_PREFIXES);
  if (!prefixes.length) return false;
  const openidHash = String(session.openidHash || "").toLowerCase();
  return prefixes.some((prefix) => openidHash.startsWith(prefix.toLowerCase()));
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

function tokenAllowed(token) {
  const configured = String(process.env.AI_COMPETITION_CAPABILITY_TOKEN_SHA256 || "").trim().toLowerCase();
  const candidate = String(token || "").trim();
  if (!configured || !candidate || isCompetitionCapabilityExpired()) return false;
  return hashToken(candidate).toLowerCase() === configured;
}

function requiresEnhancedSession() {
  return boolEnv("AI_ENHANCED_REQUIRE_SESSION", false) || boolEnv("AI_COMPETITION_REQUIRE_SESSION", false);
}

function getAuthorizationStatus() {
  const expiry = getCompetitionCapabilityExpiry();
  const configuredMode = resolveConfiguredMode();
  const openidPrefixCount = splitList(process.env.AI_COMPETITION_OPENID_HASH_PREFIXES).length;
  const tokenConfigured = Boolean(String(process.env.AI_COMPETITION_CAPABILITY_TOKEN_SHA256 || "").trim());
  return {
    runtimeMode: configuredMode,
    trialEnhancedMode: configuredMode === "trial",
    devEnhancedMode: configuredMode === "dev",
    sessionRequired: requiresEnhancedSession(),
    sessionAuthorizationConfigured: openidPrefixCount > 0,
    shortCredentialConfigured: tokenConfigured,
    shortCredentialExpiresAt: expiry.expiresAt,
    shortCredentialExpiryValid: tokenConfigured ? expiry.valid : false,
    shortCredentialExpired: tokenConfigured ? expiry.expired || !expiry.valid : false,
    allowUnknownEnv: boolEnv("AI_COMPETITION_ALLOW_UNKNOWN_ENV", false),
    allowTrialEnv: boolEnv("AI_COMPETITION_ALLOW_TRIAL_ENV", false),
    allowAllSessionsNonProduction: boolEnv("AI_COMPETITION_ALLOW_ALL_SESSIONS", false) && process.env.NODE_ENV !== "production",
    authorizedAccountRuleCount: openidPrefixCount,
  };
}

function resolveRuntimeMode(input = {}) {
  const context = input.context || {};
  // Only the server-owned session argument may grant session authorization. A
  // similarly named object in client context is intentionally ignored.
  const session = input.serverSession || {};
  const configuredMode = resolveConfiguredMode();
  const requestedRaw = context.runtimeMode || input.runtimeMode || configuredMode;
  const requestedMode = capabilityManifestService.normalizeRuntimeMode(requestedRaw);

  if (configuredMode === "public") {
    return {
      runtimeMode: "public",
      configuredMode,
      requestedMode,
      authorized: false,
      reason: "server_runtime_public",
    };
  }
  if (isReleaseEnv(context)) {
    return {
      runtimeMode: "public",
      configuredMode,
      requestedMode,
      authorized: false,
      reason: "release_env_fail_closed",
    };
  }

  const sessionAuthorized = sessionAllowed(session);
  const capabilityToken = input.capabilityToken
    || input.competitionCapabilityToken
    || session.competitionCapabilityToken
    || context.competitionCapabilityToken;
  const capabilityAuthorized = tokenAllowed(capabilityToken);
  const explicitlyAuthorized = sessionAuthorized || capabilityAuthorized;
  const knownClientEnvironment = isDevelopOrTrial(context);
  const knownEnvironmentAllowed = trialEnvironmentAllowed(context);
  const unknownEnvironmentAllowed = boolEnv("AI_COMPETITION_ALLOW_UNKNOWN_ENV", false);

  if (!knownClientEnvironment && !unknownEnvironmentAllowed) {
    return {
      runtimeMode: "public",
      configuredMode,
      requestedMode,
      authorized: false,
      reason: "env_version_not_develop_or_trial",
    };
  }

  if (requiresEnhancedSession() && !explicitlyAuthorized) {
    return {
      runtimeMode: "public",
      configuredMode,
      requestedMode,
      authorized: false,
      reason: "enhanced_session_not_authorized",
    };
  }

  if (knownEnvironmentAllowed && !requiresEnhancedSession()) {
    return {
      runtimeMode: configuredMode,
      configuredMode,
      requestedMode,
      authorized: true,
      reason: `server_runtime_${configuredMode}`,
    };
  }

  if (explicitlyAuthorized) {
    return {
      runtimeMode: configuredMode,
      configuredMode,
      requestedMode,
      authorized: true,
      reason: sessionAuthorized ? "server_session_authorized" : "capability_token_authorized",
    };
  }

  return {
    runtimeMode: "public",
    configuredMode,
    requestedMode,
    authorized: false,
    reason: knownClientEnvironment ? "competition_not_authorized" : "unknown_env_requires_authorization",
  };
}

module.exports = {
  getAuthorizationStatus,
  isDevelopOrTrial,
  isReleaseEnv,
  resolveConfiguredMode,
  resolveRuntimeMode,
  sessionAllowed,
  trialEnvironmentAllowed,
  tokenAllowed,
};
