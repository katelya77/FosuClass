#!/usr/bin/env node
const assert = require("assert");
const http = require("http");

function validDecision(overrides = {}) {
  return Object.assign({
    schemaVersion: "decision.v2",
    goal: { name: "get_teaching_week", confidence: 0.99, requiresClarification: false },
    entities: [],
    constraints: {},
    skillCandidates: [{ skillId: "teaching_week", confidence: 0.98 }],
    plan: { steps: [{ id: "read-week", skillId: "teaching_week", purpose: "Read teaching week" }] },
    responseMode: "deterministic",
  }, overrides);
}

async function run() {
  const requests = [];
  let responseContract = validDecision();
  const server = http.createServer((req, res) => {
    let raw = "";
    req.on("data", (chunk) => { raw += chunk; });
    req.on("end", () => {
      const body = JSON.parse(raw || "{}");
      requests.push(body);
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ choices: [{ message: { content: JSON.stringify(responseContract) } }] }));
    });
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const baseUrl = `http://127.0.0.1:${server.address().port}`;

  const keys = [
    "AI_RUNTIME_MODE", "AI_PROVIDER_ACTIVE_ENV", "AI_COMPETITION_ALLOW_ALL_SESSIONS",
    "AI_PROVIDER_IGNORE_ENV_FILE", "AI_EXECUTION_POLICY", "NODE_ENV",
  ];
  const previous = Object.fromEntries(keys.map((key) => [key, process.env[key]]));
  process.env.AI_RUNTIME_MODE = "trial";
  process.env.AI_PROVIDER_ACTIVE_ENV = "trial";
  process.env.AI_COMPETITION_ALLOW_ALL_SESSIONS = "true";
  process.env.AI_PROVIDER_IGNORE_ENV_FILE = "true";
  process.env.NODE_ENV = "test";

  const providerConfigService = require("../server/src/services/ai/providerConfigService");
  const originalResolve = providerConfigService.resolveRuntimeProviderConfig;
  let configuredPolicy = "strict_model_first";
  providerConfigService.resolveRuntimeProviderConfig = () => ({
    AI_AGENT_ENABLED: "true",
    AI_RUNTIME_MODE: "trial",
    AI_EXECUTION_POLICY: configuredPolicy,
    AI_PROVIDER: "deepseek",
    AI_PROVIDER_CHAIN: "deepseek,mock",
    AI_DECISION_PROVIDER: "deepseek",
    AI_PROVIDER_POLICY: "tool-only",
    AI_BASE_URL: baseUrl,
    AI_DECISION_MODEL: "strict-decision-test",
    AI_MODEL: "strict-decision-test",
    AI_STRUCTURED_TIMEOUT_MS: "3000",
    DEEPSEEK_API_KEY: "unit-test-placeholder-not-real",
    AI_UNDERSTANDING_RULE_FIRST: "1",
    AI_MODEL_PLANNER_ENABLED: "true",
  });

  try {
    const agentService = require("../server/src/services/ai/agentService");
    const events = [];
    const response = await agentService.chat({
      message: "现在第几教学周",
      runtimeMode: "trial",
      protocolVersion: "agent.v2",
      serverSession: { openidHash: "strict-decision-test-user" },
      context: { envVersion: "trial", memoryMode: "local_only" },
      onEvent: (event) => events.push(event),
    });

    assert.strictEqual(requests.length, 1, "strict Turn must use one semantic Decision call and no model Planner call");
    const prompt = JSON.stringify(requests[0].messages || []);
    assert.ok(/DecisionContract V2/.test(prompt));
    assert.ok(/allowedSkills/.test(prompt));
    assert.ok(!/toolName/.test(prompt), "Decision prompt must not expose Tool names");
    const types = events.map((event) => event.type);
    assert.ok(types.indexOf("provider.started") >= 0);
    assert.ok(types.indexOf("provider.started") < types.indexOf("intent.resolved"), "Provider Decision must precede semantic routing");
    assert.strictEqual(types.filter((type) => type === "provider.started").length, 1);

    const decisionStage = response.platformTrace.stages.find((stage) => stage.stage === "decision");
    assert.ok(decisionStage);
    const { contextId: decisionContextId, ...decisionDetails } = decisionStage.details;
    assert.match(decisionContextId, /^ctx_[a-f0-9]{24}$/);
    assert.deepStrictEqual(decisionDetails, {
      executionPolicy: "strict_model_first",
      intendedProvider: "deepseek",
      actualFirstProvider: "deepseek",
      decisionSource: "model",
      goal: "get_teaching_week",
      selectedSkill: "teaching_week",
      fallbackPath: ["deepseek:success"],
    });
    assert.strictEqual(response.intent, "get_teaching_week");
    assert.strictEqual(response.understanding.source, "model");
    assert.strictEqual(response.goalContract.goal, "get_teaching_week");
    assert.strictEqual(response.providerStages.planner.attempted, false, "unified Decision must suppress the legacy model Planner");

    const strictCalls = requests.length;
    responseContract = Object.assign(validDecision(), { toolName: "invented_tool" });
    const invalid = await agentService.chat({
      message: "现在第几教学周",
      runtimeMode: "trial",
      protocolVersion: "agent.v2",
      serverSession: { openidHash: "strict-decision-test-user" },
      context: { envVersion: "trial", memoryMode: "local_only" },
    });
    assert.strictEqual(requests.length, strictCalls + 1);
    const invalidDecisionStage = invalid.platformTrace.stages.find((stage) => stage.stage === "decision");
    assert.strictEqual(invalidDecisionStage.details.decisionSource, "deterministic_fallback");
    assert.ok(invalidDecisionStage.details.fallbackPath[0].includes("PROVIDER_STRUCTURED_OUTPUT_INVALID")
      || invalidDecisionStage.details.fallbackPath[0].includes("DECISION_EXTRA_FIELD"));

    responseContract = validDecision();
    configuredPolicy = "adaptive";
    const callsBeforeAdaptive = requests.length;
    const adaptive = await agentService.chat({
      message: "现在第几教学周",
      runtimeMode: "trial",
      protocolVersion: "agent.v2",
      serverSession: { openidHash: "strict-decision-test-user" },
      context: { envVersion: "trial", memoryMode: "local_only" },
    });
    assert.strictEqual(requests.length, callsBeforeAdaptive, "only explicit adaptive may use the deterministic high-confidence path");
    const adaptiveStage = adaptive.platformTrace.stages.find((stage) => stage.stage === "decision");
    assert.strictEqual(adaptiveStage.details.executionPolicy, "adaptive");
    assert.strictEqual(adaptiveStage.details.decisionSource, "deterministic_adaptive");

    const callsBeforePublic = requests.length;
    const publicResponse = await agentService.chat({
      message: "现在第几教学周",
      runtimeMode: "public",
      protocolVersion: "agent.v2",
      context: { envVersion: "release", memoryMode: "local_only" },
    });
    assert.strictEqual(requests.length, callsBeforePublic, "public external attempt count must remain zero");
    const publicStage = publicResponse.platformTrace.stages.find((stage) => stage.stage === "decision");
    assert.strictEqual(publicStage.details.executionPolicy, "deterministic");
    assert.strictEqual(Object.prototype.hasOwnProperty.call(publicStage.details, "actualFirstProvider"), false,
      "public client trace must not expose Provider diagnostics");
    console.log("test-agent-strict-decision: PASS");
  } finally {
    providerConfigService.resolveRuntimeProviderConfig = originalResolve;
    keys.forEach((key) => {
      if (previous[key] === undefined) delete process.env[key];
      else process.env[key] = previous[key];
    });
    await new Promise((resolve) => server.close(resolve));
  }
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
