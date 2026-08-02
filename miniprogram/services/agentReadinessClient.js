/**
 * Client-safe Agent readiness probe.
 */
const request = require("../utils/request");
const platform = require("../utils/platform");

function statusCopy(statusMachine) {
  switch (String(statusMachine || "")) {
    case "network_offline":
      return { label: "离线", className: "offline", chips: ["本地模式"] };
    case "server_unreachable":
      return { label: "服务不可达", className: "warn", chips: ["本地模式"] };
    case "enhanced_ready":
      return { label: "增强就绪", className: "online", chips: ["增强模式"] };
    case "enhanced_degraded":
      return { label: "增强降级", className: "warn", chips: ["增强模式"] };
    case "public_ready":
    default:
      return { label: "稳定模式", className: "online", chips: ["稳定模式"] };
  }
}

async function fetchReadiness() {
  try {
    const envVersion = encodeURIComponent(platform.getMiniProgramEnvVersion());
    const response = await request.get(`/api/ai/agent/readiness?envVersion=${envVersion}`, {}, {
      showLoading: false,
      silentError: true,
      timeout: 8000,
      retries: 0,
      dedupe: true,
    });
    if (!response || response.success === false) {
      return {
        ok: false,
        network: "reachable",
        server: "unreachable",
        runtimeMode: "public",
        enhancedMode: "disabled",
        statusMachine: "server_unreachable",
        reasonCode: response && response.reasonCode || "SERVER_UNREACHABLE",
        checkedAt: new Date().toISOString(),
      };
    }
    const statusMachine = response.statusMachine || "public_ready";
    return Object.assign({
      ok: true,
      statusMachine,
      network: response.network || "reachable",
      server: response.server || "ready",
      runtimeMode: response.runtimeMode || "public",
      enhancedMode: response.enhancedMode || "disabled",
      authorization: response.authorization || "allowed",
      providerConfigured: response.providerConfigured === true,
      configuredAvailable: response.configuredAvailable === true,
      providerVerified: response.providerVerified === true,
      providerReachable: response.providerReachable === true,
      provider: response.provider || response.providerName || "",
      configVersion: response.configVersion || "",
      lastProbeAt: response.lastProbeAt || "",
      lastSuccessAt: response.lastSuccessAt || "",
      lastFailureAt: response.lastFailureAt || "",
      circuitState: response.circuitState || "unknown",
      memoryAvailable: response.memoryAvailable === true,
      runEventsSupported: response.runEventsSupported !== false,
      reasonCode: response.reasonCode || "",
      requestId: response.requestId || "",
      checkedAt: response.checkedAt || new Date().toISOString(),
    }, statusCopy(statusMachine));
  } catch (error) {
    const reasonCode = error && (error.reasonCode || error.code) || "WECHAT_NETWORK_REQUEST_FAILED";
    return {
      ok: false,
      network: "unknown",
      server: "unreachable",
      runtimeMode: "public",
      enhancedMode: "disabled",
      statusMachine: "server_unreachable",
      reasonCode,
      failureLayer: error && error.failureLayer || "network",
      statusCode: Number(error && error.statusCode || 0) || 0,
      elapsedMs: Number(error && error.elapsedMs || 0) || 0,
      requestId: error && error.requestId || "",
      safeErrMsg: error && error.safeErrMsg || "",
      checkedAt: new Date().toISOString(),
      label: "服务不可达",
      className: "warn",
      chips: ["本地模式"],
    };
  }
}

async function detectNetworkOffline() {
  return new Promise((resolve) => {
    try {
      wx.getNetworkType({
        success: (res) => resolve(String(res.networkType || "") === "none"),
        fail: () => resolve(false),
      });
    } catch (error) {
      resolve(false);
    }
  });
}

async function probeAgentStatus() {
  const offline = await detectNetworkOffline();
  if (offline) {
    return {
      ok: false,
      statusMachine: "network_offline",
      network: "offline",
      server: "unknown",
      runtimeMode: "public",
      enhancedMode: "disabled",
      reasonCode: "NETWORK_OFFLINE",
      label: "离线",
      className: "offline",
      chips: ["本地模式"],
      checkedAt: new Date().toISOString(),
    };
  }
  return fetchReadiness();
}

module.exports = {
  fetchReadiness,
  probeAgentStatus,
  statusCopy,
};
