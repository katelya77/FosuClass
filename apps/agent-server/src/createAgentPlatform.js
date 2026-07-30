function codedError(code, message) {
  const error = new Error(message || code);
  error.code = code;
  return error;
}

function requireMethod(owner, method, dependencyName) {
  if (!owner || typeof owner[method] !== "function") {
    throw codedError("AGENT_PLATFORM_DEPENDENCY_INVALID", `${dependencyName}.${method} is required`);
  }
}

function toLegacyEvent(event) {
  return Object.assign({}, event.publicPayload || {}, {
    eventId: event.eventId,
    runId: event.runId,
    sequence: event.sequence,
    type: event.type,
    protocolVersion: event.protocolVersion,
    configVersion: event.configVersion,
    at: event.createdAt,
    createdAt: event.createdAt,
  });
}

function createAgentPlatform(options = {}) {
  const runtime = options.runtime;
  const plugin = options.plugin;
  const stages = options.stages;
  requireMethod(runtime, "executeTurn", "runtime");
  if (!plugin || !plugin.id) throw codedError("AGENT_PLATFORM_PLUGIN_REQUIRED");
  ["assembleContext", "decide", "executeSkillTool", "verify", "compose"].forEach((method) => {
    requireMethod(stages, method, "stages");
  });
  const createRunId = typeof options.createRunId === "function"
    ? options.createRunId
    : () => `run_${Date.now().toString(36)}`;
  const resolveConfigSnapshot = typeof options.resolveConfigSnapshot === "function"
    ? options.resolveConfigSnapshot
    : () => ({ configVersion: plugin.manifestVersion || plugin.version });
  const pluginOwner = String(options.pluginOwner || `plugins/${plugin.id}`).slice(0, 160);

  async function executeTurn(input = {}) {
    const runId = String(input.runId || createRunId()).slice(0, 128);
    const request = Object.assign({}, input, { runId });
    delete request.onEvent;
    delete request.signal;
    const callerEmit = typeof input.onEvent === "function" ? input.onEvent : () => {};
    const resolvedConfig = await resolveConfigSnapshot({ request, plugin });
    const configSnapshot = Object.assign({}, resolvedConfig || {}, {
      configVersion: String(resolvedConfig && resolvedConfig.configVersion
        || plugin.manifestVersion
        || plugin.version
        || "unversioned"),
      pluginIds: [plugin.id],
    });
    // Request-scoped plugin state (sessions, repositories, authoritative Tool
    // resources and Provider configuration) must never become a Runtime
    // artifact or Trace payload. The Context stage returns an envelope once;
    // only its generic snapshot crosses the package boundary.
    let privateTurnState = null;
    const invokeStage = (method, viewName) => async (stageInput) => {
      const context = stageInput && stageInput.context || null;
      const contextView = context && context.views && context.views[viewName] || null;
      return stages[method](Object.assign({}, stageInput, {
        contextView,
        privateState: privateTurnState,
      }));
    };
    const execution = await runtime.executeTurn({
      request,
      configSnapshot,
      signal: input.signal || null,
      emit: (event) => callerEmit(toLegacyEvent(event)),
      stages: {
        context: async (stageInput) => {
          const assembled = await stages.assembleContext(stageInput);
          if (assembled && assembled.snapshot) {
            privateTurnState = assembled.privateState || null;
            return assembled.snapshot;
          }
          return assembled;
        },
        decision: invokeStage("decide", "decision"),
        skillTool: invokeStage("executeSkillTool", "tool"),
        verification: invokeStage("verify", "verification"),
        response: invokeStage("compose", "response"),
      },
    });
    const response = execution.artifacts && execution.artifacts.response;
    if (!response || typeof response !== "object") {
      throw codedError("AGENT_PLATFORM_RESPONSE_INVALID");
    }
    const publicMode = String(response.runtimeMode || request.runtimeMode || "public").toLowerCase() === "public";
    const clientTrace = publicMode
      ? Object.assign({}, execution.platformTrace, {
        stages: (execution.platformTrace.stages || []).map((stage) => {
          const details = Object.assign({}, stage.details || {});
          delete details.intendedProvider;
          delete details.actualFirstProvider;
          return Object.assign({}, stage, { details });
        }),
      })
      : execution.platformTrace;
    return Object.assign({}, response, {
      runId,
      deadlineAt: new Date(execution.deadlineAt).toISOString(),
      platformTrace: clientTrace,
      ui: execution.ui,
    });
  }

  function diagnostics() {
    return Object.freeze({
      runtimePackage: "@xiaofu-agent/agent-runtime",
      protocolPackage: "@xiaofu-agent/agent-protocol",
      skillRuntimePackage: "@xiaofu-agent/skill-runtime",
      toolRuntimePackage: "@xiaofu-agent/tool-runtime",
      uiSchemaPackage: "@xiaofu-agent/ui-schema",
      pluginIds: Object.freeze([plugin.id]),
      plugins: Object.freeze([Object.freeze({
        id: plugin.id,
        version: String(plugin.version || "unknown"),
        manifestVersion: String(plugin.manifestVersion || "unknown"),
      })]),
      configVersion: String(plugin.manifestVersion ? `manifest:${plugin.manifestVersion}` : plugin.version || "unversioned"),
      legacyWholeChatCallback: false,
      runtime: typeof runtime.diagnostics === "function" ? runtime.diagnostics() : {},
      stageOwners: Object.freeze({
        context: pluginOwner,
        decision: pluginOwner,
        skillTool: pluginOwner,
        verification: pluginOwner,
        response: pluginOwner,
      }),
    });
  }

  return Object.freeze({
    executeTurn,
    diagnostics,
  });
}

module.exports = {
  createAgentPlatform,
};
