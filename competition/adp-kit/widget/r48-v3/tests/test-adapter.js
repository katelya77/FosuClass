/*
 * R48 Widget V3 — Adapter 单元测试（零依赖）
 * 断言 Adapter 的输入守卫、字段映射、Action 文案生成与裁剪边界。
 * 运行：node tests/test-adapter.js
 */
"use strict";

const path = require("path");
const assert = require("assert");
const adapter = require("../adapter.js");

const HERE = __dirname;

let failures = 0;

function check(name, fn) {
  try {
    fn();
    console.log(`  ok - ${name}`);
  } catch (err) {
    failures += 1;
    console.error(`  FAIL - ${name}`);
    console.error(`    ${err.message.split("\n").join("\n    ")}`);
  }
}

const verifiedEnvelope = (overrides = {}) => ({
  dataVersion: "competition-demo-v1",
  queryId: "qid-demo-0001",
  evidence: { verified: true },
  resolvedEntity: { type: "teacher", name: "教师003" },
  query: { week: 1, weekday: 3 },
  items: [
    {
      lessonId: "L01",
      courseName: "数据结构",
      periodText: "第1-2节",
      startTime: "08:30",
      endTime: "10:05",
      date: "2027-03-03",
      weekday: 3,
      weekdayName: "周三",
      campusName: "校区A",
      building: "教学楼A",
      roomName: "A101",
      teachers: ["教师003"],
      classes: ["计科2401"],
    },
  ],
  ...overrides,
});

console.log("== test-adapter ==");

check("守卫：缺 envelope 抛错", () => {
  assert.throws(() => adapter.adaptScheduleV3(), /missing envelope/);
  assert.throws(() => adapter.adaptClassroomV3(null), /missing envelope/);
  assert.throws(() => adapter.adaptConflictV3(undefined), /missing envelope/);
  assert.throws(() => adapter.adaptDayPlanV3(null), /missing envelope/);
  assert.throws(() => adapter.adaptCampusOverviewV3(), /missing envelope/);
});

check("守卫：错误 dataVersion 抛错", () => {
  const env = verifiedEnvelope({ dataVersion: "competition-demo-v0" });
  assert.throws(() => adapter.adaptScheduleV3(env), /dataVersion/);
  assert.throws(() => adapter.adaptClassroomV3(env), /dataVersion/);
});

check("守卫：未核验结果抛错（成功信封但 verified=false）", () => {
  const env = verifiedEnvelope({ evidence: { verified: false } });
  assert.throws(() => adapter.adaptScheduleV3(env), /unverified/);
  assert.throws(() => adapter.adaptConflictV3(env), /unverified/);
});

check("守卫：成功信封缺 evidence 抛错", () => {
  const env = { dataVersion: "competition-demo-v1", success: true, items: [] };
  assert.throws(() => adapter.adaptDayPlanV3(env), /unverified/);
});

check("守卫：失败 envelope（success=false）不抛错并给出降级视图", () => {
  const view = adapter.adaptScheduleV3({ success: false });
  assert.strictEqual(view.success, false);
  assert.strictEqual(view.evidence.verified, false);
});

check("schedule：基础信封映射", () => {
  const view = adapter.adaptScheduleV3(verifiedEnvelope());
  assert.strictEqual(view.cardType, "schedule");
  assert.strictEqual(view.schemaVersion, "campus-widget/v3");
  assert.strictEqual(view.dataVersion, "competition-demo-v1");
  assert.strictEqual(view.queryId, "qid-demo-0001");
  assert.strictEqual(view.success, true);
  assert.strictEqual(view.statusText, "已核验");
  assert.strictEqual(view.evidence.verified, true);
  assert.strictEqual(view.title, "教师003");
  assert.strictEqual(view.viewMode, "day");
  assert.strictEqual(view.activeWeekday, 3);
  assert.strictEqual(view.summary.totalCount, 1);
  assert.strictEqual(view.items[0].courseName, "数据结构");
  assert.strictEqual(view.items[0].teachers[0], "教师003");
  assert.match(view.footerText, /校园课表工具/);
});

check("schedule：week 模式生成 7 天列表", () => {
  const env = verifiedEnvelope({ query: { week: 3 } });
  const view = adapter.adaptScheduleV3(env);
  assert.strictEqual(view.viewMode, "week");
  assert.strictEqual(view.days.length, 7);
  assert.strictEqual(view.days[2].count, 1);
  assert.strictEqual(view.days[0].count, 0);
});

check("schedule：date 模式（有 date 无 weekday）", () => {
  const env = verifiedEnvelope({ query: { date: "2027-03-01", week: 1 } });
  const view = adapter.adaptScheduleV3(env);
  assert.strictEqual(view.viewMode, "date");
  assert.match(view.timeText, /2027-03-01/);
});

check("schedule：week=1 无上一周，week=20 无下一周", () => {
  const v1 = adapter.adaptScheduleV3(verifiedEnvelope({ query: { week: 1 } }));
  assert.ok(!v1.actions.some((a) => a.id === "schedule-prev-week"), "week=1 不允许出现上一周");
  const v20 = adapter.adaptScheduleV3(verifiedEnvelope({ query: { week: 20 } }));
  assert.ok(!v20.actions.some((a) => a.id === "schedule-next-week"), "week=20 不允许出现下一周");
});

check("schedule：week 模式第 1 周动作=下一周+检查风险（≤3）", () => {
  const view = adapter.adaptScheduleV3(verifiedEnvelope({ query: { week: 1 } }));
  assert.deepStrictEqual(view.actions.map((a) => a.id), ["schedule-next-week", "schedule-week-risk"]);
  assert.ok(view.actions.length <= 3);
  assert.ok(view.actions.every((a) => a.type === "sys.chat" && a.message));
});

check("schedule：day 模式动作为 查看整周/换一天/检查风险", () => {
  const view = adapter.adaptScheduleV3(verifiedEnvelope());
  assert.deepStrictEqual(view.actions.map((a) => a.id), ["schedule-week", "schedule-choose-day", "schedule-risk"]);
});

check("classroom：normal 映射与动作", () => {
  const env = {
    dataVersion: "competition-demo-v1",
    evidence: { verified: true },
    query: { campus: "校区A", date: "2027-03-01", periodStart: 3, periodEnd: 4 },
    items: [
      { roomName: "A101", campusName: "校区A", building: "教学楼A", capacity: 60, type: "多媒体教室", periodText: "第3-4节", date: "2027-03-01" },
      { roomName: "A102", campusName: "校区A", building: "教学楼A", capacity: 45, roomType: "普通教室", periodText: "第3-4节", date: "2027-03-01" },
    ],
  };
  const view = adapter.adaptClassroomV3(env);
  assert.strictEqual(view.statusText, "已核验");
  assert.strictEqual(view.summary.totalCount, 2);
  assert.strictEqual(view.summary.empty, false);
  assert.strictEqual(view.filters[0].id, "campus");
  assert.strictEqual(view.filters[1].id, "date");
  assert.strictEqual(view.filters[2].id, "period");
  assert.strictEqual(view.actions.length, 3);
  assert.strictEqual(view.actions[0].id, "classroom-change-campus");
  assert.match(view.actions[0].message, /校区B/);
});

check("classroom：空结果降级动作（放宽容量/取消楼栋/换时段）", () => {
  const env = {
    dataVersion: "competition-demo-v1",
    evidence: { verified: true },
    query: { campus: "校区A", date: "2027-03-01", periodStart: 3, capacity: 100, building: "教学楼A" },
    items: [],
  };
  const view = adapter.adaptClassroomV3(env);
  assert.strictEqual(view.summary.empty, true);
  assert.deepStrictEqual(
    view.actions.map((a) => a.id),
    ["classroom-relax-capacity", "classroom-remove-building", "classroom-change-period"],
  );
  assert.ok(view.actions.every((a) => a.type === "sys.chat" && a.message && a.message !== a.label));
});

check("conflict：双对象比较", () => {
  const env = {
    dataVersion: "competition-demo-v1",
    evidence: { verified: true },
    compared: [{ name: "教师001" }, { name: "教师002" }],
    summary: { conflictCount: 1, rushWarningCount: 0, selfCompare: false, firstBusySlots: 2, secondBusySlots: 3 },
    query: { week: 3 },
    items: [
      {
        date: "2027-03-04",
        weekdayName: "周四",
        periodText: "第3-4节",
        first: { courseName: "课程A", periodText: "第3-4节", campusName: "校区A", roomName: "A101" },
        second: { courseName: "课程B", periodText: "第3-4节", campusName: "校区B", roomName: "B201" },
      },
    ],
    rushWarnings: [],
  };
  const view = adapter.adaptConflictV3(env);
  assert.strictEqual(view.summary.conflictCount, 1);
  assert.strictEqual(view.summary.selfCompare, false);
  assert.strictEqual(view.items[0].first.courseName, "课程A");
  assert.strictEqual(view.actions.length, 2);
  assert.match(view.actions[0].message, /教师001/);
  assert.match(view.actions[1].message, /教师002/);
});

check("conflict：单对象自查（selfCompare）", () => {
  const env = {
    dataVersion: "competition-demo-v1",
    evidence: { verified: true },
    compared: [{ name: "教师003" }],
    summary: { conflictCount: 0, rushWarningCount: 1, selfCompare: true, firstBusySlots: 0, secondBusySlots: 0 },
    query: { week: 1, weekday: 3 },
    items: [],
    rushWarnings: [{ entity: "教师003", date: "2027-03-03", weekdayName: "周三", gapMinutes: 30, from: {}, to: {} }],
  };
  const view = adapter.adaptConflictV3(env);
  assert.strictEqual(view.summary.selfCompare, true);
  assert.strictEqual(view.summary.rushWarningCount, 1);
  assert.strictEqual(view.items.length, 0);
  assert.strictEqual(view.rushWarnings.length, 1);
  assert.deepStrictEqual(view.actions.map((a) => a.id), ["conflict-self-day", "conflict-self-week"]);
});

check("day-plan：映射与动作（有 nextDate 时携带确定日期）", () => {
  const env = {
    dataVersion: "competition-demo-v1",
    evidence: { verified: true },
    query: { date: "2027-03-03", weekday: 3, nextDate: "2027-03-04" },
    summary: { lessonCount: 2, gapCount: 1, studySuggestionCount: 1, hasCrossCampus: false },
    items: [
      { type: "lesson", lessonId: "L1", courseName: "高数", periodText: "第1-2节", startTime: "08:30", endTime: "10:05", campusName: "校区A", roomName: "A101", teachers: ["教师003"], suggestion: "", studyRooms: [] },
      { type: "study", lessonId: "", courseName: "", periodText: "第3-4节", startTime: "", endTime: "", campusName: "校区A", roomName: "", teachers: [], suggestion: "建议去图书馆自习", studyRooms: ["图书馆2层"] },
    ],
  };
  const view = adapter.adaptDayPlanV3(env);
  assert.strictEqual(view.items.length, 2);
  assert.strictEqual(view.summary.lessonCount, 2);
  assert.strictEqual(view.summary.studySuggestionCount, 1);
  assert.strictEqual(view.actions.length, 3);
  assert.match(view.actions[0].message, /2027-03-04/);
});

check("campus-overview：top1 嵌套结构与默认 fallback", () => {
  const env = {
    dataVersion: "competition-demo-v1",
    evidence: { verified: true },
    items: [
      {
        window: { windowStart: "2027-03-01", windowEnd: "2027-03-28", teachingStart: "2027-03-08", preparationPeriod: { startDate: "2027-03-01", endDate: "2027-03-07" } },
        summary: { lessonOccurrences: 1234, teacherCount: 120, roomCount: 80, campusCount: 2, weekCount: 4 },
        matrix: [{ days: [{ lessonCount: 12 }, { lessonCount: 8 }] }],
        campusResources: [{ campusName: "校区A", lessonOccurrences: 700, occupancyRate: 0.62, freeRoomPeriodUnits: 210, largeRoomAvailabilityRate: 0.55 }],
        teacherLoadTop: [{ teacherName: "教师002", lessonOccurrences: 24, periodUnits: 48 }],
        risks: { conflictCount: 2, rushCount: 3, continuousLoadCount: 1 },
        peakSlot: { week: 1, weekdayName: "周三", period: 3, lessonCount: 45 },
      },
    ],
  };
  const view = adapter.adaptCampusOverviewV3(env);
  assert.strictEqual(view.top1.teacherName, "教师002");
  assert.strictEqual(view.top1.week, 1);
  assert.strictEqual(view.phaseText.includes("准备期"), true);
  assert.strictEqual(view.metrics.length, 4);
  assert.strictEqual(view.actions[0].id, "overview-top1-schedule");
  assert.match(view.actions[0].message, /教师002/);
});

check("campus-overview：teacherLoadTop 为空时 top1=null 且降级为 1 个动作", () => {
  const env = {
    dataVersion: "competition-demo-v1",
    evidence: { verified: true },
    items: [
      {
        window: { windowStart: "", windowEnd: "", teachingStart: "", preparationPeriod: {} },
        summary: {},
        matrix: [],
        campusResources: [],
        teacherLoadTop: [],
        risks: {},
        peakSlot: {},
      },
    ],
  };
  const view = adapter.adaptCampusOverviewV3(env);
  assert.strictEqual(view.top1, null);
  assert.strictEqual(view.actions.length, 1);
  assert.strictEqual(view.actions[0].id, "overview-classroom");
});

check("choice：waitForUser、items 裁剪 5 条、message 模板", () => {
  const env = {
    success: false,
    items: Array.from({ length: 7 }, (_, i) => ({ key: `k${i}`, name: `候选${i}`, type: "teacher", campusName: "校区A" })),
    error: { code: "AMBIGUOUS_ENTITY" },
  };
  const view = adapter.adaptChoiceV3(env, { originalTask: "课表查询" });
  assert.strictEqual(view.success, false);
  assert.strictEqual(view.statusText, "请确认对象");
  assert.strictEqual(view.interaction.waitForUser, true);
  assert.strictEqual(view.items.length, 5);
  assert.strictEqual(view.items[0].message, "选择候选0，继续课表查询");
  assert.deepStrictEqual(view.actions.map((a) => a.id), ["choice-rephrase"]);
  assert.strictEqual(view.error.code, "AMBIGUOUS_ENTITY");
});

check("recovery：OUT_OF_RANGE 动作与 keptFilters", () => {
  const env = {
    success: false,
    query: { campus: "校区A", week: 30, periodStart: 3 },
    error: { code: "OUT_OF_RANGE", message: "只能查询当前学期内的日期" },
  };
  const view = adapter.adaptRecoveryV3(env);
  assert.strictEqual(view.success, false);
  assert.strictEqual(view.statusText, "任务恢复");
  assert.strictEqual(view.error.code, "OUT_OF_RANGE");
  assert.strictEqual(view.keptFilters[0].id, "campus");
  assert.deepStrictEqual(view.actions.map((a) => a.id), ["recovery-semester-range", "recovery-first-week"]);
  assert.match(view.reasonText, /当前学期/);
  assert.match(view.footerText, /不展示任何推测性校园事实/);
});

check("recovery：未知错误码回退 TOOL_FAILURE 文案", () => {
  const view = adapter.adaptRecoveryV3({ success: false, error: { code: "UNKNOWN" } });
  assert.strictEqual(view.error.code, "UNKNOWN");
  assert.match(view.title, /没有返回可核验结果/);
  assert.deepStrictEqual(view.actions.map((a) => a.id), ["recovery-retry", "recovery-edit-query"]);
});

check("全局：所有 adapter 输出 actions<=3 且 type=sys.chat", () => {
  const views = [
    adapter.adaptScheduleV3(verifiedEnvelope()),
    adapter.adaptScheduleV3(verifiedEnvelope({ query: { week: 3 } })),
    adapter.adaptClassroomV3({
      dataVersion: "competition-demo-v1", evidence: { verified: true },
      query: { campus: "校区A", date: "2027-03-01" },
      items: [{ roomName: "A101", campusName: "校区A", building: "教学楼A", capacity: 60, roomType: "多媒体", periodText: "第3-4节", date: "2027-03-01" }],
    }),
  ];
  for (const view of views) {
    assert.ok(view.actions.length <= 3);
    assert.ok(view.actions.every((a) => a.type === "sys.chat" && a.id && a.label && a.message));
  }
});

if (failures > 0) {
  console.error(`\ntest-adapter: ${failures} 项失败`);
  process.exit(1);
}
console.log("test-adapter: 全部通过");