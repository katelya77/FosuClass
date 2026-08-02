const assert = require("assert");

const { createSkillCatalog } = require("../packages/skill-runtime");
const { createDecisionService } = require("../server/src/services/ai/decision/decisionService");
const { MemoryController } = require("../server/src/services/ai/memory/memoryController");

async function main() {
  const order = [];
  const contract = {
    schemaVersion: "decision.v2",
    goal: { name: "get_teaching_week", confidence: 0.99, requiresClarification: false },
    entities: [],
    constraints: {},
    skillCandidates: [{ skillId: "teaching_week", confidence: 0.99 }],
    plan: { steps: [{ id: "read-week", skillId: "teaching_week", purpose: "Read teaching week" }] },
    responseMode: "deterministic",
  };
  const providerRuntime = {
    async generateStructured(input) {
      order.push("provider");
      const validated = input.validate(contract);
      return {
        contract: validated,
        provider: "deepseek",
        intendedProvider: "deepseek",
        actualFirstProvider: "deepseek",
        fallbackPath: ["deepseek:success"],
      };
    },
  };
  const skillCatalog = createSkillCatalog({
    skills: [{
      id: "teaching_week",
      supportedGoals: ["get_teaching_week"],
      runtimeModes: ["public", "trial", "dev"],
      allowedTools: ["get_teaching_week"],
    }],
  });
  const deterministicResolve = () => {
    order.push("rule");
    return { name: "get_teaching_week", confidence: 1, slots: {}, ruleScore: 10 };
  };
  const service = createDecisionService({ providerRuntime, skillCatalog, deterministicResolve });
  const result = await service.decide({
    message: "现在第几教学周？",
    runtimeMode: "trial",
    executionPolicy: "strict_model_first",
    providerRuntimeConfig: {
      AI_AGENT_ENABLED: "true",
      AI_DECISION_PROVIDER: "deepseek",
      AI_PROVIDER: "deepseek",
      DEEPSEEK_API_KEY: "unit-test-placeholder",
    },
    context: {},
    conversationState: {},
    contextView: {
      contextId: "ctx_strict_first",
      currentTurn: { message: "现在第几教学周？", runtimeMode: "trial" },
      workingState: {},
      recentMessages: [],
      rollingSummary: "",
      memories: [],
      episodes: [],
    },
  });
  assert.strictEqual(result.decisionSource, "model");
  assert.strictEqual(order[0], "provider", "strict_model_first may not run semantic rules before Provider Decision");
  assert.deepStrictEqual(order, ["provider", "rule"], "rules are allowed only as post-Decision validation hints");

  const conversationMemory = {
    loadForChat() {
      return {
        principal: { authenticated: false, principalKey: "", runtimeMode: "trial" },
        state: null,
        memory: { mode: "local_only", authenticated: false },
        context: {},
      };
    },
  };
  const memoryController = new MemoryController({
    conversationMemory,
    userMemory: {
      prepareTurnSnapshot() {
        return { allItems: [], values: {}, items: [], episodes: [], revision: 0, policy: null };
      },
    },
  });
  const followUp = "\u5468\u4e09\u4e0b\u5348\u5462";
  const strictMemory = memoryController.load({
    message: followUp,
    executionPolicy: "strict_model_first",
  });
  assert.strictEqual(strictMemory.conversationState.workingMemory.weekday, null);
  assert.strictEqual(strictMemory.conversationState.workingMemory.periodHint, "");
  const adaptiveMemory = memoryController.load({
    message: followUp,
    executionPolicy: "adaptive",
  });
  assert.strictEqual(adaptiveMemory.conversationState.workingMemory.weekday, 3);
  assert.strictEqual(adaptiveMemory.conversationState.workingMemory.periodHint, "afternoon");
  console.log("test-agent-strict-first-call-proof: PASS");
}

main().catch((error) => {
  console.error(error && error.stack || error);
  process.exit(1);
});
