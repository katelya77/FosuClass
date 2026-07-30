const { createAgentRuntime, createContextAssembler } = require("../../../../packages/agent-runtime");
const { EXECUTION_POLICIES, resolveExecutionPolicy } = require("../../../../packages/provider-runtime");
const platformProtocol = require("../../../../packages/agent-protocol");
const uiSchema = require("../../../../packages/ui-schema");
const { createSkillCatalog } = require("../../../../packages/skill-runtime");
const { createToolRuntime } = require("../../../../packages/tool-runtime");
const { createAgentPlatform, createRunHandlers } = require("../../../../apps/agent-server");
const { createFosuCampusPlugin, createFosuStages } = require("../../../../plugins/fosu-campus");

const capabilityManifestService = require("./capabilityManifestService");
const skillRegistry = require("./skillRegistry");
const toolRegistry = require("./toolRegistry");
const toolSchemaRegistry = require("./generated/toolSchemas.generated");
const responseComposer = require("./responseComposer");
const releaseService = require("../releaseService");
const agentProtocol = require("./agentProtocol");
const { AgentKernel } = require("./agentKernel");
const { createFosuTurnPorts } = require("./runtime/fosuTurnPorts");
const { createDecisionService } = require("./decision/decisionService");
const providerRuntimeComposition = require("./providerRuntimeComposition");
const providerConfigService = require("./providerConfigService");
const runtimeModeService = require("./runtimeModeService");
const safetyGuard = require("./safetyGuard");

const recentPlatformTraces = [];
let runHandlers = null;

const plugin = createFosuCampusPlugin({
  capabilityManifestService,
  skillRegistry,
  toolRegistry,
  toolSchemaRegistry,
  responseComposer,
  releaseService,
  mapResultToBlocks: uiSchema.blocksFromAgentResult,
});
const platformSkillCatalog = createSkillCatalog({ skills: plugin.skills });
const platformToolRuntime = createToolRuntime({ tools: plugin.tools });
const platformKernel = new AgentKernel({
  skillRegistry: platformSkillCatalog,
  toolRuntime: platformToolRuntime,
  capabilityManifestService,
  intentResolver: toolRegistry.resolveIntent,
});
const platformDecisionService = createDecisionService({
  providerRuntime: providerRuntimeComposition.getProviderRuntime(),
  skillCatalog: platformSkillCatalog,
  deterministicResolve(message, context) {
    return require("./runtime/understandingCoordinator").resolveRuleBackedIntent(message, context).intent;
  },
});
const platformContextAssembler = createContextAssembler({
  redact: safetyGuard.redactSensitiveText,
});
const ports = createFosuTurnPorts({
  agentKernel: platformKernel,
  skillCatalog: platformSkillCatalog,
  decisionService: platformDecisionService,
  contextAssembler: platformContextAssembler,
});
const stages = createFosuStages({ plugin, ports });
const runtime = createAgentRuntime({
  protocol: platformProtocol,
  uiSchema,
  traceSink(trace) {
    recentPlatformTraces.push(trace);
    if (recentPlatformTraces.length > 200) recentPlatformTraces.splice(0, recentPlatformTraces.length - 200);
  },
});
const platform = createAgentPlatform({
  runtime,
  plugin,
  stages,
  createRunId: agentProtocol.createRunId,
  resolveConfigSnapshot() {
    return {
      configVersion: `manifest:${plugin.manifestVersion}`,
    };
  },
});

function getPlatform() {
  return platform;
}

function getDiagnostics() {
  return Object.assign({}, platform.diagnostics(), {
    manifestVersion: plugin.manifestVersion,
    skillCount: plugin.skills.length,
    toolCount: plugin.tools.length,
    recentTraceCount: recentPlatformTraces.length,
    providerRuntime: providerRuntimeComposition.getProviderRuntimeDiagnostics(),
  });
}

function listRecentPlatformTraces() {
  return recentPlatformTraces.slice().reverse();
}

function getExecutionPolicyTruth() {
  const activeMode = runtimeModeService.resolveConfiguredMode();
  let runtimeConfig = {};
  try {
    const status = providerConfigService.getStatus();
    const environment = activeMode === "public" ? "public" : (status.activeEnvironment || activeMode);
    runtimeConfig = providerConfigService.getRuntimeConfigForEnvironment(environment) || {};
  } catch (error) {
    runtimeConfig = {};
  }
  const configuredPolicy = runtimeConfig.AI_EXECUTION_POLICY || process.env.AI_EXECUTION_POLICY || "";
  return Object.freeze({
    activeMode,
    configuredPolicy: String(configuredPolicy || "").slice(0, 40),
    effectiveDefault: resolveExecutionPolicy({
      runtimeMode: activeMode,
      configuredPolicy,
      trusted: true,
    }),
    supported: Object.freeze([
      EXECUTION_POLICIES.DETERMINISTIC,
      EXECUTION_POLICIES.STRICT_MODEL_FIRST,
      EXECUTION_POLICIES.ADAPTIVE,
    ]),
    strictModelFirstReady: true,
    adaptiveReady: true,
    publicProviderForbidden: true,
  });
}

function getRunHandlers() {
  if (runHandlers) return runHandlers;
  // Lazy imports keep the Agent Runtime independent from the integrated
  // Express shell while still binding every transport to this exact platform
  // singleton and the existing Run Repository fact source.
  const agentRunEventService = require("./agentRunEventService");
  const aguiAdapter = require("./aguiAdapter");
  const agentService = require("./agentService");
  const { safeLog } = require("../../utils/safeLogger");
  runHandlers = createRunHandlers({
    platform,
    runRepository: agentRunEventService,
    protocol: agentProtocol,
    agui: aguiAdapter,
    buildFailureResponse: agentService.buildServiceFailureResponse,
    log: safeLog,
    runRepositoryId: "agentRunEventService",
    resolvePrincipal(req) {
      const session = req && req.fosuSession || null;
      return {
        repositoryPrincipal: session,
        runtimePrincipal: session ? {
          openidHash: session.openidHash || "",
          sessionIdHash: session.sessionIdHash || "",
          appid: session.appid || "",
        } : null,
      };
    },
    resolvePollCredential(req) {
      return String(req && req.body && req.body.pollToken
        || req && req.query && req.query.pollToken
        || req && req.headers && req.headers["x-fosu-run-poll-token"]
        || "");
    },
  });
  return runHandlers;
}

module.exports = {
  getDiagnostics,
  getExecutionPolicyTruth,
  getPlatform,
  getRunHandlers,
  listRecentPlatformTraces,
};
