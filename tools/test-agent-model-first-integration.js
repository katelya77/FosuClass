#!/usr/bin/env node
const assert = require("assert");
const http = require("http");

const understandingContract = {
  goal: "conversational_help",
  entityType: "none",
  entity: "",
  normalizedEntity: "",
  constraints: {},
  followUpMode: "new_goal",
  confidence: 0.99,
  needsClarification: false,
};
const plannerPayload = {
  goal: "conversational_help",
  intent: "conversational_help",
  confidence: 0.99,
  slots: {},
  needsClarification: false,
  clarification: null,
  steps: [],
  stopCondition: "all_steps_done",
};

async function run() {
  const requests = [];
  const server = http.createServer((req, res) => {
    if (req.method !== "POST" || !/\/chat\/completions$/.test(req.url || "")) {
      res.writeHead(404);
      res.end("not found");
      return;
    }
    let raw = "";
    req.on("data", (chunk) => { raw += chunk; });
    req.on("end", () => {
      const body = JSON.parse(raw || "{}");
      const prompt = JSON.stringify(body.messages || []);
      const purpose = /semantic understanding layer|normalizedEntity|followUpMode/.test(prompt)
        ? "understanding"
        : "planning";
      requests.push(purpose);
      const payload = purpose === "understanding" ? understandingContract : plannerPayload;
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({
        choices: [{ message: { content: JSON.stringify(payload) } }],
        usage: { prompt_tokens: 20, completion_tokens: 20 },
      }));
    });
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const baseUrl = `http://127.0.0.1:${server.address().port}`;

  const envKeys = [
    "AI_RUNTIME_MODE",
    "AI_PROVIDER_ACTIVE_ENV",
    "AI_COMPETITION_ALLOW_ALL_SESSIONS",
    "AI_PROVIDER_IGNORE_ENV_FILE",
    "NODE_ENV",
  ];
  const previousEnv = {};
  envKeys.forEach((key) => { previousEnv[key] = process.env[key]; });
  process.env.AI_RUNTIME_MODE = "trial";
  process.env.AI_PROVIDER_ACTIVE_ENV = "trial";
  process.env.AI_COMPETITION_ALLOW_ALL_SESSIONS = "true";
  process.env.AI_PROVIDER_IGNORE_ENV_FILE = "true";
  process.env.NODE_ENV = "test";

  const providerConfigService = require("../server/src/services/ai/providerConfigService");
  const originalResolve = providerConfigService.resolveRuntimeProviderConfig;
  providerConfigService.resolveRuntimeProviderConfig = () => ({
    AI_AGENT_ENABLED: "true",
    AI_PROVIDER: "deepseek",
    AI_PROVIDER_CHAIN: "deepseek,mock",
    AI_PROVIDER_POLICY: "tool-only",
    AI_BASE_URL: baseUrl,
    AI_MODEL: "model-first-test",
    AI_PLANNER_MODEL: "model-first-test",
    AI_UNDERSTANDING_MODEL: "model-first-test",
    AI_UNDERSTANDING_ENABLED: "true",
    AI_MODEL_PLANNER_ENABLED: "true",
    AI_STRUCTURED_TIMEOUT_MS: "3000",
    DEEPSEEK_API_KEY: "unit-test-placeholder-not-real",
    AI_API_KEY: "unit-test-placeholder-not-real",
  });

  try {
    delete require.cache[require.resolve("../server/src/services/ai/agentService")];
    const agentService = require("../server/src/services/ai/agentService");
    const events = [];
    const response = await agentService.chat({
      message: "你好，你都能做什么",
      runtimeMode: "trial",
      protocolVersion: "agent.v2",
      serverSession: { openidHash: "model-first-test-user" },
      context: { envVersion: "trial", memoryMode: "local_only" },
      onEvent: (event) => events.push(event),
    });

    assert.ok(requests.length >= 2, `expected understanding + planning calls, got ${requests.join(",")}`);
    assert.strictEqual(requests[0], "understanding", "the first model request must be Understanding");
    assert.ok(requests.includes("planning"), "the existing constrained planner must remain in the chain");
    const types = events.map((event) => event.type);
    const understandingStarted = types.indexOf("understanding.started");
    const understandingCompleted = types.indexOf("understanding.completed");
    const intentResolved = types.indexOf("intent.resolved");
    assert.ok(understandingStarted >= 0, "missing understanding.started");
    assert.ok(understandingCompleted > understandingStarted, "understanding must complete after it starts");
    assert.ok(intentResolved > understandingCompleted, "Manifest intent resolution must happen after Understanding");
    assert.strictEqual(response.goalContract.goal, "conversational_help");
    assert.strictEqual(response.understanding.source, "model");
    assert.strictEqual(response.understanding.providerUsed, "deepseek");
    assert.strictEqual(response.understanding.externalProviderUsed, true);
    assert.strictEqual(response.externalProviderUsed, true, "Understanding/Planner usage must survive a tool-only response stage");
    assert.strictEqual(response.providerStages.understanding.attempted, true);
    assert.strictEqual(response.providerStages.understanding.completed, true);
    assert.strictEqual(response.providerStages.planner.attempted, true);
    assert.strictEqual(response.providerStages.response.attempted, false);
    const terminalEvent = events.filter((event) => /^run\.(completed|degraded|failed)$/.test(event.type)).pop();
    assert.ok(terminalEvent, "missing terminal run event");
    assert.strictEqual(terminalEvent.providerUsed, true, "terminal event must aggregate all Provider stages");

    const callsBeforePublic = requests.length;
    const publicEvents = [];
    const publicResponse = await agentService.chat({
      message: "你好",
      runtimeMode: "public",
      protocolVersion: "agent.v2",
      context: { envVersion: "release", memoryMode: "local_only" },
      onEvent: (event) => publicEvents.push(event),
    });
    assert.strictEqual(requests.length, callsBeforePublic, "public must not call the model endpoint");
    assert.strictEqual(publicResponse.externalProviderUsed, false);
    assert.ok(!("understanding" in publicResponse), "public must not expose model diagnostics");
    assert.ok(!("providerStages" in publicResponse), "public must not expose Provider stage diagnostics");
    assert.ok(publicEvents.some((event) => event.type === "understanding.started"));
    assert.ok(publicEvents.some((event) => event.type === "understanding.completed"));
    assert.ok(!publicEvents.some((event) => event.type === "provider.started"));

    console.log("test-agent-model-first-integration: PASS");
  } finally {
    providerConfigService.resolveRuntimeProviderConfig = originalResolve;
    envKeys.forEach((key) => {
      if (previousEnv[key] === undefined) delete process.env[key];
      else process.env[key] = previousEnv[key];
    });
    await new Promise((resolve) => server.close(resolve));
  }
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
