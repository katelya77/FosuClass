#!/usr/bin/env node
const assert = require("assert");

process.env.AI_RUNTIME_MODE = "public";
process.env.AI_AGENT_ENABLED = "false";
process.env.AI_WEATHER_ENABLED = "false";
process.env.AI_ALLOW_PERSONAL_CONTEXT = "false";

const manifestService = require("../server/src/services/ai/capabilityManifestService");
const agentService = require("../server/src/services/ai/agentService");
const toolRegistry = require("../server/src/services/ai/toolRegistry");

function slotsFor(intentId) {
  const base = {
    q: "evidence-test-no-match",
    id: "evidence-test-no-match",
    type: "course",
    classroom: "C7-101",
    from: "C7",
    to: "A1",
    campus: "仙溪校区",
    week: 1,
    weekday: 1,
    sections: [1, 2],
    duration: 2,
  };
  if (intentId === "get_schedule_detail") return { id: base.id, type: base.type };
  return base;
}

async function run() {
  const originalResolveIntent = toolRegistry.resolveIntent;
  const factualIntents = Object.values(manifestService.getManifest().intents)
    .filter((item) => item.factualTask)
    .map((item) => item.id);
  try {
    for (const intentId of factualIntents) {
      toolRegistry.resolveIntent = () => ({ name: intentId, confidence: 1, slots: slotsFor(intentId) });
      const response = await agentService.chat({
        protocolVersion: "agent.v2",
        message: `evidence-test-${intentId}`,
        context: {
          envVersion: "release",
          term: "test-term",
          releaseVersion: "test-release",
          currentTeachingWeek: 1,
          currentScheduleSummary: { enabled: false, courses: [] },
        },
      });
      assert.strictEqual(response.intent, intentId, `${intentId} must remain canonical`);
      assert.ok(response.evidence && response.evidence.checkedAt, `${intentId} requires checkedAt`);
      assert.ok(Object.prototype.hasOwnProperty.call(response.evidence, "term"), `${intentId} requires term evidence field`);
      assert.ok(Object.prototype.hasOwnProperty.call(response.evidence, "releaseVersion"), `${intentId} requires release evidence field`);
      assert.ok(Object.prototype.hasOwnProperty.call(response.evidence, "currentWeek"), `${intentId} requires teaching-week evidence field`);
      assert.ok(Array.isArray(response.evidence.sources), `${intentId} requires source evidence field`);
      if (response.success) {
        assert.strictEqual(response.evidence.complete, true, `${intentId} successful facts require complete deterministic evidence`);
        assert.ok(response.evidence.toolCount > 0, `${intentId} requires a successful tool observation`);
      } else {
        assert.strictEqual(response.evidence.complete, false, `${intentId} failed tools must not claim complete evidence`);
        assert.strictEqual(response.evidence.toolCount, 0, `${intentId} failed tools are not evidence`);
        assert.ok(response.errors.some((item) => item.code === "FACT_TOOL_EVIDENCE_REQUIRED"));
        assert.ok(response.steps.some((step) => step.status === "failed"), `${intentId} must expose the failed execution step`);
      }
      assert.ok(response.steps.length > 0, `${intentId} requires recorded execution steps`);
      assert.strictEqual(response.externalProviderUsed, false);
    }
  } finally {
    toolRegistry.resolveIntent = originalResolveIntent;
  }
  console.log(`test-agent-factual-evidence-v2 passed (${factualIntents.length} intents)`);
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
