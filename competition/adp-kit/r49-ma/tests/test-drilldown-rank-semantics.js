"use strict";
// R49.3 / G2-D Drilldown State Semantics Hardening 新增回归（2026-08-17）
// R49.4 更新（2026-08-17）：下钻时间窗口改用显式 WindowContext 语义。
// R49.4.1 更新（2026-08-17）：教师负载排名真源 = campus_teacher_load_query；
//   排名断言一律取该 façade 的真实 items，不再把 campus_overview.teacherLoadTop 当任意窗口排名真源；
//   overview 相关用例只保留在真正测试整体校园态势（固定窗口）本身。
//
// 覆盖用户指定 A~H：
//  A. overview 固定窗口 teacherLoadTop 稳定排序（指标并列时 Top1/Top2 position 仍稳定）
//     + teacher_load(1..4) 窗口排名与 overview 固定窗口（同 1..4）排序一致（同数据集同稳定排序）
//  B. 未来四周教师负载最高 → 看Top1课表 → 检查Top1风险（NO clarification；entity=teacher_load items[0]；
//     detailWindow=1..4；risk mode=self；risk 未指定时间必须澄清，不自动 week=1）
//  C. overviewWindow.count=4 不得变成 academicWeek=4；四周排名后下钻保留 detailWindow=1..4
//  D. schedule 下钻 detailWindow=1..4（范围工具）；「只看第一周」→ 1..1（单周工具）
//  D4. 新会话单句链「看未来第一周课表负载最高的教师课表」→ teacher_load(1,1) → Top1 → schedule week=1
//  E. risk 下钻必须显式周次（不自动 week=1）
//  F. 看Top2课表 → teacher_load items[1]（不得调用 Top1）
//  G. 并列第一都有谁 → 如实列并列项，不压缩为 Top1，不破坏 rankContext
//  H. 随后「看Top1课表」仍落 teacher_load items[0]
//  + prompt / handoff / context policy / matrix / fixture 契约断言（R49.4.1 source-aware）。
//
// 旧 CASE D 行为下这些断言必然失败（并列触发澄清 / week 继承 4 / Top1 依赖指标唯一性 / overview 当排名真源），
// 新行为下通过；禁止弱化既有断言。

const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const path = require("path");

const V2_PATH = path.join(__dirname, "..", "..", "mock-data", "competition-demo-v2.json");
process.env.CAMPUS_DATA_PATH = V2_PATH;

const { callAgentTool } = require("../../cloudfunctions/campusflowAdpTools/src/agent-tools.js");
const { isMultiObjectRequest, resolveRank, resolveDrilldownWeek } = require("../tools/rank-semantics.js");
const { resolveDetailWindow, shouldUseRangeSchedule } = require("../tools/window-semantics.js");

const RANKING_WINDOW_14 = { weekStart: 1, weekEnd: 4 };

const R49_MA = path.join(__dirname, "..");
const FIXTURES = require("./fixtures/multi-turn-cases.json");
const MAIN = fs.readFileSync(path.join(R49_MA, "agents", "main-orchestrator.md"), "utf8");
const INSIGHT = fs.readFileSync(path.join(R49_MA, "agents", "campus-insight.md"), "utf8");
const SCHEDULE = fs.readFileSync(path.join(R49_MA, "agents", "schedule-space.md"), "utf8");
const RISK = fs.readFileSync(path.join(R49_MA, "agents", "risk-planning.md"), "utf8");
const HANDOFF = fs.readFileSync(path.join(R49_MA, "03-HANDOFF-POLICY.md"), "utf8");
const CONTEXT = fs.readFileSync(path.join(R49_MA, "04-CONTEXT-POLICY.md"), "utf8");
const E2E_MATRIX = fs.readFileSync(path.join(R49_MA, "09-MULTI-AGENT-E2E-MATRIX.md"), "utf8");

// R49.4.1：教师负载窗口排名的唯一动态真源 = campus_teacher_load_query（真实 façade）。
function teacherLoad(weekStart = 1, weekEnd = 4, topN = 3) {
  const env = callAgentTool("campus_teacher_load_query", { weekStart, weekEnd, topN });
  assert.strictEqual(env.success, true, "campus_teacher_load_query 必须成功");
  assert.ok(Array.isArray(env.items) && env.items.length >= topN, `窗口 ${weekStart}..${weekEnd} 排名应至少 ${topN} 项`);
  return env;
}

// overview 仅保留整体态势本身（固定窗口）的用例。
function overview() {
  const env = callAgentTool("campus_overview", {});
  assert.strictEqual(env.success, true);
  return env.items[0];
}

// ---------------------------------------------------------------------------
// A. 排名确定性：teacher_load 是真源，与 overview 固定窗口（同 1..4）排序一致
// ---------------------------------------------------------------------------
test("A. 教师负载排名真源 = campus_teacher_load_query：稳定排序、并列 tie-break、与 overview 固定窗口一致", () => {
  const env = teacherLoad(1, 4, 3);
  const top = env.items;
  assert.strictEqual(top[0].rank, 1);
  assert.strictEqual(top[0].teacher.name, "教师009", "v2 数据锚点：W1..W4 窗口 Top1=教师009");
  assert.strictEqual(top[1].teacher.name, "教师011", "v2 数据锚点：W1..W4 窗口 Top2=教师011");
  assert.ok(
    top[0].lessonOccurrences === top[1].lessonOccurrences && top[0].periodUnits === top[1].periodUnits,
    "v2 数据锚点：Top1/Top2 业务指标并列（27/54 与 27/54），本测试即围绕该真实并列构造",
  );
  assert.strictEqual(top[1].tiedWithPrevious, true, "并列项必须 tiedWithPrevious=true（稳定排序下的 position 语义）");
  assert.ok(
    top[0].teacher.name.localeCompare(top[1].teacher.name, "zh-CN") < 0,
    "指标并列时必须按 teacherName zh-CN tie-break 稳定排序",
  );
  const again = teacherLoad(1, 4, 3);
  assert.deepStrictEqual(again.items, top, "重复调用 teacher_load(1,4,3) 必须逐字节一致（确定性）");

  const ov = overview();
  const ovTop = ov.teacherLoadTop;
  assert.strictEqual(ovTop[0].teacherName, "教师009", "overview 固定窗口（1..4）Top1 与 teacher_load 一致");
  assert.deepStrictEqual(
    top.map((t) => t.teacher.name),
    ovTop.slice(0, 3).map((t) => t.teacherName),
    "同窗口（1..4）下 teacher_load 与 overview 固定窗口排序必须一致（同数据集同稳定排序）",
  );

  const cmp = (left, right) => (
    right.lessonOccurrences - left.lessonOccurrences
    || right.periodUnits - left.periodUnits
    || left.teacher.name.localeCompare(right.teacher.name, "zh-CN")
  );
  for (let i = 0; i < top.length - 1; i += 1) {
    assert.ok(cmp(top[i], top[i + 1]) <= 0, `teacher_load items 相邻项必须满足 lessonOccurrences DESC → periodUnits DESC → teacherName ASC（index ${i}）`);
  }
});

// ---------------------------------------------------------------------------
// B. 链路：未来四周 → 看Top1课表 → 检查Top1风险
// ---------------------------------------------------------------------------
test("B. 链路：Top1 drilldown NO clarification，entity=teacher_load items[0]，detailWindow=1..4", () => {
  const top = teacherLoad(1, 4, 3).items;
  assert.deepStrictEqual(
    resolveDetailWindow({ rankingWindow: RANKING_WINDOW_14 }),
    { weekStart: 1, weekEnd: 4 },
    "未来四周排名后「看Top1课表」继承 detailWindow=1..4（不得默认 week=1，不得误成 week=4）",
  );
  assert.strictEqual(shouldUseRangeSchedule(RANKING_WINDOW_14), true, "1..4 必须走范围课表工具");

  const t2 = resolveRank("看Top1课表");
  assert.strictEqual(t2.kind, "single", "「看Top1课表」必须是单排位（即使指标并列），不得进入澄清分支");
  assert.strictEqual(t2.rank, 1);
  const entity1 = top[t2.rank - 1];
  assert.strictEqual(entity1.teacher.name, "教师009", "Top1 实体 = teacher_load items[0]（position 语义）");

  const sch = callAgentTool("campus_schedule_query", { entityType: "teacher", entityName: entity1.teacher.name, week: 1 });
  assert.strictEqual(sch.success, true, "Top1 课表必须成功（无澄清）");
  assert.strictEqual(sch.items.length, 6, "教师009 第 1 周应 6 节（显式周次数据锚点）");

  const t3 = resolveRank("检查Top1风险");
  assert.strictEqual(t3.kind, "single");
  assert.strictEqual(t3.rank, 1);
  assert.deepStrictEqual(
    resolveDetailWindow({ rankingWindow: RANKING_WINDOW_14 }),
    RANKING_WINDOW_14,
    "未指定时间的「检查Top1风险」不得自动收窄为 week=1（须澄清时间窗口）",
  );
  const risk = callAgentTool("campus_risk_check", { mode: "self", entityType: "teacher", entityName: entity1.teacher.name, week: 1 });
  assert.strictEqual(risk.success, true);
  assert.strictEqual(risk.summary.selfCompare, true, "Top1 风险必须 self 模式");
  assert.strictEqual(risk.summary.conflictCount, 1, "教师009 第 1 周冲突必须为 1（非污染后 2）");
  assert.strictEqual(risk.summary.rushWarningCount, 1, "教师009 第 1 周赶场必须为 1");
});

// ---------------------------------------------------------------------------
// C. overviewWindow.count 不得成为 academicWeek
// ---------------------------------------------------------------------------
test("C. overviewWindow.count=4 与 academicWeek 严格隔离（下钻保留 1..4，绝不自动 week=4）", () => {
  const item = overview();
  const window = item.window;
  assert.strictEqual(window.teachingWeeks.count, 4, "overview 聚合窗口应为 4 周");
  const overviewWindow = { kind: "future_weeks", count: window.teachingWeeks.count };
  assert.strictEqual(resolveDrilldownWeek(overviewWindow, null), null, "聚合窗口不得推导出默认教学周（R49.4 退役 week=1 默认）");
  const detail = resolveDetailWindow({ rankingWindow: RANKING_WINDOW_14 });
  assert.deepStrictEqual(detail, { weekStart: 1, weekEnd: 4 }, "四周排名后下钻保留 1..4（不丢窗口）");
  assert.notStrictEqual(detail.weekStart, overviewWindow.count, "窗口起点不得被 count 污染");
  assert.strictEqual(shouldUseRangeSchedule(detail), true, "1..4 使用范围课表");
  const narrowed = resolveDetailWindow({ rankingWindow: RANKING_WINDOW_14, explicitWeek: 1 });
  assert.deepStrictEqual(narrowed, { weekStart: 1, weekEnd: 1 }, "「只看第一周」收窄为 1..1");
  assert.strictEqual(shouldUseRangeSchedule(narrowed), false, "1..1 使用单周课表");
  const explicit = resolveDrilldownWeek(overviewWindow, 7);
  assert.strictEqual(explicit, 7, "用户显式指定教学周时用显式值");
});

// ---------------------------------------------------------------------------
// D/E. schedule 下钻窗口语义（detailWindow 1..4 / 显式收窄 1..1）+ D4 新会话单句链
// ---------------------------------------------------------------------------
test("D/E. schedule 下钻保留 detailWindow=1..4，「只看第一周」显式收窄 1..1（CASE D 标准链）", () => {
  const top = teacherLoad(1, 4, 3).items;
  const detail = resolveDetailWindow({ rankingWindow: RANKING_WINDOW_14 });
  assert.deepStrictEqual(detail, { weekStart: 1, weekEnd: 4 }, "schedule 下钻必须继承四周窗口");
  assert.strictEqual(shouldUseRangeSchedule(detail), true, "1..4 使用范围课表工具");
  const narrowed = resolveDetailWindow({ rankingWindow: RANKING_WINDOW_14, explicitWeek: 1 });
  assert.deepStrictEqual(narrowed, { weekStart: 1, weekEnd: 1 }, "「只看第一周」→ 1..1（fresh 单周调用）");
  assert.strictEqual(shouldUseRangeSchedule(narrowed), false, "1..1 使用单周课表工具");
  const ov = callAgentTool("campus_schedule_query", { entityType: "teacher", entityName: top[0].teacher.name, week: 1 });
  assert.strictEqual(ov.success, true);
  assert.ok(ov.items.length > 0);
});

test("D4. 新会话单句链：teacher_load(1,1) → 稳定 Top1 → schedule week=1（无知识库/无循环）", () => {
  const firstWeek = teacherLoad(1, 1, 3);
  const top1 = firstWeek.items[0];
  assert.strictEqual(top1.rank, 1, "W1..W1 窗口排名必须返回 rank=1");
  assert.strictEqual(top1.teacher.name, "教师003", "v2 数据锚点：未来第一周（W1..W1）课表负载最高 = 教师003");
  const sch = callAgentTool("campus_schedule_query", { entityType: "teacher", entityName: top1.teacher.name, week: 1 });
  assert.strictEqual(sch.success, true, "D4 链第二步：Top1 单周课表必须成功");
  assert.ok(sch.items.length > 0, "教师003 第 1 周应有课");
  assert.strictEqual(shouldUseRangeSchedule({ weekStart: 1, weekEnd: 1 }), false, "D4 使用单周工具（非范围工具）");
});

// ---------------------------------------------------------------------------
// F. Top2 下钻 = teacher_load items[1]，不得调用 Top1
// ---------------------------------------------------------------------------
test("F. Top2 下钻：entity=teacher_load items[1]，不得落在 Top1", () => {
  const top = teacherLoad(1, 4, 3).items;
  const r = resolveRank("看Top2课表");
  assert.strictEqual(r.kind, "single");
  assert.strictEqual(r.rank, 2);
  const entity = top[r.rank - 1];
  assert.strictEqual(entity.teacher.name, "教师011", "Top2 实体 = teacher_load items[1]（v2 锚点）");
  assert.notStrictEqual(entity.teacher.name, "教师009", "Top2 不得调用 Top1 实体");
  const sch = callAgentTool("campus_schedule_query", { entityType: "teacher", entityName: entity.teacher.name, week: 1 });
  assert.strictEqual(sch.success, true);
  assert.ok(sch.items.length > 0, "教师011 第 1 周应有课");
  const d2 = FIXTURES.rankDrilldown.find((c) => c.id === "D2");
  assert.strictEqual(d2.turns[1].state.rank, 2);
  assert.deepStrictEqual(
    resolveDetailWindow({ rankingWindow: RANKING_WINDOW_14 }),
    { weekStart: 1, weekEnd: 4 },
    "Top2 下钻同样继承 detailWindow=1..4（fixture 窗口字段随 Task 7 的 D1~D5 矩阵更新）",
  );
});

// ---------------------------------------------------------------------------
// G. 并列第一都有谁：如实列并列项，不压缩为 Top1，不破坏 rankContext
// ---------------------------------------------------------------------------
test("G. 多对象轮：并列第一都如实列出，selectedRank 保持 null，rankContext 不被破坏", () => {
  const top = teacherLoad(1, 4, 3).items;
  assert.ok(isMultiObjectRequest("并列第一都有谁"), "「并列第一都有谁」必须判定为多对象语义");
  assert.strictEqual(resolveRank("并列第一都有谁").kind, "multi", "多对象轮不得解析为 Top1");
  const tied = top.filter((t) => t.lessonOccurrences === top[0].lessonOccurrences && t.periodUnits === top[0].periodUnits);
  assert.ok(tied.length >= 2, "并列项应不少于 2 位（教师009 + 教师011）");
  assert.deepStrictEqual(tied.map((t) => t.teacher.name), ["教师009", "教师011"], "并列项必须来自本轮真实结果");
  const d3 = FIXTURES.rankDrilldown.find((c) => c.id === "D3");
  assert.strictEqual(d3.turns[1].state.multiObject, true);
  assert.strictEqual(d3.turns[1].state.rankContext.selectedRank, null, "多对象轮 selectedRank 必须保持 null");
});

// ---------------------------------------------------------------------------
// H. 多对象轮之后「看Top1课表」仍落 teacher_load items[0]
// ---------------------------------------------------------------------------
test("H. 多对象轮后单排位仍正确落 teacher_load items[0]，NO clarification", () => {
  const top = teacherLoad(1, 4, 3).items;
  const d3 = FIXTURES.rankDrilldown.find((c) => c.id === "D3");
  assert.strictEqual(d3.turns[2].state.rank, 1, "多对象轮后「看Top1课表」仍是 rank=1");
  const r = resolveRank("看Top1课表");
  assert.strictEqual(r.kind, "single");
  assert.strictEqual(r.rank, 1);
  const entity = top[r.rank - 1];
  assert.strictEqual(entity.teacher.name, "教师009", "多对象轮后 Top1 仍 = teacher_load items[0]");
  const sch = callAgentTool("campus_schedule_query", { entityType: "teacher", entityName: entity.teacher.name, week: 1 });
  assert.strictEqual(sch.success, true);
});

// ---------------------------------------------------------------------------
// 契约：prompt / handoff / context policy / matrix 已同步 R49.4.1 source-aware 语义
// ---------------------------------------------------------------------------
test("契约 1：Main prompt 含并列不澄清、position 语义、week 隔离、source-aware rankContext、R49.4 窗口语义", () => {
  assert.ok(MAIN.includes("items[0]"), "Main 必须引用排名结果 items[0]（position 语义）");
  assert.ok(MAIN.includes("position 语义"), "Main 必须声明 Top1 为 position 语义");
  assert.ok(MAIN.includes("NO CLARIFICATION"), "Main 必须声明单排位 NO CLARIFICATION");
  assert.ok(MAIN.includes("并列第一的两个"), "Main 必须包含多对象触发短语");
  assert.ok(MAIN.includes("overviewWindow.count") && MAIN.includes("绝不等于 academicWeek"), "Main 必须隔离 overviewWindow 与教学周");
  assert.ok(MAIN.includes("windowContext") && MAIN.includes("rankingWindow") && MAIN.includes("detailWindow"), "Main 必须携带 windowContext(rankingWindow/detailWindow)");
  assert.ok(MAIN.includes("sourceTool"), "Main rankContext 必须声明 sourceTool");
  assert.ok(MAIN.includes("campus_teacher_load_query"), "Main 路由必须识别教师负载工具");
  assert.ok(MAIN.includes("campus_schedule_range_query"), "Main 路由必须识别范围课表工具");
  assert.ok(!MAIN.includes("drilldownAcademicWeek"), "Main 不得再声明 drilldownAcademicWeek=1 默认（R49.4 已退役）");
  assert.ok(MAIN.includes("rankContext"), "Main 信封必须含 rankContext");
  assert.ok(MAIN.includes("禁止硬编码 教师009") || MAIN.includes("禁止写死"), "Main 不得允许硬编码教师009");
  assert.ok(!MAIN.includes('source: "campus_overview"'), "Main rankContext 不得写死 overview 来源（R49.4.1）");
});

test("契约 2：Insight prompt 含 source-aware rankContext / selectedRank / 并列不压缩 / 工具职责拆分", () => {
  assert.ok(INSIGHT.includes("rankContext"), "Insight 必须返回 rankContext");
  assert.ok(INSIGHT.includes("sourceTool"), "Insight rankContext 必须声明 sourceTool（R49.4.1）");
  assert.ok(INSIGHT.includes("selectedRank"), "Insight 必须管理 selectedRank");
  assert.ok(INSIGHT.includes("教师009与教师011并列最高") || INSIGHT.includes("并列最高"), "Insight 必须如实说明并列");
  assert.ok(INSIGHT.includes("不得"), "Insight 并列不得压缩为 Top1");
  assert.ok(INSIGHT.includes("campus_teacher_load_query"), "Insight 必须使用教师负载排名工具");
  assert.ok(INSIGHT.includes("rankingWindow"), "Insight 必须按 rankingWindow 语义取数");
  assert.ok(INSIGHT.includes("不作为任意教师周窗口排名的替代工具"), "Insight 必须声明 overview 不得替代教师负载排名（R49.4.1）");
  assert.ok(!INSIGHT.includes("drilldownAcademicWeek"), "Insight 不得再声明 drilldownAcademicWeek（R49.4 已退役）");
  assert.ok(!INSIGHT.includes("动态负载/风险数字全部来自 `campus_overview`"), "Insight 不得保留 overview-only 旧规则（R49.4.1）");
});

test("契约 3：Handoff/Context policy 含 source-aware 排位语义与窗口语义；Schedule/Risk 含范围/单周工具与显式周次规则", () => {
  assert.ok(HANDOFF.includes("rankContext"), "03-HANDOFF-POLICY 信封必须含 rankContext");
  assert.ok(HANDOFF.includes("sourceTool"), "03 信封 rankContext 必须含 sourceTool（R49.4.1）");
  assert.ok(HANDOFF.includes("position 语义") || HANDOFF.includes("position"), "03 必须声明 position 语义");
  assert.ok(HANDOFF.includes("6.1") && HANDOFF.includes("6.2"), "03 必须含排位语义与窗口策略小节");
  assert.ok(HANDOFF.includes("windowContext") && HANDOFF.includes("rankingWindow") && HANDOFF.includes("detailWindow"), "03 必须声明 windowContext 窗口信封");
  assert.ok(!HANDOFF.includes("drilldownAcademicWeek"), "03 不得再声明 drilldownAcademicWeek=1 默认（R49.4 已退役）");
  assert.ok(!HANDOFF.includes('"source": "campus_overview"'), "03 rankContext 不得写死 overview 来源（R49.4.1）");
  assert.ok(CONTEXT.includes("overviewWindow") && CONTEXT.includes("绝不继承为 activeTime.week"), "04 必须隔离 overviewWindow");
  assert.ok(CONTEXT.includes("rankingWindow") && CONTEXT.includes("detailWindow"), "04 必须声明 rankingWindow/detailWindow 解析");
  assert.ok(!CONTEXT.includes("drilldownAcademicWeek"), "04 不得再声明 drilldownAcademicWeek（R49.4 已退役）");
  assert.ok(CONTEXT.includes("并列第一的两个") || CONTEXT.includes("这两位"), "04 必须含多对象短语");
  assert.ok(SCHEDULE.includes("campus_schedule_range_query") && SCHEDULE.includes("detailWindow"), "schedule-space 必须按 detailWindow 选择范围/单周工具");
  assert.ok(!SCHEDULE.includes("drilldownAcademicWeek"), "schedule-space 不得再声明 drilldownAcademicWeek=1 默认");
  assert.ok(RISK.includes("mode=self") && RISK.includes("绝不要求第二对象"), "risk-planning self 铁律不变");
  assert.ok(RISK.includes("澄清"), "risk-planning 未显式周次时必须澄清（不得静默 week=1）");
  assert.ok(RISK.includes("多周窗口不是有效 risk week"), "risk-planning 必须声明多周窗口不是有效 risk week（R49.4.1）");
  assert.ok(!RISK.includes("drilldownAcademicWeek"), "risk-planning 不得再声明 drilldownAcademicWeek=1 默认");
});

test("契约 4：矩阵 D1~D5/D-2/D-3 与 fixtures rankDrilldown 同步（R49.4.1 source-aware）", () => {
  assert.ok(E2E_MATRIX.includes("CASE D-2"), "矩阵必须含 Top2 变体");
  assert.ok(E2E_MATRIX.includes("CASE D-3"), "矩阵必须含并列多对象变体");
  assert.ok(E2E_MATRIX.includes("#### D4"), "矩阵必须含 D4 新会话单句链（teacher_load(1,1) → schedule week=1）");
  assert.ok(E2E_MATRIX.includes("并列不澄清"), "矩阵必须声明并列不澄清");
  assert.ok(E2E_MATRIX.includes("rankingWindow") && E2E_MATRIX.includes("detailWindow"), "矩阵必须含 R49.4 窗口字段");
  assert.ok(E2E_MATRIX.includes("campus_day_plan(date=2026-09-06)"), "矩阵 CASE C 必须含 09-06 evidence 契约");
  assert.ok(E2E_MATRIX.includes("campus_teacher_load_query(weekStart=1, weekEnd=4)"), "矩阵 D1 必须绑定 teacher_load 参数（R49.4.1）");
  assert.deepStrictEqual(FIXTURES.rankDrilldown.map((c) => c.id), ["D2", "D3"]);
  const drilldownD1 = FIXTURES.rankDrilldown.map((c) => c.turns[0]);
  assert.ok(
    drilldownD1.every((t) => t.state && t.state.rankContext && t.state.rankContext.sourceTool === "campus_teacher_load_query"),
    "rankDrilldown fixtures 的 D1 rankContext 必须声明 sourceTool=campus_teacher_load_query（R49.4.1）",
  );
  assert.ok(!JSON.stringify(FIXTURES.rankDrilldown).includes('"source":"campus_overview"'), "fixtures rankContext 不得再写死 overview 来源（R49.4.1）");
  const d = FIXTURES.hardCases.find((c) => c.id === "D");
  assert.deepStrictEqual(d.turns.map((t) => t.route), ["insight", "schedule", "schedule", "clarify"], "CASE D 主链路由必须为 D1→D2→D3→D5（risk 未给周次 → 澄清）");
});

test("契约 5：rank-semantics 纯函数边界（多对象优先、未知引用 none、无默认周）", () => {
  assert.strictEqual(isMultiObjectRequest("把并列第一两位都给我看看"), true);
  assert.strictEqual(isMultiObjectRequest("他们呢"), true);
  assert.strictEqual(isMultiObjectRequest("比较这两位"), true);
  assert.strictEqual(resolveRank("看Top3课表").rank, 3);
  assert.strictEqual(resolveRank("排第一那个").rank, 1);
  assert.strictEqual(resolveRank("第二个").rank, 2);
  assert.strictEqual(resolveRank("随便看看").kind, "none");
  assert.strictEqual(resolveDrilldownWeek({ kind: "future_weeks", count: 4 }, null), null, "聚合窗口不得推导默认教学周（R49.4）");
  assert.strictEqual(resolveDrilldownWeek(null, null), null, "无窗口且无显式周 → 不猜（null）");
  assert.strictEqual(resolveDrilldownWeek({ kind: "future_weeks", count: 4 }, 4), 4, "用户显式说第4周则用 4");
});