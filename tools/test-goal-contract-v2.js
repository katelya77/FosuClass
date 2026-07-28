#!/usr/bin/env node
const assert = require("assert");

const capabilityManifestService = require("../server/src/services/ai/capabilityManifestService");
const {
  intentToGoalContract,
} = require("../server/src/services/ai/understanding/goalContract");
const {
  CONTRACT_VERSION,
  ENTITY_ROLES,
  FOLLOW_UP_MODES_V2,
  FORBIDDEN_FIELDS,
  GOAL_CONTRACT_V2_KEYS,
  GOAL_CONTRACT_V2_SCHEMA,
  GOAL_EFFECTS,
  GOAL_IDS,
  PROVENANCE_SOURCES,
  REQUESTED_EFFECTS,
  emptyGoalContractV2,
  fromIntent,
  fromV1Contract,
  normalizeGoalContractV2,
  parseGoalContractV2Json,
  toLegacyV1,
} = require("../server/src/services/ai/understanding/goalContractV2");
const {
  emptyWorkingMemory,
  normalizeWorkingMemory,
  updateWorkingMemory,
} = require("../server/src/services/ai/memory/workingMemory");

function contract(overrides = {}) {
  return Object.assign({
    contractVersion: CONTRACT_VERSION,
    goalId: "search_school_index",
    candidateGoals: [{ goalId: "search_school_index", confidence: 0.9, provenance: "model" }],
    entities: [{ role: "teacher", value: "陈芳", normalizedValue: "陈芳", confidence: 0.9, provenance: "model" }],
    constraints: {},
    followUpMode: "new_goal",
    missingSlots: [],
    ambiguity: { isAmbiguous: false, reason: "", candidates: [] },
    requestedEffect: "read",
    confidence: 0.9,
    provenance: { source: "model", provider: "hunyuan3", model: "", understandingSource: "model" },
  }, overrides);
}

function assertCode(fn, expectedCode) {
  assert.throws(fn, (error) => error && error.code === expectedCode, expectedCode);
}

function testGeneratedMatchesManifest() {
  const manifest = capabilityManifestService.getManifest();
  const manifestGoals = Object.keys(manifest.intents || {});
  assert.deepStrictEqual(GOAL_IDS, manifestGoals, "GOAL_IDS must equal the manifest intents key set in order");
  manifestGoals.forEach((goalId) => {
    const effect = GOAL_EFFECTS[goalId];
    assert.ok(effect, `GOAL_EFFECTS must cover ${goalId}`);
    assert.ok(REQUESTED_EFFECTS.includes(effect), `GOAL_EFFECTS[${goalId}] must be a valid effect, got ${effect}`);
  });
  assert.strictEqual(Object.keys(GOAL_EFFECTS).length, manifestGoals.length);

  // Schema snapshot consistency with the live normalizer.
  const normalized = normalizeGoalContractV2(contract());
  assert.deepStrictEqual(Object.keys(normalized), GOAL_CONTRACT_V2_KEYS);
  assert.deepStrictEqual(
    GOAL_CONTRACT_V2_SCHEMA.required.slice().concat("requestedEffect").sort(),
    Object.keys(normalized).slice().sort()
  );
  assert.deepStrictEqual(GOAL_CONTRACT_V2_SCHEMA.properties.goalId.enum, GOAL_IDS);
  assert.deepStrictEqual(GOAL_CONTRACT_V2_SCHEMA.properties.followUpMode.enum, FOLLOW_UP_MODES_V2);
  assert.deepStrictEqual(GOAL_CONTRACT_V2_SCHEMA.properties.entities.items.properties.role.enum, ENTITY_ROLES);
  assert.deepStrictEqual(GOAL_CONTRACT_V2_SCHEMA.properties.requestedEffect.enum, REQUESTED_EFFECTS);
  assert.deepStrictEqual(GOAL_CONTRACT_V2_SCHEMA.properties.provenance.properties.source.enum, PROVENANCE_SOURCES);
  assert.deepStrictEqual(GOAL_CONTRACT_V2_SCHEMA.forbiddenFields, FORBIDDEN_FIELDS);
  assert.strictEqual(GOAL_CONTRACT_V2_SCHEMA.properties.contractVersion.const, CONTRACT_VERSION);
  console.log("✓ generated artifact matches manifest and schema snapshot");
}

function testValidatorRejections() {
  assertCode(() => normalizeGoalContractV2(null), "GOAL_CONTRACT_V2_INVALID");
  assertCode(() => normalizeGoalContractV2([contract()]), "GOAL_CONTRACT_V2_INVALID");

  // Extra field anywhere at top level.
  assertCode(() => normalizeGoalContractV2(contract({ hack: true })), "GOAL_CONTRACT_V2_EXTRA_FIELD");
  // Missing required field.
  const noProvenance = contract();
  delete noProvenance.provenance;
  assertCode(() => normalizeGoalContractV2(noProvenance), "GOAL_CONTRACT_V2_MISSING_FIELD");
  const noGoal = contract();
  delete noGoal.goalId;
  assertCode(() => normalizeGoalContractV2(noGoal), "GOAL_CONTRACT_V2_MISSING_FIELD");

  // Forbidden fields at any nesting level: toolName / url / route / tool.
  assertCode(() => normalizeGoalContractV2(contract({ toolName: "search_teacher" })), "GOAL_CONTRACT_V2_FORBIDDEN_FIELD");
  assertCode(() => normalizeGoalContractV2(contract({
    ambiguity: { isAmbiguous: true, reason: "x", candidates: [{ value: "a", confidence: 0.5, url: "https://evil" }] },
  })), "GOAL_CONTRACT_V2_FORBIDDEN_FIELD");
  assertCode(() => normalizeGoalContractV2(contract({
    entities: [{ role: "page", value: "pages/index/index", route: "/pages/index/index" }],
  })), "GOAL_CONTRACT_V2_FORBIDDEN_FIELD");
  assertCode(() => normalizeGoalContractV2(contract({
    constraints: { campus: "江湾", tool: "drop" },
  })), "GOAL_CONTRACT_V2_FORBIDDEN_FIELD");

  // Goal / version / enums.
  assertCode(() => normalizeGoalContractV2(contract({ goalId: "run_any_tool" })), "GOAL_CONTRACT_V2_GOAL_NOT_ALLOWED");
  assertCode(() => normalizeGoalContractV2(contract({ contractVersion: "goal-contract.v1" })), "GOAL_CONTRACT_V2_VERSION_INVALID");
  assertCode(() => normalizeGoalContractV2(contract({ followUpMode: "inherit_everything" })), "GOAL_CONTRACT_V2_FOLLOW_UP_MODE_INVALID");
  assertCode(() => normalizeGoalContractV2(contract({
    entities: [{ role: "hacker", value: "x" }],
  })), "GOAL_CONTRACT_V2_ENTITY_ROLE_INVALID");
  assertCode(() => normalizeGoalContractV2(contract({ requestedEffect: "execute_shell" })), "GOAL_CONTRACT_V2_EFFECT_INVALID");
  assertCode(() => normalizeGoalContractV2(contract({
    provenance: { source: "rogue", provider: "", model: "", understandingSource: "" },
  })), "GOAL_CONTRACT_V2_PROVENANCE_INVALID");

  // Confidence bounds and types.
  assertCode(() => normalizeGoalContractV2(contract({ confidence: 1.5 })), "GOAL_CONTRACT_V2_CONFIDENCE_INVALID");
  assertCode(() => normalizeGoalContractV2(contract({ confidence: -0.1 })), "GOAL_CONTRACT_V2_CONFIDENCE_INVALID");
  assertCode(() => normalizeGoalContractV2(contract({ confidence: "0.9" })), "GOAL_CONTRACT_V2_CONFIDENCE_INVALID");

  // Collection limits.
  const tooManyEntities = contract({
    entities: Array.from({ length: 9 }, (_, index) => ({ role: "teacher", value: `t${index}` })),
  });
  assertCode(() => normalizeGoalContractV2(tooManyEntities), "GOAL_CONTRACT_V2_ENTITIES_INVALID");
  const tooManyCandidates = contract({
    candidateGoals: ["get_today_courses", "get_next_course", "get_week_schedule", "get_teaching_week"]
      .map((goalId) => ({ goalId, confidence: 0.5 })),
  });
  assertCode(() => normalizeGoalContractV2(tooManyCandidates), "GOAL_CONTRACT_V2_CANDIDATES_INVALID");

  // missingSlots must be declared by the goal in the manifest or be an entity role.
  assertCode(() => normalizeGoalContractV2(contract({ missingSlots: ["undeclared_slot"] })), "GOAL_CONTRACT_V2_MISSING_SLOTS_INVALID");
  assertCode(() => normalizeGoalContractV2(contract({ goalId: "get_next_course", missingSlots: ["teacherName"] })), "GOAL_CONTRACT_V2_MISSING_SLOTS_INVALID");

  // Constraints reuse the V1 whitelist.
  assertCode(() => normalizeGoalContractV2(contract({ constraints: { apiKey: "must-not-pass" } })), "GOAL_CONTRACT_CONSTRAINT_NOT_ALLOWED");
  assertCode(() => normalizeGoalContractV2(contract({ constraints: { continuousSections: "2" } })), "GOAL_CONTRACT_CONSTRAINT_INVALID");

  // JSON entry point.
  assertCode(() => parseGoalContractV2Json("not json"), "GOAL_CONTRACT_V2_JSON_INVALID");
  console.log("✓ validator rejects extra/missing/forbidden fields and invalid values");
}

function testValidatorNormalize() {
  const normalized = normalizeGoalContractV2(contract({
    followUpMode: "correction",
    missingSlots: ["teacher", "q"],
    ambiguity: {
      isAmbiguous: true,
      reason: "多个候选教师",
      candidates: [
        { goalId: "search_school_index", entityRole: "teacher", value: "陈芳", confidence: 0.6 },
        { entityRole: "teacher", value: "陈方", confidence: 0.4 },
      ],
    },
    candidateGoals: [
      { goalId: "get_schedule_detail", confidence: 0.2 },
      { goalId: "search_school_index", confidence: 0.9 },
      { goalId: "get_today_courses", confidence: 0.5 },
    ],
  }));
  assert.strictEqual(normalized.followUpMode, "correction");
  assert.deepStrictEqual(normalized.missingSlots, ["teacher", "q"]);
  assert.strictEqual(normalized.ambiguity.isAmbiguous, true);
  assert.strictEqual(normalized.ambiguity.candidates.length, 2);
  // candidateGoals are sorted by confidence descending.
  assert.deepStrictEqual(
    normalized.candidateGoals.map((item) => item.goalId),
    ["search_school_index", "get_today_courses", "get_schedule_detail"]
  );
  // Item-level defaults inherit the top-level confidence and provenance source.
  assert.strictEqual(normalized.candidateGoals[0].confidence, 0.9);
  assert.strictEqual(normalized.candidateGoals[0].provenance, "model");

  // requestedEffect is derived from GOAL_EFFECTS when omitted.
  const derived = normalizeGoalContractV2(contract({ goalId: "manage_course_reminders", requestedEffect: undefined }));
  assert.strictEqual(derived.requestedEffect, "write");

  // Empty-value entities are rejected; normalizedValue defaults to value.
  assertCode(() => normalizeGoalContractV2(contract({ entities: [{ role: "teacher", value: " " }] })), "GOAL_CONTRACT_V2_ENTITIES_INVALID");
  const defaulted = normalizeGoalContractV2(contract({ entities: [{ role: "course", value: "高等数学" }] }));
  assert.strictEqual(defaulted.entities[0].normalizedValue, "高等数学");

  // parseGoalContractV2Json round-trips a normalized contract.
  const reparsed = parseGoalContractV2Json(JSON.stringify(normalized));
  assert.deepStrictEqual(reparsed, normalized);
  console.log("✓ validator normalizes correction/missingSlots/ambiguity and derives effects");
}

function testV1AdapterCapabilityMatrix() {
  const cases = [
    // 课表查询
    { intent: { name: "get_today_courses", slots: { week: 16 } }, goalId: "get_today_courses", effect: "read", role: "none" },
    // 设为当前课表
    { intent: { name: "set_current_schedule", slots: { detailId: "cls-1", name: "22软件工程1班" } }, goalId: "set_current_schedule", effect: "write", role: "class", entity: "22软件工程1班" },
    // 下一节课
    { intent: { name: "get_next_course", slots: {} }, goalId: "get_next_course", effect: "read", role: "none" },
    // 天气 + 校区 + 日期切换
    { intent: { name: "get_campus_weather", slots: { campus: "江湾", dateHint: "明天" } }, goalId: "get_campus_weather", effect: "read", role: "campus", entity: "江湾", constraints: { campus: "江湾", dateHint: "明天" } },
    // 空教室连续节数
    { intent: { name: "search_continuous_empty_rooms", slots: { minFreeSections: 4, week: 16, weekday: 3 } }, goalId: "search_continuous_empty_rooms", effect: "read", role: "none", constraints: { continuousSections: 4, week: 16, weekday: 3 } },
    // 教师/班级/教室/课程追问
    { intent: { name: "search_school_index", slots: { type: "teacher", q: "陈芳" } }, goalId: "search_school_index", effect: "read", role: "teacher", entity: "陈芳" },
    { intent: { name: "search_school_index", slots: { type: "class", q: "22软件工程1班" } }, goalId: "search_school_index", effect: "read", role: "class", entity: "22软件工程1班" },
    { intent: { name: "search_school_index", slots: { type: "classroom", q: "B11-201" } }, goalId: "search_school_index", effect: "read", role: "classroom", entity: "B11-201" },
    { intent: { name: "search_school_index", slots: { type: "course", q: "高等数学" } }, goalId: "search_school_index", effect: "read", role: "course", entity: "高等数学" },
    // 提醒创建/修改/删除
    { intent: { name: "manage_course_reminders", slots: { leadMinutes: 20 } }, goalId: "manage_course_reminders", effect: "write", role: "none" },
    // 页面打开/导航
    { intent: { name: "search_campus_place", slots: { q: "图书馆" } }, goalId: "search_campus_place", effect: "navigate", role: "none" },
    { intent: { name: "get_campus_route", slots: { from: "南门", to: "图书馆" } }, goalId: "get_campus_route", effect: "navigate", role: "none" },
    // 用户偏好更新
    { intent: { name: "update_user_preference", slots: { preferredName: "小佛" } }, goalId: "update_user_preference", effect: "write", role: "none" },
    // 公开知识问答
    { intent: { name: "rag_search", slots: { q: "奖学金申请条件" } }, goalId: "rag_search", effect: "read", role: "none" },
    { intent: { name: "project_qa", slots: { q: "怎么导入课表" } }, goalId: "project_qa", effect: "conversation", role: "none" },
  ];
  cases.forEach((item) => {
    const v1 = intentToGoalContract(item.intent);
    const v2 = fromV1Contract(v1, { source: "adapter", understandingSource: "deterministic_policy" });
    assert.strictEqual(v2.contractVersion, CONTRACT_VERSION, item.goalId);
    assert.strictEqual(v2.goalId, item.goalId, item.goalId);
    assert.strictEqual(v2.requestedEffect, item.effect, item.goalId);
    assert.deepStrictEqual(v2.candidateGoals.map((candidate) => candidate.goalId), [item.goalId], item.goalId);
    if (item.role === "none") {
      assert.deepStrictEqual(v2.entities, [], item.goalId);
    } else {
      assert.strictEqual(v2.entities.length, 1, item.goalId);
      assert.strictEqual(v2.entities[0].role, item.role, item.goalId);
      assert.strictEqual(v2.entities[0].value, item.entity, item.goalId);
    }
    Object.keys(item.constraints || {}).forEach((key) => {
      assert.deepStrictEqual(v2.constraints[key], item.constraints[key], `${item.goalId} constraint ${key}`);
    });
    assert.strictEqual(v2.provenance.source, "adapter", item.goalId);
    assert.strictEqual(v2.provenance.understandingSource, "deterministic_policy", item.goalId);
  });

  // V1 clarification requests become ambiguity plus a role-shaped missing slot.
  const clarify = fromV1Contract(intentToGoalContract({
    name: "search_school_index",
    slots: { type: "teacher", slot: { missing: "teacherName" } },
  }));
  assert.strictEqual(clarify.ambiguity.isAmbiguous, true);
  assert.deepStrictEqual(clarify.missingSlots, ["teacher"]);

  // Provenance accepts a bare source string.
  const ruled = fromV1Contract(intentToGoalContract({ name: "get_next_course", slots: {} }), "rule");
  assert.strictEqual(ruled.provenance.source, "rule");
  console.log(`✓ V1->V2 adapter covers ${cases.length} capability classes with manifest goalIds`);
}

function testRoundTrip() {
  const cases = [
    { name: "search_school_index", slots: { type: "teacher", q: "陈芳" }, confidence: 0.92 },
    { name: "search_school_index", slots: { type: "course", q: "高等数学" }, confidence: 0.88 },
    { name: "search_continuous_empty_rooms", slots: { minFreeSections: 4, week: 16, weekday: 3 } },
    { name: "get_campus_weather", slots: { campus: "江湾", dateHint: "明天" } },
    { name: "get_next_course", slots: {}, followUp: true },
    { name: "set_current_schedule", slots: { detailId: "cls-1", name: "22软件工程1班" } },
  ];
  cases.forEach((intent) => {
    const legacy = intentToGoalContract(intent);
    const v2 = fromIntent(intent);
    const back = toLegacyV1(v2);
    assert.deepStrictEqual(back, legacy, `round-trip must not lose slots for ${intent.name}`);
  });

  // correction maps back to the closest V1 mode.
  const corrected = normalizeGoalContractV2(contract({ followUpMode: "correction" }));
  assert.strictEqual(toLegacyV1(corrected).followUpMode, "new_goal");

  // Needs-clarification survives both directions.
  const clarify = fromIntent({ name: "clarify_missing_slot", slots: { slot: { missing: "teacherName" } } });
  assert.strictEqual(clarify.ambiguity.isAmbiguous, true);
  assert.strictEqual(toLegacyV1(clarify).needsClarification, true);

  // fromIntent honours deterministic provenance by default.
  assert.strictEqual(fromIntent({ name: "get_next_course", slots: {} }).provenance.source, "deterministic");
  console.log("✓ fromIntent -> V2 -> toLegacyV1 round-trip preserves key slots");
}

function testEmptyContract() {
  const empty = emptyGoalContractV2("get_today_courses", "fallback");
  assert.strictEqual(empty.contractVersion, CONTRACT_VERSION);
  assert.strictEqual(empty.goalId, "get_today_courses");
  assert.strictEqual(empty.requestedEffect, "read");
  assert.strictEqual(empty.confidence, 0);
  assert.strictEqual(empty.provenance.source, "fallback");
  assert.deepStrictEqual(empty.entities, []);
  assertCode(() => emptyGoalContractV2("not_a_goal"), "GOAL_CONTRACT_V2_GOAL_NOT_ALLOWED");
  console.log("✓ emptyGoalContractV2 builds minimal valid contracts");
}

function testWorkingMemoryStoresV2() {
  const v2 = fromIntent({ name: "get_next_course", slots: {} });
  const updated = updateWorkingMemory(emptyWorkingMemory(), { intentName: "get_next_course", goalContract: v2 });
  assert.strictEqual(updated.lastGoalContract.contractVersion, CONTRACT_VERSION);
  assert.strictEqual(updated.lastGoalContract.goalId, "get_next_course");
  assert.strictEqual(updated.lastGoalContract.requestedEffect, "read");

  // Hydration keeps V2 shape.
  const hydrated = normalizeWorkingMemory(updated);
  assert.strictEqual(hydrated.lastGoalContract.contractVersion, CONTRACT_VERSION);
  assert.deepStrictEqual(hydrated.lastGoalContract, updated.lastGoalContract);

  // Legacy V1 payloads upgrade through the adapter.
  const legacyV1 = intentToGoalContract({ name: "search_school_index", slots: { type: "teacher", q: "陈芳" } });
  const upgraded = normalizeWorkingMemory({ lastGoalContract: legacyV1 });
  assert.strictEqual(upgraded.lastGoalContract.contractVersion, CONTRACT_VERSION);
  assert.strictEqual(upgraded.lastGoalContract.goalId, "search_school_index");
  assert.strictEqual(upgraded.lastGoalContract.entities[0].value, "陈芳");

  // Invalid contracts keep the previously stored one; explicit null clears.
  const kept = updateWorkingMemory(updated, { intentName: "get_next_course", goalContract: { nonsense: true } });
  assert.deepStrictEqual(kept.lastGoalContract, updated.lastGoalContract);
  const cleared = updateWorkingMemory(updated, { intentName: "get_next_course", goalContract: null });
  assert.strictEqual(cleared.lastGoalContract, null);
  console.log("✓ working memory stores lastGoalContract as GoalContract V2");
}

function main() {
  testGeneratedMatchesManifest();
  testValidatorRejections();
  testValidatorNormalize();
  testV1AdapterCapabilityMatrix();
  testRoundTrip();
  testEmptyContract();
  testWorkingMemoryStoresV2();
  console.log("\nGoalContract V2 tests passed");
}

main();
