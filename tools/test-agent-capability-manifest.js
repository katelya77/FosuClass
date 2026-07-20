#!/usr/bin/env node
const assert = require("assert");
const path = require("path");
const { spawnSync } = require("child_process");

const manifestService = require("../server/src/services/ai/capabilityManifestService");
const agentProtocol = require("../server/src/services/ai/agentProtocol");
const skillRegistry = require("../server/src/services/ai/skillRegistry");
const toolRegistry = require("../server/src/services/ai/toolRegistry");
const clientCompat = require("../miniprogram/shared/agentCapabilityCompat.generated");

const generatorCheck = spawnSync(process.execPath, [
  path.resolve(__dirname, "generate-agent-capability-compat.js"),
  "--check",
], { cwd: path.resolve(__dirname, ".."), encoding: "utf8" });
assert.strictEqual(generatorCheck.status, 0, generatorCheck.stderr || generatorCheck.stdout);

const report = manifestService.assertConsistency({
  agentProtocol,
  skillRegistry,
  toolRegistry,
  clientCompat,
});

assert.strictEqual(report.ok, true, JSON.stringify(report.errors, null, 2));
assert.ok(report.intentCount >= 25, "all existing canonical intents must be described");
assert.ok(report.toolCount >= 20, "all executable tools must be described");
assert.ok(report.skillCount >= 16, "phase-one built-in skills must be registered");

const manifest = manifestService.getManifest();
assert.deepStrictEqual(manifest.protocolVersions, ["agent.v1", "agent.v2"]);
assert.strictEqual(manifest.runtimeModes.competition.aliasFor, "trial");

Object.values(manifest.intents).forEach((capability) => {
  assert.ok(capability.id, "intent id is required");
  assert.ok(capability.displayName, `${capability.id} requires a display name`);
  assert.ok(Array.isArray(capability.runtimeModes), `${capability.id} requires runtime modes`);
  assert.ok(capability.skill, `${capability.id} requires a skill`);
  assert.ok(Array.isArray(capability.allowedTools), `${capability.id} requires allowed tools`);
  assert.ok(Array.isArray(capability.allowedCardTypes), `${capability.id} requires card types`);
  assert.ok(capability.fallbackPolicy, `${capability.id} requires fallback policy`);
  if (capability.publicAllowed) {
    assert.strictEqual(
      capability.providerPolicyByMode.public,
      "never",
      `public intent ${capability.id} must never use an external provider in public mode`
    );
  }
});

const todaySkill = skillRegistry.getSkill("today_schedule");
const failedFactVerification = todaySkill.resultVerifier({
  intent: { name: "get_today_courses" },
  toolCalls: [{ name: "get_today_courses", status: "failed", result: { success: false, code: "TOOL_TIMEOUT" } }],
});
assert.strictEqual(failedFactVerification.evidenceComplete, false, "failed tool calls are not factual evidence");
assert.ok(failedFactVerification.errors.some((item) => item.code === "FACT_TOOL_EVIDENCE_REQUIRED"));

console.log("test-agent-capability-manifest passed");
