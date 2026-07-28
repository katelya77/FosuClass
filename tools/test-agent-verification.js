#!/usr/bin/env node
/**
 * test-agent-verification.js — 工具结果语义核验专项（M2-T1）
 *
 * 被测对象：server/src/services/ai/verification/toolResultVerifier.js
 * 断言以其真实导出（normalizePolicy / verify）与实际行为为准锁定：
 *   verify({ toolId, policy, result, intent, goalContract }) →
 *     { status: "verified" | "partial" | "failed" | "empty_accepted",
 *       ok: boolean,
 *       violations: [{ code, detail, field? }],
 *       evidence: { fields: string[], approximateFlags: [{ field, label }] } }
 *
 * 覆盖断言组 ①—⑥：
 *   ① outputSchema（required 缺失 / 浅类型校验 / 齐全通过）
 *   ② 四种后置条件谓词 fieldNonEmpty / fieldMatchesSlot / numericRange / timeOrder（红绿各至少一例）
 *   ③ emptyResultPolicy 三模式（accept → empty_accepted / partial / fail）与 goalContract 回退
 *   ④ partialCompletionPolicy（软违规 + allowPartial → partial；否则 failed；硬违规恒 failed）
 *   ⑤ evidencePolicy（fields / approximateFlags 透传、防御性拷贝、脏数据过滤）
 *   ⑥ 兜底行为（无 policy / policy 非法 / result 缺失或 success=false / normalizePolicy 白名单）
 *
 * 与计划口径的差异（以实现为准锁定，详见 output/agent-platform-m2-progress.md）：
 *   - evidence.fields 是策略声明的 evidenceFields 原样透传，而非"实际取到的字段列表"；
 *   - fieldMatchesSlot 与 emptyResultPolicy mode "fail" 在 manifest 中暂无实例（仅语法层支持），
 *     对应 fixture 参照 manifest 数据形态自行构造。
 *
 * 隔离纪律：被测模块为纯函数，本测试不触网、不读 env、不读写文件、不依赖 server/storage 状态；
 * fixture 全部为虚构数据，不含任何 Token/Key/Cookie/OpenID/学号/密码形态字符串。
 */
const assert = require("assert");

const { normalizePolicy, verify } = require("../server/src/services/ai/verification/toolResultVerifier");

// ---------------------------------------------------------------------------
// Fixtures（参照 server/config/agent-capability-manifest.json 真实策略形态构造）
// ---------------------------------------------------------------------------

// 参照 manifest get_today_courses（54-97 行）。
const TODAY_COURSES_POLICY = {
  outputSchema: {
    required: ["courses"],
    fields: {
      courses: "array",
      courseCount: "number",
      nextCourse: "object",
      date: "string",
      currentWeek: "number",
    },
  },
  successPostconditions: ["numericRange:courseCount:0:20"],
  emptyResultPolicy: { mode: "accept", codes: ["NO_COURSES", "EMPTY_RESULT", "NO_PERSONAL"] },
  partialCompletionPolicy: { allowPartial: true, note: "无课、未导入课表或周次不确定均为合法空态。" },
  evidencePolicy: {
    evidenceFields: ["courses", "nextCourse", "date", "currentWeek"],
    approximateFlags: [],
  },
};

// 参照 manifest get_course_route（670-760 行，含 timeOrder 与 approximateFlags 实例）。
const COURSE_ROUTE_POLICY = {
  outputSchema: {
    required: ["courseName", "startTime", "departureTime"],
    fields: {
      courseName: "string",
      classroom: "string",
      campus: "string",
      startTime: "time",
      departureTime: "time",
      walkingBufferMinutes: "integer",
      totalBufferMinutes: "integer",
      preciseRouteAvailable: "boolean",
    },
  },
  successPostconditions: [
    "fieldNonEmpty:courseName",
    "timeOrder:departureTime:startTime",
    "numericRange:totalBufferMinutes:5:180",
  ],
  emptyResultPolicy: {
    mode: "accept",
    codes: ["NO_MATCHING_COURSE", "SCHEDULE_REQUIRED", "COURSE_TIME_REQUIRED", "ROUTE_DATA_INCOMPLETE"],
  },
  partialCompletionPolicy: { allowPartial: true, note: "缺少精确定位时仍返回通用缓冲建议，但必须标注近似。" },
  evidencePolicy: {
    evidenceFields: ["courseName", "classroom", "startTime", "departureTime", "locationEvidence", "actionUrl"],
    approximateFlags: [{ field: "walkingBufferMinutes", label: "APPROXIMATE_BUFFER_NOT_PRECISE_NAV" }],
  },
};

// 参照 manifest get_campus_weather（441-488 行，emptyResultPolicy mode "partial" 实例）。
const CAMPUS_WEATHER_POLICY = {
  outputSchema: {
    required: ["weatherText", "campus"],
    fields: {
      weatherText: "string",
      campus: "string",
      temperatureC: "number",
      rainProbabilityMax24h: "number",
      updatedAt: "string",
    },
  },
  successPostconditions: ["fieldNonEmpty:weatherText"],
  emptyResultPolicy: {
    mode: "partial",
    codes: ["WEATHER_PROVIDER_FAILED", "WEATHER_DISABLED", "UNAVAILABLE"],
  },
  partialCompletionPolicy: { allowPartial: true, note: "天气不可用或使用过期数据只降级，不影响课表事实。" },
  evidencePolicy: {
    evidenceFields: ["weatherText", "temperatureC", "rainProbabilityMax24h", "campus", "updatedAt"],
    approximateFlags: [],
  },
};

// fieldMatchesSlot 在 manifest 中暂无实例（仅 verificationPolicy.js 语法层支持），
// 参照 search_empty_rooms（261 行起）的 campus 过滤语义构造。
const EMPTY_ROOM_POLICY = {
  outputSchema: {
    required: ["rooms"],
    fields: { rooms: "array", campus: "string", building: "string" },
  },
  successPostconditions: ["fieldMatchesSlot:campus:campus"],
  partialCompletionPolicy: { allowPartial: true, note: "校区过滤不一致时降级为部分结果。" },
  evidencePolicy: { evidenceFields: ["rooms", "campus"], approximateFlags: [] },
};

function okRouteResult(overrides = {}) {
  return Object.assign({
    success: true,
    courseName: "数据结构",
    classroom: "仙溪教学楼C5-201",
    campus: "仙溪校区",
    startTime: "10:00",
    departureTime: "09:40",
    walkingBufferMinutes: 12,
    totalBufferMinutes: 20,
    preciseRouteAvailable: true,
  }, overrides);
}

function assertViolationShape(outcome) {
  assert.ok(Array.isArray(outcome.violations), "violations must be an array");
  outcome.violations.forEach((violation) => {
    assert.strictEqual(typeof violation.code, "string", "violation.code must be a string");
    assert.strictEqual(typeof violation.detail, "string", "violation.detail must be a string");
    assert.ok(
      Object.keys(violation).every((key) => ["code", "detail", "field"].includes(key)),
      "public violation must not leak internal keys (e.g. hard)"
    );
  });
}

// ---------------------------------------------------------------------------
// ① outputSchema：required 缺失 / 浅类型校验 / 齐全通过
// ---------------------------------------------------------------------------
function runGroup1OutputSchema() {
  const okResult = {
    success: true,
    courses: [{ courseName: "数据结构", classroom: "仙溪教学楼C5-201" }],
    courseCount: 1,
    nextCourse: { courseName: "数据结构" },
    date: "2026-07-28",
    currentWeek: 22,
  };
  const okOutcome = verify({ toolId: "get_today_courses", policy: TODAY_COURSES_POLICY, result: okResult });
  assert.strictEqual(okOutcome.status, "verified", "g1 well-formed result must be verified");
  assert.strictEqual(okOutcome.ok, true, "g1 verified outcome must be ok");
  assert.deepStrictEqual(okOutcome.violations, [], "g1 verified outcome must carry no violations");

  const missingRequired = verify({
    toolId: "get_today_courses",
    policy: TODAY_COURSES_POLICY,
    result: { success: true, courseCount: 0 },
  });
  assert.strictEqual(missingRequired.status, "failed", "g1 missing required field must fail even with allowPartial");
  assert.strictEqual(missingRequired.ok, false, "g1 missing required field must not be ok");
  assert.strictEqual(missingRequired.violations.length, 1, "g1 missing required must yield exactly one violation");
  assert.strictEqual(missingRequired.violations[0].code, "OUTPUT_REQUIRED_MISSING", "g1 missing required code");
  assert.strictEqual(missingRequired.violations[0].field, "courses", "g1 missing required field name");

  const mistypedRequired = verify({
    toolId: "get_today_courses",
    policy: TODAY_COURSES_POLICY,
    result: { success: true, courses: "not-an-array", courseCount: 1 },
  });
  assert.strictEqual(mistypedRequired.status, "failed", "g1 mistyped required field must be a hard failure");
  assert.strictEqual(mistypedRequired.violations[0].code, "OUTPUT_TYPE_MISMATCH", "g1 mistyped required code");
  assert.strictEqual(mistypedRequired.violations[0].field, "courses", "g1 mistyped required field name");

  // 可选字段类型不符只是软违规：allowPartial 下降级为 partial 而非 failed。
  const mistypedOptional = verify({
    toolId: "get_today_courses",
    policy: TODAY_COURSES_POLICY,
    result: { success: true, courses: [], courseCount: 0, currentWeek: "22" },
  });
  assert.strictEqual(mistypedOptional.status, "partial", "g1 mistyped optional field must degrade to partial");
  assert.strictEqual(mistypedOptional.ok, true, "g1 partial outcome must still be ok");
  assert.strictEqual(mistypedOptional.violations.length, 1, "g1 mistyped optional must yield exactly one violation");
  assert.strictEqual(mistypedOptional.violations[0].code, "OUTPUT_TYPE_MISMATCH", "g1 mistyped optional code");
  assert.strictEqual(mistypedOptional.violations[0].field, "currentWeek", "g1 mistyped optional field name");

  // time 类型浅校验：非法时间串 → OUTPUT_TYPE_MISMATCH（required 内，硬失败）。
  const badTime = verify({
    toolId: "get_course_route",
    policy: COURSE_ROUTE_POLICY,
    result: okRouteResult({ startTime: "25:00" }),
  });
  assert.strictEqual(badTime.status, "failed", "g1 malformed time on required field must fail");
  assert.ok(
    badTime.violations.some((violation) => violation.code === "OUTPUT_TYPE_MISMATCH" && violation.field === "startTime"),
    "g1 malformed time must raise OUTPUT_TYPE_MISMATCH on startTime"
  );

  [okOutcome, missingRequired, mistypedRequired, mistypedOptional, badTime].forEach(assertViolationShape);
}

// ---------------------------------------------------------------------------
// ② 四种后置条件谓词（红绿各至少一例）+ 不可解析谓词硬失败
// ---------------------------------------------------------------------------
function runGroup2Postconditions() {
  // fieldNonEmpty 绿：基础结果全字段合法。
  const green = verify({ toolId: "get_course_route", policy: COURSE_ROUTE_POLICY, result: okRouteResult() });
  assert.strictEqual(green.status, "verified", "g2 well-formed route result must be verified");
  assert.deepStrictEqual(green.violations, [], "g2 well-formed route result must carry no violations");

  // fieldNonEmpty 红：courseName 为空串。
  const nonEmptyRed = verify({
    toolId: "get_course_route",
    policy: COURSE_ROUTE_POLICY,
    result: okRouteResult({ courseName: "" }),
  });
  assert.strictEqual(nonEmptyRed.status, "partial", "g2 fieldNonEmpty soft violation must be partial under allowPartial");
  assert.strictEqual(nonEmptyRed.violations.length, 1, "g2 fieldNonEmpty red must yield exactly one violation");
  assert.strictEqual(nonEmptyRed.violations[0].code, "FIELD_NON_EMPTY_VIOLATION", "g2 fieldNonEmpty red code");
  assert.strictEqual(nonEmptyRed.violations[0].field, "courseName", "g2 fieldNonEmpty red field");

  // timeOrder 绿（含相等边界：departure == start 不算倒置）。
  const equalTime = verify({
    toolId: "get_course_route",
    policy: COURSE_ROUTE_POLICY,
    result: okRouteResult({ departureTime: "10:00", startTime: "10:00" }),
  });
  assert.strictEqual(equalTime.status, "verified", "g2 equal times must satisfy timeOrder");

  // timeOrder 红：出发时间晚于上课时间。
  const timeRed = verify({
    toolId: "get_course_route",
    policy: COURSE_ROUTE_POLICY,
    result: okRouteResult({ departureTime: "10:30" }),
  });
  assert.strictEqual(timeRed.violations.length, 1, "g2 timeOrder red must yield exactly one violation");
  assert.strictEqual(timeRed.violations[0].code, "TIME_ORDER_VIOLATION", "g2 timeOrder red code");
  assert.strictEqual(timeRed.violations[0].field, "departureTime", "g2 timeOrder red reports the earlier field");
  assert.strictEqual(timeRed.status, "partial", "g2 timeOrder soft violation must be partial under allowPartial");

  // numericRange 绿：基础结果 totalBufferMinutes=20 ∈ [5,180]（已由 green 覆盖）。
  // numericRange 红：越界。
  const rangeRed = verify({
    toolId: "get_course_route",
    policy: COURSE_ROUTE_POLICY,
    result: okRouteResult({ totalBufferMinutes: 200 }),
  });
  assert.strictEqual(rangeRed.violations.length, 1, "g2 numericRange red must yield exactly one violation");
  assert.strictEqual(rangeRed.violations[0].code, "NUMERIC_RANGE_VIOLATION", "g2 numericRange red code");
  assert.strictEqual(rangeRed.violations[0].field, "totalBufferMinutes", "g2 numericRange red field");

  // numericRange 红（非数值）：字符串同样违规。
  const rangeTypeRed = verify({
    toolId: "get_course_route",
    policy: COURSE_ROUTE_POLICY,
    result: okRouteResult({ totalBufferMinutes: "20" }),
  });
  assert.ok(
    rangeTypeRed.violations.some((violation) => violation.code === "NUMERIC_RANGE_VIOLATION"),
    "g2 numericRange must reject non-number values"
  );

  // fieldMatchesSlot 绿：result.campus 与 intent.slots.campus 一致。
  const slotGreen = verify({
    toolId: "search_empty_rooms",
    policy: EMPTY_ROOM_POLICY,
    result: { success: true, rooms: [{ room: "仙溪教学楼C5-201" }], campus: "仙溪校区" },
    intent: { slots: { campus: "仙溪校区" } },
  });
  assert.strictEqual(slotGreen.status, "verified", "g2 fieldMatchesSlot match must be verified");

  // fieldMatchesSlot 绿：slot 落在 constraints、且支持数组候选。
  const slotConstraintGreen = verify({
    toolId: "search_empty_rooms",
    policy: EMPTY_ROOM_POLICY,
    result: { success: true, rooms: [{ room: "江湾会堂101" }], campus: "江湾校区" },
    intent: { constraints: { campus: ["仙溪校区", "江湾校区"] } },
  });
  assert.strictEqual(slotConstraintGreen.status, "verified", "g2 fieldMatchesSlot must read constraints and array candidates");

  // fieldMatchesSlot 绿（vacuous）：intent 未约束该 slot 时谓词恒通过。
  const slotVacuous = verify({
    toolId: "search_empty_rooms",
    policy: EMPTY_ROOM_POLICY,
    result: { success: true, rooms: [], campus: "江湾校区" },
    intent: { slots: { building: "C5" } },
  });
  assert.strictEqual(slotVacuous.status, "verified", "g2 fieldMatchesSlot must be vacuous when the slot is absent");

  // fieldMatchesSlot 红：与 intent.slots.campus 不一致；detail 只含字段/约束名，不得泄漏原值（脱敏边界）。
  const slotRed = verify({
    toolId: "search_empty_rooms",
    policy: EMPTY_ROOM_POLICY,
    result: { success: true, rooms: [{ room: "江湾会堂101" }], campus: "江湾校区" },
    intent: { slots: { campus: "仙溪校区" } },
  });
  assert.strictEqual(slotRed.violations.length, 1, "g2 fieldMatchesSlot red must yield exactly one violation");
  assert.strictEqual(slotRed.violations[0].code, "FIELD_MATCHES_SLOT_VIOLATION", "g2 fieldMatchesSlot red code");
  assert.strictEqual(slotRed.violations[0].field, "campus", "g2 fieldMatchesSlot red field");
  assert.strictEqual(slotRed.status, "partial", "g2 fieldMatchesSlot soft violation must be partial under allowPartial");
  assert.ok(!slotRed.violations[0].detail.includes("江湾校区"), "g2 violation detail must not leak the result value");
  assert.ok(!slotRed.violations[0].detail.includes("仙溪校区"), "g2 violation detail must not leak the intent slot value");

  // 不可解析谓词：即使 allowPartial 也为硬失败（运行时出现 = 调用方绕过加载期校验）。
  const invalidPredicate = verify({
    toolId: "get_today_courses",
    policy: Object.assign({}, TODAY_COURSES_POLICY, { successPostconditions: ["numericRange:courseCount:20:0"] }),
    result: { success: true, courses: [], courseCount: 0 },
  });
  assert.strictEqual(invalidPredicate.status, "failed", "g2 unparseable postcondition must be a hard failure");
  assert.strictEqual(invalidPredicate.violations[0].code, "POSTCONDITION_INVALID", "g2 unparseable postcondition code");

  [green, nonEmptyRed, equalTime, timeRed, rangeRed, rangeTypeRed,
    slotGreen, slotConstraintGreen, slotVacuous, slotRed, invalidPredicate].forEach(assertViolationShape);
}

// ---------------------------------------------------------------------------
// ③ emptyResultPolicy 三模式 + goalContract 回退与优先级
// ---------------------------------------------------------------------------
function runGroup3EmptyResultPolicy() {
  // accept：空态码命中 → empty_accepted，跳过 schema/后置条件（required 缺失也不追究）。
  const accepted = verify({
    toolId: "get_today_courses",
    policy: TODAY_COURSES_POLICY,
    result: { success: true, code: "NO_COURSES" },
  });
  assert.strictEqual(accepted.status, "empty_accepted", "g3 accept mode must yield empty_accepted");
  assert.strictEqual(accepted.ok, true, "g3 empty_accepted must be ok");
  assert.deepStrictEqual(accepted.violations, [], "g3 empty_accepted must carry no violations");

  // 空态码匹配沿用 goalContract 的子串约定："NO_COURSES_TODAY" 命中声明的 "NO_COURSES"。
  const substring = verify({
    toolId: "get_today_courses",
    policy: TODAY_COURSES_POLICY,
    result: { success: true, code: "NO_COURSES_TODAY" },
  });
  assert.strictEqual(substring.status, "empty_accepted", "g3 empty-code matching must follow the substring convention");

  // 未命中空态码：走正常 schema 校验（required courses 缺失 → 硬失败）。
  const notMatched = verify({
    toolId: "get_today_courses",
    policy: TODAY_COURSES_POLICY,
    result: { success: true, code: "SOMETHING_ELSE" },
  });
  assert.strictEqual(notMatched.status, "failed", "g3 non-matching code must fall through to schema checks");
  assert.strictEqual(notMatched.violations[0].code, "OUTPUT_REQUIRED_MISSING", "g3 fall-through must run schema checks");

  // partial：空态降级为部分结果，violations 记 EMPTY_RESULT_PARTIAL 并附 note。
  const partial = verify({
    toolId: "get_campus_weather",
    policy: CAMPUS_WEATHER_POLICY,
    result: { success: true, code: "WEATHER_PROVIDER_FAILED" },
  });
  assert.strictEqual(partial.status, "partial", "g3 partial mode must yield partial");
  assert.strictEqual(partial.ok, true, "g3 partial empty must still be ok");
  assert.strictEqual(partial.violations.length, 1, "g3 partial empty must yield exactly one violation");
  assert.strictEqual(partial.violations[0].code, "EMPTY_RESULT_PARTIAL", "g3 partial empty code");
  assert.ok(
    partial.violations[0].detail.includes("天气不可用或使用过期数据只降级，不影响课表事实。"),
    "g3 partial empty detail must append the partialCompletionPolicy note"
  );

  // fail：空态被拒绝（manifest 暂无 mode "fail" 实例，按语法层支持的形态构造）。
  const rejected = verify({
    toolId: "get_today_courses",
    policy: { emptyResultPolicy: { mode: "fail", codes: ["NO_DATA"] } },
    result: { success: true, code: "NO_DATA" },
  });
  assert.strictEqual(rejected.status, "failed", "g3 fail mode must reject the empty result");
  assert.strictEqual(rejected.ok, false, "g3 rejected empty must not be ok");
  assert.strictEqual(rejected.violations[0].code, "EMPTY_RESULT_NOT_ACCEPTED", "g3 fail mode code");

  // goalContract 回退：工具未声明 emptyResultPolicy 时接受 contract 的 { acceptEmpty, emptyCodes }。
  const policyNoEmpty = Object.assign({}, TODAY_COURSES_POLICY);
  delete policyNoEmpty.emptyResultPolicy;
  const contractAccept = verify({
    toolId: "get_today_courses",
    policy: policyNoEmpty,
    result: { success: true, code: "NO_COURSES" },
    goalContract: { acceptEmpty: true, emptyCodes: ["NO_COURSES"] },
  });
  assert.strictEqual(contractAccept.status, "empty_accepted", "g3 goalContract acceptEmpty must yield empty_accepted");
  const contractFail = verify({
    toolId: "get_today_courses",
    policy: policyNoEmpty,
    result: { success: true, code: "NO_COURSES" },
    goalContract: { acceptEmpty: false, emptyCodes: ["NO_COURSES"] },
  });
  assert.strictEqual(contractFail.status, "failed", "g3 goalContract acceptEmpty=false must reject");
  assert.strictEqual(contractFail.violations[0].code, "EMPTY_RESULT_NOT_ACCEPTED", "g3 goalContract reject code");

  // 工具自己声明的 emptyResultPolicy 优先于 goalContract。
  const declaredWins = verify({
    toolId: "get_today_courses",
    policy: TODAY_COURSES_POLICY,
    result: { success: true, code: "NO_COURSES" },
    goalContract: { acceptEmpty: false, emptyCodes: ["NO_COURSES"] },
  });
  assert.strictEqual(declaredWins.status, "empty_accepted", "g3 declared emptyResultPolicy must win over goalContract");

  [accepted, substring, notMatched, partial, rejected, contractAccept, contractFail, declaredWins]
    .forEach(assertViolationShape);
}

// ---------------------------------------------------------------------------
// ④ partialCompletionPolicy：partial 状态与 violations 形态
// ---------------------------------------------------------------------------
function runGroup4PartialCompletion() {
  const twoSoft = { courseName: "", totalBufferMinutes: 200 };

  // 仅软违规 + allowPartial:true → partial / ok:true，violations 全量保留。
  const partial = verify({
    toolId: "get_course_route",
    policy: COURSE_ROUTE_POLICY,
    result: okRouteResult(twoSoft),
  });
  assert.strictEqual(partial.status, "partial", "g4 soft-only violations with allowPartial must be partial");
  assert.strictEqual(partial.ok, true, "g4 partial outcome must be ok");
  assert.deepStrictEqual(
    partial.violations.map((violation) => violation.code).sort(),
    ["FIELD_NON_EMPTY_VIOLATION", "NUMERIC_RANGE_VIOLATION"],
    "g4 partial outcome must keep every soft violation"
  );

  // 同样的软违规 + allowPartial:false → failed。
  const noAllow = verify({
    toolId: "get_course_route",
    policy: Object.assign({}, COURSE_ROUTE_POLICY, { partialCompletionPolicy: { allowPartial: false } }),
    result: okRouteResult(twoSoft),
  });
  assert.strictEqual(noAllow.status, "failed", "g4 soft violations without allowPartial must fail");
  assert.strictEqual(noAllow.ok, false, "g4 failed outcome must not be ok");

  // 同样的软违规 + 无 partialCompletionPolicy → failed。
  const noPolicy = Object.assign({}, COURSE_ROUTE_POLICY);
  delete noPolicy.partialCompletionPolicy;
  const absent = verify({ toolId: "get_course_route", policy: noPolicy, result: okRouteResult(twoSoft) });
  assert.strictEqual(absent.status, "failed", "g4 soft violations without partialCompletionPolicy must fail");

  // 硬违规（required 字段缺失）+ allowPartial:true → 仍 failed。
  const hard = verify({
    toolId: "get_course_route",
    policy: COURSE_ROUTE_POLICY,
    result: {
      success: true,
      startTime: "10:00",
      departureTime: "09:40",
      totalBufferMinutes: 20,
    },
  });
  assert.strictEqual(hard.status, "failed", "g4 hard violation must fail even with allowPartial");
  assert.strictEqual(hard.violations[0].code, "OUTPUT_REQUIRED_MISSING", "g4 hard violation code");
  assert.strictEqual(hard.violations[0].field, "courseName", "g4 hard violation field");

  [partial, noAllow, absent, hard].forEach(assertViolationShape);
}

// ---------------------------------------------------------------------------
// ⑤ evidencePolicy：fields / approximateFlags 透传与防御性拷贝
// ---------------------------------------------------------------------------
function runGroup5Evidence() {
  const outcome = verify({ toolId: "get_course_route", policy: COURSE_ROUTE_POLICY, result: okRouteResult() });
  assert.deepStrictEqual(
    outcome.evidence.fields,
    ["courseName", "classroom", "startTime", "departureTime", "locationEvidence", "actionUrl"],
    "g5 evidence.fields must echo the declared evidenceFields"
  );
  assert.deepStrictEqual(
    outcome.evidence.approximateFlags,
    [{ field: "walkingBufferMinutes", label: "APPROXIMATE_BUFFER_NOT_PRECISE_NAV" }],
    "g5 approximateFlags must surface { field, label }"
  );

  // 失败路径同样携带 evidence。
  const failed = verify({ toolId: "get_course_route", policy: COURSE_ROUTE_POLICY, result: { success: false } });
  assert.deepStrictEqual(failed.evidence.fields, outcome.evidence.fields, "g5 evidence must be present on failed outcomes");

  // 防御性拷贝：改写返回值不得影响策略对象。
  outcome.evidence.fields.push("mutated");
  outcome.evidence.approximateFlags[0].label = "MUTATED";
  assert.deepStrictEqual(
    COURSE_ROUTE_POLICY.evidencePolicy.evidenceFields,
    ["courseName", "classroom", "startTime", "departureTime", "locationEvidence", "actionUrl"],
    "g5 mutating returned evidence.fields must not touch the policy"
  );
  assert.strictEqual(
    COURSE_ROUTE_POLICY.evidencePolicy.approximateFlags[0].label,
    "APPROXIMATE_BUFFER_NOT_PRECISE_NAV",
    "g5 mutating returned approximateFlags must not touch the policy"
  );

  // 脏数据过滤：非字符串字段名、非对象 flag 一律剔除。
  const dirty = verify({
    toolId: "get_today_courses",
    policy: {
      evidencePolicy: {
        evidenceFields: ["courses", 42, null, "date"],
        approximateFlags: [{ field: "walkingBufferMinutes", label: "APPROXIMATE_BUFFER_NOT_PRECISE_NAV" }, "junk", null],
      },
    },
    result: { success: true },
  });
  assert.deepStrictEqual(dirty.evidence.fields, ["courses", "date"], "g5 non-string evidenceFields must be filtered out");
  assert.deepStrictEqual(
    dirty.evidence.approximateFlags,
    [{ field: "walkingBufferMinutes", label: "APPROXIMATE_BUFFER_NOT_PRECISE_NAV" }],
    "g5 non-object approximateFlags must be filtered out"
  );

  // 无 evidencePolicy → 空结构。
  const none = verify({ toolId: "get_today_courses", result: { success: true } });
  assert.deepStrictEqual(none.evidence, { fields: [], approximateFlags: [] }, "g5 missing evidencePolicy must yield empty evidence");
}

// ---------------------------------------------------------------------------
// ⑥ 兜底行为：无 policy / 非法输入 / result 缺失 / normalizePolicy 白名单
// ---------------------------------------------------------------------------
function runGroup6Fallback() {
  // 无任何输入：不抛异常，result 缺失 → 硬失败，toolId 兜底 "unknown"。
  const empty = verify();
  assert.strictEqual(empty.status, "failed", "g6 verify() without input must fail closed");
  assert.strictEqual(empty.ok, false, "g6 verify() without input must not be ok");
  assert.strictEqual(empty.violations[0].code, "TOOL_RESULT_FAILED", "g6 missing result code");
  assert.ok(empty.violations[0].detail.includes("unknown"), "g6 missing toolId must fall back to \"unknown\"");

  // 无 policy（undefined / null / 非对象）：合法结果默认宽松通过。
  [undefined, null, "junk", ["outputSchema"]].forEach((policy, index) => {
    const outcome = verify({ toolId: "get_today_courses", policy, result: { success: true, note: "ok" } });
    assert.strictEqual(outcome.status, "verified", `g6 no/invalid policy #${index} must default to verified`);
    assert.strictEqual(outcome.ok, true, `g6 no/invalid policy #${index} must be ok`);
    assert.deepStrictEqual(outcome.violations, [], `g6 no/invalid policy #${index} must carry no violations`);
    assert.deepStrictEqual(
      outcome.evidence,
      { fields: [], approximateFlags: [] },
      `g6 no/invalid policy #${index} must yield empty evidence`
    );
  });

  // success=false：即使其余字段齐全也直接硬失败，且不跑空态/schema 分支。
  const failed = verify({
    toolId: "get_course_route",
    policy: COURSE_ROUTE_POLICY,
    result: Object.assign(okRouteResult({ code: "NO_MATCHING_COURSE" }), { success: false }),
  });
  assert.strictEqual(failed.status, "failed", "g6 success=false must fail even when an accept code is present");
  assert.strictEqual(failed.violations.length, 1, "g6 success=false must short-circuit to a single violation");
  assert.strictEqual(failed.violations[0].code, "TOOL_RESULT_FAILED", "g6 success=false code");

  // result 不是对象：同样 TOOL_RESULT_FAILED，不抛异常。
  ["raw-string", 42, null, ["courses"]].forEach((result, index) => {
    const outcome = verify({ toolId: "get_today_courses", policy: TODAY_COURSES_POLICY, result });
    assert.strictEqual(outcome.status, "failed", `g6 non-object result #${index} must fail`);
    assert.strictEqual(outcome.violations[0].code, "TOOL_RESULT_FAILED", `g6 non-object result #${index} code`);
  });

  // 未声明空态策略也无 goalContract：空态码不触发 empty_accepted，照常跑 schema。
  const policyNoEmpty = Object.assign({}, TODAY_COURSES_POLICY);
  delete policyNoEmpty.emptyResultPolicy;
  const noEmptyPolicy = verify({
    toolId: "get_today_courses",
    policy: policyNoEmpty,
    result: { success: true, code: "NO_COURSES" },
  });
  assert.strictEqual(noEmptyPolicy.status, "failed", "g6 empty code without any empty policy must not be empty_accepted");
  assert.strictEqual(noEmptyPolicy.violations[0].code, "OUTPUT_REQUIRED_MISSING", "g6 empty code fall-through must run schema checks");

  // intent 非对象：按无意图处理（fieldMatchesSlot vacuous），不抛异常。
  const badIntent = verify({
    toolId: "search_empty_rooms",
    policy: EMPTY_ROOM_POLICY,
    result: { success: true, rooms: [], campus: "江湾校区" },
    intent: ["not-an-object"],
  });
  assert.strictEqual(badIntent.status, "verified", "g6 non-object intent must be treated as no intent");

  // normalizePolicy：只保留五个策略键，非对象输入归一为 {}，不改动源对象。
  const source = {
    outputSchema: { required: ["courses"] },
    successPostconditions: ["fieldNonEmpty:courses"],
    emptyResultPolicy: { mode: "accept", codes: ["NO_COURSES"] },
    partialCompletionPolicy: { allowPartial: true },
    evidencePolicy: { evidenceFields: ["courses"] },
    runtimeModes: ["public"],
    rogue: "not-a-policy-key",
  };
  const normalized = normalizePolicy(source);
  assert.deepStrictEqual(
    Object.keys(normalized).sort(),
    ["emptyResultPolicy", "evidencePolicy", "outputSchema", "partialCompletionPolicy", "successPostconditions"],
    "g6 normalizePolicy must keep exactly the five verification policy keys"
  );
  assert.strictEqual(normalized.rogue, undefined, "g6 normalizePolicy must drop unknown keys");
  assert.strictEqual(source.rogue, "not-a-policy-key", "g6 normalizePolicy must not mutate the source");
  [undefined, null, "junk", 42].forEach((input, index) => {
    assert.deepStrictEqual(normalizePolicy(input), {}, `g6 normalizePolicy non-object #${index} must normalize to {}`);
  });

  [empty, failed, noEmptyPolicy, badIntent].forEach(assertViolationShape);
}

// ---------------------------------------------------------------------------
// main：依次调用各断言组；后续里程碑续写时把新组追加到 GROUPS。
// ---------------------------------------------------------------------------
const GROUPS = [
  ["group1 outputSchema", runGroup1OutputSchema],
  ["group2 postcondition predicates", runGroup2Postconditions],
  ["group3 emptyResultPolicy modes", runGroup3EmptyResultPolicy],
  ["group4 partialCompletionPolicy", runGroup4PartialCompletion],
  ["group5 evidencePolicy", runGroup5Evidence],
  ["group6 fallback behavior", runGroup6Fallback],
];

function main() {
  let failures = 0;
  for (const [name, run] of GROUPS) {
    try {
      run();
      console.log(`  PASS ${name}`);
    } catch (error) {
      failures += 1;
      console.error(`  FAIL ${name}`);
      console.error((error && error.stack) || error);
    }
  }
  const passes = GROUPS.length - failures;
  console.log(`test-agent-verification: pass=${passes} fail=${failures}`);
  if (failures > 0) {
    console.error(`test-agent-verification: FAIL (${failures}/${GROUPS.length} groups failed)`);
    process.exitCode = 1;
    return;
  }
  console.log("test-agent-verification: PASS");
}

main();
