"use strict";
// R50.4 view-model 门禁（2026-08-19）
// 确定性投影：CampusResultEnvelope + raw 工具结果 → WidgetViewModel
// P1 布局规则：整周/周范围课表（campus_schedule_query / campus_schedule_range_query、
//    无单日过滤、有课程事实）→ week-board；单日过滤 / campus_day_plan / 非 schedule 变体
//    → result-card；
// P2 week-board 数据：days[].label ∈ 周一..周日（对应 day0Label~day6Label），
//    blocks[].{time,title,location,meta} 与原始课表事实一致、确定性排序、多周携带第X周；
// P3 fail-closed：整周判定成立但无课程事实 → 回退 result-card（事实经 sections 保留）；
// P4 动作：仅官方 sys.chat，payload 仅 query；week-board 追加「看某日明细」续接；
//    不出现 intent / entityId / queryId / rankContext 等内部协议文本；
// P5 确定性：同一输入两次投影字节一致；输出零内部字段泄漏。
const test = require("node:test");
const assert = require("node:assert");
const path = require("path");

const WIDGET_DIR = path.join(__dirname, "..", "..", "r50.2", "widget");
const { projectViewModel, isWholeWeekScope, buildDays, isWeekBoardViewModel, LAYOUT_MODES } = require(path.join(WIDGET_DIR, "view-model.js"));
const { project } = require(path.join(WIDGET_DIR, "variant-adapters.js"));
const { isClean, validateEnvelope } = require(path.join(WIDGET_DIR, "envelope.js"));

const WIDGET_FIELDS = [
  "version", "variant", "status", "title", "subtitle", "verified", "summary", "context",
  "sections", "actions", "displayMeta", "layoutMode", "weekBoardTitle", "weekBoardSubtitle", "days",
];
const DAY_LABELS = ["周一", "周二", "周三", "周四", "周五", "周六", "周日"];

function makeLesson(overrides) {
  return {
    type: "lesson",
    lessonId: "les-x",
    courseName: "程序设计基础",
    teachers: ["教师003"],
    classes: ["2025级A班"],
    roomName: "A2-301",
    campusName: "校区A",
    weekday: 1,
    weekdayName: "周一",
    periodStart: 5,
    periodEnd: 6,
    periodText: "第5-6节",
    startTime: "14:00",
    endTime: "15:40",
    weeks: [1, 2, 3, 4],
    ...overrides,
  };
}

function makeRaw(lessons, overrides) {
  return {
    success: true,
    window: { weekStart: 1, weekEnd: 1 },
    query: { weekStart: 1, weekEnd: 1, weekday: null, periodStart: null, periodEnd: null },
    resolvedEntity: { type: "teacher", id: "t-003", name: "教师003" },
    items: lessons,
    ...overrides,
  };
}

function makeEnvelope(variant, extra) {
  return {
    version: "1.0",
    variant,
    status: "success",
    title: variant === "schedule" ? "教师003 · 第1周课表" : "风险检查 · 教师003",
    subtitle: variant === "schedule" ? "教师003 · 第1周" : "",
    verified: true,
    summary: variant === "schedule" ? "第1周共 5 条课程。" : "发现 1 处风险。",
    context: variant === "schedule" ? "第1周" : "",
    sections: variant === "schedule"
      ? []
      : [{ title: "时间冲突", rows: [{ label: "周二 第3-4节", value: "高等数学 vs 线性代数" }] }],
    actions: [
      { id: "followup", type: "sys.chat", label: "检查这周的风险", payload: { query: "检查教师003第1周风险" } },
      { id: "next-week", type: "sys.chat", label: "看下一个教学周", payload: { query: "查看教师003第2周课表" } },
    ],
    displayMeta: {},
    ...extra,
  };
}

const WEEK_RAW = makeRaw([
  makeLesson({ lessonId: "les-101", courseName: "程序设计基础", weekday: 1, weekdayName: "周一", periodStart: 5, periodEnd: 6, periodText: "第5-6节", startTime: "14:00", endTime: "15:40" }),
  makeLesson({ lessonId: "les-102", courseName: "数据结构", weekday: 1, weekdayName: "周一", periodStart: 7, periodEnd: 8, periodText: "第7-8节", startTime: "16:00", endTime: "17:40" }),
  makeLesson({ lessonId: "les-103", courseName: "操作系统", roomName: "B1-205", campusName: "校区B", weekday: 3, weekdayName: "周三", periodStart: 3, periodEnd: 4, periodText: "第3-4节", startTime: "10:00", endTime: "11:40", teachers: ["教师003"], classes: ["2025级B班"] }),
  makeLesson({ lessonId: "les-104", courseName: "计算机网络", roomName: "B1-206", campusName: "校区B", weekday: 4, weekdayName: "周四", periodStart: 5, periodEnd: 6, periodText: "第5-6节", startTime: "14:00", endTime: "15:40" }),
  makeLesson({ lessonId: "les-105", courseName: "数据库原理", roomName: "A2-303", weekday: 5, weekdayName: "周五", periodStart: 1, periodEnd: 2, periodText: "第1-2节", startTime: "08:00", endTime: "09:40" }),
]);

test("P1: 整周课表（无单日过滤）→ week-board，且数据与事实一致", () => {
  const envelope = makeEnvelope("schedule");
  const result = projectViewModel(WEEK_RAW, "campus_schedule_query", envelope);
  assert.strictEqual(result.ok, true, JSON.stringify(result.errors));
  const vm = result.viewModel;
  assert.strictEqual(vm.layoutMode, "week-board");
  assert.deepStrictEqual(Object.keys(vm).sort(), [...WIDGET_FIELDS].sort());
  assert.strictEqual(vm.weekBoardTitle, "教师003 · 第1周课表");
  assert.strictEqual(vm.weekBoardSubtitle, "教师003 · 第1周");
  assert.strictEqual(vm.days.length, 4, "周一/周三/周四/周五共 4 个板块，空天折叠");
  assert.deepStrictEqual(vm.days.map((day) => day.label), ["周一", "周三", "周四", "周五"]);
  const monday = vm.days[0];
  assert.strictEqual(monday.blocks.length, 2, "周一 2 节（程序设计基础 + 数据结构）");
  assert.strictEqual(monday.blocks[0].title, "程序设计基础", "按 periodStart 确定性排序（第5-6节在前）");
  assert.strictEqual(monday.blocks[1].title, "数据结构");
  assert.strictEqual(monday.blocks[0].time, "第5-6节");
  assert.strictEqual(monday.blocks[0].location, "校区A A2-301");
  assert.strictEqual(monday.blocks[0].meta, "14:00-15:40 · 教师003 · 2025级A班");
  const wednesday = vm.days[1];
  assert.strictEqual(wednesday.blocks[0].location, "校区B B1-205");
  assert.strictEqual(wednesday.blocks[0].meta, "10:00-11:40 · 教师003 · 2025级B班");
});

test("P1: 周范围（第1-2周）→ week-board，多周课程携带第X周", () => {
  const raw = makeRaw([
    makeLesson({ lessonId: "les-201", courseName: "高等数学", roomName: "A4-101", weekday: 1, weekdayName: "周一", periodStart: 1, periodEnd: 2, periodText: "第1-2节", startTime: "08:00", endTime: "09:40", weeks: [1, 2] }),
    makeLesson({ lessonId: "les-202", courseName: "操作系统", roomName: "B1-205", campusName: "校区B", weekday: 3, weekdayName: "周三", periodStart: 3, periodEnd: 4, periodText: "第3-4节", startTime: "10:00", endTime: "11:40", weeks: [2] }),
  ], { window: { weekStart: 1, weekEnd: 2 }, query: { weekStart: 1, weekEnd: 2, weekday: null, periodStart: null, periodEnd: null } });
  const envelope = makeEnvelope("schedule", { title: "教师003 · 第1-2周课表", subtitle: "教师003 · 第1-2周", summary: "第1-2周共 2 条课程。", context: "第1-2周" });
  const result = projectViewModel(raw, "campus_schedule_range_query", envelope);
  assert.strictEqual(result.ok, true);
  assert.strictEqual(result.viewModel.layoutMode, "week-board");
  const monday = result.viewModel.days.find((day) => day.label === "周一");
  assert(monday.blocks[0].meta.includes("第1-2周"), "跨周课程 meta 必须携带周次");
  const wednesday = result.viewModel.days.find((day) => day.label === "周三");
  assert(wednesday.blocks[0].meta.includes("第2周"), "仅第2周的课程 meta 必须写明第2周");
});

test("P1: 单日过滤（weekday=3）→ result-card，保留 sections", () => {
  const raw = makeRaw([
    makeLesson({ lessonId: "les-301", courseName: "操作系统", weekday: 3, weekdayName: "周三", periodStart: 3, periodEnd: 4, periodText: "第3-4节" }),
  ], { query: { weekStart: 1, weekEnd: 1, weekday: 3, periodStart: null, periodEnd: null } });
  const envelope = makeEnvelope("schedule", { title: "教师003 · 周三课表明细", subtitle: "教师003 · 第1周 · 周三" });
  const result = projectViewModel(raw, "campus_schedule_query", envelope);
  assert.strictEqual(result.ok, true);
  assert.strictEqual(result.viewModel.layoutMode, "result-card");
  assert.strictEqual(result.viewModel.days.length, 0);
  assert.strictEqual(result.viewModel.weekBoardTitle, "");
  assert.strictEqual(result.viewModel.actions.length, envelope.actions.length, "result-card 不追加日明细按钮");
});

test("P1: campus_day_plan 单日计划 → result-card", () => {
  const raw = makeRaw([makeLesson({})], { query: { weekStart: 1, weekEnd: 1, weekday: 3, periodStart: null, periodEnd: null } });
  const envelope = makeEnvelope("schedule");
  const result = projectViewModel(raw, "campus_day_plan", envelope);
  assert.strictEqual(result.ok, true);
  assert.strictEqual(result.viewModel.layoutMode, "result-card");
});

test("P1: 非 schedule 变体（risk）→ result-card 透传，事实不丢失", () => {
  const envelope = makeEnvelope("risk");
  const result = projectViewModel(null, "campus_risk_check", envelope);
  assert.strictEqual(result.ok, true);
  const vm = result.viewModel;
  assert.strictEqual(vm.layoutMode, "result-card");
  assert.strictEqual(vm.variant, "risk");
  assert.strictEqual(vm.sections.length, 1, "risk 的 sections 事实必须保留");
  assert.strictEqual(vm.sections[0].rows[0].value, "高等数学 vs 线性代数");
});

test("P2: week-board 确定性 —— 同一输入两次投影字节一致", () => {
  const envelope = makeEnvelope("schedule");
  const first = projectViewModel(WEEK_RAW, "campus_schedule_query", envelope);
  const second = projectViewModel(WEEK_RAW, "campus_schedule_query", envelope);
  assert.strictEqual(JSON.stringify(first.viewModel), JSON.stringify(second.viewModel));
  assert.strictEqual(JSON.stringify(first.viewModel.days), JSON.stringify(second.viewModel.days));
});

test("P2: isWholeWeekScope / buildDays / isWeekBoardViewModel 单元行为", () => {
  assert.strictEqual(isWholeWeekScope(WEEK_RAW, "campus_schedule_query"), true);
  assert.strictEqual(isWholeWeekScope(WEEK_RAW, "campus_day_plan"), false, "单日计划工具不算整周");
  assert.strictEqual(isWholeWeekScope({ ...WEEK_RAW, query: { ...WEEK_RAW.query, weekday: 3 } }, "campus_schedule_query"), false);
  assert.strictEqual(isWholeWeekScope(makeRaw([], { window: { weekStart: 1, weekEnd: 1 } }), "campus_schedule_query"), true, "作用域只看查询窗口，课程为空也成立");
  assert.strictEqual(isWholeWeekScope(WEEK_RAW, "campus_risk_check"), false);
  const days = buildDays(WEEK_RAW.items, WEEK_RAW);
  assert.strictEqual(days.length, 4);
  assert(isWeekBoardViewModel({ layoutMode: "week-board", days }));
  assert.strictEqual(isWeekBoardViewModel({ layoutMode: "week-board", days: [] }), false);
  assert.strictEqual(isWeekBoardViewModel({ layoutMode: "result-card", days: [] }), false);
  assert.deepStrictEqual(LAYOUT_MODES, ["result-card", "week-board"]);
});

test("P3: fail-closed —— 整周作用域但无课程事实 → 回退 result-card 且保留标题", () => {
  const raw = makeRaw([]);
  const envelope = makeEnvelope("schedule", { title: "教师003 · 第1周课表", summary: "第1周暂无课程记录。" });
  const result = projectViewModel(raw, "campus_schedule_query", envelope);
  assert.strictEqual(result.ok, true);
  assert.strictEqual(result.viewModel.layoutMode, "result-card", "无课程事实必须回退 result-card");
  assert.strictEqual(result.viewModel.title, "教师003 · 第1周课表", "回退不丢失 Envelope 标题");
  assert(result.errors.length >= 1 && result.errors[0].includes("回退"), "必须返回可核查的回退原因");
});

test("P3: fail-closed —— 课程结构损坏（无课程名/无教室）→ 不进入 week-board", () => {
  const raw = makeRaw([
    makeLesson({ courseName: "", roomName: "", campusName: "" }),
    { type: "lesson", lessonId: "les-x" },
  ]);
  const envelope = makeEnvelope("schedule");
  const result = projectViewModel(raw, "campus_schedule_query", envelope);
  assert.strictEqual(result.ok, true);
  assert.strictEqual(result.viewModel.layoutMode, "result-card", "损坏的课程块不得进入 week-board");
});

test("P4: 动作仅官方 sys.chat；week-board 追加确定性「看某日明细」；零内部协议文本", () => {
  const envelope = makeEnvelope("schedule");
  const result = projectViewModel(WEEK_RAW, "campus_schedule_query", envelope);
  const vm = result.viewModel;
  assert.strictEqual(vm.actions.length, envelope.actions.length + 1, "week-board 追加 1 个日明细续接");
  const dayAction = vm.actions[vm.actions.length - 1];
  assert.strictEqual(dayAction.id, "weekboard-day-detail");
  assert.strictEqual(dayAction.type, "sys.chat");
  assert.strictEqual(dayAction.label, "看周一明细", "确定性选择第一个有课的日");
  assert.deepStrictEqual(Object.keys(dayAction.payload), ["query"]);
  assert.strictEqual(dayAction.payload.query, "查看教师003第1周周一的课表明细");
  for (const action of vm.actions) {
    assert.strictEqual(action.type, "sys.chat");
    assert.deepStrictEqual(Object.keys(action.payload), ["query"]);
  }
  const text = JSON.stringify(vm);
  for (const forbidden of ["intent", "entityId", "queryId", "rankContext", "temporalContext", "NodeID", "VarBizID", "dataHash", "evidence", "token"]) {
    assert(!text.toLowerCase().includes(forbidden.toLowerCase()), `viewModel 不得包含 ${forbidden}`);
  }
});

test("P5: 视图输出零泄漏 —— raw 携带内部字段时 viewModel 不含内部内容", () => {
  const leakedRaw = makeRaw([
    makeLesson({ lessonId: "les-101", courseName: "程序设计基础", weekday: 1, weekdayName: "周一", periodStart: 5, periodEnd: 6, periodText: "第5-6节", internalNote: "queryId=q-1", secret: "sk-test-12345" }),
  ]);
  const envelope = makeEnvelope("schedule");
  const result = projectViewModel(leakedRaw, "campus_schedule_query", envelope);
  assert.strictEqual(result.ok, true);
  const text = JSON.stringify(result.viewModel);
  assert(!text.includes("q-1"), "raw 中的内部字段不得进入视图");
  assert(!text.includes("sk-test"), "raw 中的密钥不得进入视图");
  assert(!text.includes("lessonId"), "lessonId 不得进入视图");
  assert(!text.includes("internalNote"), "内部备注不得进入视图");
});

test("P5: 与 variant-adapters 集成 —— 真实 fixture 投影 + envelope 校验通过", () => {
  const raw = require(path.join(WIDGET_DIR, "fixtures", "schedule.json"));
  const projected = project(raw, "campus_schedule_query");
  assert.strictEqual(projected.ok, true);
  const envelope = projected.envelope;
  assert.strictEqual(validateEnvelope(envelope).ok, true);
  const result = projectViewModel(raw, "campus_schedule_query", envelope);
  assert.strictEqual(result.ok, true, JSON.stringify(result.errors));
  assert.strictEqual(result.viewModel.layoutMode, "week-board", "整周 fixture 必须投影为 week-board");
  const leak = isClean(result.viewModel);
  assert.strictEqual(leak.ok, true, JSON.stringify(leak.violations));
});
