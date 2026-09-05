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
    }, {
      id: "week_schedule",
      supportedGoals: ["get_week_schedule"],
      runtimeModes: ["public", "trial", "dev"],
      allowedTools: ["get_week_schedule"],
    }, {
      id: "search_school_schedule",
      supportedGoals: ["search_school_index"],
      runtimeModes: ["public", "trial", "dev"],
      allowedTools: ["search_school_index"],
    }],
  });
  const deterministicResolve = (message) => {
    order.push("rule");
    if (/陈芳/.test(String(message || ""))) {
      return { name: "search_school_index", confidence: 1, slots: { type: "teacher", q: "陈芳" } };
    }
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

  let openrouterRequest = null;
  let compactContract = {
    schemaVersion: "decision.intent.v1",
    goal: { name: "get_teaching_week", confidence: 0.96, requiresClarification: false },
    entities: [],
    constraints: [{ key: "week", value: 3 }],
    responseMode: "deterministic",
  };
  const openrouterService = createDecisionService({
    providerRuntime: {
      async generateStructured(input) {
        openrouterRequest = input.request;
        const validated = input.validate(compactContract);
        return {
          contract: validated,
          provider: "openrouter",
          intendedProvider: "openrouter",
          actualFirstProvider: "openrouter",
          fallbackPath: ["openrouter:success"],
        };
      },
    },
    skillCatalog,
    deterministicResolve,
  });
  const compactResult = await openrouterService.decide({
    message: "现在第几教学周？",
    runtimeMode: "trial",
    executionPolicy: "strict_model_first",
    providerRuntimeConfig: {
      AI_AGENT_ENABLED: "true",
      AI_DECISION_PROVIDER: "openrouter",
      AI_PROVIDER: "openrouter",
      OPENROUTER_ENABLED: "true",
      OPENROUTER_API_KEY: "unit-test-placeholder",
    },
    context: {},
    conversationState: {},
    contextView: {
      contextId: "ctx_openrouter_compact",
      currentTurn: { message: "现在第几教学周？", runtimeMode: "trial" },
      workingState: {},
      recentMessages: [],
      rollingSummary: "",
      memories: [],
      episodes: [],
    },
  });
  assert.strictEqual(openrouterRequest.responseSchemaName, "fosu_decision_intent_v1");
  assert.strictEqual(openrouterRequest.responseSchema.properties.schemaVersion.const, "decision.intent.v1");
  assert.strictEqual(Object.prototype.hasOwnProperty.call(openrouterRequest.responseSchema.properties, "plan"), false);
  const compactPrompt = JSON.stringify(openrouterRequest.messages);
  assert.ok(/allowedGoals/.test(compactPrompt));
  assert.ok(/goalCatalog/.test(compactPrompt));
  assert.ok(/needsPersonalScheduleSummary/.test(compactPrompt));
  assert.ok(/named teacher, class, classroom, or course/.test(compactPrompt));
  assert.ok(!/allowedSkills/.test(compactPrompt));
  assert.ok(/Never output Skill ids, Tool names, a plan/.test(compactPrompt));
  assert.strictEqual(compactResult.decisionContract.schemaVersion, "decision.v2");
  assert.deepStrictEqual(compactResult.decisionContract.constraints, { week: 3 });
  assert.deepStrictEqual(compactResult.decisionContract.skillCandidates.map((item) => item.skillId), ["teaching_week"]);
  assert.deepStrictEqual(compactResult.decisionContract.plan.steps.map((step) => step.skillId), ["teaching_week"]);

  compactContract = {
    schemaVersion: "decision.intent.v1",
    goal: { name: "get_week_schedule", confidence: 0.91, requiresClarification: false },
    entities: [{ type: "teacher", value: "陈芳", source: "user" }],
    constraints: [{ key: "teacherName", value: "陈芳" }],
    responseMode: "deterministic",
  };
  const corrected = await openrouterService.decide({
    message: "帮我查一下陈芳老师的课表",
    runtimeMode: "trial",
    executionPolicy: "strict_model_first",
    providerRuntimeConfig: {
      AI_AGENT_ENABLED: "true",
      AI_DECISION_PROVIDER: "openrouter",
      AI_PROVIDER: "openrouter",
      OPENROUTER_ENABLED: "true",
      OPENROUTER_API_KEY: "unit-test-placeholder",
    },
    context: {},
    conversationState: {},
    contextView: {
      contextId: "ctx_openrouter_contract_validation",
      currentTurn: { message: "帮我查一下陈芳老师的课表", runtimeMode: "trial" },
      workingState: {}, recentMessages: [], rollingSummary: "", memories: [], episodes: [],
    },
  });
  assert.strictEqual(corrected.decisionSource, "model_validated");
  assert.strictEqual(corrected.understanding.externalProviderUsed, true);
  assert.strictEqual(corrected.understanding.reasonCode, "MODEL_GOAL_CONTRACT_CORRECTED");
  assert.strictEqual(corrected.intent.name, "search_school_index");
  assert.strictEqual(corrected.intent.slots.type, "teacher");
  assert.strictEqual(corrected.intent.slots.q, "陈芳");
  assert.strictEqual(corrected.selectedSkillId, "search_school_schedule");
  assert.strictEqual(corrected.decisionContract.goal.name, "search_school_index");

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
