"use strict";
// R49.2.1 / G1.1 新增测试：Runtime & Contract Hardening
//
// 覆盖：
//  1. 校区别名确定性解析（校区A / A校区 / A / a / campus-a / campusA；B/C 同理）——
//     type-specific（只影响 campus 语义参数），别名由 data.campuses name/id 动态派生，不硬编码。
//  2. campus_classroom_search ADP 0 值掩码潜伏问题回归：resolveTimeRange 必须读归一化后的 input，
//     weekday=0 视为未指定（date 可推导）；节次真缺失保持 INVALID_PARAM fail-closed。
//  3. Domain Agent fresh-tool-call 纪律契约（prompt 文本 + 09 矩阵 + multi-turn fixtures）。
//  4. Insight teacher Top1 → schedule → risk(self) 真实链路（Top1=teacherLoadTop[0]，不写死）。
//  5. 「未来四周哪个校区最忙」= Insight 单域用例，不得下钻个人 schedule/risk。
//
// 断言只使用 competition-demo-v2 真实数据派生的事实；teacher-009 等仅作断言锚点，运行时不得硬编码。

const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const path = require("path");

const V2_PATH = path.join(__dirname, "..", "..", "mock-data", "competition-demo-v2.json");
process.env.CAMPUS_DATA_PATH = V2_PATH;

const { callAgentTool } = require("../../cloudfunctions/campusflowAdpTools/src/agent-tools.js");

const R49_MA = path.join(__dirname, "..");
const FIXTURES = require("./fixtures/multi-turn-cases.json");
const SCHEDULE_SPACE = fs.readFileSync(path.join(R49_MA, "agents", "schedule-space.md"), "utf8");
const RISK_PLANNING = fs.readFileSync(path.join(R49_MA, "agents", "risk-planning.md"), "utf8");
const CAMPUS_INSIGHT = fs.readFileSync(path.join(R49_MA, "agents", "campus-insight.md"), "utf8");
const E2E_MATRIX = fs.readFileSync(path.join(R49_MA, "09-MULTI-AGENT-E2E-MATRIX.md"), "utf8");

const CANONICAL_CAMPUS_NAMES = ["校区A", "校区B", "校区C"];
const CAMPUS_ALIASES = {
  "校区A": ["校区A", "A校区", "A", "a", "campus-a", "campusA"],
  "校区B": ["校区B", "B校区", "B", "b", "campus-b", "campusB"],
  "校区C": ["校区C", "C校区", "C", "c", "campus-c", "campusC"],
};

function classroomQuery(campus, extra) {
  return callAgentTool("campus_classroom_search", Object.assign(
    { campus, date: "2026-09-03", periodStart: 5, periodEnd: 6, minCapacity: 60 },
    extra,
  ));
}

function roomIds(env) {
  return env.items.map((r) => r.roomId).sort();
}

// ---------------------------------------------------------------------------
// 1. 校区别名：别名与规范名等价（同一 campusId + 同一房间集合），B/C 通用
// ---------------------------------------------------------------------------
test("1. 校区别名：A校区/A/a/campus-a/campusA 与 校区A 完全等价", () => {
  const canonical = classroomQuery("校区A");
  assert.strictEqual(canonical.success, true);
  const canonicalRooms = roomIds(canonical);
  assert.ok(canonicalRooms.length > 0, "校区A 应存在空教室");
  for (const alias of CAMPUS_ALIASES["校区A"]) {
    const env = classroomQuery(alias);
    assert.strictEqual(env.success, true, `别名「${alias}」应解析成功`);
    assert.strictEqual(env.items[0].campusName, "校区A", `别名「${alias}」应归属校区A`);
    assert.deepStrictEqual(roomIds(env), canonicalRooms, `别名「${alias}」房间集合应与规范名一致`);
  }
});

test("2. 校区别名：B/C 校区别名通用（不含硬编码 A）", () => {
  for (const canonicalName of ["校区B", "校区C"]) {
    const canonical = classroomQuery(canonicalName);
    assert.strictEqual(canonical.success, true);
    const canonicalRooms = roomIds(canonical);
    assert.ok(canonicalRooms.length > 0, `${canonicalName} 应存在空教室`);
    for (const alias of CAMPUS_ALIASES[canonicalName]) {
      const env = classroomQuery(alias);
      assert.strictEqual(env.success, true, `别名「${alias}」应解析成功`);
      assert.strictEqual(env.items[0].campusName, canonicalName);
      assert.deepStrictEqual(roomIds(env), canonicalRooms, `别名「${alias}」房间集合应与规范名一致`);
    }
  }
});

test("3. 未知校区 → ENTITY_NOT_FOUND fail-closed（不模糊匹配）", () => {
  const env = classroomQuery("校区X");
  assert.strictEqual(env.success, false);
  assert.strictEqual(env.error.code, "ENTITY_NOT_FOUND");
  assert.ok(env.error.message.includes("校区X"));
});

test("4. day_plan preferredCampus 支持别名（A校区 成功；未知校区 fail-closed）", () => {
  const env = callAgentTool("campus_day_plan", {
    date: "2026-09-04", preferredCampus: "A校区", preferredStudyDuration: 2,
  });
  assert.strictEqual(env.success, true, "preferredCampus=A校区 应解析成功");
  const bad = callAgentTool("campus_day_plan", { date: "2026-09-04", preferredCampus: "校区X" });
  assert.strictEqual(bad.success, false);
  assert.strictEqual(bad.error.code, "ENTITY_NOT_FOUND");
});

// ---------------------------------------------------------------------------
// 2. classroom ADP 0 值掩码潜伏问题（resolveTimeRange 必须读归一化后的 input）
// ---------------------------------------------------------------------------
test("5. classroom 0-mask：date + weekday=0 + 真实节次 → 成功（weekday 由 date 推导）", () => {
  const env = callAgentTool("campus_classroom_search", {
    campus: "校区A", date: "2026-09-03", weekday: 0, periodStart: 5, periodEnd: 6, minCapacity: 60,
  });
  assert.strictEqual(env.success, true, "date+weekday=0+真实节次应成功");
  assert.ok(env.items.length > 0);
  for (const it of env.items) {
    assert.strictEqual(it.campusName, "校区A");
    assert.strictEqual(it.freePeriodStart, 5);
    assert.strictEqual(it.freePeriodEnd, 6);
  }
});

test("6. classroom 0-mask：week + weekday=0 + 真实节次 → MISSING_PARAM fail-closed（空教室需明确 weekday/date）", () => {
  const env = callAgentTool("campus_classroom_search", {
    campus: "校区A", week: 1, weekday: 0, periodStart: 5, periodEnd: 6,
  });
  assert.strictEqual(env.success, false);
  assert.strictEqual(env.error.code, "MISSING_PARAM");
  assert.ok(env.error.message.includes("weekday"), "应提示缺少明确 weekday");
});

test("7. classroom 0-mask：date + 全 0 载荷 → INVALID_PARAM fail-closed（节次真缺失不得静默全时段）", () => {
  const env = callAgentTool("campus_classroom_search", {
    campus: "校区A", date: "2026-09-03", weekday: 0, periodStart: 0, periodEnd: 0,
  });
  assert.strictEqual(env.success, false);
  assert.strictEqual(env.error.code, "INVALID_PARAM");
});

test("8. preferredStudyDuration=0 → INVALID_PARAM 铁律不变（不得删除该校验）", () => {
  const env = callAgentTool("campus_day_plan", {
    date: "2026-09-04", preferredStudyDuration: 0,
  });
  assert.strictEqual(env.success, false);
  assert.strictEqual(env.error.code, "INVALID_PARAM");
});

// ---------------------------------------------------------------------------
// 3. Fresh-tool-call 纪律（runtime 语义 + prompt/矩阵/fixtures 契约）
// ---------------------------------------------------------------------------
test("9. T09 fresh-call：整周=6 节；新 Turn 只看周三必须重调 weekday=3 → 恰好 3 节（非截取）", () => {
  const week = callAgentTool("campus_schedule_query", { entityType: "teacher", entityName: "T09", week: 1 });
  assert.strictEqual(week.success, true);
  assert.strictEqual(week.items.length, 6, "T09 第 1 周整周应 6 节");
  const wed = callAgentTool("campus_schedule_query", { entityType: "teacher", entityName: "T09", week: 1, weekday: 3 });
  assert.strictEqual(wed.success, true);
  assert.strictEqual(wed.items.length, 3, "T09 week=1 weekday=3 重调应恰好 3 节");
  assert.deepStrictEqual([...new Set(wed.items.map((i) => i.weekday))], [3], "重调结果应全部为周三");
  assert.deepStrictEqual(wed.items.map((i) => i.lessonId).sort(), ["lesson-018", "lesson-051", "lesson-052"]);
  const wedMask = callAgentTool("campus_schedule_query", {
    entityType: "teacher", entityName: "T09", week: 1, weekday: 3, periodStart: 0, periodEnd: 0,
  });
  assert.strictEqual(wedMask.success, true);
  assert.strictEqual(wedMask.items.length, 3, "周三查询带 0-mask 应与不带一致");
});

test("10. prompt 契约：三个域 Agent 均含 fresh-tool-call 铁律", () => {
  for (const [file, text] of [["schedule-space.md", SCHEDULE_SPACE], ["risk-planning.md", RISK_PLANNING], ["campus-insight.md", CAMPUS_INSIGHT]]) {
    assert.ok(text.includes("fresh-tool-call"), `${file} 应含 fresh-tool-call 规则`);
    assert.ok(text.includes("必须重新调用") || text.includes("必须重调"), `${file} 应声明重新调用`);
  }
  assert.ok(SCHEDULE_SPACE.includes("campus_schedule_query(entity=T09, week=1, weekday=3)"), "schedule-space 应含 T09 周三重调示例");
  assert.ok(RISK_PLANNING.includes("campus_day_plan(date=下一天)"), "risk-planning 应含下一天重调示例");
});

test("11. fixtures/矩阵契约：CASE D（D1~D5）首轮为教师负载 Top1，校区最忙为单域用例", () => {
  const caseD = FIXTURES.hardCases.find((c) => c.id === "D");
  assert.ok(caseD.turns[0].input.includes("教师负载"), "CASE D 首轮应为教师负载问题");
  assert.ok(caseD.turns[0].hard.includes("teacherLoadTop[0]"), "CASE D 首轮 hard 应引用 teacherLoadTop[0]");
  assert.ok(caseD.turns[0].tools.includes("campus_teacher_load_query"), "CASE D 首轮必须走教师负载工具（D1）");
  assert.deepStrictEqual(caseD.turns.map((t) => t.route), ["insight", "schedule", "schedule", "clarify"], "CASE D 路由必须为 D1→D2→D3→D5");
  const core4 = FIXTURES.coreCases.find((c) => c.id === 4);
  assert.ok(core4.input.includes("哪个校区最忙"), "核心 case 4 保留校区最忙单域用例");
  assert.ok(core4.hard.includes("不得下钻"), "核心 case 4 应声明不下钻个人 schedule/risk");
  const matrixD = E2E_MATRIX.split("### CASE D：")[1].split("\n")[0];
  assert.ok(matrixD.includes("教师负载Top1"), "09 矩阵 CASE D 应为教师负载 Top1 链");
});

// ---------------------------------------------------------------------------
// 4. Insight teacher Top1 → schedule → risk(self) 真实链路（不写死）
// ---------------------------------------------------------------------------
test("12. Top1 链路：overview.teacherLoadTop[0] → schedule(显式W1) → risk(self, 显式W1) 全部成功（并列不澄清 / 显式单周）", () => {
  const ov = callAgentTool("campus_overview", {});
  assert.strictEqual(ov.success, true);
  const top1 = ov.items[0].teacherLoadTop[0];
  assert.ok(top1 && top1.teacherId && top1.teacherId.startsWith("teacher-"), "Top1 必须是教师实体（teacherLoadTop[0]）");
  assert.strictEqual(top1.teacherName, "教师009", "当前真机 Top1=教师009（仅作锚点，不写死运行时）");
  assert.strictEqual(ov.items[0].window.teachingWeeks.count, 4, "overview 聚合窗口应为 4 周（overviewWindow）");
  // R49.3：v2 数据 Top1/Top2 业务指标并列（27/54 与 27/54），position 语义仍唯一确定，不得因此澄清
  assert.strictEqual(ov.items[0].teacherLoadTop[1].lessonOccurrences, top1.lessonOccurrences, "v2 数据 Top2 与 Top1 指标并列（锚点）");
  assert.strictEqual(ov.items[0].teacherLoadTop[1].periodUnits, top1.periodUnits, "v2 数据 Top2 与 Top1 periodUnits 并列（锚点）");
  // R49.4 下钻契约：显式单周（detailWindow 1..1 / academicWeek=1）才直接落 week=1；绝不默认、绝不=聚合窗口 count
  const sch = callAgentTool("campus_schedule_query", { entityType: "teacher", entityName: top1.teacherName, week: 1 });
  assert.strictEqual(sch.success, true);
  assert.ok(sch.items.length > 0, "Top1 教师第 1 周应有课");
  const risk = callAgentTool("campus_risk_check", { mode: "self", entityType: "teacher", entityName: top1.teacherName, week: 1 });
  assert.strictEqual(risk.success, true);
  assert.strictEqual(risk.summary.selfCompare, true, "Top1 风险应为 self 模式");
  assert.strictEqual(risk.summary.conflictCount, 1, "教师009 第 1 周应 1 冲突（与 risk self 既有语义一致）");
  assert.strictEqual(risk.summary.rushWarningCount, 1, "教师009 第 1 周应 1 赶场（非污染后 2/2）");
});

test("13. 校区最忙不下钻：overview actions 仅周级 sys.chat 意图，无个人 schedule/risk 下钻", () => {
  const ov = callAgentTool("campus_overview", {});
  assert.strictEqual(ov.success, true);
  for (const a of ov.actions) {
    assert.strictEqual(a.type, "sys.chat", "overview actions 应为 sys.chat");
    assert.ok(!JSON.stringify(a).includes("entityName"), "overview actions 不得内嵌个人实体下钻");
  }
  const core4 = FIXTURES.coreCases.find((c) => c.id === 4);
  assert.strictEqual(core4.route, "→overview", "校区最忙只路由 overview");
  assert.deepStrictEqual(core4.widget, "campus-overview");
});