#!/usr/bin/env node
const assert = require("assert");

const { AgentKernel } = require("../server/src/services/ai/agentKernel");

function buildRegistry(planBuilder, allowedTools = ["allowed_tool"]) {
  return {
    getSkillForIntent() {
      return {
        id: "test_skill",
        version: "1.0.0",
        supportedIntents: ["test_intent"],
        requiredSlots: [],
        optionalSlots: [],
        allowedTools,
        runtimeModes: ["public", "trial", "dev"],
        providerPolicy: "never",
        planBuilder,
        resultVerifier: () => ({ ok: true, errors: [] }),
        fallbackPolicy: "deterministic",
        outputCardTypes: ["generic"],
      };
    },
  };
}

async function expectRejected(promise, code) {
  let caught = null;
  try {
    await promise;
  } catch (error) {
    caught = error;
  }
  assert.ok(caught, `expected ${code}`);
  assert.strictEqual(caught.code, code);
}

async function run() {
  const base = {
    message: "test",
    context: { envVersion: "release" },
    runtimeMode: "public",
    intent: { name: "test_intent", confidence: 0.9, slots: {} },
  };

  const unknownKernel = new AgentKernel({
    skillRegistry: buildRegistry(() => [{ toolName: "unknown_tool", args: {} }]),
    toolExecutor: async () => ({ success: true }),
  });
  await expectRejected(unknownKernel.execute(base), "TOOL_NOT_ALLOWED_FOR_SKILL");

  const longKernel = new AgentKernel({
    maxPlanSteps: 2,
    skillRegistry: buildRegistry(() => [
      { toolName: "allowed_tool", args: {} },
      { toolName: "allowed_tool", args: {} },
      { toolName: "allowed_tool", args: {} },
    ]),
    toolExecutor: async () => ({ success: true }),
  });
  await expectRejected(longKernel.execute(base), "PLAN_STEP_LIMIT_EXCEEDED");

  const timeoutKernel = new AgentKernel({
    toolTimeoutMs: 20,
    skillRegistry: buildRegistry(() => [{ toolName: "allowed_tool", args: {} }]),
    toolExecutor: () => new Promise((resolve) => setTimeout(() => resolve({ success: true }), 100)),
  });
  const timed = await timeoutKernel.execute(base);
  assert.strictEqual(timed.steps[0].status, "failed");
  assert.strictEqual(timed.steps[0].errorCode, "TOOL_TIMEOUT");
  assert.strictEqual(timed.toolCalls[0].result.code, "TOOL_TIMEOUT");

  console.log("test-agent-kernel-foundation passed");
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
