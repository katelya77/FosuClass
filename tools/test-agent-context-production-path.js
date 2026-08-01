const assert = require("assert");

const { createAgentRuntime } = require("../packages/agent-runtime");
const protocol = require("../packages/agent-protocol");
const uiSchema = require("../packages/ui-schema");
const { createAgentPlatform } = require("../apps/agent-server");

function contextSnapshot() {
  const base = {
    contextId: "ctx_production_contract",
    schemaVersion: "agent-context.v2",
    owner: "@xiaofu-agent/agent-runtime",
    currentTurn: { message: "view-only", runtimeMode: "public" },
  };
  return Object.freeze({
    ...base,
    messageCount: 1,
    memoryCount: 0,
    views: Object.freeze({
      decision: Object.freeze({ ...base, purpose: "decision" }),
      tool: Object.freeze({ ...base, purpose: "tool" }),
      verification: Object.freeze({ ...base, purpose: "verification" }),
      response: Object.freeze({ ...base, purpose: "response" }),
    }),
  });
}

async function main() {
  const snapshot = contextSnapshot();
  const privateState = { poisonedLegacyMessage: "must-never-enter-runtime-artifacts" };
  const seen = [];
  const stages = {
    async assembleContext() {
      return { snapshot, privateState };
    },
    async decide(input) {
      seen.push(["decision", input]);
      assert.strictEqual(input.context, snapshot);
      assert.strictEqual(input.contextView, snapshot.views.decision);
      assert.strictEqual(input.privateState, privateState);
      return { goal: { name: "test" }, selectedSkillId: "readonly", taskComplexity: "simple" };
    },
    async executeSkillTool(input) {
      seen.push(["skillTool", input]);
      assert.strictEqual(input.contextView, snapshot.views.tool);
      assert.strictEqual(input.privateState, privateState);
      return { toolCalls: [{ name: "readonly" }], contextId: snapshot.contextId };
    },
    async verify(input) {
      seen.push(["verification", input]);
      assert.strictEqual(input.contextView, snapshot.views.verification);
      assert.strictEqual(input.privateState, privateState);
      return { ok: true, contextId: snapshot.contextId };
    },
    async compose(input) {
      seen.push(["response", input]);
      assert.strictEqual(input.contextView, snapshot.views.response);
      assert.strictEqual(input.privateState, privateState);
      return { success: true, answer: "ok", cards: [], suggestions: [], contextId: snapshot.contextId };
    },
  };
  const runtime = createAgentRuntime({ protocol, uiSchema });
  const platform = createAgentPlatform({
    runtime,
    plugin: { id: "contract-plugin", version: "1", manifestVersion: "1" },
    stages,
    createRunId: () => "run_context_contract",
  });
  const response = await platform.executeTurn({
    message: "poisoned-legacy-message",
    runtimeMode: "public",
  });
  assert.deepStrictEqual(seen.map(([stage]) => stage), ["decision", "skillTool", "verification", "response"]);
  const serializedTrace = JSON.stringify(response.platformTrace);
  assert(!serializedTrace.includes(privateState.poisonedLegacyMessage));
  response.platformTrace.stages
    .filter((stage) => ["context", "decision", "skill_tool", "verification", "response"].includes(stage.stage))
    .forEach((stage) => assert.strictEqual(stage.details.contextId, snapshot.contextId, `${stage.stage} contextId`));
  assert.strictEqual(response.platformTrace.stages[0].details.schemaVersion, "agent-context.v2");
  console.log("test-agent-context-production-path: PASS");
}

main().catch((error) => {
  console.error(error && error.stack || error);
  process.exit(1);
});
