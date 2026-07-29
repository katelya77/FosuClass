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
    const execution = await runtime.executeTurn({
      request,
      configSnapshot,
      signal: input.signal || null,
      emit: (event) => callerEmit(toLegacyEvent(event)),
      stages: {
        context: (stageInput) => stages.assembleContext(stageInput),
        decision: (stageInput) => stages.decide(stageInput),
        skillTool: (stageInput) => stages.executeSkillTool(stageInput),
        verification: (stageInput) => stages.verify(stageInput),
        response: (stageInput) => stages.compose(stageInput),
      },
    });
    const response = execution.artifacts && execution.artifacts.response;
    if (!response || typeof response !== "object") {
      throw codedError("AGENT_PLATFORM_RESPONSE_INVALID");
    }
    return Object.assign({}, response, {
      runId,
      platformTrace: execution.platformTrace,
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
      legacyWholeChatCallback: false,
      stageOwners: Object.freeze({
        context: "plugins/fosu-campus",
        decision: "plugins/fosu-campus",
        skillTool: "plugins/fosu-campus",
        verification: "plugins/fosu-campus",
        response: "plugins/fosu-campus",
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
