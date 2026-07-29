const { createAgentRuntime } = require("../../../../packages/agent-runtime");
const platformProtocol = require("../../../../packages/agent-protocol");
const uiSchema = require("../../../../packages/ui-schema");
const { createSkillCatalog } = require("../../../../packages/skill-runtime");
const { createToolRuntime } = require("../../../../packages/tool-runtime");
const { createAgentPlatform } = require("../../../../apps/agent-server");
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

const recentPlatformTraces = [];

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
const ports = createFosuTurnPorts({
  agentKernel: platformKernel,
  skillCatalog: platformSkillCatalog,
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
  });
}

function listRecentPlatformTraces() {
  return recentPlatformTraces.slice().reverse();
}

module.exports = {
  getDiagnostics,
  getPlatform,
  listRecentPlatformTraces,
};
