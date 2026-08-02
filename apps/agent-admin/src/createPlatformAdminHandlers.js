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
  const listDurableRunTraces = options.listDurableRunTraces;
  const getOperationsSnapshot = options.getOperationsSnapshot;
  const runOperationsSmokeTest = options.runOperationsSmokeTest;
  const getExecutionPolicy = options.getExecutionPolicy;
  requireFunction(getPlatformDiagnostics, "getPlatformDiagnostics");
  requireFunction(listRecentPlatformTraces, "listRecentPlatformTraces");
  requireFunction(listDurableRunTraces, "listDurableRunTraces");
  requireFunction(getOperationsSnapshot, "getOperationsSnapshot");
  requireFunction(runOperationsSmokeTest, "runOperationsSmokeTest");
  requireFunction(getExecutionPolicy, "getExecutionPolicy");

  async function topologyPayload() {
    const diagnostics = safePayload(await getPlatformDiagnostics());
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
        configKernel: diagnostics.configKernel || null,
        manifestVersion: diagnostics.manifestVersion || "unknown",
        packageOwnership: diagnostics.stageOwners || {},
        legacyWholeChatCallback: diagnostics.legacyWholeChatCallback === true,
        skillCount: diagnostics.skillCount || 0,
        toolCount: diagnostics.toolCount || 0,
        recentTraceCount: diagnostics.recentTraceCount || 0,
        runtime: diagnostics.runtime || {},
        providerRuntime: diagnostics.providerRuntime || {},
        executionPolicy: getExecutionPolicy(),
      },
      serverTime: new Date().toISOString(),
    });
  }

  async function getTopology(req, res) {
    noStore(res);
    try {
      return res.json(await topologyPayload());
    } catch (error) {
      return res.status(503).json({
        success: false,
        code: "AGENT_PLATFORM_TOPOLOGY_UNAVAILABLE",
        message: "Agent platform runtime truth is temporarily unavailable.",
        serverTime: new Date().toISOString(),
      });
    }
  }

  function traceMatches(trace, query = {}) {
    const exact = (field, expected) => !expected || String(field || "") === String(expected);
    const tools = Array.isArray(trace && trace.toolCalls) ? trace.toolCalls : [];
    const recordedAtMs = Date.parse(trace && (trace.recordedAt || trace.createdAt) || "");
    const fromMs = Date.parse(query.from || "");
    const toMs = Date.parse(query.to || "");
    return exact(trace && (trace.environment || trace.runtimeMode), query.environment)
      && exact(trace && trace.status, query.status)
      && exact(trace && trace.provider, query.provider)
      && exact(trace && trace.errorCode, query.errorCode)
      && (!query.tool || tools.some((call) => String(call && (call.name || call.toolName) || "") === String(query.tool)))
      && (!Number.isFinite(fromMs) || Number.isFinite(recordedAtMs) && recordedAtMs >= fromMs)
      && (!Number.isFinite(toMs) || Number.isFinite(recordedAtMs) && recordedAtMs <= toMs);
  }

  async function getRecentRuns(req, res) {
    noStore(res);
    try {
      const limit = Math.max(1, Math.min(100, Number(req.query && req.query.limit) || 20));
      const durable = await listDurableRunTraces();
      const platformByRunId = new Map((listRecentPlatformTraces() || [])
        .filter((trace) => trace && trace.runId)
        .map((trace) => [String(trace.runId), trace]));
      const traces = (Array.isArray(durable) ? durable : [])
        .filter((trace) => traceMatches(trace, req.query || {}))
        .slice(0, limit)
        .map((trace) => safePayload(Object.assign(
          {},
          platformByRunId.get(String(trace && trace.runId || "")) || {},
          trace,
        )));
      return res.json(safePayload({
        success: true,
        app: ADMIN_APP,
        source: "durable-run-trace-store",
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

  async function getOperations(req, res) {
    noStore(res);
    try {
      const environment = String(req.query && req.query.environment || "public").slice(0, 16);
      const operations = safePayload(await getOperationsSnapshot(environment));
      return res.json(safePayload({
        success: true,
        app: ADMIN_APP,
        operations,
        serverTime: new Date().toISOString(),
      }));
    } catch (error) {
      return res.status(503).json({
        success: false,
        code: String(error && error.code || "AGENT_OPERATIONS_UNAVAILABLE").slice(0, 80),
        message: "Assistant operations truth is temporarily unavailable.",
        serverTime: new Date().toISOString(),
      });
    }
  }

  async function postSmokeTest(req, res) {
    noStore(res);
    try {
      const environment = String(req.body && req.body.environment || "public").slice(0, 16);
      const report = safePayload(await runOperationsSmokeTest(environment));
      return res.json(Object.assign({ success: true }, report));
    } catch (error) {
      return res.status(503).json({
        success: false,
        code: String(error && error.code || "AGENT_SMOKE_UNAVAILABLE").slice(0, 80),
        message: "Assistant smoke test could not be completed.",
        serverTime: new Date().toISOString(),
      });
    }
  }

  return Object.freeze({
    getTopology,
    getRecentRuns,
    getOperations,
    postSmokeTest,
    topologyPayload,
  });
}

module.exports = {
  ADMIN_APP,
  createPlatformAdminHandlers,
};
