#!/usr/bin/env node
/**
 * test-agent-followup-resolver.js — FollowUpResolver 唯一实现专项（M4-T1）
 *
 * 锁定 `server/src/services/ai/planner/followUpResolver.js` 的 GoalContract V2
 * 感知主接口 `resolve({ message, goalContractV2, workingState, pendingClarification })`
 * → `{ resolvedIntent, inheritedEntities, followUpMode, provenance, … }`，以及
 * 既有 legacy 导出（resolveFollowUp 等）在 M4-T2 接线前的零行为回归。
 *
 * 断言组：
 *   ① "不是A，是B" 实体纠正（teacher / class，provenance 标记 correction）
 *   ② "不是仙溪，是江湾" 校区约束纠正（constraints 更新，继承其余）
 *   ③ "换成江湾" 约束切换（weather / 空教室两族，继承 dateOffset 等）
 *   ④ "还是明天" 时间约束切换（weather / 个人课表；legacy 门不含日期词锁定）
 *   ⑤ "刚才那个班" 回指解析（lastResolvedEntity / 存储 lastGoalContract 继承）
 *   ⑥ 非追问消息透传不误判（followUpMode "none" + resolvedIntent null）
 *   ⑦ V1 升级形态 goalContract 输入（含不可升级载荷降级不抛错）
 *   ⑧ pendingClarification 槽位补齐（显式参数优先 / 过期失效 / 非实体消息不劫持）
 *   ⑨ 契约声明式 followUpMode（inherit_last_entity / replace_constraints / correction）
 *   ⑩ legacy 兼容面与结果形态不变量（含两处【疑似缺陷】现状锁定）
 *   ⑪ Working State 八字段对齐与 pendingClarification 三方统一形态（M4-T3）
 *
 * 隔离纪律：纯 Node 无框架无网络；fixture 全虚构（姓名/班级均为测试专用虚构值），
 * 无凭据/学号/密码形态字符串；不读写任何存储。
 */
const assert = require("assert");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const followUpResolver = require(path.join(ROOT, "server/src/services/ai/planner/followUpResolver"));
const goalContractV2 = require(path.join(ROOT, "server/src/services/ai/understanding/goalContractV2"));

const { resolve } = followUpResolver;

// ---------------------------------------------------------------------------
// fixture helpers（全部虚构值）
// ---------------------------------------------------------------------------

// 经 V2 严格 normalize 构造契约 fixture：fixture 畸形时直接报错，避免假绿。
function v2Contract(overrides = {}) {
  return goalContractV2.normalizeGoalContractV2(Object.assign({
    contractVersion: "goal-contract.v2",
    goalId: "get_campus_weather",
    candidateGoals: [],
    entities: [],
    constraints: {},
    followUpMode: "none",
    missingSlots: [],
    ambiguity: { isAmbiguous: false, reason: "", candidates: [] },
    confidence: 0.9,
    provenance: { source: "deterministic", provider: "", model: "", understandingSource: "" },
  }, overrides));
}

function weatherWorkingState(overrides = {}) {
  return Object.assign({
    activeGoal: "get_campus_weather",
    lastConstraints: { campus: "仙溪校区", dateOffset: 2, dateHint: "day_after_tomorrow" },
    lastSuccessfulTools: ["get_campus_weather"],
  }, overrides);
}

function assertResultShape(result, label) {
  [
    "resolvedIntent",
    "inheritedEntities",
    "followUpMode",
    "provenance",
    "goalId",
    "entities",
    "constraints",
    "confidence",
  ].forEach((key) => {
    assert.ok(Object.prototype.hasOwnProperty.call(result, key), `${label}: result must expose key ${key}`);
  });
  assert.ok(Array.isArray(result.inheritedEntities), `${label}: inheritedEntities array`);
  assert.ok(goalContractV2.FOLLOW_UP_MODES_V2.includes(result.followUpMode), `${label}: followUpMode must be a V2 mode`);
  assert.strictEqual(result.provenance.source, "deterministic", `${label}: provenance.source`);
  assert.strictEqual(result.provenance.resolver, "planner.followUpResolver", `${label}: provenance.resolver`);
  ["v2", "v1_upgraded", "none"].includes(result.provenance.contractSource)
    || assert.fail(`${label}: unexpected contractSource ${result.provenance.contractSource}`);
}

// ---------------------------------------------------------------------------
// ① "不是A，是B" 实体纠正
// ---------------------------------------------------------------------------
async function runGroup1EntityCorrection() {
  const teacher = resolve({
    message: "不是陈芳，是王芳",
    workingState: {
      activeGoal: "search_school_index",
      lastEntityType: "teacher",
      lastEntity: "陈芳",
      lastConstraints: { campus: "江湾校区", teachingWeek: 17 },
    },
  });
  assertResultShape(teacher, "g1 teacher correction");
  assert.strictEqual(teacher.followUpMode, "correction", "g1 followUpMode");
  assert.strictEqual(teacher.provenance.correction, true, "g1 provenance.correction");
  assert.deepStrictEqual(teacher.provenance.replacedRoles, ["teacher"], "g1 replacedRoles");
  assert.strictEqual(teacher.resolvedIntent.name, "search_school_index", "g1 intent name");
  assert.strictEqual(teacher.resolvedIntent.slots.q, "王芳", "g1 corrected q");
  assert.strictEqual(teacher.resolvedIntent.slots.type, "teacher", "g1 corrected type");
  assert.strictEqual(teacher.resolvedIntent.slots.lockedEntityType, "teacher", "g1 lockedEntityType");
  assert.strictEqual(teacher.resolvedIntent.slots.correctedFrom, "陈芳", "g1 correctedFrom");
  assert.strictEqual(teacher.resolvedIntent.followUp, true, "g1 intent followUp flag");
  assert.strictEqual(teacher.entities.length, 1, "g1 effective entity count");
  assert.strictEqual(teacher.entities[0].role, "teacher", "g1 effective entity role");
  assert.strictEqual(teacher.entities[0].value, "王芳", "g1 effective entity value");
  // 未点名的约束全部继承（校区/教学周不被纠正句清掉）
  assert.strictEqual(teacher.constraints.campus, "江湾校区", "g1 inherited campus constraint");
  assert.strictEqual(teacher.constraints.teachingWeek, 17, "g1 inherited teachingWeek");
  assert.ok(teacher.provenance.inheritedConstraints.includes("campus"), "g1 inheritedConstraints campus");

  const classCorrection = resolve({
    message: "不是24动物医学1班，是25动物医学3班",
    workingState: {
      activeGoal: "search_school_index",
      lastEntityType: "class",
      lastEntity: "24动物医学1班",
      lastConstraints: { teachingWeek: 17 },
    },
  });
  assertResultShape(classCorrection, "g1 class correction");
  assert.strictEqual(classCorrection.followUpMode, "correction", "g1 class followUpMode");
  assert.strictEqual(classCorrection.resolvedIntent.slots.q, "25动物医学3班", "g1 class corrected q");
  assert.strictEqual(classCorrection.resolvedIntent.slots.type, "class", "g1 class corrected type");
  assert.strictEqual(classCorrection.resolvedIntent.slots.week, 17, "g1 class inherited week slot");

  // 问句形态 "是不是…吗" 不得误判为纠正
  const question = resolve({
    message: "是不是陈芳老师的课吗",
    workingState: { activeGoal: "search_school_index", lastEntityType: "teacher", lastEntity: "陈芳" },
  });
  assert.strictEqual(question.followUpMode, "none", "g1 question must not be a correction");
  assert.strictEqual(question.resolvedIntent, null, "g1 question passthrough");
}

// ---------------------------------------------------------------------------
// ② "不是仙溪，是江湾" 校区约束纠正
// ---------------------------------------------------------------------------
async function runGroup2CampusCorrection() {
  const result = resolve({
    message: "不是仙溪，是江湾",
    workingState: weatherWorkingState(),
  });
  assertResultShape(result, "g2 campus correction");
  assert.strictEqual(result.followUpMode, "correction", "g2 followUpMode");
  assert.strictEqual(result.provenance.correction, true, "g2 provenance.correction");
  assert.deepStrictEqual(result.provenance.replacedRoles, ["campus"], "g2 replacedRoles campus");
  assert.ok(result.provenance.replacedConstraints.includes("campus"), "g2 replacedConstraints campus");
  assert.strictEqual(result.constraints.campus, "江湾校区", "g2 constraints campus replaced");
  // 其余约束（dateOffset/dateHint）继承
  assert.strictEqual(result.constraints.dateOffset, 2, "g2 inherited dateOffset");
  assert.ok(result.provenance.inheritedConstraints.includes("dateOffset"), "g2 inheritedConstraints dateOffset");
  assert.strictEqual(result.resolvedIntent.name, "get_campus_weather", "g2 weather goal rebuilt");
  assert.strictEqual(result.resolvedIntent.slots.campus, "江湾校区", "g2 intent campus");
  assert.strictEqual(result.resolvedIntent.slots.dateOffset, 2, "g2 intent inherited dateOffset");

  // 空教室上下文中的校区纠正 → 空教室族目标保持
  const emptyRoom = resolve({
    message: "不是仙溪，是江湾",
    workingState: {
      activeGoal: "search_continuous_empty_rooms",
      lastConstraints: { campus: "仙溪校区", continuousSections: 2 },
      lastSuccessfulTools: ["search_continuous_empty_rooms"],
    },
  });
  assert.strictEqual(emptyRoom.followUpMode, "correction", "g2 empty-room followUpMode");
  assert.strictEqual(emptyRoom.resolvedIntent.name, "search_continuous_empty_rooms", "g2 empty-room goal kept");
  assert.strictEqual(emptyRoom.resolvedIntent.slots.campus, "江湾校区", "g2 empty-room campus replaced");
  assert.strictEqual(emptyRoom.resolvedIntent.slots.minFreeSections, 2, "g2 empty-room minFreeSections inherited");
}

// ---------------------------------------------------------------------------
// ③ "换成江湾" 约束/校区切换
// ---------------------------------------------------------------------------
async function runGroup3CampusSwap() {
  const withContract = resolve({
    message: "换成江湾",
    goalContractV2: v2Contract({
      goalId: "get_campus_weather",
      entities: [{ role: "campus", value: "仙溪校区" }],
      constraints: { campus: "仙溪校区", dateOffset: 2, dateHint: "day_after_tomorrow" },
    }),
    workingState: {},
  });
  assertResultShape(withContract, "g3 weather swap");
  assert.strictEqual(withContract.followUpMode, "replace_constraints", "g3 followUpMode");
  assert.strictEqual(withContract.provenance.correction, false, "g3 not a correction");
  assert.strictEqual(withContract.provenance.contractSource, "v2", "g3 contractSource v2");
  assert.ok(withContract.provenance.replacedConstraints.includes("campus"), "g3 replacedConstraints campus");
  assert.ok(withContract.provenance.inheritedConstraints.includes("dateOffset"), "g3 inherited dateOffset");
  assert.strictEqual(withContract.constraints.campus, "江湾校区", "g3 constraints campus swapped");
  assert.strictEqual(withContract.resolvedIntent.name, "get_campus_weather", "g3 weather intent");
  assert.strictEqual(withContract.resolvedIntent.slots.campus, "江湾校区", "g3 intent campus");
  assert.strictEqual(Number(withContract.resolvedIntent.slots.dateOffset), 2, "g3 intent inherited dateOffset");
  assert.strictEqual(withContract.resolvedIntent.slots.dateHint, "day_after_tomorrow", "g3 intent inherited dateHint");

  const emptyRoom = resolve({
    message: "换成江湾校区",
    workingState: {
      activeGoal: "search_continuous_empty_rooms",
      lastConstraints: { campus: "仙溪校区", continuousSections: 2 },
      lastSuccessfulTools: ["search_continuous_empty_rooms"],
    },
  });
  assertResultShape(emptyRoom, "g3 empty-room swap");
  assert.strictEqual(emptyRoom.followUpMode, "replace_constraints", "g3 empty-room followUpMode");
  assert.strictEqual(emptyRoom.resolvedIntent.name, "search_continuous_empty_rooms", "g3 empty-room intent");
  assert.strictEqual(emptyRoom.resolvedIntent.slots.campus, "江湾校区", "g3 empty-room campus");
  assert.strictEqual(emptyRoom.resolvedIntent.slots.minFreeSections, 2, "g3 empty-room continuous inherited");

  // 课表实体上下文：校区切换继承实体
  const schoolIndex = resolve({
    message: "换成江湾",
    workingState: {
      activeGoal: "search_school_index",
      lastEntityType: "class",
      lastEntity: "25动物医学3班",
      lastConstraints: { campus: "仙溪校区", teachingWeek: 17 },
    },
  });
  assert.strictEqual(schoolIndex.followUpMode, "replace_constraints", "g3 school-index followUpMode");
  assert.strictEqual(schoolIndex.resolvedIntent.name, "search_school_index", "g3 school-index intent");
  assert.strictEqual(schoolIndex.resolvedIntent.slots.q, "25动物医学3班", "g3 school-index entity inherited");
  assert.strictEqual(schoolIndex.resolvedIntent.slots.campus, "江湾校区", "g3 school-index campus swapped");
  assert.strictEqual(schoolIndex.inheritedEntities.length, 1, "g3 school-index inheritedEntities");
  assert.strictEqual(schoolIndex.inheritedEntities[0].role, "class", "g3 school-index inherited role");
}

// ---------------------------------------------------------------------------
// ④ "还是明天" 时间约束切换
// ---------------------------------------------------------------------------
async function runGroup4DateSwitch() {
  const weather = resolve({
    message: "还是明天",
    workingState: weatherWorkingState(),
  });
  assertResultShape(weather, "g4 weather date switch");
  assert.strictEqual(weather.followUpMode, "replace_constraints", "g4 followUpMode");
  assert.ok(weather.provenance.replacedConstraints.includes("dateOffset"), "g4 replacedConstraints dateOffset");
  assert.strictEqual(weather.constraints.dateOffset, 1, "g4 constraints dateOffset switched");
  assert.strictEqual(weather.constraints.dateHint, "tomorrow", "g4 constraints dateHint");
  assert.strictEqual(weather.resolvedIntent.name, "get_campus_weather", "g4 weather intent");
  assert.strictEqual(weather.resolvedIntent.slots.campus, "仙溪校区", "g4 campus inherited not cleared");
  assert.strictEqual(Number(weather.resolvedIntent.slots.dateOffset), 1, "g4 intent dateOffset tomorrow");

  const personal = resolve({
    message: "还是明天",
    workingState: { activeGoal: "get_today_courses", lastConstraints: { dateOffset: 0 } },
  });
  assert.strictEqual(personal.followUpMode, "replace_constraints", "g4 personal followUpMode");
  assert.strictEqual(personal.resolvedIntent.name, "get_tomorrow_courses", "g4 personal goal remapped");

  const schoolIndex = resolve({
    message: "那明天呢",
    workingState: {
      activeGoal: "search_school_index",
      lastEntityType: "class",
      lastEntity: "25动物医学3班",
      lastConstraints: { teachingWeek: 17 },
    },
  });
  assert.strictEqual(schoolIndex.followUpMode, "replace_constraints", "g4 school-index followUpMode");
  assert.strictEqual(schoolIndex.resolvedIntent.name, "search_school_index", "g4 school-index intent");
  assert.strictEqual(schoolIndex.resolvedIntent.slots.q, "25动物医学3班", "g4 school-index entity inherited");
  assert.strictEqual(schoolIndex.constraints.dateOffset, 1, "g4 school-index constraint switched");

  // 兼容锁定：legacy resolveFollowUp 的约束门刻意不含日期词（现状不变，
  // "还是明天" 的解析能力只存在于新 resolve()；M4-T2 切换调用点后生效）。
  assert.strictEqual(
    followUpResolver.resolveFollowUp("还是明天", weatherWorkingState()),
    null,
    "g4 legacy gate must stay date-word-free (compat lock)"
  );

  // 更长日期词先匹配：“大后天”不得被“后天”子串截断。
  const inThreeDays = followUpResolver.parseDateOffset("大后天");
  assert.strictEqual(inThreeDays.dateOffset, 3, "g4 大后天 offset");
  assert.strictEqual(inThreeDays.dateHint, "in_3_days", "g4 大后天 hint");
}

// ---------------------------------------------------------------------------
// ⑤ "刚才那个班" 回指解析
// ---------------------------------------------------------------------------
async function runGroup5Anaphora() {
  const result = resolve({
    message: "刚才那个班",
    workingState: {
      activeGoal: "search_school_index",
      lastResolvedEntity: { type: "class", id: "class-detail-25-animal-3", name: "25动物医学3班" },
      lastConstraints: { teachingWeek: 17 },
    },
  });
  assertResultShape(result, "g5 anaphora");
  assert.strictEqual(result.followUpMode, "inherit_last_entity", "g5 followUpMode");
  assert.strictEqual(result.resolvedIntent.name, "search_school_index", "g5 intent name");
  assert.strictEqual(result.resolvedIntent.slots.q, "25动物医学3班", "g5 inherited q");
  assert.strictEqual(result.resolvedIntent.slots.type, "class", "g5 inherited type");
  assert.strictEqual(result.resolvedIntent.slots.week, 17, "g5 inherited week");
  assert.strictEqual(result.inheritedEntities.length, 1, "g5 inheritedEntities count");
  assert.strictEqual(result.inheritedEntities[0].value, "25动物医学3班", "g5 inheritedEntities value");
  assert.strictEqual(result.inheritedEntities[0].inheritedFrom, "last_resolved_entity", "g5 inheritedFrom");

  // 存储在 working state 的 lastGoalContract（V2 形态）也是回指来源
  const stored = resolve({
    message: "刚才那个班",
    workingState: {
      lastGoalContract: v2Contract({
        goalId: "search_school_index",
        entities: [{ role: "class", value: "24动物医学1班" }],
      }),
    },
  });
  assert.strictEqual(stored.followUpMode, "inherit_last_entity", "g5 stored followUpMode");
  assert.strictEqual(stored.resolvedIntent.slots.q, "24动物医学1班", "g5 stored contract entity inherited");
  assert.strictEqual(stored.inheritedEntities[0].inheritedFrom, "last_goal_contract", "g5 stored inheritedFrom");

  // 无可继承实体时不得伪造回指
  const noEntity = resolve({ message: "刚才那个班", workingState: {} });
  assert.strictEqual(noEntity.followUpMode, "none", "g5 no-entity anaphora must pass through");
  assert.strictEqual(noEntity.resolvedIntent, null, "g5 no-entity resolvedIntent null");
}

// ---------------------------------------------------------------------------
// ⑥ 非追问消息透传不误判
// ---------------------------------------------------------------------------
async function runGroup6Passthrough() {
  const cases = [
    "查一下25动物医学3班周三的课表",
    "今天天气怎么样",
    "帮我找明天下午仙溪校区的空教室",
    "你好",
    "陈芳老师的课表",
  ];
  cases.forEach((message) => {
    const result = resolve({ message, workingState: weatherWorkingState() });
    assertResultShape(result, `g6 "${message}"`);
    assert.strictEqual(result.followUpMode, "none", `g6 "${message}" followUpMode must be none`);
    assert.strictEqual(result.resolvedIntent, null, `g6 "${message}" resolvedIntent must be null`);
    assert.deepStrictEqual(result.inheritedEntities, [], `g6 "${message}" inheritedEntities empty`);
    assert.strictEqual(result.confidence, 0, `g6 "${message}" confidence 0`);
  });
  const empty = resolve({ message: "", workingState: {} });
  assert.strictEqual(empty.followUpMode, "none", "g6 empty message none");
  assert.strictEqual(empty.resolvedIntent, null, "g6 empty message passthrough");
}

// ---------------------------------------------------------------------------
// ⑦ V1 升级形态 goalContract 输入
// ---------------------------------------------------------------------------
async function runGroup7V1UpgradedContract() {
  const v1 = {
    goal: "get_campus_weather",
    entityType: "campus",
    entity: "仙溪校区",
    normalizedEntity: "仙溪校区",
    constraints: { campus: "仙溪校区", dateOffset: 2, dateHint: "day_after_tomorrow" },
    followUpMode: "new_goal",
    confidence: 0.9,
    needsClarification: false,
  };
  const result = resolve({ message: "换成江湾", goalContractV2: v1, workingState: {} });
  assertResultShape(result, "g7 v1-upgraded");
  assert.strictEqual(result.provenance.contractSource, "v1_upgraded", "g7 contractSource");
  assert.strictEqual(result.followUpMode, "replace_constraints", "g7 followUpMode");
  assert.strictEqual(result.resolvedIntent.name, "get_campus_weather", "g7 weather intent");
  assert.strictEqual(result.resolvedIntent.slots.campus, "江湾校区", "g7 campus swapped");
  assert.strictEqual(Number(result.resolvedIntent.slots.dateOffset), 2, "g7 v1 constraints inherited");

  // 不可升级的 V1 载荷（goal 不在 Capability Manifest）→ 降级为无契约，
  // 绝不抛错，解析回退到 working state + 确定性门。
  const invalidV1 = Object.assign({}, v1, { goal: "open_schedule" });
  const degraded = resolve({
    message: "换成江湾",
    goalContractV2: invalidV1,
    workingState: weatherWorkingState(),
  });
  assertResultShape(degraded, "g7 degraded");
  assert.strictEqual(degraded.provenance.contractSource, "none", "g7 degraded contractSource");
  assert.strictEqual(degraded.followUpMode, "replace_constraints", "g7 degraded still resolves");
  assert.strictEqual(degraded.resolvedIntent.slots.campus, "江湾校区", "g7 degraded campus swapped");

  // 直接给 V2 形态契约时 contractSource 标记 v2
  const native = resolve({
    message: "换成江湾",
    goalContractV2: v2Contract({ goalId: "get_campus_weather", constraints: { campus: "仙溪校区" } }),
    workingState: {},
  });
  assert.strictEqual(native.provenance.contractSource, "v2", "g7 native v2 contractSource");
}

// ---------------------------------------------------------------------------
// ⑧ pendingClarification 槽位补齐
// ---------------------------------------------------------------------------
async function runGroup8PendingClarification() {
  const pending = {
    intentName: "search_school_index",
    type: "teacher",
    missing: "teacherName",
    createdAt: Date.now(),
    expiresAt: Date.now() + 60000,
  };
  const filled = resolve({ message: "陈芳", workingState: {}, pendingClarification: pending });
  assertResultShape(filled, "g8 teacher fill");
  assert.strictEqual(filled.followUpMode, "fill_pending_clarification", "g8 followUpMode");
  assert.strictEqual(filled.resolvedIntent.name, "search_school_index", "g8 intent name");
  assert.strictEqual(filled.resolvedIntent.slots.type, "teacher", "g8 slot type");
  assert.strictEqual(filled.resolvedIntent.slots.q, "陈芳", "g8 slot q");
  assert.strictEqual(filled.resolvedIntent.slots.lockedEntityType, "teacher", "g8 lockedEntityType");
  assert.strictEqual(filled.resolvedIntent.slots.filledFromPendingClarification, true, "g8 filled flag");
  assert.strictEqual(filled.resolvedIntent.slots.missing, "teacherName", "g8 missing slot");
  assert.strictEqual(filled.provenance.filledSlot, "teacherName", "g8 provenance filledSlot");
  assert.strictEqual(filled.entities[0].role, "teacher", "g8 entity role");

  // 显式参数优先于 workingState.pendingClarification
  const precedence = resolve({
    message: "陈芳",
    workingState: {
      pendingClarification: { intentName: "search_school_index", type: "class", missing: "className", expiresAt: Date.now() + 60000 },
    },
    pendingClarification: pending,
  });
  assert.strictEqual(precedence.followUpMode, "fill_pending_clarification", "g8 precedence followUpMode");
  assert.strictEqual(precedence.resolvedIntent.slots.type, "teacher", "g8 explicit param wins");

  // workingState 自带的 pendingClarification 同样可走补齐路径
  const fromState = resolve({
    message: "25动物医学3班",
    workingState: {
      activeGoal: "search_school_index",
      pendingClarification: { intentName: "search_school_index", type: "class", missing: "className", expiresAt: Date.now() + 60000 },
    },
  });
  assert.strictEqual(fromState.followUpMode, "fill_pending_clarification", "g8 state pending followUpMode");
  assert.strictEqual(fromState.resolvedIntent.slots.type, "class", "g8 class fill type");
  assert.strictEqual(fromState.resolvedIntent.slots.q, "25动物医学3班", "g8 class fill q");

  // 过期 pending 不得补齐（陈芳 无其他追问门 → 透传）
  const expired = resolve({
    message: "陈芳",
    workingState: {},
    pendingClarification: Object.assign({}, pending, { expiresAt: Date.now() - 1000 }),
  });
  assert.strictEqual(expired.followUpMode, "none", "g8 expired pending passthrough");
  assert.strictEqual(expired.resolvedIntent, null, "g8 expired resolvedIntent null");

  // 非实体消息不被 pending 劫持，继续走约束切换路径
  const notHijacked = resolve({
    message: "换成江湾",
    workingState: weatherWorkingState(),
    pendingClarification: pending,
  });
  assert.strictEqual(notHijacked.followUpMode, "replace_constraints", "g8 non-entity message not hijacked");
  assert.strictEqual(notHijacked.resolvedIntent.name, "get_campus_weather", "g8 falls through to constraint path");
}

// ---------------------------------------------------------------------------
// ⑨ 契约声明式 followUpMode
// ---------------------------------------------------------------------------
async function runGroup9ContractDeclaredModes() {
  // inherit_last_entity + set_current_schedule（goalResolver V1 行为 parity）
  const setCurrent = resolve({
    message: "设为当前课表",
    goalContractV2: v2Contract({
      goalId: "set_current_schedule",
      followUpMode: "inherit_last_entity",
      confidence: 0.97,
    }),
    workingState: {
      activeGoal: "search_school_index",
      lastResolvedEntity: { type: "class", id: "class-detail-25-animal-3", name: "25动物医学3班" },
    },
  });
  assertResultShape(setCurrent, "g9 set_current_schedule");
  assert.strictEqual(setCurrent.followUpMode, "inherit_last_entity", "g9 followUpMode");
  assert.strictEqual(setCurrent.resolvedIntent.name, "set_current_schedule", "g9 intent name");
  assert.strictEqual(setCurrent.resolvedIntent.slots.detailId, "class-detail-25-animal-3", "g9 detailId");
  assert.strictEqual(setCurrent.resolvedIntent.slots.name, "25动物医学3班", "g9 name");
  assert.strictEqual(setCurrent.resolvedIntent.slots.explicitCommand, true, "g9 explicitCommand");
  assert.strictEqual(setCurrent.inheritedEntities.length, 1, "g9 inheritedEntities");
  assert.strictEqual(setCurrent.inheritedEntities[0].role, "class", "g9 inherited role");

  // inherit_last_entity + search_school_index（working state 教师实体）
  const inherited = resolve({
    message: "那她周三呢",
    goalContractV2: v2Contract({ goalId: "search_school_index", followUpMode: "inherit_last_entity" }),
    workingState: { activeGoal: "search_school_index", lastEntityType: "teacher", lastEntity: "陈芳" },
  });
  assert.strictEqual(inherited.followUpMode, "inherit_last_entity", "g9 search followUpMode");
  assert.strictEqual(inherited.resolvedIntent.slots.q, "陈芳", "g9 search inherited q");
  assert.strictEqual(inherited.resolvedIntent.slots.type, "teacher", "g9 search inherited type");

  // replace_constraints：working state 基底 + 契约约束覆盖（mergeConstraints parity）
  const replaced = resolve({
    message: "换成江湾校区",
    goalContractV2: v2Contract({
      goalId: "get_campus_weather",
      followUpMode: "replace_constraints",
      constraints: { campus: "江湾校区" },
      confidence: 0.96,
    }),
    workingState: weatherWorkingState(),
  });
  assert.strictEqual(replaced.followUpMode, "replace_constraints", "g9 replace followUpMode");
  assert.strictEqual(replaced.resolvedIntent.name, "get_campus_weather", "g9 replace intent");
  assert.strictEqual(replaced.resolvedIntent.slots.campus, "江湾校区", "g9 contract constraint overlays state");
  assert.strictEqual(Number(replaced.resolvedIntent.slots.dateOffset), 2, "g9 state constraint inherited");

  // correction 声明：契约实体按 role 替换上一契约实体，其余角色继承
  const declaredCorrection = resolve({
    message: "不是陈芳，是王芳",
    goalContractV2: v2Contract({
      goalId: "search_school_index",
      followUpMode: "correction",
      entities: [{ role: "teacher", value: "王芳" }],
    }),
    workingState: {
      activeGoal: "search_school_index",
      lastGoalContract: v2Contract({
        goalId: "search_school_index",
        entities: [{ role: "teacher", value: "陈芳" }, { role: "course", value: "动物医学" }],
      }),
    },
  });
  assert.strictEqual(declaredCorrection.followUpMode, "correction", "g9 declared correction mode");
  assert.strictEqual(declaredCorrection.provenance.correction, true, "g9 declared correction flag");
  assert.deepStrictEqual(declaredCorrection.provenance.replacedRoles, ["teacher"], "g9 declared replacedRoles");
  assert.strictEqual(declaredCorrection.resolvedIntent.slots.q, "王芳", "g9 declared corrected q");
  const inheritedRoles = declaredCorrection.inheritedEntities.map((entity) => entity.role);
  assert.ok(inheritedRoles.includes("course"), "g9 declared correction keeps other roles");
  assert.ok(!inheritedRoles.includes("teacher"), "g9 declared correction drops replaced role");
}

// ---------------------------------------------------------------------------
// ⑩ legacy 兼容面与结果形态不变量
// ---------------------------------------------------------------------------
async function runGroup10LegacyCompat() {
  // 既有导出签名全部保留（toolRegistry / goalResolver / test-xiaofu-core-experience 依赖）
  [
    "emptyConstraints",
    "emptyConversationWorkingState",
    "normalizeConstraints",
    "normalizeConversationWorkingState",
    "inferCampus",
    "parseDateOffset",
    "parseContinuousSections",
    "isCampusSwapOnly",
    "isConstraintOnlyFollowUp",
    "resolveFollowUp",
    "applyTurnToWorkingState",
  ].forEach((name) => {
    assert.strictEqual(typeof followUpResolver[name], "function", `g10 legacy export ${name} must stay a function`);
  });
  ["resolve", "coerceGoalContractV2Input", "isDateOnlyFollowUp", "isAnaphoricEntityReference", "parseEntityCorrection"]
    .forEach((name) => {
      assert.strictEqual(typeof followUpResolver[name], "function", `g10 new export ${name} must be a function`);
    });

  // legacy resolveFollowUp 行为逐断言对齐 test-xiaofu-core-experience.js :132-139
  const legacy = followUpResolver.resolveFollowUp("换成江湾校区", {
    activeGoal: "get_campus_weather",
    lastConstraints: { campus: "仙溪校区", dateOffset: 2, dateHint: "day_after_tomorrow" },
    lastSuccessfulTools: ["get_campus_weather"],
  });
  assert.strictEqual(legacy.kind, "follow_up_modify_constraint", "g10 legacy kind");
  assert.ok(legacy.replacedFields.includes("campus"), "g10 legacy replaced campus");
  assert.strictEqual(Number(legacy.constraints.dateOffset), 2, "g10 legacy inherited date");
  assert.strictEqual(legacy.intent.name, "get_campus_weather", "g10 legacy intent name");
  assert.strictEqual(legacy.intent.slots.campus, "江湾校区", "g10 legacy intent campus");

  // applyTurnToWorkingState 合并语义不变
  const merged = followUpResolver.applyTurnToWorkingState(
    { activeGoal: "get_campus_weather", lastConstraints: { campus: "仙溪校区" } },
    { constraints: { campus: "江湾校区" }, tools: ["get_campus_weather"] }
  );
  assert.strictEqual(merged.lastConstraints.campus, "江湾校区", "g10 applyTurn constraints merge");
  assert.ok(merged.lastSuccessfulTools.includes("get_campus_weather"), "g10 applyTurn tools merge");

  // 【疑似缺陷】legacy 空教室路径：prev campus 为空时 "campus" 同时落入
  // inheritedFields 与 replacedFields（followUpResolver.js :255-261，weather
  // 返回分支会过滤 inherited 里的 campus，空教室分支不会，两族口径互相矛盾）。
  // 按任务纪律锁定现状，不擅自修。
  const doubleListed = followUpResolver.resolveFollowUp("换成江湾校区", {
    activeGoal: "search_continuous_empty_rooms",
    lastConstraints: { continuousSections: 2 },
  });
  assert.ok(doubleListed.inheritedFields.includes("campus"), "g10 【疑似缺陷】campus locked in inheritedFields");
  assert.ok(doubleListed.replacedFields.includes("campus"), "g10 【疑似缺陷】campus locked in replacedFields");

  // 新接口在任意分支的结果形态不变量
  const samples = [
    resolve({ message: "不是陈芳，是王芳", workingState: { lastEntityType: "teacher", lastEntity: "陈芳" } }),
    resolve({ message: "换成江湾", workingState: weatherWorkingState() }),
    resolve({ message: "还是明天", workingState: weatherWorkingState() }),
    resolve({ message: "刚才那个班", workingState: { lastResolvedEntity: { type: "class", id: "x", name: "25动物医学3班" } } }),
    resolve({ message: "查课表", workingState: {} }),
  ];
  samples.forEach((sample, index) => assertResultShape(sample, `g10 sample#${index}`));
}

// ---------------------------------------------------------------------------
// ⑪ Working State 字段与 GoalContract V2 对齐（M4-T3）
// ---------------------------------------------------------------------------
async function runGroup11WorkingStateAlignment() {
  const workingMemory = require(path.join(ROOT, "server/src/services/ai/memory/workingMemory"));
  const verificationCoordinator = require(path.join(ROOT, "server/src/services/ai/runtime/verificationCoordinator"));

  const REQUIRED_STATE_FIELDS = [
    "activeGoal",
    "pendingClarification",
    "lastGoalContract",
    "lastResolvedEntity",
    "lastConstraints",
    "pendingAction",
    "providerUsed",
    "understandingSource",
  ];

  // 1) workingMemory 与 typed conversation working state 双形态均含八字段
  REQUIRED_STATE_FIELDS.forEach((field) => {
    assert.ok(
      Object.prototype.hasOwnProperty.call(workingMemory.emptyWorkingMemory(), field),
      `g11 workingMemory.emptyWorkingMemory must expose ${field}`
    );
    assert.ok(
      Object.prototype.hasOwnProperty.call(followUpResolver.emptyConversationWorkingState(), field),
      `g11 emptyConversationWorkingState must expose ${field}`
    );
  });

  // 2) pendingClarification 三方统一形态：verificationCoordinator 生产 →
  //    workingMemory 存储归一 → followUpResolver 消费，键集与值全程一致。
  const produced = verificationCoordinator.buildClarificationPatch({
    name: "clarify_missing_slot",
    slots: { slot: { type: "teacher", missing: "teacherName" } },
  }).pendingClarification;
  assert.deepStrictEqual(
    Object.keys(produced).sort(),
    ["createdAt", "expiresAt", "intentName", "missing", "type"],
    "g11 producer pendingClarification 5-key shape"
  );
  const stored = workingMemory.normalizeWorkingMemory({ pendingClarification: produced }).pendingClarification;
  assert.deepStrictEqual(stored, produced, "g11 workingMemory stores producer shape verbatim");
  const typed = followUpResolver.normalizeConversationWorkingState({ pendingClarification: produced }).pendingClarification;
  assert.deepStrictEqual(typed, produced, "g11 typed working state keeps the same shape");
  const consumed = resolve({ message: "陈芳", workingState: { pendingClarification: stored } });
  assert.strictEqual(consumed.followUpMode, "fill_pending_clarification", "g11 consumer fills from unified shape");
  assert.strictEqual(consumed.resolvedIntent.slots.q, "陈芳", "g11 consumer fill q");

  // 3) 归一仅收敛键与类型：多余键丢弃、数字字符串时间戳转 Number、畸形载荷降级 null
  const coerced = workingMemory.normalizeWorkingMemory({
    pendingClarification: {
      intentName: "search_school_index",
      type: "class",
      missing: "className",
      createdAt: String(produced.createdAt),
      expiresAt: String(produced.expiresAt),
      extraJunk: "drop-me",
    },
  }).pendingClarification;
  assert.deepStrictEqual(
    coerced,
    {
      intentName: "search_school_index",
      type: "class",
      missing: "className",
      createdAt: produced.createdAt,
      expiresAt: produced.expiresAt,
    },
    "g11 normalization drops extra keys and coerces timestamps"
  );
  ["junk", ["type"], 7, true].forEach((junk, index) => {
    assert.strictEqual(
      workingMemory.normalizeWorkingMemory({ pendingClarification: junk }).pendingClarification,
      null,
      `g11 malformed pendingClarification#${index} degrades to null`
    );
    assert.strictEqual(
      followUpResolver.normalizeConversationWorkingState({ pendingClarification: junk }).pendingClarification,
      null,
      `g11 typed state malformed pendingClarification#${index} degrades to null`
    );
  });

  // 4) 过期语义仍归消费方：hydration 不丢过期条目（与旧 passthrough 行为一致），
  //    pickPendingClarification 在消费侧拒绝过期条目。
  const expiredAt = Date.now() - 1000;
  const expiredStored = workingMemory.normalizeWorkingMemory({
    pendingClarification: {
      intentName: "search_school_index",
      type: "teacher",
      missing: "teacherName",
      createdAt: expiredAt - 60000,
      expiresAt: expiredAt,
    },
  }).pendingClarification;
  assert.ok(expiredStored && expiredStored.expiresAt === expiredAt, "g11 expired entry preserved at hydration");
  const expiredFill = resolve({ message: "陈芳", workingState: { pendingClarification: expiredStored } });
  assert.strictEqual(expiredFill.followUpMode, "none", "g11 expired pending still rejected by consumer");

  // 5) updateWorkingMemory：显式 set → 归一存储；null 清除；undefined 继承
  const turned = workingMemory.updateWorkingMemory(workingMemory.emptyWorkingMemory(), {
    message: "陈芳",
    pendingClarification: produced,
  });
  assert.deepStrictEqual(turned.pendingClarification, produced, "g11 updateWorkingMemory stores normalized pending");
  const cleared = workingMemory.updateWorkingMemory(turned, { message: "算了", pendingClarification: null });
  assert.strictEqual(cleared.pendingClarification, null, "g11 explicit null clears pending");
  const inherited = workingMemory.updateWorkingMemory(turned, { message: "那周三呢" });
  assert.deepStrictEqual(inherited.pendingClarification, produced, "g11 undefined input inherits pending");

  // 6) normalizeStoredGoalContract（V1 存储升级路径）行为不变：
  //    V1 → adapter 升级、垃圾丢弃、V2 直存
  const upgraded = workingMemory.normalizeWorkingMemory({
    lastGoalContract: {
      goal: "get_campus_weather",
      entityType: "campus",
      entity: "仙溪校区",
      normalizedEntity: "仙溪校区",
      constraints: { campus: "仙溪校区" },
      followUpMode: "new_goal",
      confidence: 0.9,
      needsClarification: false,
    },
  }).lastGoalContract;
  assert.ok(upgraded, "g11 V1 stored contract upgrades");
  assert.strictEqual(upgraded.contractVersion, "goal-contract.v2", "g11 upgraded contractVersion");
  assert.strictEqual(upgraded.goalId, "get_campus_weather", "g11 upgraded goalId");
  assert.strictEqual(
    upgraded.provenance.understandingSource,
    "legacy_v1_working_memory",
    "g11 upgraded provenance marker"
  );
  assert.strictEqual(
    workingMemory.normalizeWorkingMemory({ lastGoalContract: { totally: "junk" } }).lastGoalContract,
    null,
    "g11 garbage stored contract still dropped"
  );
  const nativeStored = workingMemory.normalizeWorkingMemory({
    lastGoalContract: v2Contract({ goalId: "get_campus_weather" }),
  }).lastGoalContract;
  assert.strictEqual(nativeStored.contractVersion, "goal-contract.v2", "g11 native V2 stored verbatim");

  // typed working state 同步携带 lastGoalContract / providerUsed / understandingSource
  const typedFull = followUpResolver.normalizeConversationWorkingState({
    lastGoalContract: v2Contract({ goalId: "get_campus_weather" }),
    providerUsed: "mock-provider",
    understandingSource: "rule",
  });
  assert.strictEqual(typedFull.lastGoalContract.goalId, "get_campus_weather", "g11 typed state carries V2 contract");
  assert.strictEqual(typedFull.providerUsed, "mock-provider", "g11 typed state providerUsed");
  assert.strictEqual(typedFull.understandingSource, "rule", "g11 typed state understandingSource");
  assert.strictEqual(
    followUpResolver.normalizeConversationWorkingState({ lastGoalContract: { totally: "junk" } }).lastGoalContract,
    null,
    "g11 typed state garbage contract degrades to null"
  );

  // 7) legacy resolveFollowUp 仍消费归一后的 pending（fill_pending_entity 零回归）
  const legacyFill = followUpResolver.resolveFollowUp("陈芳", {
    activeGoal: "search_school_index",
    pendingClarification: produced,
  });
  assert.ok(legacyFill, "g11 legacy fill_pending_entity still resolves");
  assert.strictEqual(legacyFill.kind, "fill_pending_entity", "g11 legacy kind");
  assert.strictEqual(legacyFill.intent.slots.filledFromPendingClarification, true, "g11 legacy filled flag");
}

// ---------------------------------------------------------------------------
// main：依次调用各断言组
// ---------------------------------------------------------------------------
const GROUPS = [
  ["group1 entity correction (不是A，是B)", runGroup1EntityCorrection],
  ["group2 campus correction (不是仙溪，是江湾)", runGroup2CampusCorrection],
  ["group3 campus swap (换成江湾)", runGroup3CampusSwap],
  ["group4 date switch (还是明天)", runGroup4DateSwitch],
  ["group5 anaphora (刚才那个班)", runGroup5Anaphora],
  ["group6 non-follow-up passthrough", runGroup6Passthrough],
  ["group7 V1-upgraded contract input", runGroup7V1UpgradedContract],
  ["group8 pendingClarification slot fill", runGroup8PendingClarification],
  ["group9 contract-declared followUpMode", runGroup9ContractDeclaredModes],
  ["group10 legacy compat + shape invariants", runGroup10LegacyCompat],
  ["group11 working state V2 alignment (M4-T3)", runGroup11WorkingStateAlignment],
];

async function main() {
  let failures = 0;
  for (const [name, run] of GROUPS) {
    try {
      await run();
      console.log(`  PASS ${name}`);
    } catch (error) {
      failures += 1;
      console.error(`  FAIL ${name}`);
      console.error((error && error.stack) || error);
    }
  }
  if (failures > 0) {
    console.error(`test-agent-followup-resolver: FAIL (${failures}/${GROUPS.length} groups failed)`);
    process.exitCode = 1;
    return;
  }
  console.log("test-agent-followup-resolver: PASS");
}

main().catch((error) => {
  console.error((error && error.stack) || error);
  process.exitCode = 1;
});
