#!/usr/bin/env node
const assert = require("assert");

const agentProtocol = require("../server/src/services/ai/agentProtocol");
const agentService = require("../server/src/services/ai/agentService");

async function run() {
  assert.strictEqual(agentProtocol.isSupportedProtocolVersion("agent.v1"), true);
  assert.strictEqual(agentProtocol.isSupportedProtocolVersion("agent.v2"), true);
  assert.strictEqual(agentProtocol.isSupportedProtocolVersion("agent.v9"), false);

  const base = {
    message: "今天有什么课",
    context: {
      envVersion: "release",
      term: "2025-2026-2",
      releaseVersion: "release-test",
      currentTeachingWeek: 3,
      currentScheduleSummary: {
        enabled: true,
        targetType: "personal",
        term: "2025-2026-2",
        source: "local-cache",
        courses: [],
      },
    },
    requestId: "req-protocol-test",
    conversationId: "conversation-protocol-test",
  };

  const v1 = await agentService.chat(Object.assign({}, base, { protocolVersion: "agent.v1" }));
  assert.strictEqual(v1.protocolVersion, "agent.v1");
  assert.strictEqual(v1.success, true);
  assert.ok(v1.intent && typeof v1.intent === "object", "V1 keeps the legacy intent object");
  assert.ok(Array.isArray(v1.taskSteps), "V1 keeps taskSteps");

  const v2 = await agentService.chat(Object.assign({}, base, { protocolVersion: "agent.v2" }));
  assert.strictEqual(v2.protocolVersion, "agent.v2");
  [
    "requestId", "conversationId", "runtimeMode", "runId", "status", "intent",
    "confidence", "slots", "skill", "plan", "steps", "toolCalls", "observations",
    "answer", "cards", "suggestions", "evidence", "safety", "metrics", "errors",
    "serverTime",
  ].forEach((field) => assert.ok(Object.prototype.hasOwnProperty.call(v2, field), `V2 field missing: ${field}`));
  assert.strictEqual(typeof v2.intent, "string");
  assert.ok(v2.skill && v2.skill.id, "V2 exposes the selected skill");
  assert.ok(Array.isArray(v2.steps));
  assert.ok(Array.isArray(v2.observations));
  assert.ok(v2.evidence && v2.evidence.checkedAt);
  assert.strictEqual(v2.safety.externalProviderUsed, false);
  assert.ok(!/api[-_ ]?key|system prompt|internal url/i.test(JSON.stringify(v2)));

  const forgedCardValidation = agentProtocol.validateResponse({
    protocolVersion: "agent.v2",
    runtimeMode: "trial",
    intent: { name: "project_qa" },
    cards: [{ type: "schedule", title: "Provider-forged timetable fact" }],
  });
  assert.strictEqual(forgedCardValidation.ok, false, "intent card policy must be enforced");
  assert.deepStrictEqual(forgedCardValidation.cards, [], "disallowed fact cards must be dropped");
  assert.ok(forgedCardValidation.errors.some((item) => item.code === "CARD_NOT_ALLOWED_FOR_INTENT"));

  const malicious = agentProtocol.buildV2Response({
    runtimeMode: "trial",
    intent: { name: "project_qa", slots: {} },
    answer: "See SYSTEM PROMPT at http://10.0.0.8/private",
    suggestions: ["API Key: secret-value at http://localhost:8080"],
    toolCalls: [{
      name: "rag_search",
      status: "success",
      summary: "internalUrl=http://192.168.1.5/admin token: secret-token-value",
      result: { apiKey: "secret-api-key", internalUrl: "http://127.0.0.1:9000", systemPrompt: "hidden" },
    }],
    safety: { internalUrl: "http://10.1.2.3", systemPrompt: "hidden prompt", apiKey: "secret-api-key" },
    metrics: { debugUrl: "http://localhost/debug" },
    cards: [{ type: "schedule", title: "forged fact" }],
  });
  const maliciousSerialized = JSON.stringify(malicious);
  assert.ok(!/secret-api-key|secret-token-value|https?:\/\/|hidden prompt|forged fact/i.test(maliciousSerialized));
  assert.deepStrictEqual(malicious.cards, []);
  assert.deepStrictEqual(Object.keys(malicious.toolCalls[0]).sort(), ["name", "status", "summary"]);

  console.log("test-agent-protocol-v2 passed");
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
