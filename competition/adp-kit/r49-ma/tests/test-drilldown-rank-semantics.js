"use strict";
// R49.3 / G2-D Drilldown State Semantics Hardening 新增回归（2026-08-17）
//
// 覆盖用户指定 A~H：
//  A. campus_overview teacherLoadTop 稳定排序（指标并列时 Top1/Top2 position 仍稳定）
//  B. 未来四周教师负载最高 → 看Top1课表 → 检查Top1风险（NO clarification；entity=teacherLoadTop[0]；
//     risk mode=self；week=1）
//  C. overviewWindow.count=4 不得变成 academicWeek=4
//  D. schedule drilldown week=1
//  E. risk drilldown week=1
//  F. 看Top2课表 → teacherLoadTop[1]（不得调用 Top1）
//  G. 并列第一都有谁 → 如实列并列项，不压缩为 Top1，不破坏 rankContext
//  H. 随后「看Top1课表」仍落 teacherLoadTop[0]
//  + prompt / handoff / context policy / matrix / fixture 契约断言。
//
// 旧 CASE D 行为下这些断言必然失败（并列触发澄清 / week 继承 4 / Top1 依赖指标唯一性），
// 新行为下通过；禁止弱化既有断言。
//
// 模拟决策核心 = tools/rank-semantics.js 纯函数 + CampusTools 真实取数，与 Agent Prompt 同源同语义。

const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const path = require("path");

const V2_PATH = path.join(__dirname, "..", "..", "mock-data", "competition-demo-v2.json");
process.env.CAMPUS_DATA_PATH = V2_PATH;

const { callAgentTool } = require("../../cloudfunctions/campusflowAdpTools/src/agent-tools.js");
const { isMultiObjectRequest, resolveRank, resolveDrilldownWeek } = require("../tools/rank-semantics.js");

const R49_MA = path.join(__dirname, "..");
const FIXTURES = require("./fixtures/multi-turn-cases.json");
const MAIN = fs.readFileSync(path.join(R49_MA, "agents", "main-orchestrator.md"), "utf8");
const INSIGHT = fs.readFileSync(path.join(R49_MA, "agents", "campus-insight.md"), "utf8");
const SCHEDULE = fs.readFileSync(path.join(R49_MA, "agents", "schedule-space.md"), "utf8");
const RISK = fs.readFileSync(path.join(R49_MA, "agents", "risk-planning.md"), "utf8");
const HANDOFF = fs.readFileSync(path.join(R49_MA, "03-HANDOFF-POLICY.md"), "utf8");
const CONTEXT = fs.readFileSync(path.join(R49_MA, "04-CONTEXT-POLICY.md"), "utf8");
const E2E_MATRIX = fs.readFileSync(path.join(R49_MA, "09-MULTI-AGENT-E2E-MATRIX.md"), "utf8");

function overview() {
  const env = callAgentTool("campus_overview", {});
  assert.strictEqual(env.success, true);
  return env.items[0];
}

// ---------------------------------------------------------------------------
// A. teacherLoadTop 稳定排序（并列时 position 仍稳定）
// ---------------------------------------------------------------------------
test("A. teacherLoadTop 稳定排序：指标并列时 Top1/Top2 position 稳定、重跑一致、tie-break 确定性", () => {
  const first = overview();
  const top = first.teacherLoadTop;
  assert.ok(top.length >= 3, "teacherLoadTop 应至少 3 项");
  assert.strictEqual(top[0].teacherName, "教师009", "v2 数据锚点：Top1=教师009");
  assert.ok(
    top[0].lessonOccurrences === top[1].lessonOccurrences && top[0].periodUnits === top[1].periodUnits,
    "v2 数据锚点：Top1/Top2 业务指标并列（27/54 与 27/54），本测试即围绕该真实并列构造",
  );
  assert.ok(
    top[0].teacherName.localeCompare(top[1].teacherName, "zh-CN") < 0,
    "指标并列时必须按 teacherName zh-CN tie-break 稳定排序",
  );
  const second = overview();
  assert.deepStrictEqual(second.teacherLoadTop, top, "重复调用 teacherLoadTop 必须逐字节一致（确定性）");
  const cmp = (left, right) => (
    right.lessonOccurrences - left.lessonOccurrences
    || right.periodUnits - left.periodUnits
    || left.teacherName.localeCompare(right.teacherName, "zh-CN")
  );
  for (let i = 0; i < top.length - 1; i += 1) {
    assert.ok(cmp(top[i], top[i + 1]) <= 0, `teacherLoadTop 相邻项必须满足 lessonOccurrences DESC → periodUnits DESC → teacherName ASC（index ${i}）`);
  }
});

// ---------------------------------------------------------------------------
// B. 链路：未来四周 → 看Top1课表 → 检查Top1风险
// ---------------------------------------------------------------------------
test("B. 链路：Top1 drilldown NO clarification，entity=teacherLoadTop[0]，risk mode=self", () => {
  const item = overview();
  const top = item.teacherLoadTop;
  const window = { kind: "future_weeks", count: 4 };
  assert.strictEqual(resolveDrilldownWeek(window, null), 1, "未显式指定教学周 → drilldownAcademicWeek=1");

  const t2 = resolveRank("看Top1课表");
  assert.strictEqual(t2.kind, "single", "「看Top1课表」必须是单排位（即使指标并列），不得进入澄清分支");
  assert.strictEqual(t2.rank, 1);
  const entity1 = top[t2.rank - 1];
  assert.strictEqual(entity1.teacherName, "教师009", "Top1 实体 = teacherLoadTop[0]");

  const sch = callAgentTool("campus_schedule_query", { entityType: "teacher", entityName: entity1.teacherName, week: 1 });
  assert.strictEqual(sch.success, true, "Top1 课表必须成功（无澄清）");
  assert.strictEqual(sch.items.length, 6, "教师009 第 1 周应 6 节");

  const t3 = resolveRank("检查Top1风险");
  assert.strictEqual(t3.kind, "single");
  assert.strictEqual(t3.rank, 1);
  const risk = callAgentTool("campus_risk_check", { mode: "self", entityType: "teacher", entityName: entity1.teacherName, week: 1 });
  assert.strictEqual(risk.success, true);
  assert.strictEqual(risk.summary.selfCompare, true, "Top1 风险必须 self 模式");
  assert.strictEqual(risk.summary.conflictCount, 1, "教师009 第 1 周冲突必须为 1（非污染后 2）");
  assert.strictEqual(risk.summary.rushWarningCount, 1, "教师009 第 1 周赶场必须为 1");
});

// ---------------------------------------------------------------------------
// C. overviewWindow.count 不得成为 academicWeek
// ---------------------------------------------------------------------------
test("C. overviewWindow.count=4 与 academicWeek 严格隔离（week 恒为 1，绝不 4）", () => {
  const item = overview();
  const window = item.window;
  assert.strictEqual(window.teachingWeeks.count, 4, "overview 聚合窗口应为 4 周");
  const overviewWindow = { kind: "future_weeks", count: window.teachingWeeks.count };
  const drilldownWeek = resolveDrilldownWeek(overviewWindow, null);
  assert.strictEqual(drilldownWeek, 1, "聚合窗口 count=4 不得推导为教学周 4");
  assert.notStrictEqual(drilldownWeek, overviewWindow.count, "week 不得等于 overviewWindow.count（跨域 slot collision 回归）");
  const explicit = resolveDrilldownWeek(overviewWindow, 7);
  assert.strictEqual(explicit, 7, "用户显式指定教学周时用显式值");
});

// ---------------------------------------------------------------------------
// D/E. schedule / risk drilldown 均 week=1
// ---------------------------------------------------------------------------
test("D/E. schedule 与 risk 下钻均携带 week=1（CASE D 标准链）", () => {
  const item = overview();
  const caseD = FIXTURES.hardCases.find((c) => c.id === "D");
  assert.strictEqual(caseD.turns[1].state.week, 1, "fixture：schedule 下钻 week=1");
  assert.strictEqual(caseD.turns[2].state.week, 1, "fixture：risk 下钻 week=1");
  assert.strictEqual(caseD.turns[1].state.rank, 1);
  assert.strictEqual(caseD.turns[2].state.rank, 1);
  const dropped = caseD.turns[1].dropped || [];
  assert.ok(dropped.includes("overviewWindow"), "fixture：schedule 下钻必须 drop overviewWindow");
  const ov = callAgentTool("campus_schedule_query", { entityType: "teacher", entityName: item.teacherLoadTop[0].teacherName, week: 1 });
  assert.strictEqual(ov.success, true);
  assert.ok(ov.items.length > 0);
});

// ---------------------------------------------------------------------------
// F. Top2 下钻 = teacherLoadTop[1]，不得调用 Top1
// ---------------------------------------------------------------------------
test("F. Top2 下钻：entity=teacherLoadTop[1]，不得落在 Top1", () => {
  const item = overview();
  const top = item.teacherLoadTop;
  const r = resolveRank("看Top2课表");
  assert.strictEqual(r.kind, "single");
  assert.strictEqual(r.rank, 2);
  const entity = top[r.rank - 1];
  assert.strictEqual(entity.teacherName, "教师011", "Top2 实体 = teacherLoadTop[1]（v2 锚点）");
  assert.notStrictEqual(entity.teacherName, "教师009", "Top2 不得调用 Top1 实体");
  const sch = callAgentTool("campus_schedule_query", { entityType: "teacher", entityName: entity.teacherName, week: 1 });
  assert.strictEqual(sch.success, true);
  assert.ok(sch.items.length > 0, "教师011 第 1 周应有课");
  const d2 = FIXTURES.rankDrilldown.find((c) => c.id === "D2");
  assert.strictEqual(d2.turns[1].state.rank, 2);
  assert.strictEqual(d2.turns[1].state.week, 1);
});

// ---------------------------------------------------------------------------
// G. 并列第一都有谁：如实列并列项，不压缩为 Top1，不破坏 rankContext
// ---------------------------------------------------------------------------
test("G. 多对象轮：并列第一都如实列出，selectedRank 保持 null，rankContext 不被破坏", () => {
  const item = overview();
  const top = item.teacherLoadTop;
  assert.ok(isMultiObjectRequest("并列第一都有谁"), "「并列第一都有谁」必须判定为多对象语义");
  assert.strictEqual(resolveRank("并列第一都有谁").kind, "multi", "多对象轮不得解析为 Top1");
  const tied = top.filter((t) => t.lessonOccurrences === top[0].lessonOccurrences && t.periodUnits === top[0].periodUnits);
  assert.ok(tied.length >= 2, "并列项应不少于 2 位（教师009 + 教师011）");
  assert.deepStrictEqual(tied.map((t) => t.teacherName), ["教师009", "教师011"], "并列项必须来自本轮真实结果");
  const d3 = FIXTURES.rankDrilldown.find((c) => c.id === "D3");
  assert.strictEqual(d3.turns[1].state.multiObject, true);
  assert.strictEqual(d3.turns[1].state.rankContext.selectedRank, null, "多对象轮 selectedRank 必须保持 null");
});

// ---------------------------------------------------------------------------
// H. 多对象轮之后「看Top1课表」仍落 teacherLoadTop[0]
// ---------------------------------------------------------------------------
test("H. 多对象轮后单排位仍正确落 teacherLoadTop[0]，NO clarification", () => {
  const item = overview();
  const top = item.teacherLoadTop;
  const d3 = FIXTURES.rankDrilldown.find((c) => c.id === "D3");
  assert.strictEqual(d3.turns[2].state.rank, 1, "多对象轮后「看Top1课表」仍是 rank=1");
  const r = resolveRank("看Top1课表");
  assert.strictEqual(r.kind, "single");
  assert.strictEqual(r.rank, 1);
  const entity = top[r.rank - 1];
  assert.strictEqual(entity.teacherName, "教师009", "多对象轮后 Top1 仍 = teacherLoadTop[0]");
  const sch = callAgentTool("campus_schedule_query", { entityType: "teacher", entityName: entity.teacherName, week: 1 });
  assert.strictEqual(sch.success, true);
});

// ---------------------------------------------------------------------------
// 契约：prompt / handoff / context policy / matrix 已同步 R49.3 语义
// ---------------------------------------------------------------------------
test("契约 1：Main prompt 含并列不澄清、rank position、week 隔离规则", () => {
  assert.ok(MAIN.includes("teacherLoadTop[0]"), "Main 必须引用 teacherLoadTop[0]");
  assert.ok(MAIN.includes("position 语义"), "Main 必须声明 Top1 为 position 语义");
  assert.ok(MAIN.includes("NO CLARIFICATION"), "Main 必须声明单排位 NO CLARIFICATION");
  assert.ok(MAIN.includes("并列第一的两个"), "Main 必须包含多对象触发短语");
  assert.ok(MAIN.includes("drilldownAcademicWeek = 1"), "Main 必须声明下钻默认周=1");
  assert.ok(MAIN.includes("overviewWindow.count") && MAIN.includes("绝不等于 academicWeek"), "Main 必须隔离 overviewWindow 与教学周");
  assert.ok(MAIN.includes("rankContext"), "Main 信封必须含 rankContext");
  assert.ok(MAIN.includes("禁止硬编码 教师009") || MAIN.includes("禁止写死"), "Main 不得允许硬编码教师009");
});

test("契约 2：Insight prompt 含 rankContext / selectedRank / 并列不压缩 / week 隔离", () => {
  assert.ok(INSIGHT.includes("rankContext"), "Insight 必须返回 rankContext");
  assert.ok(INSIGHT.includes("selectedRank"), "Insight 必须管理 selectedRank");
  assert.ok(INSIGHT.includes("教师009与教师011并列最高") || INSIGHT.includes("并列最高"), "Insight 必须如实说明并列");
  assert.ok(INSIGHT.includes("不得"), "Insight 并列不得压缩为 Top1");
  assert.ok(INSIGHT.includes("drilldownAcademicWeek=1") || INSIGHT.includes("drilldownAcademicWeek"), "Insight 不得继承 overviewWindow 为教学周");
});

test("契约 3：Handoff/Context policy 含排位语义与 overviewWindow 隔离；Schedule/Risk 含下钻周次规则", () => {
  assert.ok(HANDOFF.includes("rankContext"), "03-HANDOFF-POLICY 信封必须含 rankContext");
  assert.ok(HANDOFF.includes("position 语义") || HANDOFF.includes("position"), "03 必须声明 position 语义");
  assert.ok(HANDOFF.includes("6.1") && HANDOFF.includes("6.2"), "03 必须含排位语义与时间策略小节");
  assert.ok(HANDOFF.includes("drilldownAcademicWeek = 1"), "03 必须声明下钻默认周=1");
  assert.ok(CONTEXT.includes("overviewWindow") && CONTEXT.includes("绝不继承为 activeTime.week"), "04 必须隔离 overviewWindow");
  assert.ok(CONTEXT.includes("并列第一的两个") || CONTEXT.includes("这两位"), "04 必须含多对象短语");
  assert.ok(SCHEDULE.includes("drilldownAcademicWeek=1"), "schedule-space 必须声明下钻周次");
  assert.ok(RISK.includes("drilldownAcademicWeek=1"), "risk-planning 必须声明下钻周次");
  assert.ok(RISK.includes("mode=self") && RISK.includes("绝不要求第二对象"), "risk-planning self 铁律不变");
});

test("契约 4：矩阵 CASE D/D-2/D-3 与 fixtures rankDrilldown 同步", () => {
  assert.ok(E2E_MATRIX.includes("CASE D-2"), "矩阵必须含 Top2 变体");
  assert.ok(E2E_MATRIX.includes("CASE D-3"), "矩阵必须含并列多对象变体");
  assert.ok(E2E_MATRIX.includes("并列不澄清"), "矩阵必须声明并列不澄清");
  assert.ok(E2E_MATRIX.includes("drilldown"), "矩阵必须含下钻周次说明");
  assert.ok(E2E_MATRIX.includes("campus_day_plan(date=2026-09-06)"), "矩阵 CASE C 必须含 09-06 evidence 契约");
  assert.deepStrictEqual(FIXTURES.rankDrilldown.map((c) => c.id), ["D2", "D3"]);
  const d = FIXTURES.hardCases.find((c) => c.id === "D");
  assert.deepStrictEqual(d.turns.map((t) => t.route), ["insight", "schedule", "risk"], "CASE D 主链路由不变");
});

test("契约 5：rank-semantics 纯函数边界（多对象优先、未知引用 none）", () => {
  assert.strictEqual(isMultiObjectRequest("把并列第一两位都给我看看"), true);
  assert.strictEqual(isMultiObjectRequest("他们呢"), true);
  assert.strictEqual(isMultiObjectRequest("比较这两位"), true);
  assert.strictEqual(resolveRank("看Top3课表").rank, 3);
  assert.strictEqual(resolveRank("排第一那个").rank, 1);
  assert.strictEqual(resolveRank("第二个").rank, 2);
  assert.strictEqual(resolveRank("随便看看").kind, "none");
  assert.strictEqual(resolveDrilldownWeek({ kind: "future_weeks", count: 4 }, null), 1);
  assert.strictEqual(resolveDrilldownWeek(null, null), null, "无窗口且无显式周 → 不猜（null）");
  assert.strictEqual(resolveDrilldownWeek({ kind: "future_weeks", count: 4 }, 4), 4, "用户显式说第4周则用 4");
});