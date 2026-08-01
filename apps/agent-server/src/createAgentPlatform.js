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
  // P7a：可选 Engine Registry。提供时执行经 registry.resolve 选择引擎、
  // 经 AgentEngineAdapter.execute 进入真实执行链；缺省保持既有 runtime
  // 直调行为（向后兼容既有测试与嵌入式装配）。Engine 元数据写入
  // platformTrace.engine（intendedEngine/actualEngine/engineVersion/
  // conformanceVersion/fallbackPath/outcome），不含 Provider 名与密钥。
  const engineRegistry = options.engineRegistry && typeof options.engineRegistry.resolve === "function"
    ? options.engineRegistry
    : null;
  const engineTraceMetadata = typeof options.engineTraceMetadata === "function"
    ? options.engineTraceMetadata
    : null;
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
    let resultEngineTrace = null;
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
    const execution = await (async () => {
      const engineInput = {
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
      };
      if (!engineRegistry) {
        return runtime.executeTurn(engineInput);
      }
      // Run 创建后绑定 Engine：单次执行 resolve 一次，在途执行不切换。
      const engine = engineRegistry.resolve({
        environment: configSnapshot.environment || request.runtimeMode,
      });
      try {
        const result = await engine.execute(engineInput);
        resultEngineTrace = engineTraceMetadata
          ? engineTraceMetadata(engine, { outcome: "success" })
          : null;
        return result;
      } catch (error) {
        if (engineTraceMetadata && error && typeof error === "object") {
          error.engineTrace = engineTraceMetadata(engine, {
            outcome: error.code === "ABORTED" ? "cancelled" : "failed",
          });
        }
        throw error;
      }
    })();
    const response = execution.artifacts && execution.artifacts.response;
    if (!response || typeof response !== "object") {
      throw codedError("AGENT_PLATFORM_RESPONSE_INVALID");
    }
    const publicMode = String(response.runtimeMode || request.runtimeMode || "public").toLowerCase() === "public";
    const traceWithEngine = resultEngineTrace
      ? Object.assign({}, execution.platformTrace, { engine: resultEngineTrace })
      : execution.platformTrace;
    const clientTrace = publicMode
      ? Object.assign({}, traceWithEngine, {
        stages: (execution.platformTrace.stages || []).map((stage) => {
          const details = Object.assign({}, stage.details || {});
          delete details.intendedProvider;
          delete details.actualFirstProvider;
          // P2R Wave 2：失败分类字段只允许 trial/dev 客户端 Trace。
          delete details.failureClass;
          delete details.fallbackReason;
          delete details.remainingFallbackBudget;
          // P2R：计划来源字段同样只属 trial/dev（发射侧已门控，这里双保险）。
          delete details.proposedPlan;
          delete details.resolvedPlan;
          delete details.planSource;
          delete details.planAdjustmentReasons;
          return Object.assign({}, stage, { details });
        }),
      })
      : traceWithEngine;
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
      engines: engineRegistry && typeof engineRegistry.diagnostics === "function"
        ? engineRegistry.diagnostics()
        : null,
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
