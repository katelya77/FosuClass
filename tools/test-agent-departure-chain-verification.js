#!/usr/bin/env node
/**
 * test-agent-departure-chain-verification.js — 出发链实体-时间-地点交叉核验专项（M2-T3）
 *
 * 被测对象：
 *   server/src/services/ai/verification/departureChainVerifier.js
 *     verifyDepartureChain({ toolResults, intent, goalContract }) →
 *       { status: "verified" | "partial" | "failed" | "skipped",
 *         ok: boolean,
 *         violations: [{ code, detail, field? }],
 *         approximateFlags: [{ field, label }] }
 *   server/src/services/ai/runtime/verificationCoordinator.js（verifyToolResults 的 M2-T3 追加接线）
 *
 * 链式目标：course_action_advice（"我下一节课在哪，什么时候该出发？"），
 * 课表侧工具 get_next_course / get_today_courses / get_tomorrow_courses +
 * 路线侧工具 get_course_route 同时在场且可用时才核验，否则 skipped 不误报。
 *
 * 覆盖断言组 ①—⑨：
 *   ① 目标门控与齐备性：非链式目标 / 单侧缺失 / needContext / 上游失败 /
 *      perTool empty_accepted 或 failed → skipped 且不误报
 *   ② 规则一 CHAIN_NEXT_COURSE_MISSING（硬，红绿）
 *   ③ 规则二 CHAIN_CLASSROOM_MISSING（软，红绿）
 *   ④ 规则三 CHAIN_START_TIME_MISMATCH（硬，红绿 + 时间不可解析时不误报）
 *   ⑤ 规则四 CHAIN_DESTINATION_MISMATCH（硬，红绿 + 楼栋代码/包含归一化绿例）
 *   ⑥ 规则五 CHAIN_DEPARTURE_NOT_EARLIER（软，红绿：相等与晚于均红）
 *   ⑦ 规则六 approximateFlags：通用缓冲必带中文"非精确导航"标注、不改变状态、防御性拷贝
 *   ⑧ 全绿链 + 课表侧选择（date 对齐优先、优先级回退、courses[0] 回退）+  violation 公共形态
 *   ⑨ coordinator 端到端：链式 goal + 两工具结果 → 事件与 outcome 正确（绿/红/软/skipped）
 *
 * 隔离纪律：纯 Node 无框架；不触网、不读 env、不读写文件、不依赖 server/storage 状态；
 * fixture 全部为虚构数据（合成楼名/合成课程名/2099 年日期），不含任何 Token/Key/Cookie/
 * OpenID/学号/密码形态字符串。
 */
const assert = require("assert");

const {
  CHAIN_GOAL_IDS,
  CHAIN_TOOL_LABEL,
  isDepartureChainGoal,
  verifyDepartureChain,
} = require("../server/src/services/ai/verification/departureChainVerifier");
const verificationCoordinator = require("../server/src/services/ai/runtime/verificationCoordinator");
const { deriveExecutionOutcome } = require("../server/src/services/ai/runtime/responseComposerBridge");

// ---------------------------------------------------------------------------
// Fixtures（虚构合成数据；形态参照 toolRegistry.getCourseRoute 真实输出）
// ---------------------------------------------------------------------------

const CHAIN_INTENT = { name: "course_action_advice", slots: {} };
const SENTINEL_COURSE = "合成哨兵课程D3C7";
const SENTINEL_CLASSROOM = "合成教学楼Q7-305";

function chainCourse(overrides = {}) {
  return Object.assign({
    courseName: SENTINEL_COURSE,
    teacherName: "合成教师",
    classroom: SENTINEL_CLASSROOM,
    weekday: 1,
    startSection: 3,
    endSection: 4,
    sectionText: "第3-4节",
    timeText: "10:00-11:40",
    status: "upcoming",
    campus: "合成校区",
  }, overrides);
}

function scheduleCall(toolId, overrides = {}) {
  const course = chainCourse(overrides.course || {});
  return {
    toolId,
    status: "success",
    result: Object.assign({
      success: true,
      needContext: false,
      date: "2099-10-19",
      currentWeek: 8,
      courses: [course],
      nextCourse: course,
      courseCount: 1,
    }, overrides.result || {}),
  };
}

function routeCall(overrides = {}) {
  return {
    toolId: "get_course_route",
    status: "success",
    result: Object.assign({
      success: true,
      courseName: SENTINEL_COURSE,
      classroom: SENTINEL_CLASSROOM,
      campus: "合成校区",
      date: "2099-10-19",
      startTime: "10:00",
      from: "合成宿舍",
      departureTime: "09:40",
      walkingBufferMinutes: 20,
      weatherBufferMinutes: 0,
      totalBufferMinutes: 20,
      preciseRouteAvailable: false,
    }, overrides),
  };
}

function greenInput(overrides = {}) {
  return Object.assign({
    toolResults: [scheduleCall("get_next_course"), routeCall()],
    intent: CHAIN_INTENT,
    goalContract: { goalId: "course_action_advice" },
  }, overrides);
}

function assertSkipped(outcome, label) {
  assert.strictEqual(outcome.status, "skipped", `${label}: must be skipped`);
  assert.strictEqual(outcome.ok, true, `${label}: skipped must be ok`);
  assert.deepStrictEqual(outcome.violations, [], `${label}: skipped must carry no violations`);
  assert.deepStrictEqual(outcome.approximateFlags, [], `${label}: skipped must carry no approximateFlags`);
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
// ① 目标门控与齐备性：不齐备一律 skipped，不误报
// ---------------------------------------------------------------------------
function runGroup1Gating() {
  // 非链式目标：即使两侧结果齐备也不核验。
  assertSkipped(verifyDepartureChain(greenInput({ intent: { name: "get_today_courses", slots: {} }, goalContract: null })), "g1 non-chain intent");
  assertSkipped(verifyDepartureChain(greenInput({
    intent: { name: "next_course_location", slots: {} },
    goalContract: { goalId: "next_course_location" },
  })), "g1 non-chain goalId");

  // 目标识别的三种等价来源：V2 goalId / legacy goal / intent.name。
  assert.strictEqual(isDepartureChainGoal(CHAIN_INTENT, { goalId: "course_action_advice" }), true, "g1 V2 goalId must be detected");
  assert.strictEqual(isDepartureChainGoal(CHAIN_INTENT, { goal: "course_action_advice" }), true, "g1 legacy goal must be detected");
  assert.strictEqual(isDepartureChainGoal(CHAIN_INTENT, null), true, "g1 intent.name alone must be detected");
  assert.strictEqual(isDepartureChainGoal({ name: "get_next_course" }, null), false, "g1 non-chain intent must not be detected");
  assert.deepStrictEqual(CHAIN_GOAL_IDS, ["course_action_advice"], "g1 chain goal id set must stay minimal");

  // 单侧缺失：只有课表侧 / 只有路线侧。
  assertSkipped(verifyDepartureChain(greenInput({ toolResults: [scheduleCall("get_next_course")] })), "g1 schedule-only");
  assertSkipped(verifyDepartureChain(greenInput({ toolResults: [routeCall()] })), "g1 route-only");

  // 路线侧合法空态（needContext）：工具已声明，链层不得补刀。
  assertSkipped(verifyDepartureChain(greenInput({
    toolResults: [scheduleCall("get_next_course"), routeCall({ needContext: true, courses: [], courseCount: 0 })],
  })), "g1 route needContext");

  // 路线侧上游失败 / success=false：kernel 已裁定，链层不重复惩罚。
  assertSkipped(verifyDepartureChain(greenInput({
    toolResults: [scheduleCall("get_next_course"), Object.assign(routeCall({ success: false, code: "NO_MATCHING_COURSE" }), { status: "failed" })],
  })), "g1 route upstream failed");
  assertSkipped(verifyDepartureChain(greenInput({
    toolResults: [scheduleCall("get_next_course"), routeCall({ success: false, code: "NO_MATCHING_COURSE" })],
  })), "g1 route success=false");

  // perTool 状态门控：empty_accepted（合法空态）与 failed（已被逐工具层判负）不参与链核验。
  const withPerTool = (perToolStatus) => greenInput({
    toolResults: [Object.assign(scheduleCall("get_next_course"), { perToolStatus }), routeCall()],
  });
  assertSkipped(verifyDepartureChain(withPerTool("empty_accepted")), "g1 schedule empty_accepted");
  assertSkipped(verifyDepartureChain(withPerTool("failed")), "g1 schedule perTool failed");
  assertSkipped(verifyDepartureChain(withPerTool("skipped")), "g1 schedule perTool skipped");

  // 脏输入：不抛异常，一律 skipped。
  assertSkipped(verifyDepartureChain(), "g1 empty input");
  assertSkipped(verifyDepartureChain(greenInput({ toolResults: "junk" })), "g1 non-array toolResults");
  assertSkipped(verifyDepartureChain(greenInput({ toolResults: [null, 42, "junk", {}] })), "g1 junk tool results");
}

// ---------------------------------------------------------------------------
// ② 规则一 CHAIN_NEXT_COURSE_MISSING（硬）
// ---------------------------------------------------------------------------
function runGroup2NextCourse() {
  // 红：课表侧成功但没有任何下一节课，路线侧却给出了出发建议 → 链自相矛盾。
  const red = verifyDepartureChain(greenInput({
    toolResults: [
      scheduleCall("get_next_course", { result: { nextCourse: null, courses: [], courseCount: 0 } }),
      routeCall(),
    ],
  }));
  assert.strictEqual(red.status, "failed", "g2 missing next course must fail the chain");
  assert.strictEqual(red.ok, false, "g2 missing next course must not be ok");
  assert.strictEqual(red.violations.length, 1, "g2 must yield exactly one violation");
  assert.strictEqual(red.violations[0].code, "CHAIN_NEXT_COURSE_MISSING", "g2 red code");
  assert.strictEqual(red.violations[0].field, "nextCourse", "g2 red field");
  assert.strictEqual(red.approximateFlags.length, 1, "g2 advisory flag must survive the early return");

  // 绿：nextCourse 存在（全绿链在 ⑧ 组系统覆盖，此处验证本规则不发报）。
  const green = verifyDepartureChain(greenInput());
  assert.ok(!green.violations.some((violation) => violation.code === "CHAIN_NEXT_COURSE_MISSING"), "g2 green must not fire rule one");

  [red, green].forEach(assertViolationShape);
}

// ---------------------------------------------------------------------------
// ③ 规则二 CHAIN_CLASSROOM_MISSING（软）
// ---------------------------------------------------------------------------
function runGroup3Classroom() {
  // 红：课程教室为空 → "在哪"无法回答；软违规降级 partial 而非 failed。
  const red = verifyDepartureChain(greenInput({
    toolResults: [scheduleCall("get_next_course", { course: { classroom: "", roomName: "" } }), routeCall({ classroom: "" })],
  }));
  assert.strictEqual(red.status, "partial", "g3 empty classroom must be a soft violation (partial)");
  assert.strictEqual(red.ok, true, "g3 partial outcome must still be ok");
  assert.strictEqual(red.violations.length, 1, "g3 must yield exactly one violation");
  assert.strictEqual(red.violations[0].code, "CHAIN_CLASSROOM_MISSING", "g3 red code");
  assert.strictEqual(red.violations[0].field, "classroom", "g3 red field");

  // 绿：教室非空（⑧ 组全绿链覆盖）。
  const green = verifyDepartureChain(greenInput());
  assert.ok(!green.violations.some((violation) => violation.code === "CHAIN_CLASSROOM_MISSING"), "g3 green must not fire rule two");

  [red, green].forEach(assertViolationShape);
}

// ---------------------------------------------------------------------------
// ④ 规则三 CHAIN_START_TIME_MISMATCH（硬）
// ---------------------------------------------------------------------------
function runGroup4StartTime() {
  // 红：课表课程 14:00 上课，路线却按 10:00 计算 → 时间链断裂（硬失败）。
  const red = verifyDepartureChain(greenInput({
    toolResults: [
      scheduleCall("get_next_course", { course: { timeText: "14:00-15:40" } }),
      routeCall({ startTime: "10:00", departureTime: "09:40" }),
    ],
  }));
  assert.strictEqual(red.status, "failed", "g4 start time mismatch must fail the chain");
  assert.strictEqual(red.violations.length, 1, "g4 must yield exactly one violation");
  assert.strictEqual(red.violations[0].code, "CHAIN_START_TIME_MISMATCH", "g4 red code");
  assert.strictEqual(red.violations[0].field, "startTime", "g4 red field");

  // 绿：timeText 首时间与路线 startTime 一致（10:00-11:40 ~ 10:00，⑧ 组覆盖）。
  const green = verifyDepartureChain(greenInput());
  assert.ok(!green.violations.some((violation) => violation.code === "CHAIN_START_TIME_MISMATCH"), "g4 green must not fire rule three");

  // 不误报：课程侧时间不可解析时本规则不评估（缺时间由逐工具层负责），其余全绿 → verified。
  const noTime = verifyDepartureChain(greenInput({
    toolResults: [scheduleCall("get_next_course", { course: { timeText: "", startSection: 0, endSection: 0 } }), routeCall()],
  }));
  assert.strictEqual(noTime.status, "verified", "g4 unparseable course time must not fabricate a mismatch");

  [red, green, noTime].forEach(assertViolationShape);
}

// ---------------------------------------------------------------------------
// ⑤ 规则四 CHAIN_DESTINATION_MISMATCH（硬）+ 地点归一化绿例
// ---------------------------------------------------------------------------
function runGroup5Destination() {
  // 红：路线终点与课程教室完全不同。
  const red = verifyDepartureChain(greenInput({
    toolResults: [scheduleCall("get_next_course"), routeCall({ classroom: "合成西区会堂W2-101" })],
  }));
  assert.strictEqual(red.status, "failed", "g5 destination mismatch must fail the chain");
  assert.strictEqual(red.violations.length, 1, "g5 must yield exactly one violation");
  assert.strictEqual(red.violations[0].code, "CHAIN_DESTINATION_MISMATCH", "g5 red code");
  assert.strictEqual(red.violations[0].field, "classroom", "g5 red field");

  // 红：课程有教室而路线侧终点缺失，同样无法闭环。
  const missing = verifyDepartureChain(greenInput({
    toolResults: [scheduleCall("get_next_course"), routeCall({ classroom: "" })],
  }));
  assert.strictEqual(missing.status, "failed", "g5 missing route destination must fail the chain");
  assert.strictEqual(missing.violations[0].code, "CHAIN_DESTINATION_MISMATCH", "g5 missing destination code");

  // 绿：完全一致（⑧ 组覆盖）。
  const green = verifyDepartureChain(greenInput());
  assert.ok(!green.violations.some((violation) => violation.code === "CHAIN_DESTINATION_MISMATCH"), "g5 exact match must not fire rule four");

  // 绿：楼栋代码归一化——"Q7-305" 与 "合成教学楼Q7-305" 同楼（extractBuildingCode 惯例）。
  const alias = verifyDepartureChain(greenInput({
    toolResults: [
      scheduleCall("get_next_course", { course: { classroom: "Q7-305" } }),
      routeCall({ classroom: SENTINEL_CLASSROOM }),
    ],
  }));
  assert.ok(!alias.violations.some((violation) => violation.code === "CHAIN_DESTINATION_MISMATCH"), "g5 building-code alias must be tolerated");

  // 绿：包含关系归一化——"东座" 落在 "合成图书馆东座" 内。
  const contained = verifyDepartureChain(greenInput({
    toolResults: [
      scheduleCall("get_next_course", { course: { classroom: "合成图书馆东座" } }),
      routeCall({ classroom: "东座" }),
    ],
  }));
  assert.ok(!contained.violations.some((violation) => violation.code === "CHAIN_DESTINATION_MISMATCH"), "g5 containment alias must be tolerated");

  [red, missing, green, alias, contained].forEach(assertViolationShape);
}

// ---------------------------------------------------------------------------
// ⑥ 规则五 CHAIN_DEPARTURE_NOT_EARLIER（软）
// ---------------------------------------------------------------------------
function runGroup6DepartureOrder() {
  // 红（相等）：出发时间等于上课时间，零步行缓冲；逐工具 timeOrder 容忍相等，链层软违规收紧。
  const equal = verifyDepartureChain(greenInput({
    toolResults: [scheduleCall("get_next_course"), routeCall({ departureTime: "10:00" })],
  }));
  assert.strictEqual(equal.status, "partial", "g6 equal departure must be a soft violation (partial)");
  assert.strictEqual(equal.violations.length, 1, "g6 equal case must yield exactly one violation");
  assert.strictEqual(equal.violations[0].code, "CHAIN_DEPARTURE_NOT_EARLIER", "g6 equal case code");
  assert.strictEqual(equal.violations[0].field, "departureTime", "g6 equal case field");

  // 红（晚于）：出发晚于上课。
  const late = verifyDepartureChain(greenInput({
    toolResults: [scheduleCall("get_next_course"), routeCall({ departureTime: "10:30" })],
  }));
  assert.strictEqual(late.status, "partial", "g6 late departure must be a soft violation (partial)");
  assert.strictEqual(late.violations[0].code, "CHAIN_DEPARTURE_NOT_EARLIER", "g6 late case code");

  // 绿：严格早于（⑧ 组全绿链覆盖）。
  const green = verifyDepartureChain(greenInput());
  assert.ok(!green.violations.some((violation) => violation.code === "CHAIN_DEPARTURE_NOT_EARLIER"), "g6 earlier departure must not fire rule five");

  [equal, late, green].forEach(assertViolationShape);
}

// ---------------------------------------------------------------------------
// ⑦ 规则六 approximateFlags：通用缓冲必须标注"非精确导航"，且不影响状态
// ---------------------------------------------------------------------------
function runGroup7ApproximateFlags() {
  // preciseRouteAvailable:false → 必带中文标注；状态仍为 verified。
  const flagged = verifyDepartureChain(greenInput());
  assert.strictEqual(flagged.status, "verified", "g7 advisory flag must not change a green status");
  assert.strictEqual(flagged.approximateFlags.length, 1, "g7 generic-buffer route must carry exactly one flag");
  assert.strictEqual(flagged.approximateFlags[0].field, "departureTime", "g7 flag must point at departureTime");
  assert.ok(flagged.approximateFlags[0].label.includes("非精确导航"), "g7 flag label must carry the Chinese 非精确导航 wording");

  // preciseRouteAvailable 缺省同样视为非精确导航。
  const absent = verifyDepartureChain(greenInput({
    toolResults: [scheduleCall("get_next_course"), routeCall({ preciseRouteAvailable: undefined })],
  }));
  assert.strictEqual(absent.approximateFlags.length, 1, "g7 missing preciseRouteAvailable must still be flagged");

  // 精确导航可用 → 不插旗。
  const precise = verifyDepartureChain(greenInput({
    toolResults: [scheduleCall("get_next_course"), routeCall({ preciseRouteAvailable: true })],
  }));
  assert.deepStrictEqual(precise.approximateFlags, [], "g7 precise navigation must not be flagged");
  assert.strictEqual(precise.status, "verified", "g7 precise green chain must be verified");

  // 防御性拷贝：改写返回值不影响后续调用，也不触碰输入。
  flagged.approximateFlags[0].label = "MUTATED";
  const fresh = verifyDepartureChain(greenInput());
  assert.ok(fresh.approximateFlags[0].label.includes("非精确导航"), "g7 mutating returned flags must not leak into later calls");

  const inputSnapshot = greenInput();
  const before = JSON.stringify(inputSnapshot);
  verifyDepartureChain(inputSnapshot);
  assert.strictEqual(JSON.stringify(inputSnapshot), before, "g7 verifyDepartureChain must not mutate its input");
}

// ---------------------------------------------------------------------------
// ⑧ 全绿链 + 课表侧选择优先级 + violation 公共形态（脱敏边界）
// ---------------------------------------------------------------------------
function runGroup8GreenChain() {
  // 全绿：verified / ok / 无 violations / 通用缓冲旗一面。
  const green = verifyDepartureChain(greenInput());
  assert.strictEqual(green.status, "verified", "g8 well-formed chain must be verified");
  assert.strictEqual(green.ok, true, "g8 verified chain must be ok");
  assert.deepStrictEqual(green.violations, [], "g8 verified chain must carry no violations");
  assert.strictEqual(green.approximateFlags.length, 1, "g8 green chain keeps the advisory flag");

  // 课表侧 date 对齐优先：今日课（14:00）与明日课（10:00）同时在场，
  // 路线 date=2099-10-20 必须对齐明日课表结果；选错侧会误报时间不一致。
  const tomorrowCourse = chainCourse({ timeText: "10:00-11:40" });
  const todayCourse = chainCourse({ courseName: "合成干扰课程K2M5", timeText: "14:00-15:40" });
  const dated = verifyDepartureChain(greenInput({
    toolResults: [
      scheduleCall("get_today_courses", { course: todayCourse, result: { date: "2099-10-19" } }),
      scheduleCall("get_tomorrow_courses", { course: tomorrowCourse, result: { date: "2099-10-20" } }),
      routeCall({ date: "2099-10-20", startTime: "10:00", departureTime: "09:40" }),
    ],
  }));
  assert.strictEqual(dated.status, "verified", "g8 schedule side must be picked by route date alignment");

  // 优先级回退：路线无 date 时按 get_next_course > get_today_courses > get_tomorrow_courses。
  const priority = verifyDepartureChain(greenInput({
    toolResults: [
      scheduleCall("get_tomorrow_courses", { course: { timeText: "14:00-15:40" }, result: { date: "2099-10-20" } }),
      scheduleCall("get_next_course", { result: { date: "" } }),
      routeCall({ date: "", startTime: "10:00", departureTime: "09:40" }),
    ],
  }));
  assert.strictEqual(priority.status, "verified", "g8 schedule side must fall back to tool priority order");

  // 目标课程回退：nextCourse 缺省时取 courses[0]（与 getCourseRoute 真实选择一致）。
  const firstCourse = chainCourse();
  const fallback = verifyDepartureChain(greenInput({
    toolResults: [
      scheduleCall("get_today_courses", { result: { nextCourse: null, courses: [firstCourse], courseCount: 1 } }),
      routeCall(),
    ],
  }));
  assert.strictEqual(fallback.status, "verified", "g8 courses[0] fallback must keep the chain verifiable");

  // violation 公共形态：只允许 code/detail/field，detail 不得携带原始课名/教室/时间值（脱敏边界）。
  const red = verifyDepartureChain(greenInput({
    toolResults: [scheduleCall("get_next_course"), routeCall({ classroom: "合成西区会堂W2-101", startTime: "08:00", departureTime: "07:40" })],
  }));
  assertViolationShape(red);
  const details = red.violations.map((violation) => violation.detail).join("\n");
  assert.ok(!details.includes(SENTINEL_COURSE), "g8 violation detail must not leak the course name");
  assert.ok(!details.includes(SENTINEL_CLASSROOM), "g8 violation detail must not leak the course classroom");
  assert.ok(!details.includes("合成西区会堂W2-101"), "g8 violation detail must not leak the route destination");
  assert.ok(!/10:00|08:00|07:40/.test(details), "g8 violation detail must not leak raw time values");
}

// ---------------------------------------------------------------------------
// ⑨ coordinator 端到端：链式 goal + 两工具结果 → 事件与 outcome 正确
// ---------------------------------------------------------------------------
function toExecution(toolCalls, overrides = {}) {
  return Object.assign({
    runtimeMode: "public",
    intent: CHAIN_INTENT,
    goalContract: { goalId: "course_action_advice" },
    toolCalls: toolCalls.map((call) => ({ name: call.toolId, status: call.status, summary: "synthetic chain fixture", result: call.result })),
    verification: { ok: true, errors: [], evidenceComplete: true },
  }, overrides);
}

function runGroup9Coordinator() {
  const events = [];
  const emit = { onEvent: (event) => events.push(event) };

  // 绿：链核验通过，chain/evidence 透出，终态 completed。
  const greenExecution = toExecution([scheduleCall("get_next_course"), routeCall()]);
  const greenSummary = verificationCoordinator.verifyToolResults(greenExecution, greenExecution.intent, greenExecution.goalContract, {
    eventInput: emit,
    runtimeMode: "public",
  });
  assert.strictEqual(greenSummary.status, "verified", "g9 green chain aggregate must be verified");
  assert.ok(greenSummary.chain, "g9 summary must carry the chain verdict");
  assert.strictEqual(greenSummary.chain.status, "verified", "g9 chain verdict must be verified");
  assert.strictEqual(greenSummary.chain.approximateFlags.length, 1, "g9 chain verdict must surface the advisory flag");
  assert.deepStrictEqual(
    greenSummary.evidence && greenSummary.evidence.approximateFlags,
    greenSummary.chain.approximateFlags,
    "g9 approximateFlags must surface into summary evidence"
  );
  const greenCompleted = events.find((event) => event.type === "verification.completed");
  assert.ok(events.some((event) => event.type === "verification.started"), "g9 verification.started must be emitted");
  assert.ok(greenCompleted, "g9 verification.completed must be emitted");
  assert.strictEqual(greenCompleted.status, "verified", "g9 completed event must reflect the chain verdict");
  assert.strictEqual(greenCompleted.violationCount, 0, "g9 green completed event must carry zero violations");
  const greenOutcome = deriveExecutionOutcome({ execution: greenExecution });
  assert.strictEqual(greenOutcome.status, "completed", "g9 green chain must keep the completed outcome");
  assert.strictEqual(greenOutcome.verificationOk, true, "g9 green outcome verification must be ok");

  // 红：路线终点与课程地点矛盾 → 聚合 failed，kernel errors 追加 departure_chain。
  events.length = 0;
  const redExecution = toExecution([scheduleCall("get_next_course"), routeCall({ classroom: "合成西区会堂W2-101" })]);
  const redSummary = verificationCoordinator.verifyToolResults(redExecution, redExecution.intent, redExecution.goalContract, {
    eventInput: emit,
    runtimeMode: "public",
  });
  assert.strictEqual(redSummary.status, "failed", "g9 chain contradiction must fail the aggregate");
  assert.strictEqual(redSummary.chain.status, "failed", "g9 chain verdict must be failed");
  assert.ok(
    redSummary.violations.some((violation) => violation.tool === CHAIN_TOOL_LABEL && violation.code === "CHAIN_DESTINATION_MISMATCH"),
    "g9 chain violation must fold into the aggregate violations with tool departure_chain"
  );
  assert.strictEqual(redExecution.verification.ok, false, "g9 chain failure must fold into execution.verification.ok");
  assert.ok(
    redExecution.verification.errors.some((item) => item.code === "TOOL_RESULT_VERIFICATION_FAILED" && item.tool === CHAIN_TOOL_LABEL),
    "g9 chain failure must append TOOL_RESULT_VERIFICATION_FAILED for departure_chain"
  );
  const redCompleted = events.find((event) => event.type === "verification.completed");
  assert.strictEqual(redCompleted.status, "failed", "g9 completed event must reflect the chain failure");
  assert.ok(redCompleted.violationCount >= 1, "g9 completed event must count chain violations");
  assert.ok(!("tool" in redCompleted), "g9 completed event tool field stays reserved for real tool ids");
  const redOutcome = deriveExecutionOutcome({ execution: redExecution });
  assert.strictEqual(redOutcome.status, "failed", "g9 chain failure must drive deriveExecutionOutcome to failed");
  assert.strictEqual(redOutcome.eventType, "run.failed", "g9 chain failure must surface the run.failed terminal event");
  assert.ok(
    !JSON.stringify(events).includes(SENTINEL_COURSE) && !JSON.stringify(events).includes(SENTINEL_CLASSROOM),
    "g9 verification events must never carry raw schedule data"
  );

  // 软：出发时间等于上课时间 → 聚合 partial，终态 run.degraded。
  events.length = 0;
  const partialExecution = toExecution([scheduleCall("get_next_course"), routeCall({ departureTime: "10:00" })]);
  const partialSummary = verificationCoordinator.verifyToolResults(partialExecution, partialExecution.intent, partialExecution.goalContract, {
    eventInput: emit,
    runtimeMode: "public",
  });
  assert.strictEqual(partialSummary.status, "partial", "g9 soft chain violation must degrade the aggregate to partial");
  assert.strictEqual(partialSummary.chain.status, "partial", "g9 chain verdict must be partial");
  assert.strictEqual(partialExecution.partialCompletion, true, "g9 partial chain must fold into execution.partialCompletion");
  const partialOutcome = deriveExecutionOutcome({ execution: partialExecution });
  assert.strictEqual(partialOutcome.status, "partial", "g9 partial chain must drive deriveExecutionOutcome to partial");
  assert.strictEqual(partialOutcome.eventType, "run.degraded", "g9 partial chain must surface the run.degraded terminal event");

  // skipped：路线侧合法空态（needContext）→ 链不核验、summary 不带 chain/evidence、不误报。
  events.length = 0;
  const skippedExecution = toExecution([
    scheduleCall("get_next_course", { result: { needContext: true, nextCourse: null, courses: [], courseCount: 0 } }),
    routeCall({ needContext: true }),
  ]);
  const skippedSummary = verificationCoordinator.verifyToolResults(skippedExecution, skippedExecution.intent, skippedExecution.goalContract, {
    eventInput: emit,
    runtimeMode: "public",
  });
  assert.strictEqual(skippedSummary.status, "verified", "g9 legal-empty chain sides must not fail the aggregate");
  assert.strictEqual(skippedSummary.chain, undefined, "g9 skipped chain must not attach a chain verdict");
  assert.strictEqual(skippedSummary.evidence, undefined, "g9 skipped chain must not attach evidence");
  const skippedOutcome = deriveExecutionOutcome({ execution: skippedExecution });
  assert.strictEqual(skippedOutcome.status, "completed", "g9 skipped chain must keep the completed outcome");
}

// ---------------------------------------------------------------------------
// main：依次调用各断言组；后续里程碑续写时把新组追加到 GROUPS。
// ---------------------------------------------------------------------------
const GROUPS = [
  ["group1 goal gating & completeness (skipped)", runGroup1Gating],
  ["group2 rule1 CHAIN_NEXT_COURSE_MISSING", runGroup2NextCourse],
  ["group3 rule2 CHAIN_CLASSROOM_MISSING", runGroup3Classroom],
  ["group4 rule3 CHAIN_START_TIME_MISMATCH", runGroup4StartTime],
  ["group5 rule4 CHAIN_DESTINATION_MISMATCH", runGroup5Destination],
  ["group6 rule5 CHAIN_DEPARTURE_NOT_EARLIER", runGroup6DepartureOrder],
  ["group7 rule6 approximateFlags", runGroup7ApproximateFlags],
  ["group8 green chain & schedule selection", runGroup8GreenChain],
  ["group9 coordinator end-to-end", runGroup9Coordinator],
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
  console.log(`test-agent-departure-chain-verification: pass=${passes} fail=${failures}`);
  if (failures > 0) {
    console.error(`test-agent-departure-chain-verification: FAIL (${failures}/${GROUPS.length} groups failed)`);
    process.exitCode = 1;
    return;
  }
  console.log("test-agent-departure-chain-verification: PASS");
}

main();
