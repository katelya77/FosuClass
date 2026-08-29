"use strict";
// R49.4.1 Prompt Consistency Gate（2026-08-17）
//
// 目标：消除 R49.3 → R49.4 升级后残留在 Agent Prompt / policy 中的语义冲突。
// 设计真源：docs/superpowers/specs/2026-08-17-r49.4.1-adp-console-convergence-design.md §6。
//
// 门禁断言（语义，不是文件存在性）：
//  1. Main/Insight 明确声明教师负载窗口排名使用 campus_teacher_load_query；
//  2. 不允许「动态负载/风险数字全部来自 campus_overview」与「窗口变化必须重新调用 campus_overview」
//     这类 overview-only 旧规则（与 teacher_load 职责冲突）；
//  3. rankContext 来源必须 source-aware（sourceTool），不得把 source 硬编码为 campus_overview；
//  4. Schedule 多周 detailWindow 必须使用 campus_schedule_range_query；
//  5. Risk 多周 rank 下钻未给单周/日期时必须 NEED_CLARIFICATION，绝不默认 week=1；
//  6. 不允许 drilldownAcademicWeek=1 之类的退役默认；
//  7. overviewWindow 聚合计数必须与 activeTime.week 隔离；
//  8. Top1/Top2/Top3 保持 position 语义、并列不澄清（NO CLARIFICATION）。
//
// 该测试必须在旧 Prompt 上失败（证明 R49.3 残留真实存在），在 R49.4.1 修复后变绿。

const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const read = (name) => fs.readFileSync(path.join(ROOT, name), "utf8");
const MAIN = read("agents/main-orchestrator.md");
const INSIGHT = read("agents/campus-insight.md");
const SCHEDULE = read("agents/schedule-space.md");
const RISK = read("agents/risk-planning.md");
const HANDOFF = read("03-HANDOFF-POLICY.md");
const CONTEXT = read("04-CONTEXT-POLICY.md");

test("R49.4.1-1 teacher-load ranking has one authoritative tool", () => {
  assert.match(MAIN, /教师负载.*campus_teacher_load_query/s, "Main 必须把教师负载窗口排名路由到 campus_teacher_load_query");
  assert.match(INSIGHT, /教师负载.*campus_teacher_load_query/s, "Insight 必须把教师负载窗口排名绑定 campus_teacher_load_query");
  assert.doesNotMatch(INSIGHT, /动态负载\/风险数字全部来自 `campus_overview`/, "R49.3 旧规则「动态负载/风险数字全部来自 campus_overview」必须删除（与 teacher_load 冲突）");
  assert.doesNotMatch(INSIGHT, /窗口[^。\n]*必须重新调用[^。\n]*campus_overview/, "R49.3 旧规则「窗口变化必须重新调用 campus_overview」必须删除（overview 不得替代任意教师负载窗口排名）");
});

test("R49.4.1-2 rankContext is source-aware instead of overview-only", () => {
  assert.match(MAIN, /sourceTool/, "Main rankContext 必须声明 sourceTool（当前真实产生排名的工具）");
  assert.match(INSIGHT, /sourceTool/, "Insight rankContext 必须声明 sourceTool");
  assert.match(HANDOFF, /sourceTool/, "Handoff 信封 rankContext 必须声明 sourceTool");
  assert.doesNotMatch(MAIN, /source:\s*"campus_overview"/, "Main rankContext 不得把 source 硬编码为 campus_overview");
  assert.doesNotMatch(INSIGHT, /source:\s*"campus_overview"/, "Insight rankContext 不得把 source 硬编码为 campus_overview");
  assert.doesNotMatch(HANDOFF, /source:\s*"campus_overview"/, "Handoff 信封 rankContext 不得把 source 硬编码为 campus_overview");
});

test("R49.4.1-3 multi-week schedule and risk window semantics stay separated", () => {
  assert.match(SCHEDULE, /campus_schedule_range_query/, "Schedule 多周 detailWindow 必须使用 campus_schedule_range_query");
  assert.match(SCHEDULE, /detailWindow/, "Schedule 必须按 detailWindow 选择工具形态");
  assert.match(RISK, /NEED_CLARIFICATION/, "Risk 无显式单周/日期时必须 NEED_CLARIFICATION");
  assert.match(RISK, /绝不.*week=1/, "Risk 必须声明绝不默认 week=1");
  assert.doesNotMatch(MAIN, /drilldownAcademicWeek\s*=\s*1/, "Main 不得再声明退役默认 drilldownAcademicWeek=1");
  assert.doesNotMatch(SCHEDULE, /drilldownAcademicWeek/, "Schedule 不得再声明退役默认 drilldownAcademicWeek");
  assert.doesNotMatch(RISK, /drilldownAcademicWeek/, "Risk 不得再声明退役默认 drilldownAcademicWeek");
  assert.match(CONTEXT, /overviewWindow[^。\n]*绝不继承为 activeTime\.week/, "overviewWindow 聚合计数必须与 activeTime.week 严格隔离");
  assert.match(CONTEXT, /绝不[^。\n]*week=1/, "Context policy 必须声明绝不默认 week=1");
});

test("R49.4.1-4 Top1 remains deterministic position semantics", () => {
  for (const text of [MAIN, INSIGHT, HANDOFF, CONTEXT]) {
    assert.match(text, /position 语义/, "Top1/Top2/Top3 必须声明为 position 语义");
  }
  assert.match(MAIN, /NO CLARIFICATION/, "单排位引用必须 NO CLARIFICATION（并列不澄清）");
  assert.match(MAIN, /禁止硬编码 教师009|禁止写死/, "Main 必须声明禁止硬编码比赛数据实体");
});
