/**
 * Client-safe Agent readiness snapshot.
 * Never exposes keys, key suffixes, base URLs, openids, or internal stacks.
 */
const runtimeModeService = require("./runtimeModeService");
const providerConfigService = require("./providerConfigService");
const providerReadinessService = require("./providerReadinessService");
const { defaultMemoryService } = require("./conversation/conversationMemoryService");

function nowIso() {
  return new Date().toISOString();
}

function resolveRequestReadiness(input = {}) {
  const context = input.context || {};
  const serverSession = input.serverSession || null;
  const runtimeDecision = runtimeModeService.resolveRuntimeMode({
    context,
    serverSession,
    runtimeMode: input.runtimeMode,
  });
  const runtimeMode = runtimeDecision.runtimeMode || "public";
  const runtimeConfig = providerConfigService.resolveRuntimeProviderConfig({
    context,
    runtimeMode,
  });
  const providerFlags = providerReadinessService.publicProviderFlags(runtimeMode, runtimeConfig);
  const authenticated = Boolean(serverSession && serverSession.openidHash);
  let memoryAvailable = false;
  try {
    memoryAvailable = authenticated && Boolean(defaultMemoryService);
  } catch (error) {
    memoryAvailable = false;
  }

  let authorization = "not_allowed";
  if (runtimeMode === "public") {
    authorization = runtimeDecision.reason === "server_runtime_public" ? "allowed" : "not_allowed";
    // public core tools are allowed; enhanced is not.
    if (runtimeDecision.authorized !== true && runtimeMode === "public") {
      authorization = "allowed"; // stable public path
    }
  } else if (runtimeDecision.authorized) {
    authorization = "allowed";
  } else {
    authorization = "not_allowed";
  }

  let enhancedMode = "disabled";
  let reasonCode = runtimeDecision.reason || providerFlags.reasonCode || "";
  if (runtimeMode === "public") {
    enhancedMode = "disabled";
    reasonCode = reasonCode || "SERVER_RUNTIME_PUBLIC";
  } else if (!runtimeDecision.authorized) {
    enhancedMode = "disabled";
    if (runtimeDecision.reason === "enhanced_session_not_authorized") {
      reasonCode = "ENHANCED_SESSION_NOT_AUTHORIZED";
    } else if (runtimeDecision.reason === "env_version_not_develop_or_trial") {
      reasonCode = "TRIAL_ENV_NOT_ALLOWED";
    } else {
      reasonCode = reasonCode || "TRIAL_ENV_NOT_ALLOWED";
    }
  } else if (providerFlags.providerConfigured && providerFlags.providerReachable) {
    enhancedMode = "ready";
    reasonCode = providerFlags.reasonCode || "PROVIDER_HEALTHY";
  } else {
    enhancedMode = "degraded";
    reasonCode = providerFlags.reasonCode || "PROVIDER_KEY_MISSING";
  }

  // network/server are filled by route after this process answers.
  return {
    network: "reachable",
    server: "ready",
    runtimeMode,
    configuredMode: runtimeDecision.configuredMode || runtimeModeService.resolveConfiguredMode(),
    enhancedMode,
    authorization,
    providerConfigured: providerFlags.providerConfigured === true,
    providerReachable: providerFlags.providerReachable === true,
    memoryAvailable,
    runEventsSupported: true,
    reasonCode: String(reasonCode || "").slice(0, 80),
    checkedAt: nowIso(),
  };
}

function toClientStatusMachine(readiness = {}, options = {}) {
  if (options.networkOffline === true) return "network_offline";
  if (options.serverUnreachable === true || readiness.server === "unreachable") return "server_unreachable";
  if (readiness.runtimeMode === "trial" || readiness.runtimeMode === "dev") {
    if (readiness.enhancedMode === "ready") return "enhanced_ready";
    if (readiness.enhancedMode === "degraded") return "enhanced_degraded";
  }
  return "public_ready";
}

module.exports = {
  resolveRequestReadiness,
  toClientStatusMachine,
};
