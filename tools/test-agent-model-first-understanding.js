#!/usr/bin/env node
const assert = require("assert");

const {
  GOAL_CONTRACT_KEYS,
  normalizeGoalContract,
  parseGoalContractJson,
  intentToGoalContract,
} = require("../server/src/services/ai/understanding/goalContract");
const { resolveGoalContract } = require("../server/src/services/ai/understanding/goalResolver");
const { fromV1Contract } = require("../server/src/services/ai/understanding/goalContractV2");
const { UnderstandingService } = require("../server/src/services/ai/understanding/understandingService");
const {
  normalizeWorkingMemory,
  updateWorkingMemory,
} = require("../server/src/services/ai/memory/workingMemory");
const { EVENT_TYPES, loadingTextForEvent } = require("../server/src/services/ai/runEventCatalog");

function contract(overrides = {}) {
  return Object.assign({
    goal: "search_school_index",
    entityType: "teacher",
    entity: "陈芳",
    normalizedEntity: "陈芳",
    constraints: {},
    followUpMode: "new_goal",
    confidence: 0.98,
    needsClarification: false,
  }, overrides);
}

function assertCode(fn, expectedCode) {
  assert.throws(fn, (error) => error && error.code === expectedCode, expectedCode);
}

async function testStrictGoalContract() {
  const normalized = normalizeGoalContract(contract({
    constraints: { college: "动物科技学院" },
  }));
  assert.deepStrictEqual(Object.keys(normalized), GOAL_CONTRACT_KEYS);
  assert.strictEqual(normalized.goal, "search_school_index");
  assert.strictEqual(normalized.entityType, "teacher");
  assert.strictEqual(normalized.constraints.college, "动物科技学院");

  const sectionArray = normalizeGoalContract(contract({
    constraints: { sections: [1, 2] },
  }));
  assert.deepStrictEqual(sectionArray.constraints.sections, [1, 2]);

  assertCode(() => normalizeGoalContract(Object.assign(contract(), {
    toolName: "search_teacher",
  })), "GOAL_CONTRACT_EXTRA_FIELD");
  assertCode(() => normalizeGoalContract(contract({
    goal: "run_any_tool",
  })), "GOAL_CONTRACT_GOAL_NOT_ALLOWED");
  assertCode(() => normalizeGoalContract(contract({
    confidence: 1.5,
  })), "GOAL_CONTRACT_CONFIDENCE_INVALID");
  assertCode(() => normalizeGoalContract(contract({
    confidence: "0.9",
  })), "GOAL_CONTRACT_CONFIDENCE_INVALID");
  assertCode(() => normalizeGoalContract(contract({
    entity: { name: "must-not-coerce" },
  })), "GOAL_CONTRACT_FIELD_TYPE_INVALID");
  assertCode(() => normalizeGoalContract(contract({
    entityType: ["teacher"],
  })), "GOAL_CONTRACT_FIELD_TYPE_INVALID");
  assertCode(() => normalizeGoalContract(contract({
    constraints: { apiKey: "must-not-pass" },
  })), "GOAL_CONTRACT_CONSTRAINT_NOT_ALLOWED");
  assertCode(() => normalizeGoalContract(contract({
    constraints: { continuousSections: "2" },
  })), "GOAL_CONTRACT_CONSTRAINT_INVALID");
  assertCode(() => normalizeGoalContract(contract({
    constraints: { campus: 42 },
  })), "GOAL_CONTRACT_CONSTRAINT_INVALID");
  assertCode(() => normalizeGoalContract(contract({
    constraints: { sections: [0, 2] },
  })), "GOAL_CONTRACT_CONSTRAINT_INVALID");
  assertCode(() => normalizeGoalContract(contract({
    constraints: { sections: ["1", "2"] },
  })), "GOAL_CONTRACT_CONSTRAINT_INVALID");

  const parsed = parseGoalContractJson(JSON.stringify(contract()));
  assert.strictEqual(parsed.normalizedEntity, "陈芳");
  assertCode(() => parseGoalContractJson(`\`\`\`json\n${JSON.stringify(contract())}\n\`\`\``), "GOAL_CONTRACT_JSON_INVALID");

  const legacyLocalIntent = intentToGoalContract({
    name: "search_school_index",
    slots: { type: "class", q: "25动物医学6班", week: "", sections: [] },
    confidence: 0.9,
  });
  assert.strictEqual(Object.prototype.hasOwnProperty.call(legacyLocalIntent.constraints, "week"), false);
  assert.strictEqual(Object.prototype.hasOwnProperty.call(legacyLocalIntent.constraints, "sections"), false);
}

async function testManifestResolverAndFollowUp() {
  const teacher = resolveGoalContract({
    contract: contract({ constraints: { college: "动物科技学院" } }),
    message: "陈芳",
  });
  assert.strictEqual(teacher.intent.name, "search_school_index");
  assert.deepStrictEqual(teacher.intent.slots, {
    type: "teacher",
    q: "陈芳",
    lockedEntityType: "teacher",
    collegeName: "动物科技学院",
  });

  const weather = resolveGoalContract({
    contract: contract({
      goal: "get_campus_weather",
      entityType: "campus",
      entity: "江湾校区",
      normalizedEntity: "江湾校区",
      constraints: { campus: "江湾校区" },
      followUpMode: "replace_constraints",
      confidence: 0.96,
    }),
    message: "换成江湾校区",
    conversationState: {
      workingMemory: {
        activeGoal: "get_campus_weather",
        campus: "仙溪校区",
        lastConstraints: { campus: "仙溪校区", dateOffset: 2, dateHint: "day_after_tomorrow" },
      },
    },
  });
  assert.strictEqual(weather.intent.name, "get_campus_weather");
  assert.strictEqual(weather.intent.slots.campus, "江湾校区");
  assert.strictEqual(weather.intent.slots.dateOffset, 2);
  assert.strictEqual(weather.intent.slots.dateHint, "day_after_tomorrow");

  const continuous = resolveGoalContract({
    contract: contract({
      goal: "search_continuous_empty_rooms",
      entityType: "none",
      entity: "",
      normalizedEntity: "",
      constraints: { continuousSections: 2 },
      followUpMode: "replace_constraints",
      confidence: 0.94,
    }),
    message: "只看连续两节",
    conversationState: {
      workingMemory: {
        activeGoal: "search_empty_rooms",
        campus: "仙溪校区",
        lastConstraints: { campus: "仙溪校区", weekday: 3 },
      },
    },
  });
  assert.strictEqual(continuous.intent.name, "search_continuous_empty_rooms");
  assert.strictEqual(continuous.intent.slots.minFreeSections, 2);
  assert.strictEqual(continuous.intent.slots.campus, "仙溪校区");
  assert.strictEqual(continuous.intent.slots.weekday, 3);

  const currentSchedule = resolveGoalContract({
    contract: contract({
      goal: "set_current_schedule",
      entityType: "class",
      entity: "",
      normalizedEntity: "",
      constraints: {},
      followUpMode: "inherit_last_entity",
      confidence: 0.97,
    }),
    message: "设为当前课表",
    conversationState: {
      workingMemory: {
        activeGoal: "search_school_index",
        lastResolvedEntity: {
          type: "class",
          detailId: "class-detail-25-animal-3",
          name: "25动物医学3班",
        },
      },
    },
  });
  assert.strictEqual(currentSchedule.intent.name, "set_current_schedule");
  assert.strictEqual(currentSchedule.intent.slots.detailId, "class-detail-25-animal-3");
  assert.strictEqual(currentSchedule.intent.slots.name, "25动物医学3班");
  assert.strictEqual(currentSchedule.intent.slots.explicitCommand, true);

  const pendingTeacher = resolveGoalContract({
    contract: contract({
      goal: "clarify_missing_slot",
      entityType: "teacher",
      entity: "",
      normalizedEntity: "",
      constraints: {},
      needsClarification: true,
      confidence: 0.62,
    }),
    message: "陈芳",
    conversationState: {
      pendingClarification: {
        intentName: "search_school_index",
        type: "teacher",
        missing: "teacherName",
        expiresAt: Date.now() + 60000,
      },
      workingMemory: {},
    },
  });
  assert.strictEqual(pendingTeacher.contract.goal, "search_school_index");
  assert.strictEqual(pendingTeacher.contract.followUpMode, "fill_pending_clarification");
  assert.strictEqual(pendingTeacher.intent.slots.q, "陈芳");
  assert.strictEqual(pendingTeacher.intent.slots.type, "teacher");

  const typedClarification = resolveGoalContract({
    contract: contract({
      goal: "clarify_missing_slot",
      entityType: "none",
      entity: "",
      normalizedEntity: "",
      constraints: {},
      confidence: 0.8,
      needsClarification: true,
    }),
    message: "查课程安排",
    deterministicHint: {
      name: "clarify_missing_slot",
      slots: { slot: { missing: "courseName", type: "course" } },
    },
  });
  assert.strictEqual(typedClarification.contract.goal, "clarify_missing_slot");
  assert.strictEqual(typedClarification.contract.entityType, "course");
  assert.strictEqual(typedClarification.intent.slots.slot.type, "course");
}

async function testModelFirstAndPublicPolicy() {
  const events = [];
  const modelContract = contract({
    goal: "get_campus_weather",
    entityType: "campus",
    entity: "仙溪校区",
    normalizedEntity: "仙溪校区",
    constraints: { campus: "仙溪校区", dateOffset: 1, dateHint: "tomorrow" },
    confidence: 0.99,
  });
  const service = new UnderstandingService({
    structuredGenerate: async () => ({
      content: JSON.stringify(modelContract),
      provider: "deepseek",
      latencyMs: 4,
    }),
  });
  const understood = await service.understand({
    message: "帮我看看明天的仙溪校区天气怎么样",
    runtimeMode: "trial",
    providerRuntimeConfig: { AI_AGENT_ENABLED: "true" },
    deterministicIntent: { name: "conversational_help", slots: {} },
    onEvent: (event) => events.push(event),
  });
  assert.strictEqual(understood.source, "model");
  assert.strictEqual(understood.providerUsed, "deepseek");
  assert.strictEqual(understood.intent.name, "get_campus_weather");
  assert.strictEqual(understood.intent.slots.dateOffset, 1);
  assert.deepStrictEqual(events.map((event) => event.type), [
    "understanding.started",
    "understanding.completed",
  ]);

  const publicService = new UnderstandingService({
    structuredGenerate: async () => {
      throw new Error("public must never call a model");
    },
  });
  const publicResult = await publicService.understand({
    message: "陈芳",
    runtimeMode: "public",
    deterministicIntent: {
      name: "search_school_index",
      slots: { type: "teacher", q: "陈芳", lockedEntityType: "teacher" },
      confidence: 0.9,
    },
  });
  assert.strictEqual(publicResult.source, "deterministic_policy");
  assert.strictEqual(publicResult.providerUsed, false);
  assert.strictEqual(publicResult.externalProviderUsed, false);
  assert.strictEqual(publicResult.contract.entityType, "teacher");

  const fallbackService = new UnderstandingService({
    structuredGenerate: async () => ({
      content: JSON.stringify(Object.assign({}, modelContract, { toolName: "get_campus_weather" })),
      provider: "coze",
      latencyMs: 3,
    }),
  });
  const fallback = await fallbackService.understand({
    message: "明天仙溪天气",
    runtimeMode: "dev",
    providerRuntimeConfig: { AI_AGENT_ENABLED: "true" },
    deterministicIntent: {
      name: "get_campus_weather",
      slots: { campus: "仙溪校区", dateOffset: 1, dateHint: "tomorrow" },
      confidence: 0.88,
    },
  });
  assert.strictEqual(fallback.source, "deterministic_fallback");
  assert.strictEqual(fallback.fallback, true);
  assert.strictEqual(fallback.contract.goal, "get_campus_weather");
  assert.strictEqual(Object.prototype.hasOwnProperty.call(fallback.contract, "toolName"), false);

  const invalidEvents = [];
  const invalidModel = new UnderstandingService({
    structuredGenerate: async (input) => {
      input.onEvent({ type: "provider.started", provider: "deepseek" });
      input.onEvent({ type: "provider.completed", provider: "deepseek" });
      return { provider: "deepseek", content: "{}" };
    },
  });
  const invalidFallback = await invalidModel.understand({
    message: "查看老师课表",
    runtimeMode: "trial",
    providerRuntimeConfig: { AI_AGENT_ENABLED: "true" },
    deterministicIntent: { name: "clarify_missing_slot", slots: { slot: { missing: "teacherName", type: "teacher" } } },
    onEvent: (event) => invalidEvents.push(event),
  });
  assert.strictEqual(invalidFallback.source, "deterministic_fallback");
  assert.strictEqual(invalidFallback.externalProviderUsed, true, "invalid model JSON still counts as a real Provider call");
  assert.strictEqual(invalidFallback.providerUsed, "deepseek");
  assert.strictEqual(invalidEvents.filter((event) => event.type === "understanding.fallback").pop().providerUsed, true);

  let disabledProviderCalls = 0;
  const disabledService = new UnderstandingService({
    structuredGenerate: async () => {
      disabledProviderCalls += 1;
      throw new Error("disabled provider must not run");
    },
  });
  const disabled = await disabledService.understand({
    message: "陈芳",
    runtimeMode: "trial",
    providerRuntimeConfig: { AI_AGENT_ENABLED: "false", AI_UNDERSTANDING_ENABLED: "true" },
    deterministicIntent: {
      name: "search_school_index",
      slots: { type: "teacher", q: "陈芳", lockedEntityType: "teacher" },
      confidence: 0.9,
    },
  });
  assert.strictEqual(disabledProviderCalls, 0);
  assert.strictEqual(disabled.reasonCode, "AGENT_PROVIDER_DISABLED");
  assert.strictEqual(disabled.contract.goal, "search_school_index");
}

async function testWorkingStateAndRunEvents() {
  const goal = contract({
    goal: "get_campus_weather",
    entityType: "campus",
    entity: "仙溪校区",
    normalizedEntity: "仙溪校区",
    constraints: { campus: "仙溪校区", dateOffset: 2 },
    confidence: 0.96,
  });
  const updated = updateWorkingMemory(null, {
    intentName: "get_campus_weather",
    slots: { campus: "仙溪校区", dateOffset: 2 },
    goalContract: goal,
    providerUsed: "hunyuan3",
    understandingSource: "model",
    pendingAction: { command: "setCurrentSchedule", status: "awaiting_receipt" },
  });
  const normalized = normalizeWorkingMemory(updated);
  assert.strictEqual(normalized.providerUsed, "hunyuan3");
  assert.strictEqual(normalized.understandingSource, "model");
  // Working memory stores the unified GoalContract V2; V1 inputs upgrade via the adapter.
  assert.deepStrictEqual(
    normalized.lastGoalContract,
    fromV1Contract(goal, { source: "adapter", understandingSource: "legacy_v1_working_memory" })
  );
  assert.strictEqual(normalized.pendingAction.status, "awaiting_receipt");

  ["understanding.started", "understanding.completed", "understanding.fallback"].forEach((type) => {
    assert.ok(EVENT_TYPES.includes(type), `${type} must be public RunEvent`);
  });
  const understandingText = loadingTextForEvent({ type: "understanding.started" }, "trial");
  assert.ok(/理解/.test(understandingText), understandingText);
  assert.ok(!/Thinking/.test(understandingText), understandingText);
}

async function run() {
  await testStrictGoalContract();
  await testManifestResolverAndFollowUp();
  await testModelFirstAndPublicPolicy();
  await testWorkingStateAndRunEvents();
  console.log("test-agent-model-first-understanding: PASS");
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
