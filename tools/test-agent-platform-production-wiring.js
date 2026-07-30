const assert = require("assert");

process.env.AI_RUNTIME_MODE = "public";
process.env.AI_AGENT_ENABLED = "false";
process.env.AI_ALLOW_PERSONAL_CONTEXT = "true";
process.env.AI_WEATHER_ENABLED = "false";

const { buildAiContext } = require("./fixtures/ai-today-courses.fixture");
const agentService = require("../server/src/services/ai/agentService");

async function main() {
  const events = [];
  const response = await agentService.chat({
    protocolVersion: "agent.v2",
    message: "我今天有什么课？",
    context: buildAiContext(),
    onEvent: (event) => events.push(event),
  });

  assert.strictEqual(response.success, true);
  assert.strictEqual(response.protocolVersion, "agent.v2");
  assert.strictEqual(response.externalProviderUsed, false);
  assert(response.evidence && response.evidence.complete === true);
  assert(response.evidence.toolCount > 0);
  assert(Array.isArray(response.cards));
  assert(Array.isArray(response.toolCalls));

  assert(response.platformTrace, "production response must expose the safe platform Trace");
  assert.strictEqual(response.platformTrace.runtimePackage, "@xiaofu-agent/agent-runtime");
  assert.deepStrictEqual(response.platformTrace.pluginIds, ["fosu-campus"]);
  const stageNames = response.platformTrace.stages.map((stage) => stage.stage);
  assert.deepStrictEqual(stageNames, [
    "context",
    "decision",
    "skill_tool",
    "verification",
    "response",
    "ui",
    "total",
  ]);
  assert.strictEqual(response.platformTrace.stages.find((stage) => stage.stage === "decision").outcome, "success");
  const contextStages = response.platformTrace.stages.filter((stage) => (
    ["context", "decision", "skill_tool", "verification", "response"].includes(stage.stage)
  ));
  assert.match(contextStages[0].details.contextId, /^ctx_[a-f0-9]{24}$/);
  assert.strictEqual(contextStages[0].details.schemaVersion, "agent-context.v2");
  assert.strictEqual(contextStages[0].details.owner, "@xiaofu-agent/agent-runtime");
  assert.deepStrictEqual(
    Array.from(new Set(contextStages.map((stage) => stage.details.contextId))),
    [contextStages[0].details.contextId],
    "Decision, Tool, Verification and Response must consume one assembled Context identity"
  );
  assert(!JSON.stringify(response.platformTrace).includes("currentScheduleSummary"));
  assert(response.ui && Array.isArray(response.ui.blocks));

  const diagnostics = agentService.__getPlatformForTests();
  assert.strictEqual(diagnostics.runtimePackage, "@xiaofu-agent/agent-runtime");
  assert.deepStrictEqual(diagnostics.pluginIds, ["fosu-campus"]);
  assert.strictEqual(diagnostics.legacyWholeChatCallback, false);
  assert.deepStrictEqual(diagnostics.stageOwners, {
    context: "plugins/fosu-campus",
    decision: "plugins/fosu-campus",
    skillTool: "plugins/fosu-campus",
    verification: "plugins/fosu-campus",
    response: "plugins/fosu-campus",
  });

  const eventTypes = events.map((event) => event.type);
  assert(eventTypes.includes("runtime.entered"));
  assert(eventTypes.includes("stage.started"));
  assert(eventTypes.includes("runtime.completed"));

  const noScheduleResponse = await agentService.chat({
    protocolVersion: "agent.v2",
    message: "\u4eca\u5929\u6709\u4ec0\u4e48\u8bfe\uff1f",
    context: {
      envVersion: "release",
      currentTeachingWeek: 3,
      term: "2025-2026-2",
      todayDate: "2026-07-21",
    },
  });
  assert.strictEqual(noScheduleResponse.success, false, "missing personal schedule must return a truthful incomplete result");
  assert.strictEqual(noScheduleResponse.evidence.complete, false);
  assert((noScheduleResponse.steps || []).some((step) => step.tool === "get_today_courses" && step.status === "failed"));
  const noScheduleTools = (noScheduleResponse.observations || []).map((observation) => observation.tool);
  assert(noScheduleTools.includes("get_today_courses"), "the authoritative fact tool must still execute");
  assert(!noScheduleTools.includes("explain_personal_import"), "replan must not escape the selected Skill/tool intersection");

  const plainResponse = await agentService.chat({
    protocolVersion: "agent.v2",
    message: "\u4f60\u662f\u8c01\uff1f",
    context: { envVersion: "release" },
  });
  assert.strictEqual(plainResponse.success, true);
  assert.deepStrictEqual(
    (plainResponse.toolCalls || []).map((call) => call.name),
    [],
    "an empty exact-match intersection must not be expanded to rag_search"
  );
  console.log("test-agent-platform-production-wiring: PASS");
}

main().catch((error) => {
  console.error(error && error.stack || error);
  process.exit(1);
});
