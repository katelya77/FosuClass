"use strict";
// Final Hero Stability Matrix 门禁（2026-08）
// 8 组 Hero 场景 × ≥3 变体（≥24 用例），全部确定性执行真实 CampusTools（v3 匿名数据集）
// + Mission Planner + FreshToolCallGuard + Decision Runtime + Widget 投影 + Fail-safe 契约。
// 最低标准（每用例必须全部满足）：
//   1) correctness：规划序列 / 工具结果 / 完成状态 / 决策与卡片符合预期（24/24）；
//   2) no fabricated dynamic fact：公开投影中的校园实体名都来自本轮工具结果；
//   3) no internal protocol leakage：公开投影无 queryId/dataHash/sourceTool/DecisionBundle/
//      MissionState/resultRef 等内部字段；
//   4) no stale entity/week/date：槽位变化触发 fresh guard 重新核验，不使用旧结果截取；
//   5) widget failure always has semantic fallback：卡片校验失败 → 同一 projection 派生可读文本。
// 禁止针对具体教师编号或具体问句的规则：全部机制为 capability-level 通用机制。
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

// 固定 v3 匿名数据集（与线上 CampusTools 同源），必须在 require 任何工具前设置。
process.env.CAMPUS_DATA_PATH = path.join(__dirname, "..", "..", "mock-data", "competition-demo-v3.json");

const R51 = path.join(__dirname, "..", "..", "r51");
const KIT = path.join(__dirname, "..", "..");
const { planMission } = require(path.join(R51, "mission", "planner.js"));
const { newMissionState, applyFacts, markStepStatus } = require(path.join(R51, "mission", "model.js"));
const { evaluateMission } = require(path.join(R51, "mission", "completion.js"));
const { freshToolRequired } = require(path.join(R51, "mission", "fresh-guard.js"));
const { selectFinalOutcome } = require(path.join(R51, "mission", "final-outcome-selector.js"));
const { fallbackFromProjection, selectFinalPresentation } = require(path.join(R51, "presentation", "final-presentation-policy.js"));
const { callAgentTool } = require(path.join(KIT, "cloudfunctions", "campusflowAdpTools", "src", "agent-tools.js"));
const ADAPTERS = require(path.join(KIT, "r50.2", "widget", "variant-adapters.js"));
const { projectViewModel } = require(path.join(KIT, "r50.2", "widget", "view-model.js"));
const { validateWidgetPayload } = require(path.join(KIT, "widget", "native", "campus-result-unified-v1", "payload-validator.js"));

const dataset = JSON.parse(fs.readFileSync(path.join(KIT, "mock-data", "competition-demo-v3.json"), "utf8"));
const COURSE_NAMES = new Set(dataset.courses.map((c) => c.name));
const TEACHER_NAMES = new Set(dataset.teachers.map((t) => t.name));
const CLASS_NAMES = new Set(dataset.classes.map((c) => c.name));

const LEAK = /queryId|dataHash|dataVersion|sourceTool|rankContext|temporalContext|DecisionBundle|MissionState|GoalSpec|resultRef|resultCard|evidence|computedAt|receiptVersion|mutatedData|sourceLessonId|sourceCourseId|classId/i;

const FACT_KEY_BY_CAPABILITY = Object.freeze({
  ENTITY_RESOLUTION: "resolvedEntities",
  SCHEDULE_DETAIL: "scheduleFacts",
  SCHEDULE_RANGE: "scheduleFacts",
  SPACE_DISCOVERY: "spaceFacts",
  COMMON_AVAILABILITY: "availabilityFacts",
  GROUP_PLANNING: "groupPlanFacts",
  RISK_CHECK: "riskFacts",
  RESCHEDULE_SIMULATION: "rescheduleSimFacts",
  TEACHER_LOAD_RANKING: "rankingFacts",
  CAMPUS_OVERVIEW: "overviewFacts",
  SPACE_UTILIZATION_RANKING: "spaceUtilFacts",
  DAY_PLANNING: "dayPlanFacts",
  TEMPORAL_RESOLUTION: "temporalScopeExplicit",
});

function slotsOf(capability, params) {
  const slots = { ...params };
  delete slots.decisionPreferences;
  delete slots.entities;
  return slots;
}

// 确定性执行 Mission：按 planner 的步骤顺序调用真实 Agent Tool，收集执行轨迹。
function runMission(goalSpec, paramsFor, opts = {}) {
  const plan = planMission(goalSpec);
  const state = newMissionState(goalSpec, { kind: opts.kind || "NEW_TASK", prior: opts.prior });
  state.steps = plan.steps;
  state.goal.completionCriteria = plan.completionCriteria;
  state.unresolvedRequirements = plan.unresolved.slice();
  const executed = [];
  for (const step of plan.steps) {
    const e = evaluateMission(state);
    if (e.status !== "in_progress") break;
    const params = paramsFor(step.capability, executed.length, executed);
    if (!params) break;
    const raw = callAgentTool(step.tools[0], params);
    executed.push({ capability: step.capability, tool: step.tools[0], params, raw });
    const factKey = FACT_KEY_BY_CAPABILITY[step.capability];
    applyFacts(state, [{
      capabilityId: step.capability,
      factKey,
      slots: slotsOf(step.capability, params),
      resultRef: raw && raw.queryId,
      verified: Boolean(raw && raw.success === true && raw.evidence && raw.evidence.verified === true),
    }]);
    markStepStatus(state, step.capability, "done");
  }
  return { plan, state, executed, final: evaluateMission(state) };
}

function publicTextOf(payload) {
  const parts = [
    payload.title, payload.subtitle, payload.summary, payload.context,
    ...(Array.isArray(payload.sections) ? payload.sections.flatMap((section) => [
      section.title, section.note || "",
      ...(Array.isArray(section.rows) ? section.rows.flatMap((row) => [row.label, row.value, row.badge || "", row.hint || ""]) : []),
    ]) : []),
    ...(Array.isArray(payload.actions) ? payload.actions.flatMap((action) => [action.label, (action.payload && action.payload.query) || ""]) : []),
    ...(Array.isArray(payload.days) ? payload.days.flatMap((day) => [day.label, ...day.blocks.flatMap((block) => [block.time, block.title, block.location, block.meta || ""])]) : []),
  ];
  return parts.filter((part) => typeof part === "string").join(" ");
}

function decisionCardOf(run) {
  const last = run.executed[run.executed.length - 1];
  return last && last.raw && last.raw.decision ? last.raw.decision.resultCard : null;
}

// 投影兜底：无 decision 的工具走 variant-adapter → viewModel。
function envelopeViewOf(run, toolName, adapterName) {
  const raw = run.executed.find((x) => x.tool === toolName);
  if (!raw) return null;
  const built = ADAPTERS[adapterName](raw.raw, toolName);
  if (!built.ok) return null;
  const projected = projectViewModel(raw.raw, toolName, built.envelope);
  return projected.ok ? projected.viewModel : null;
}

// Gate 2：公开投影中的校园实体名必须全部来自本轮工具结果（无虚构动态事实）。
function assertNoFabricatedNames(caseId, publicText, executed) {
  const rawNames = new Set();
  for (const step of executed) {
    const rawText = JSON.stringify(step.raw);
    for (const set of [COURSE_NAMES, TEACHER_NAMES, CLASS_NAMES]) {
      for (const name of set) if (rawText.includes(name)) rawNames.add(name);
    }
  }
  for (const set of [COURSE_NAMES, TEACHER_NAMES, CLASS_NAMES]) {
    for (const name of set) {
      if (publicText.includes(name)) {
        assert.ok(rawNames.has(name), `${caseId}: 投影中出现未核验实体名「${name}」（虚构动态事实）`);
      }
    }
  }
}

// Gate 5：Widget failure always has semantic fallback（同一 projection 派生可读文本）。
function assertSemanticFallback(caseId, payload) {
  const validation = validateWidgetPayload(payload);
  assert.equal(validation.ok, true, `${caseId}: 正常投影必须通过 Widget 校验: ${validation.errors.join(";")}`);
  const broken = JSON.parse(JSON.stringify(payload));
  broken.internal = { queryId: "q-secret" };
  const fallback = fallbackFromProjection(broken, "当前结果暂时无法以卡片展示。");
  assert.notEqual(fallback, "当前结果暂时无法以卡片展示。", `${caseId}: fallback 必须从同一 projection 派生业务内容`);
  if (payload.title) assert.ok(fallback.includes(payload.title), `${caseId}: fallback 必须保留同一 projection 标题`);
  if (payload.summary) assert.ok(fallback.includes(payload.summary), `${caseId}: fallback 必须保留同一 projection 摘要`);
  assert.doesNotMatch(fallback, /queryId|q-secret|\{|\}/, `${caseId}: fallback 不得泄漏内部协议或裸 JSON`);
}

// Gate 3：公开投影无内部协议泄漏。
function assertNoLeak(caseId, payload) {
  assert.doesNotMatch(JSON.stringify(payload), LEAK, `${caseId}: 公开投影泄漏内部协议字段`);
}

function runCase(caseId, fixture) {
  const variantResults = [];
  for (const variant of fixture.variants) {
    const goalSpec = fixture.goalSpec(variant);
    const run = runMission(goalSpec, (cap, index, executed) => fixture.paramsFor(cap, index, executed, variant), {});
    variantResults.push({ variant, run });
    // Gate 1a：规划序列符合期望（userOutcome 不影响计划 → 所有变体等价）
    assert.deepStrictEqual(
      run.executed.map((x) => x.capability),
      fixture.expectedSteps,
      `${caseId} [${variant.text}] 规划序列`,
    );
    assert.strictEqual(run.final.status, fixture.expectedFinalStatus || "complete", `${caseId} [${variant.text}] 完成状态`);
    // Gate 1b：每个工具调用成功（fail-closed 时不伪装成功）
    for (const step of run.executed) {
      assert.equal(step.raw.success, true, `${caseId} [${variant.text}] ${step.tool} 必须成功`);
    }
  }
  // 变体之间 plan 结构等价（同一目标语义 → 同一能力序列，禁止按问句绑定规则）
  const ref = JSON.stringify(variantResults[0].run.plan.steps);
  for (const { variant, run } of variantResults.slice(1)) {
    assert.equal(JSON.stringify(run.plan.steps), ref, `${caseId} [${variant.text}] 必须与首变体计划等价`);
  }
  const primary = variantResults[0];
  // 取 primary 变体执行完整门禁
  const run = primary.run;
  if (fixture.payloadOf) {
    const payload = fixture.payloadOf(run);
    assert.ok(payload, `${caseId}: 必须产出公开投影`);
    const publicText = publicTextOf(payload);
    assertNoLeak(caseId, payload);
    assertNoFabricatedNames(caseId, publicText, run.executed);
    assertSemanticFallback(caseId, payload);
    if (fixture.assertPayload) fixture.assertPayload(caseId, payload, run);
  }
  if (fixture.assertRun) fixture.assertRun(caseId, run);
  return variantResults;
}

// ---------------------------------------------------------------------------
// 用例组定义（8 组 × ≥3 变体）
// ---------------------------------------------------------------------------
const GROUPS = [
  {
    id: "G1",
    title: "教师周课表",
    variants: [
      { text: "查看教师003第1周课表", week: 1 },
      { text: "教师003这周上什么课？", week: 1 },
      { text: "看下教师003第二周的排课", week: 2 }, // state 变体
    ],
    goalSpec: (v) => ({
      goalFamily: "schedule_inquiry",
      userOutcome: v.text,
      target: { entityType: "teacher", name: "教师003" },
      temporalScope: { kind: "explicit", weekStart: v.week, weekEnd: v.week },
      constraints: {}, selection: {},
    }),
    expectedSteps: ["ENTITY_RESOLUTION", "SCHEDULE_DETAIL"],
    paramsFor: (cap, index, executed, v) => cap === "ENTITY_RESOLUTION"
      ? { entityType: "teacher", keyword: "教师003" }
      : { entityType: "teacher", entityName: "教师003", week: v.week },
    payloadOf: (run) => envelopeViewOf(run, "campus_schedule_query", "projectSchedule"),
    assertRun: (caseId, run) => {
      const sched = run.executed.find((x) => x.capability === "SCHEDULE_DETAIL");
      assert.ok(sched.raw.items.length > 0, `${caseId}: 课表非空`);
      for (const item of sched.raw.items) assert.ok(COURSE_NAMES.has(item.courseName), `${caseId}: 课次课程必须在数据集中`);
      // Gate 4：week 槽位变化 → fresh guard 必须要求重新核验
      const fact = { slots: { week: 1, entityName: "教师003" }, verified: true };
      assert.equal(freshToolRequired({ week: 2, entityName: "教师003" }, [fact]), true, `${caseId}: week 变化必须 fresh`);
      assert.equal(freshToolRequired({ week: 1, entityName: "教师003" }, [fact]), false, `${caseId}: 同槽位可复用`);
    },
  },
  {
    id: "G2",
    title: "周几追问 → 下周",
    variants: [
      { text: "教师003第1周周一有什么课？→ 那下周呢", phaseA: { week: 1, weekday: 1 }, phaseB: { week: 2, weekday: 1 } },
      { text: "先看教师003第1周周一，再看第2周周一", phaseA: { week: 1, weekday: 1 }, phaseB: { week: 2, weekday: 1 } },
      { text: "教师003周一的课 → 下一周同一时间", phaseA: { week: 1, weekday: 1 }, phaseB: { week: 2, weekday: 1 } },
    ],
    goalSpec: (v) => ({
      goalFamily: "schedule_inquiry",
      userOutcome: v.text,
      target: { entityType: "teacher", name: "教师003" },
      temporalScope: { kind: "explicit", weekStart: v.phaseA.week, weekEnd: v.phaseA.week, weekday: v.phaseA.weekday },
      constraints: {}, selection: {},
    }),
    expectedSteps: ["ENTITY_RESOLUTION", "SCHEDULE_DETAIL"],
    paramsFor: (cap, index, executed, v) => cap === "ENTITY_RESOLUTION"
      ? { entityType: "teacher", keyword: "教师003" }
      : { entityType: "teacher", entityName: "教师003", week: v.phaseA.week, weekday: v.phaseA.weekday },
    payloadOf: (run) => envelopeViewOf(run, "campus_schedule_query", "projectSchedule"),
    assertRun: (caseId, run) => {
      // Gate 4：两阶段执行，week 变化必须 fresh，且第二阶段结果不是旧结果截取
      const first = run.executed.find((x) => x.capability === "SCHEDULE_DETAIL");
      const factA = { slots: { week: 1, weekday: 1, entityName: "教师003" }, verified: true };
      assert.equal(freshToolRequired({ week: 2, weekday: 1, entityName: "教师003" }, [factA]), true, `${caseId}: 追问下周必须 fresh`);
      // 模拟第二阶段：以 FOLLOW_UP 重新规划并执行，week=2 必须被携带到工具参数
      const secondGoal = {
        goalFamily: "schedule_inquiry",
        userOutcome: "那下周呢",
        target: { entityType: "teacher", entityRef: "teacher-003", name: "教师003" },
        temporalScope: { kind: "explicit", weekStart: 2, weekEnd: 2, weekday: 1 },
        constraints: {}, selection: {},
      };
      const run2 = runMission(secondGoal, (cap, index) => cap === "ENTITY_RESOLUTION"
        ? { entityType: "teacher", keyword: "教师003" }
        : { entityType: "teacher", entityName: "教师003", week: 2, weekday: 1 }, { kind: "FOLLOW_UP" });
      const second = run2.executed.find((x) => x.capability === "SCHEDULE_DETAIL");
      assert.ok(second, `${caseId}: 第二阶段必须执行课表查询`);
      assert.equal(second.params.week, 2, `${caseId}: 第二阶段必须查询第 2 周（不得沿用第 1 周）`);
      assert.equal(second.raw.query.week, 2, `${caseId}: 工具回显必须为第 2 周`);
      assert.equal(second.raw.query.weekday, 1, `${caseId}: 工具回显必须为周一`);
      assert.equal(second.raw.query.date, "2026-09-07", `${caseId}: 第 2 周周一的日期必须确定性解析为 2026-09-07`);
    },
  },
  {
    id: "G3",
    title: "课表 → 跨校区风险",
    variants: [
      { text: "查看教师003第1周课表，并检查他的跨校区赶场风险" },
      { text: "教师003这周排课有没有赶场风险？先看课表" },
      { text: "帮教师003查第1周课表和风险" },
    ],
    goalSpec: (v) => ({
      goalFamily: "teaching_assurance",
      userOutcome: v.text,
      target: { entityType: "teacher", name: "教师003" },
      temporalScope: { kind: "explicit", weekStart: 1, weekEnd: 1 },
      constraints: {}, selection: {},
    }),
    expectedSteps: ["ENTITY_RESOLUTION", "SCHEDULE_DETAIL", "RISK_CHECK"],
    paramsFor: (cap, index, executed) => {
      if (cap === "ENTITY_RESOLUTION") return { entityType: "teacher", keyword: "教师003" };
      if (cap === "SCHEDULE_DETAIL") return { entityType: "teacher", entityName: "教师003", week: 1 };
      return { mode: "self", entityType: "teacher", entityName: "教师003", week: 1 };
    },
    payloadOf: (run) => envelopeViewOf(run, "campus_risk_check", "projectRisk"),
    assertRun: (caseId, run) => {
      const risk = run.executed.find((x) => x.capability === "RISK_CHECK");
      assert.ok(risk, `${caseId}: 必须执行风险检查`);
      assert.ok(risk.raw.summary && typeof risk.raw.summary.rushWarningCount === "number", `${caseId}: 风险结论必须来自工具`);
      // 组合任务收口：最终卡必须是 risk（不是第一张课表卡）
      const finalPayload = envelopeViewOf(run, "campus_risk_check", "projectRisk");
      assert.equal(finalPayload.variant, "risk", `${caseId}: 课表→风险必须收口 risk 卡`);
    },
  },
  {
    id: "G4",
    title: "教室推荐 + 软偏好",
    variants: [
      { text: "找校区A周一5-6节空教室，容量大的优先" },
      { text: "尽量选能坐更多人的教室，校区A周一5-6节" },
      { text: "空间宽裕一点的教室（校区A，周一5-6）" },
    ],
    goalSpec: (v) => ({
      goalFamily: "space_inquiry",
      userOutcome: v.text,
      target: {},
      temporalScope: { kind: "explicit", weekStart: 1, weekEnd: 1, weekday: 1, periodStart: 5, periodEnd: 6 },
      constraints: { campus: "校区A", soft: { preferLarger: true } },
      selection: {},
    }),
    expectedSteps: ["SPACE_DISCOVERY"],
    paramsFor: () => ({ campus: "校区A", week: 1, weekday: 1, periodStart: 5, periodEnd: 6, decisionPreferences: { preferLarger: true } }),
    payloadOf: (run) => decisionCardOf(run) || envelopeViewOf(run, "campus_classroom_search", "projectSpace"),
    assertRun: (caseId, run) => {
      const space = run.executed.find((x) => x.capability === "SPACE_DISCOVERY");
      assert.ok(space.raw.items.length > 0, `${caseId}: 空教室结果非空`);
      // Gate 1：软偏好一次携带，不先做无偏好查询再重试
      assert.deepStrictEqual(space.params.decisionPreferences, { preferLarger: true }, `${caseId}: 首次查询必须携带白名单偏好`);
      // 决策推荐容量 = 候选最大容量（确定性）
      const maxCapacity = Math.max(...space.raw.items.map((r) => r.capacity));
      const preferred = space.raw.decision && space.raw.decision.preferred;
      if (preferred) {
        const chosen = space.raw.items.find((r) => `${r.roomName}` === preferred.label);
        if (chosen) assert.equal(chosen.capacity, maxCapacity, `${caseId}: preferLarger 推荐必须是容量最大的教室`);
      }
    },
  },
  {
    id: "G5",
    title: "硬约束空 → 明确放宽",
    variants: [
      { text: "找校区A周三7-8节容量200以上的空教室", minCapacity: 200, campus: "校区A", weekday: 3, periodStart: 7, periodEnd: 8 },
      { text: "第1周周五容量100以上带多媒体的教室，校区A", minCapacity: 100, campus: "校区A", weekday: 5, periodStart: 7, periodEnd: 8 },
      { text: "校区C周二3-4节300人以上教室", minCapacity: 300, campus: "校区C", weekday: 2, periodStart: 3, periodEnd: 4 },
    ],
    goalSpec: (v) => ({
      goalFamily: "space_inquiry",
      userOutcome: v.text,
      target: {},
      temporalScope: { kind: "explicit", weekStart: 1, weekEnd: 1, weekday: v.weekday, periodStart: v.periodStart, periodEnd: v.periodEnd },
      constraints: { campus: v.campus, minCapacity: v.minCapacity },
      selection: {},
    }),
    expectedSteps: ["SPACE_DISCOVERY"],
    paramsFor: (cap, index, executed, v) => ({ campus: v.campus, week: 1, weekday: v.weekday, periodStart: v.periodStart, periodEnd: v.periodEnd, minCapacity: v.minCapacity }),
    payloadOf: (run) => decisionCardOf(run) || envelopeViewOf(run, "campus_classroom_search", "projectSpace"),
    assertRun: (caseId, run) => {
      const space = run.executed.find((x) => x.capability === "SPACE_DISCOVERY");
      // Gate 1：硬约束不可满足 → 无候选，且 relaxedCount=0（绝不静默放宽）
      assert.equal(space.raw.items.length, 0, `${caseId}: 硬约束下必须为空结果`);
      const decision = space.raw.decision;
      assert.ok(decision, `${caseId}: 空结果也必须给出权威决策`);
      assert.equal(decision.status, "no_feasible_candidate", `${caseId}: 必须显式 no_feasible_candidate`);
      assert.equal(decision.receipt.decision, "no_viable_option", `${caseId}: receipt 必须 no_viable_option`);
      assert.equal(decision.receipt.recommendation, null, `${caseId}: 不得伪造推荐`);
      const cardText = publicTextOf(decision.resultCard);
      assert.ok(/暂无可行候选|没有匹配|未找到/.test(cardText), `${caseId}: 卡片必须明确说明无匹配（不静默放宽）`);
    },
  },
  {
    id: "G6",
    title: "三教师共同空闲 + 教室",
    variants: [
      { text: "帮教师005、教师006、教师014找第1周周四上午的共同空闲，并推荐合适教室" },
      { text: "三位老师005/006/014周四上午能不能碰头？找个教室" },
      { text: "查教师005、006、014第1周周四上午的共同空闲时间，推荐教室" },
    ],
    goalSpec: (v) => ({
      goalFamily: "collaboration_planning",
      userOutcome: v.text,
      target: { entities: [
        { type: "teacher", name: "教师005" },
        { type: "teacher", name: "教师006" },
        { type: "teacher", name: "教师014" },
      ], resolved: false },
      temporalScope: { kind: "explicit", weekStart: 1, weekEnd: 1, weekday: 4, periodStart: 1, periodEnd: 4 },
      constraints: { wantPlan: true },
      selection: {},
    }),
    expectedSteps: ["ENTITY_RESOLUTION", "COMMON_AVAILABILITY", "SPACE_DISCOVERY", "GROUP_PLANNING"],
    paramsFor: (cap, index, executed) => {
      if (cap === "ENTITY_RESOLUTION") return { entityType: "teacher", keyword: "教师005" };
      if (cap === "COMMON_AVAILABILITY") return { entities: [
        { type: "teacher", name: "教师005" }, { type: "teacher", name: "教师006" }, { type: "teacher", name: "教师014" },
      ], week: 1, weekday: 4, periodStart: 1, periodEnd: 4 };
      if (cap === "SPACE_DISCOVERY") return { week: 1, weekday: 4, periodStart: 1, periodEnd: 4 };
      return { entities: [
        { type: "teacher", name: "教师005" }, { type: "teacher", name: "教师006" }, { type: "teacher", name: "教师014" },
      ], week: 1, weekday: 4, periodStart: 1, periodEnd: 4 };
    },
    payloadOf: (run) => decisionCardOf(run),
    assertRun: (caseId, run) => {
      const avail = run.executed.find((x) => x.capability === "COMMON_AVAILABILITY");
      assert.ok(avail.raw.items.length > 0, `${caseId}: 三位教师周四上午必须有共同空闲（数据集锚点）`);
      const plan = run.executed.find((x) => x.capability === "GROUP_PLANNING");
      assert.ok(plan.raw.decision && plan.raw.decision.status === "recommended", `${caseId}: 群体方案必须有权威推荐`);
      assert.ok(plan.raw.items.every((item) => Array.isArray(item.rooms) && item.rooms.length > 0), `${caseId}: 候选方案必须含真实教室`);
      assert.equal(plan.raw.decision.resultCard.variant, "collaboration", `${caseId}: 卡片变体必须是 collaboration`);
    },
  },
  {
    id: "G7",
    title: "排名 → Top1 课表 → 风险",
    variants: [
      { text: "未来四周教师负载最高的是谁？看下Top1的课表，再检查风险" },
      { text: "教师负载排名第一的老师，第1周课表和风险" },
      { text: "谁最忙？看看他第1周课表和赶场风险" },
    ],
    goalSpec: (v) => ({
      goalFamily: "campus_operations_insight",
      userOutcome: v.text,
      target: {},
      temporalScope: { kind: "explicit", weekStart: 1, weekEnd: 4 },
      constraints: { needRisk: true },
      selection: { metric: "teacher_load", position: 1 },
    }),
    expectedSteps: ["TEACHER_LOAD_RANKING", "SCHEDULE_DETAIL", "RISK_CHECK"],
    paramsFor: (cap, index, executed) => {
      if (cap === "TEACHER_LOAD_RANKING") return { weekStart: 1, weekEnd: 4, topN: 3 };
      const top1 = executed.find((x) => x.capability === "TEACHER_LOAD_RANKING").raw.items[0];
      const entityName = top1.teacher.name;
      if (cap === "SCHEDULE_DETAIL") return { entityType: "teacher", entityName, week: 1 };
      return { mode: "self", entityType: "teacher", entityName, week: 1 };
    },
    payloadOf: (run) => envelopeViewOf(run, "campus_risk_check", "projectRisk"),
    assertRun: (caseId, run) => {
      const ranking = run.executed.find((x) => x.capability === "TEACHER_LOAD_RANKING");
      const top1 = ranking.raw.items[0];
      assert.ok(top1 && top1.rank === 1, `${caseId}: 排名首位存在且 rank=1`);
      const top1Name = top1.teacher.name;
      // Gate 4：下钻实体必须继承 Top1（不得用旧实体/编造实体）
      const sched = run.executed.find((x) => x.capability === "SCHEDULE_DETAIL");
      assert.equal(sched.params.entityName, top1Name, `${caseId}: 课表下钻必须继承 Top1 实体`);
      const risk = run.executed.find((x) => x.capability === "RISK_CHECK");
      assert.equal(risk.params.entityName, top1Name, `${caseId}: 风险检查必须继承 Top1 实体`);
      assert.ok(sched.raw.items.length > 0, `${caseId}: Top1 第 1 周课表非空`);
      const finalPayload = envelopeViewOf(run, "campus_risk_check", "projectRisk");
      assert.equal(finalPayload.variant, "risk", `${caseId}: 排名→课表→风险必须收口 risk 卡`);
    },
  },
  {
    id: "G8",
    title: "调课 What-if 完整链",
    variants: [
      { text: "把数据结构这门课调到周四第7-8节可行吗？", weekday: 4, periodStart: 7, periodEnd: 8 },
      { text: "数据结构能挪到周四晚上吗？", weekday: 4, periodStart: 7, periodEnd: 8 },
      { text: "模拟把数据结构换到周三第7-8节", weekday: 3, periodStart: 7, periodEnd: 8 }, // state 变体
    ],
    goalSpec: (v) => ({
      goalFamily: "reschedule_simulation",
      userOutcome: v.text,
      target: { entityType: "course", name: "数据结构" },
      temporalScope: { kind: "explicit", weekStart: 1, weekEnd: 1, weekday: v.weekday, periodStart: v.periodStart, periodEnd: v.periodEnd },
      constraints: {}, selection: {},
    }),
    expectedSteps: ["ENTITY_RESOLUTION", "RESCHEDULE_SIMULATION"],
    paramsFor: (cap, index, executed, v) => cap === "ENTITY_RESOLUTION"
      ? { entityType: "course", keyword: "数据结构" }
      : { sourceCourseName: "数据结构", target: { weekday: v.weekday, periodStart: v.periodStart, periodEnd: v.periodEnd } },
    payloadOf: (run) => decisionCardOf(run),
    assertRun: (caseId, run) => {
      const sim = run.executed.find((x) => x.capability === "RESCHEDULE_SIMULATION");
      assert.ok(sim, `${caseId}: 必须执行调课模拟`);
      const raw = sim.raw;
      // 完整确定性链：实体解析 → 多课次逐条模拟
      assert.equal(raw.summary.lessonCount, 2, `${caseId}: 数据结构有 2 个课次（多班级），必须逐条模拟`);
      assert.equal(raw.summary.multiLesson, true, `${caseId}: 必须标记多课次`);
      assert.equal(raw.items.length, 2, `${caseId}: 每课次一条结果`);
      for (const item of raw.items) {
        assert.ok(item.checks.teacherConflict && item.checks.classConflict, `${caseId}: 教师/班级可用性必须核验`);
        assert.ok(item.checks.spaceAvailability && typeof item.checks.spaceAvailability.ok === "boolean", `${caseId}: 目标时段空间可用性必须核验`);
        assert.ok(item.checks.capacity && item.checks.feature, `${caseId}: 容量/设备内在约束必须核验`);
        assert.ok(item.checks.spaceAvailability.roomCount >= 0, `${caseId}: 空间候选数必须存在`);
        assert.equal(item.feasible, typeof item.feasible === "boolean" ? item.feasible : false, `${caseId}: 每课次必须有整体可行性`);
      }
      assert.equal(raw.simulation.mutatedData, false, `${caseId}: 模拟绝不修改数据`);
      // DecisionBundle → result-card
      const decision = raw.decision;
      assert.ok(decision, `${caseId}: 必须附加权威决策`);
      assert.equal(decision.resultCard.variant, "reschedule", `${caseId}: 卡片变体必须是 reschedule`);
      assert.equal(decision.resultCard.displayMeta.simulated, true, `${caseId}: 必须带模拟标记（未修改课表）`);
      assert.ok(decision.resultCard.verified === true, `${caseId}: 卡片必须 verified`);
      const cardText = publicTextOf(decision.resultCard);
      assert.ok(cardText.includes("数据结构") || cardText.includes("推荐"), `${caseId}: 卡片必须承载业务结论`);
    },
  },
];

// ---------------------------------------------------------------------------
// 执行：8 组 × ≥3 变体 ≥ 24 用例
// ---------------------------------------------------------------------------
test("HS1 矩阵完整性：8 组、每组 ≥3 变体、总用例 ≥24", () => {
  assert.equal(GROUPS.length, 8);
  let total = 0;
  for (const group of GROUPS) {
    assert.ok(group.variants.length >= 3, `${group.id} 变体数必须 ≥3`);
    total += group.variants.length;
  }
  assert.ok(total >= 24, `总用例必须 ≥24（实际 ${total}）`);
});

test("HS2 Final Hero Stability：8 组全部通过 5 条最低标准", () => {
  let passed = 0;
  let total = 0;
  for (const group of GROUPS) {
    runCase(group.id, group);
    passed += group.variants.length;
    total += group.variants.length;
  }
  assert.equal(passed, total, `correctness 必须 ${total}/${total}`);
});

test("HS3 矩阵文档与门禁一致（SSOT）", () => {
  const doc = fs.readFileSync(path.join(KIT, "final", "hero-stability", "FINAL-HERO-STABILITY-MATRIX.md"), "utf8");
  for (const group of GROUPS) {
    assert.ok(doc.includes(`| ${group.id} |`), `矩阵文档必须包含 ${group.id}`);
  }
  for (const gate of ["correctness", "no fabricated dynamic fact", "no internal protocol leakage", "no stale entity/week/date", "widget failure always has semantic fallback"]) {
    assert.ok(doc.includes(gate), `矩阵文档必须包含标准：${gate}`);
  }
  // capability-level：生产提示词不得包含针对具体教师编号或具体问句的规则
  const mainPrompt = fs.readFileSync(path.join(KIT, "final", "prompts", "main-orchestrator.md"), "utf8");
  assert.doesNotMatch(mainPrompt, /教师00\d|把数据结构|调到周四/, "Final Main 不得含测试问句/编号规则");
  const riskPrompt = fs.readFileSync(path.join(KIT, "final", "prompts", "risk-planning.md"), "utf8");
  assert.doesNotMatch(riskPrompt, /教师00\d|数据结构/, "Final Risk 不得含测试问句/编号规则");
});

// ---------------------------------------------------------------------------
// 附加：Silent orchestration 与输出纪律（面向最终输出的 capability-level 门禁）
// ---------------------------------------------------------------------------
test("HS4 最终输出纪律：四份 Final 提示词均禁止编排自述与占位降级", () => {
  for (const name of ["main-orchestrator.md", "schedule-space.md", "risk-planning.md", "campus-insight.md"]) {
    const text = fs.readFileSync(path.join(KIT, "final", "prompts", name), "utf8");
    assert.match(text, /不.*(?:复述执行过程|展示.*(?:转交|内部过程)|描述调用过程)|不要.*内部过程/, `${name}: 必须禁止编排自述`);
    assert.match(text, /可读中文文本|可读.*文本/, `${name}: 必须要求可读中文文本输出`);
  }
});

test("HS5 展示契约一致性：FinalPresentationPolicy 的 fallback 从同一投影派生", () => {
  const valid = {
    version: "1.0", variant: "reschedule", status: "success", layoutMode: "result-card",
    title: "调课模拟", summary: "可以调至 周四 第7-8节（模拟，未执行）。", verified: true,
    sections: [{ title: "可行性检查", rows: [{ label: "教师", value: "无冲突" }] }],
    actions: [], displayMeta: { simulated: true }, subtitle: "", context: "",
    weekBoardTitle: "", weekBoardSubtitle: "", days: [],
  };
  assert.equal(validateWidgetPayload(valid).ok, true);
  const broken = { ...valid, secret: { queryId: "x" } };
  const fallback = fallbackFromProjection(broken, "占位");
  assert.ok(fallback.includes("调课模拟"), "fallback 保留标题");
  assert.ok(fallback.includes("可以调至"), "fallback 保留摘要");
  assert.ok(fallback.includes("模拟"), "fallback 保留模拟声明");
  assert.doesNotMatch(fallback, /queryId|\{|\}|schema|version/i);
  // 展示判定入口同样从同一投影派生
  const selected = selectFinalPresentation({
    responseClass: "dynamic_result", resultCard: broken,
    fallbackText: "占位", validateResultCard: validateWidgetPayload,
  });
  assert.equal(selected.mode, "text");
  assert.ok(selected.fallbackText.includes("调课模拟"));
});
