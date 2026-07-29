const { sanitizePublicValue } = require("@xiaofu-agent/agent-protocol");

const ADMIN_APP = "@xiaofu-agent/agent-admin";

function codedError(code, message) {
  const error = new Error(message || code);
  error.code = code;
  return error;
}

function requireFunction(value, name) {
  if (typeof value !== "function") throw codedError("AGENT_ADMIN_DEPENDENCY_INVALID", `${name} is required`);
}

function noStore(res) {
  res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate");
  res.setHeader("Pragma", "no-cache");
}

function safePayload(value) {
  return sanitizePublicValue(value && typeof value === "object" ? value : {});
}

function createPlatformAdminHandlers(options = {}) {
  const getPlatformDiagnostics = options.getPlatformDiagnostics;
  const listRecentPlatformTraces = options.listRecentPlatformTraces;
  const getExecutionPolicy = options.getExecutionPolicy;
  requireFunction(getPlatformDiagnostics, "getPlatformDiagnostics");
  requireFunction(listRecentPlatformTraces, "listRecentPlatformTraces");
  requireFunction(getExecutionPolicy, "getExecutionPolicy");

  function topologyPayload() {
    const diagnostics = safePayload(getPlatformDiagnostics());
    const plugins = Array.isArray(diagnostics.plugins)
      ? diagnostics.plugins
      : (diagnostics.pluginIds || []).map((id) => ({ id, version: "unknown" }));
    return safePayload({
      success: true,
      app: ADMIN_APP,
      platform: {
        runtimePackage: diagnostics.runtimePackage,
        protocolPackage: diagnostics.protocolPackage,
        skillRuntimePackage: diagnostics.skillRuntimePackage,
        toolRuntimePackage: diagnostics.toolRuntimePackage,
        uiSchemaPackage: diagnostics.uiSchemaPackage,
        pluginIds: diagnostics.pluginIds || [],
        plugins,
        configVersion: diagnostics.configVersion || "unversioned",
        manifestVersion: diagnostics.manifestVersion || "unknown",
        packageOwnership: diagnostics.stageOwners || {},
        legacyWholeChatCallback: diagnostics.legacyWholeChatCallback === true,
        skillCount: diagnostics.skillCount || 0,
        toolCount: diagnostics.toolCount || 0,
        recentTraceCount: diagnostics.recentTraceCount || 0,
        executionPolicy: getExecutionPolicy(),
      },
      serverTime: new Date().toISOString(),
    });
  }

  function getTopology(req, res) {
    noStore(res);
    try {
      return res.json(topologyPayload());
    } catch (error) {
      return res.status(503).json({
        success: false,
        code: "AGENT_PLATFORM_TOPOLOGY_UNAVAILABLE",
        message: "Agent platform runtime truth is temporarily unavailable.",
        serverTime: new Date().toISOString(),
      });
    }
  }

  function getRecentRuns(req, res) {
    noStore(res);
    try {
      const limit = Math.max(1, Math.min(100, Number(req.query && req.query.limit) || 20));
      const traces = listRecentPlatformTraces().slice(0, limit).map((trace) => safePayload(trace));
      return res.json(safePayload({
        success: true,
        app: ADMIN_APP,
        runs: traces,
        count: traces.length,
        serverTime: new Date().toISOString(),
      }));
    } catch (error) {
      return res.status(503).json({
        success: false,
        code: "AGENT_PLATFORM_TRACES_UNAVAILABLE",
        message: "Agent platform traces are temporarily unavailable.",
        serverTime: new Date().toISOString(),
      });
    }
  }

  return Object.freeze({
    getTopology,
    getRecentRuns,
    topologyPayload,
  });
}

module.exports = {
  ADMIN_APP,
  createPlatformAdminHandlers,
};
