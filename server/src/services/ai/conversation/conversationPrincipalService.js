/**
 * Server-side ConversationPrincipal.
 * Never trust client-supplied identity; only derive from validated session.
 */
const crypto = require("crypto");
const capabilityManifestService = require("../capabilityManifestService");

function getMemorySecret() {
  const secret = String(
    process.env.FOSU_AGENT_MEMORY_SECRET
    || process.env.FOSU_SESSION_SECRET_CURRENT
    || process.env.FOSU_SESSION_SECRET
    || ""
  ).trim();
  if (secret) return secret;
  if (process.env.NODE_ENV === "production") {
    const error = new Error("FOSU_AGENT_MEMORY_SECRET is required in production");
    error.code = "MEMORY_SECRET_MISSING";
    throw error;
  }
  return "dev-only-agent-memory-secret";
}

function getDeployEnv() {
  return String(process.env.FOSU_DEPLOY_ENV || process.env.NODE_ENV || "development").trim().toLowerCase() || "development";
}

function hmacPrincipalKey(parts = []) {
  const material = parts.map((part) => String(part || "")).join("|");
  return crypto.createHmac("sha256", getMemorySecret()).update(material).digest("hex");
}

/**
 * Resolve principal from server session only.
 * @param {object} options
 * @param {object|null} options.serverSession - req.fosuSession
 * @param {string} [options.runtimeMode]
 * @param {string} [options.appid]
 */
function resolvePrincipal(options = {}) {
  const session = options.serverSession && typeof options.serverSession === "object"
    ? options.serverSession
    : null;
  const runtimeMode = capabilityManifestService.normalizeRuntimeMode(options.runtimeMode || "public");
  const appid = String(options.appid || (session && session.appid) || process.env.WX_APPID || "default-app").trim();
  const deployEnv = getDeployEnv();
  const openidHash = session && session.openidHash ? String(session.openidHash) : "";

  if (session && openidHash) {
    const principalKey = hmacPrincipalKey([
      "wechat",
      appid,
      openidHash,
      runtimeMode,
      deployEnv,
    ]);
    return {
      principalType: "wechat",
      principalKey,
      authenticated: true,
      runtimeMode,
      appid,
      deployEnv,
      // Never expose openidHash outside this service.
      openidHashPrefix: openidHash.slice(0, 8),
    };
  }

  return {
    principalType: "anonymous",
    principalKey: "",
    authenticated: false,
    runtimeMode,
    appid,
    deployEnv,
    openidHashPrefix: "",
  };
}

function principalShard(principalKey) {
  if (!principalKey) return "anonymous";
  return String(principalKey).slice(0, 16);
}

module.exports = {
  getDeployEnv,
  getMemorySecret,
  hmacPrincipalKey,
  principalShard,
  resolvePrincipal,
};
