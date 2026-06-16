const assert = require("assert");

process.env.AI_AGENT_ENABLED = "false";
process.env.AI_RUNTIME_MODE = "competition";
process.env.AI_COMPETITION_ALLOW_ALL_SESSIONS = "true";
process.env.NODE_ENV = "development";
process.env.AI_WEATHER_ENABLED = "false";

const agentProtocol = require("../server/src/services/ai/agentProtocol");
const agentService = require("../server/src/services/ai/agentService");
const campusMapService = require("../server/src/services/ai/campusMapService");
const imageGenerationGateService = require("../server/src/services/ai/imageGenerationGateService");
const knowledgeBaseService = require("../server/src/services/ai/knowledgeBaseService");
const toolRegistry = require("../server/src/services/ai/toolRegistry");

const MSG_MULTI_STEP = "\u6211\u660e\u5929\u4e0b\u5348\u6ca1\u8bfe\u7684\u65f6\u5019\uff0c\u4ed9\u6eaa\u6821\u533a\u54ea\u91cc\u6709\u7a7a\u6559\u5ba4\uff0c\u5929\u6c14\u600e\u4e48\u6837\uff1f";
const MSG_WEATHER = "\u4ed9\u6eaa\u6821\u533a\u5929\u6c14\u600e\u4e48\u6837";
const MSG_PRIVACY = "\u4f5b\u8bfe\u5c0f\u8868\u9690\u79c1\u8bf4\u660e";
const MSG_IMAGE = "\u751f\u6210\u4e00\u5f20\u8bfe\u8868\u5206\u4eab\u6d77\u62a5";

function baseContext(extra = {}) {
  return Object.assign({
    term: "2025-2026-2",
    currentTeachingWeek: 1,
    todayWeekday: 1,
    envVersion: "develop",
    userPreferences: {
      campus: "\u4ed9\u6eaa\u6821\u533a",
      weatherAdviceEnabled: true,
    },
  }, extra);
}

async function chat(message, extra = {}) {
  return agentService.chat(Object.assign({
    message,
    context: baseContext(extra.context),
    runtimeMode: extra.runtimeMode || "competition",
    serverSession: extra.serverSession || { openidHash: "unit-test-openid" },
    protocolVersion: extra.protocolVersion || agentProtocol.PROTOCOL_VERSION,
  }, extra.input || {}));
}

async function testProtocolAndRuntimeModes() {
  const unsupported = await chat(MSG_WEATHER, { protocolVersion: "agent.v0" });
  assert.strictEqual(unsupported.protocolVersion, agentProtocol.PROTOCOL_VERSION);
  assert.strictEqual(unsupported.runtimeMode, "public");
  assert.strictEqual(unsupported.metrics.intentName, "protocol_version_unsupported");

  const unknownMode = await chat(MSG_WEATHER, { runtimeMode: "legacy-open" });
  assert.strictEqual(unknownMode.runtimeMode, "public");
  assert.notStrictEqual(unknownMode.safety.competitionAuthorized, true);

  const release = await chat(MSG_WEATHER, { context: { envVersion: "release" } });
  assert.strictEqual(release.runtimeMode, "public");
  assert.notStrictEqual(release.safety.competitionAuthorized, true);

  const competition = await chat(MSG_WEATHER);
  assert.strictEqual(competition.runtimeMode, "competition");
  assert.strictEqual(competition.safety.competitionAuthorized, true);
  assert.strictEqual(competition.safety.validationOk, true);
}

async function testPlannerToolEvidenceResponse() {
  const intent = toolRegistry.resolveIntent(MSG_MULTI_STEP, baseContext());
  assert.strictEqual(intent.name, "campus_multi_step_advice");

  const response = await chat(MSG_MULTI_STEP);
  assert.strictEqual(response.protocolVersion, agentProtocol.PROTOCOL_VERSION);
  assert.strictEqual(response.intent.name, "campus_multi_step_advice");
  const planTools = response.plan.map((item) => item.toolName);
  assert.deepStrictEqual(planTools, [
    "get_tomorrow_courses",
    "search_empty_rooms",
    "get_campus_weather",
    "search_campus_place",
  ]);
  assert(response.toolCalls.length >= 4);
  assert(response.evidenceItems.length >= 4);
  assert.strictEqual(response.safety.validationOk, true);
}

function testKnowledgeMapAndImageGates() {
  const knowledge = knowledgeBaseService.searchKnowledge({ q: MSG_PRIVACY });
  assert.strictEqual(knowledge.success, true);
  assert(knowledge.items.length > 0);
  assert(knowledge.items[0].sourceId);
  assert(knowledge.items[0].updatedAt);

  const place = campusMapService.searchCampusPlace({ q: "C7" });
  assert.strictEqual(place.success, true);
  assert(place.items.length > 0);
  assert(place.items[0].id);

  const missing = campusMapService.searchCampusPlace({ q: "\u4e0d\u5b58\u5728\u7684\u697c" });
  assert.strictEqual(missing.success, true);
  assert.strictEqual(missing.total, 0);

  const publicGate = imageGenerationGateService.buildDisabledResult("public");
  assert.strictEqual(publicGate.success, false);
  assert.strictEqual(publicGate.code, "IMAGE_GENERATION_DISABLED");
  assert.strictEqual(publicGate.status.enabled, false);
}

async function testPublicLeakControls() {
  process.env.AI_RUNTIME_MODE = "public";
  const response = await agentService.chat({
    message: MSG_WEATHER,
    context: baseContext({ runtimeMode: "competition", envVersion: "develop" }),
    runtimeMode: "competition",
    serverSession: { openidHash: "unit-test-openid" },
    protocolVersion: agentProtocol.PROTOCOL_VERSION,
  });
  const visible = JSON.stringify({
    answer: response.answer,
    cards: response.cards,
    suggestions: response.suggestions,
  });
  assert.strictEqual(response.runtimeMode, "public");
  assert(!/Provider|Token|Prompt|competition|Oracle|CloudBase|cloudbase|provider/i.test(visible));
}

async function run() {
  await testProtocolAndRuntimeModes();
  await testPlannerToolEvidenceResponse();
  testKnowledgeMapAndImageGates();
  await testPublicLeakControls();
  console.log("test-ai-agent-protocol-v1 passed");
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
