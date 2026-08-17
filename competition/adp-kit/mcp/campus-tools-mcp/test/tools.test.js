/**
 * CampusTools 自动化测试（node:test，零依赖）。
 *
 * 覆盖：
 * - 7 个工具的正向用例（基于 competition-demo-v1 设计场景锚定断言）
 * - 缺参 / 非法参数 / 实体不存在 / 范围越界 / 空结果 分支
 * - 统一信封结构完整性
 * - 数据守卫：非 competition-demo 数据文件被拒绝
 * - 服务端：/health、REST 工具、MCP tools/list 与 tools/call
 */

const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");

// 测试前确保使用比赛匿名数据（默认路径已指向 mock-data/competition-demo-v1.json）
process.env.CAMPUS_DATA_PATH = path.join(__dirname, "..", "..", "..", "mock-data", "competition-demo-v1.json");

const { callTool, TOOL_DEFS } = require("../src/tools");
const { loadDataset } = require("../src/data");

function assertEnvelope(env) {
  for (const k of ["success", "queryId", "dataVersion", "items", "actions", "evidence"]) {
    assert.ok(k in env, `信封缺少字段 ${k}`);
  }
  assert.equal(env.dataVersion, "competition-demo-v1");
  assert.match(env.queryId, /^q-/);
  assert.equal(env.evidence.dataVersion, "competition-demo-v1");
}

// ---------------------------------------------------------------------------
// resolve_entity
// ---------------------------------------------------------------------------
test("resolve_entity: 精确命中教师", () => {
  const env = callTool("resolve_entity", { name: "教师003" });
  assertEnvelope(env);
  assert.equal(env.success, true);
  assert.equal(env.resolvedEntity.type, "teacher");
  assert.equal(env.resolvedEntity.id, "t-003");
});

test("resolve_entity: 口语归一化（教师1 → 教师001）", () => {
  const env = callTool("resolve_entity", { name: "教师1" });
  assert.equal(env.success, true);
  assert.equal(env.resolvedEntity.id, "t-001");
});

test("resolve_entity: 实体不存在", () => {
  const env = callTool("resolve_entity", { name: "教师999" });
  assert.equal(env.success, false);
  assert.equal(env.error.code, "ENTITY_NOT_FOUND");
});

test("resolve_entity: 缺参", () => {
  const env = callTool("resolve_entity", {});
  assert.equal(env.success, false);
  assert.equal(env.error.code, "MISSING_PARAM");
});

// ---------------------------------------------------------------------------
// get_academic_context
// ---------------------------------------------------------------------------
test("get_academic_context: 学期首日 = 第1周周一", () => {
  const env = callTool("get_academic_context", { date: "2026-08-31" });
  assertEnvelope(env);
  assert.equal(env.success, true);
  const ctx = env.items[0];
  assert.equal(ctx.resolvedDate, "2026-08-31");
  assert.equal(ctx.week, 1);
  assert.equal(ctx.weekday, 1);
  assert.equal(ctx.semester.id, "2026-2027-1");
  assert.equal(ctx.semester.endDate, "2027-01-17");
});

test("get_academic_context: 今天/明天/后天按显式 baseDate 确定性解析", () => {
  const expected = { 今天: "2026-09-02", 明天: "2026-09-03", 后天: "2026-09-04" };
  for (const [dateText, resolvedDate] of Object.entries(expected)) {
    const env = callTool("get_academic_context", { dateText, baseDate: "2026-09-02" });
    assert.equal(env.success, true);
    assert.equal(env.items[0].resolvedDate, resolvedDate);
    assert.equal(env.items[0].inSemester, true);
  }
});

test("get_academic_context: 本周/这周/下周星期解析", () => {
  const cases = [
    ["本周一", "2026-08-31", 1, 1],
    ["这周日", "2026-09-06", 1, 7],
    ["下周一", "2026-09-07", 2, 1],
    ["下周日", "2026-09-13", 2, 7],
  ];
  for (const [dateText, resolvedDate, week, weekday] of cases) {
    const env = callTool("get_academic_context", { dateText, baseDate: "2026-09-02" });
    assert.equal(env.success, true);
    assert.equal(env.items[0].resolvedDate, resolvedDate);
    assert.equal(env.items[0].week, week);
    assert.equal(env.items[0].weekday, weekday);
  }
});

test("get_academic_context: 第N周周X 与绝对 dateText", () => {
  const teachingWeek = callTool("get_academic_context", { dateText: "第3周周五", baseDate: "2026-09-02" });
  assert.equal(teachingWeek.success, true);
  assert.equal(teachingWeek.items[0].resolvedDate, "2026-09-18");
  assert.equal(teachingWeek.items[0].week, 3);
  assert.equal(teachingWeek.items[0].weekdayName, "周五");

  const absolute = callTool("get_academic_context", { dateText: "2027-01-17", baseDate: "2026-09-02" });
  assert.equal(absolute.success, true);
  assert.equal(absolute.items[0].week, 20);
  assert.equal(absolute.items[0].weekday, 7);
});

test("get_academic_context: date 优先于 dateText，非法输入受控失败", () => {
  const precedence = callTool("get_academic_context", {
    date: "2026-09-01",
    dateText: "下周五",
    baseDate: "2026-09-02",
  });
  assert.equal(precedence.success, true);
  assert.equal(precedence.items[0].resolvedDate, "2026-09-01");

  const invalid = callTool("get_academic_context", { dateText: "下个月某天", baseDate: "2026-09-02" });
  assert.equal(invalid.success, false);
  assert.equal(invalid.error.code, "INVALID_PARAM");

  const outOfRange = callTool("get_academic_context", { dateText: "第25周周一", baseDate: "2026-09-02" });
  assert.equal(outOfRange.success, false);
  assert.equal(outOfRange.error.code, "OUT_OF_RANGE");
});

test("get_academic_context: 学期外日期标记 inSemester=false", () => {
  const env = callTool("get_academic_context", { date: "2027-09-01" });
  assert.equal(env.success, true);
  assert.equal(env.items[0].inSemester, false);
  assert.equal(env.items[0].week, null);
});

// ---------------------------------------------------------------------------
// query_schedule
// ---------------------------------------------------------------------------
test("query_schedule: 教师003 周一第1周有课（设计场景锚定）", () => {
  const env = callTool("query_schedule", {
    entityType: "teacher",
    entityName: "教师003",
    week: 1,
    weekday: 1,
  });
  assertEnvelope(env);
  assert.equal(env.success, true);
  assert.ok(env.items.length >= 1, "教师003 周一第1周应至少有 1 节课");
});

test("query_schedule: 2025级A班 周五第5-6节有课（fri-afternoon-ab-overlap）", () => {
  const env = callTool("query_schedule", {
    entityType: "class",
    entityName: "2025级A班",
    week: 1,
    weekday: 5,
    periodStart: 5,
    periodEnd: 6,
  });
  assert.equal(env.success, true);
  assert.ok(env.items.length >= 1);
});

test("query_schedule: 日期模式（2026-08-31 = 第1周周一）", () => {
  const env = callTool("query_schedule", {
    entityType: "class",
    entityName: "2025级A班",
    date: "2026-08-31",
  });
  assert.equal(env.success, true);
  assert.ok(Array.isArray(env.items));
});

test("query_schedule: 周次越界", () => {
  const env = callTool("query_schedule", {
    entityType: "class",
    entityName: "2025级A班",
    week: 99,
  });
  assert.equal(env.success, false);
  assert.equal(env.error.code, "OUT_OF_RANGE");
});

test("query_schedule: 实体不存在", () => {
  const env = callTool("query_schedule", {
    entityType: "class",
    entityName: "2099级Z班",
    week: 1,
  });
  assert.equal(env.success, false);
  assert.equal(env.error.code, "ENTITY_NOT_FOUND");
});

test("query_schedule: weekday=0 按 R49.2 契约视为未指定（整周）", () => {
  // 基线失败证据：HEAD（R49.2 commit 04d5c87）起 weekday=0 语义从 INVALID_PARAM
  // 改为「0 填充可选整数视为未指定」→ 整周查询；本用例为契约同步，非削弱检查。
  const env = callTool("query_schedule", {
    entityType: "teacher",
    entityName: "教师001",
    week: 1,
    weekday: 0,
  });
  assert.equal(env.success, true);
  assert.equal(env.query.weekday, null, "weekday=0 视为未指定，不回显 0");
  assert.equal(env.items.length, 4);
});

// ---------------------------------------------------------------------------
// find_available_classrooms
// ---------------------------------------------------------------------------
test("find_available_classrooms: 第1周周一 1-2节 校区A 有空教室", () => {
  const env = callTool("find_available_classrooms", {
    campus: "校区A",
    week: 1,
    weekday: 1,
    periodStart: 1,
    periodEnd: 2,
  });
  assertEnvelope(env);
  assert.equal(env.success, true);
  assert.ok(env.items.length >= 1, "应至少存在一间空闲教室");
  for (const r of env.items) assert.equal(r.campusName, "校区A");
});

test("find_available_classrooms: 连续节次参数（consecutivePeriods）", () => {
  const env = callTool("find_available_classrooms", {
    campus: "校区B",
    week: 1,
    weekday: 3,
    startPeriod: 7,
    consecutivePeriods: 2,
  });
  assert.equal(env.success, true);
});

test("find_available_classrooms: capacity 别名与楼栋筛选", () => {
  const env = callTool("find_available_classrooms", {
    campus: "校区A",
    week: 1,
    weekday: 2,
    startPeriod: 1,
    consecutivePeriods: 2,
    building: "教学楼A1",
    capacity: 60,
  });
  assert.equal(env.success, true);
  env.items.forEach((room) => {
    assert.equal(room.building, "教学楼A1");
    assert.ok(room.capacity >= 60);
  });
});

// ---------------------------------------------------------------------------
// compare_schedules
// ---------------------------------------------------------------------------
test("compare_schedules: A班 vs B班 周五下午冲突（设计场景）", () => {
  const env = callTool("compare_schedules", {
    firstType: "class",
    firstName: "2025级A班",
    secondType: "class",
    secondName: "2025级B班",
    week: 1,
  });
  assertEnvelope(env);
  assert.equal(env.success, true);
  assert.equal(env.summary.hasConflict, true, "A/B 班第1周周五 5-6 节应存在冲突");
  assert.ok(env.items.length >= 1);
  const fri = env.items.find((c) => c.weekday === 5);
  assert.ok(fri, "冲突应包含周五");
  assert.ok(fri.periodStart <= 5 && fri.periodEnd >= 5, "冲突应覆盖第5节");
});

test("compare_schedules: 教师003 周一跨校区提醒（设计场景）", () => {
  const env = callTool("compare_schedules", {
    firstType: "teacher",
    firstName: "教师003",
    secondType: "teacher",
    secondName: "教师003",
    week: 1,
  });
  assert.equal(env.success, true);
  assert.ok(Array.isArray(env.rushWarnings), "应输出 rushWarnings 字段");
  assert.ok(env.rushWarnings.length >= 1, "教师003 周一跨校区赶场应被识别");
  assert.equal(env.rushWarnings[0].weekday, 1);
});

test("compare_schedules: weekday=0 仅在本工具兼容为整周", () => {
  const env = callTool("compare_schedules", {
    firstType: "room",
    firstName: "A1-101",
    secondType: "room",
    secondName: "A1-102",
    week: 1,
    weekday: 0,
  });
  assert.equal(env.success, true);
  assert.equal(env.query.week, 1);
  assert.equal(env.query.weekday, null);
  assert.ok(env.items.every((item) => item.weekday >= 1 && item.weekday <= 7));
});

test("compare_schedules: 同实体不产生相同 lessonId 的伪冲突", () => {
  const env = callTool("compare_schedules", {
    firstType: "teacher",
    firstName: "教师003",
    secondType: "teacher",
    secondName: "教师003",
    week: 1,
    weekday: 1,
  });
  assert.equal(env.success, true);
  assert.equal(env.summary.selfCompare, true);
  assert.equal(
    env.items.some((item) => item.first.lessonId === item.second.lessonId),
    false,
  );
});

test("compare_schedules: 同实体赶场提醒唯一", () => {
  const env = callTool("compare_schedules", {
    firstType: "teacher",
    firstName: "教师003",
    secondType: "teacher",
    secondName: "教师003",
    week: 1,
  });
  assert.equal(env.success, true);
  const keys = env.rushWarnings.map((item) =>
    `${item.entity}|${item.weekday}|${item.from.lessonId}|${item.to.lessonId}`,
  );
  assert.equal(new Set(keys).size, keys.length);
  assert.equal(env.summary.rushWarningCount, env.rushWarnings.length);
});

// ---------------------------------------------------------------------------
// generate_day_plan
// ---------------------------------------------------------------------------
test("generate_day_plan: 演示用户001 周五（含课程与建议）", () => {
  const env = callTool("generate_day_plan", { visitorId: "visitor-demo-001", date: "2026-09-04" });
  assertEnvelope(env);
  assert.equal(env.success, true);
  assert.ok(env.items.length >= 1, "第1周周五演示用户应有课程或计划项");
});

test("generate_day_plan: 偏好校区与学习时长进入建议", () => {
  const env = callTool("generate_day_plan", {
    visitorId: "visitor-demo-001",
    date: "2026-09-04",
    preferredCampus: "校区B",
    preferredStudyDuration: 2,
  });
  assert.equal(env.success, true);
  const gap = env.items.find((item) => item.type === "gap");
  assert.ok(gap, "周五课程之间应产生可规划的空档");
  assert.ok(Array.isArray(gap.studyRooms), "空档应带确定性教室建议");
});

test("generate_day_plan: 用户不存在", () => {
  const env = callTool("generate_day_plan", { visitorId: "nobody", date: "2026-09-04" });
  assert.equal(env.success, false);
  assert.equal(env.error.code, "ENTITY_NOT_FOUND");
});

test("generate_day_plan: 日期格式非法", () => {
  const env = callTool("generate_day_plan", { visitorId: "visitor-demo-001", date: "3月6日" });
  assert.equal(env.success, false);
  assert.equal(env.error.code, "INVALID_PARAM");
});

// ---------------------------------------------------------------------------
// get_campus_teaching_overview
// ---------------------------------------------------------------------------
test("get_campus_teaching_overview: 固定 Hero 窗口与四周指标", () => {
  const env = callTool("get_campus_teaching_overview", {});
  assertEnvelope(env);
  assert.equal(env.success, true);
  assert.equal(env.evidence.verified, true);
  assert.equal(env.evidence.preparationPeriodLessonCount, 0);
  const overview = env.items[0];
  assert.deepEqual(overview.window.preparationPeriod, {
    startDate: "2026-08-25",
    endDate: "2026-08-30",
    lessonCount: 0,
  });
  assert.equal(overview.summary.weekCount, 4);
  assert.equal(overview.summary.lessonOccurrences, 126);
  assert.deepEqual(overview.matrix.map((week) => week.days.map((day) => day.lessonCount)), [
    [7, 6, 7, 5, 6],
    [7, 6, 7, 5, 7],
    [7, 6, 7, 5, 6],
    [7, 6, 7, 5, 7],
  ]);
  assert.equal(overview.teacherLoadTop[0].teacherName, "教师002");
  assert.equal(overview.risks.conflictCount, 0);
  assert.equal(overview.risks.rushCount, 8);
  assert.equal(env.actions.find((action) => action.intent === "schedule_risk_check").type, "sys.chat");
});

test("get_campus_teaching_overview: 非冻结窗口 fail closed", () => {
  const env = callTool("get_campus_teaching_overview", { windowStart: "2026-08-24" });
  assert.equal(env.success, false);
  assert.equal(env.error.code, "INVALID_PARAM");
  assert.equal(env.evidence.verified, false);
});

// ---------------------------------------------------------------------------
// query_teacher_load（R49.4：教师课表负载窗口聚合）
// ---------------------------------------------------------------------------
test("query_teacher_load: W1 窗口正向 + 排名形状", () => {
  const env = callTool("query_teacher_load", { weekStart: 1, weekEnd: 1, topN: 3 });
  assertEnvelope(env);
  assert.equal(env.success, true);
  assert.deepEqual(env.window, { weekStart: 1, weekEnd: 1 });
  assert.deepEqual(env.rankContext, { source: "query_teacher_load", list: "teacherLoadTop", selectedRank: null });
  assert.equal(env.items.length, 3, "topN=3 应返回 3 位教师");
  for (const item of env.items) {
    assert.ok(Number.isInteger(item.rank) && item.rank >= 1);
    assert.ok(item.teacher && typeof item.teacher.id === "string" && typeof item.teacher.name === "string");
    assert.ok(Number.isInteger(item.lessonOccurrences) && item.lessonOccurrences >= 1);
    assert.ok(Number.isInteger(item.periodUnits) && item.periodUnits >= item.lessonOccurrences);
    assert.equal(typeof item.tiedWithPrevious, "boolean");
  }
  assert.equal(env.items[0].tiedWithPrevious, false, "第 1 名不存在上一名并列");
  for (let i = 1; i < env.items.length; i += 1) {
    const prev = env.items[i - 1];
    const cur = env.items[i];
    assert.ok(
      prev.lessonOccurrences > cur.lessonOccurrences
        || (prev.lessonOccurrences === cur.lessonOccurrences && prev.periodUnits >= cur.periodUnits),
      "负载排序应按 出现次数 DESC → 节次单元 DESC",
    );
  }
});

test("query_teacher_load: W1..W4 与 overview teacherLoadTop 完全一致（v1 锚定）", () => {
  const overview = callTool("get_campus_teaching_overview", {});
  const load = callTool("query_teacher_load", { weekStart: 1, weekEnd: 4 });
  assert.equal(load.success, true);
  assert.deepEqual(load.window, { weekStart: 1, weekEnd: 4 });
  assert.equal(load.items.length, 8, "无 topN 时返回全部教师（v1 共 8 位）");
  const mapped = load.items.slice(0, 3).map((item) => ({
    teacherId: item.teacher.id,
    teacherName: item.teacher.name,
    lessonOccurrences: item.lessonOccurrences,
    periodUnits: item.periodUnits,
  }));
  assert.deepEqual(mapped, overview.items[0].teacherLoadTop, "相同窗口下负载指标应与 overview 一致");
  assert.equal(mapped[0].teacherName, "教师002");
  assert.equal(mapped[0].lessonOccurrences, 24);
  assert.equal(mapped[0].periodUnits, 48);
});

test("query_teacher_load: 同一入参两次调用确定性一致", () => {
  const first = callTool("query_teacher_load", { weekStart: 1, weekEnd: 4, topN: 5 });
  const second = callTool("query_teacher_load", { weekStart: 1, weekEnd: 4, topN: 5 });
  assert.equal(first.success, true);
  assert.equal(second.success, true);
  assert.deepEqual(
    { window: first.window, rankContext: first.rankContext, items: first.items },
    { window: second.window, rankContext: second.rankContext, items: second.items },
  );
});

test("query_teacher_load: 校区过滤后仍成功聚合", () => {
  const env = callTool("query_teacher_load", { weekStart: 1, weekEnd: 1, campus: "校区B" });
  assertEnvelope(env);
  assert.equal(env.success, true);
  assert.deepEqual(env.window, { weekStart: 1, weekEnd: 1 });
  assert.ok(env.items.length >= 1, "校区B 第1周应有教师开课");
});

test("query_teacher_load: 缺 weekStart/weekEnd", () => {
  const env = callTool("query_teacher_load", { topN: 3 });
  assert.equal(env.success, false);
  assert.equal(env.error.code, "MISSING_PARAM");
});

test("query_teacher_load: topN=0 拒绝", () => {
  const env = callTool("query_teacher_load", { weekStart: 1, weekEnd: 4, topN: 0 });
  assert.equal(env.success, false);
  assert.equal(env.error.code, "INVALID_PARAM");
});

test("query_teacher_load: 反向窗口 4..1 拒绝", () => {
  const env = callTool("query_teacher_load", { weekStart: 4, weekEnd: 1 });
  assert.equal(env.success, false);
  assert.equal(env.error.code, "INVALID_PARAM");
});

test("query_teacher_load: 周次越界 21..21 拒绝", () => {
  const env = callTool("query_teacher_load", { weekStart: 21, weekEnd: 21 });
  assert.equal(env.success, false);
  assert.equal(env.error.code, "OUT_OF_RANGE");
});

test("query_teacher_load: 未知校区 fail closed", () => {
  const env = callTool("query_teacher_load", { weekStart: 1, weekEnd: 1, campus: "校区Z" });
  assert.equal(env.success, false);
  assert.equal(env.error.code, "ENTITY_NOT_FOUND");
});

// ---------------------------------------------------------------------------
// query_schedule_range（R49.4：多教学周课表展开）
// ---------------------------------------------------------------------------
test("query_schedule_range: 教师003 W1..W4 逐教学周展开", () => {
  const env = callTool("query_schedule_range", {
    entityType: "teacher",
    entityName: "教师003",
    weekStart: 1,
    weekEnd: 4,
  });
  assertEnvelope(env);
  assert.equal(env.success, true);
  assert.deepEqual(env.window, { weekStart: 1, weekEnd: 4 });
  assert.ok(env.items.length >= 4, "教师003 每周都有课，W1..W4 至少 4 条");
  const weeks = env.items.map((item) => item.academicWeek);
  assert.deepEqual([...new Set(weeks)].sort((a, b) => a - b), [1, 2, 3, 4], "每个匹配教学周恰好出现");
  for (const item of env.items) {
    assert.ok(Number.isInteger(item.academicWeek) && item.academicWeek >= 1 && item.academicWeek <= 4);
    assert.ok(typeof item.lessonId === "string");
    assert.ok(typeof item.date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(item.date));
  }
});

test("query_schedule_range: 单周 1..1 与 query_schedule(week=1) 语义等价", () => {
  const range = callTool("query_schedule_range", {
    entityType: "teacher",
    entityName: "教师003",
    weekStart: 1,
    weekEnd: 1,
  });
  const single = callTool("query_schedule", { entityType: "teacher", entityName: "教师003", week: 1 });
  assert.equal(range.success, true);
  assert.equal(single.success, true);
  const strip = (items) => items
    .map(({ academicWeek, ...rest }) => rest)
    .sort((a, b) => a.lessonId.localeCompare(b.lessonId));
  assert.deepEqual(strip(range.items), strip(single.items), "去掉 academicWeek 后应与单周查询完全一致");
});

test("query_schedule_range: weekday=0/periodStart=0/periodEnd=0 视为未指定（R49.2 语义）", () => {
  const zero = callTool("query_schedule_range", {
    entityType: "teacher",
    entityName: "教师003",
    weekStart: 1,
    weekEnd: 1,
    weekday: 0,
    periodStart: 0,
    periodEnd: 0,
  });
  const plain = callTool("query_schedule_range", {
    entityType: "teacher",
    entityName: "教师003",
    weekStart: 1,
    weekEnd: 1,
  });
  assert.equal(zero.success, true);
  assert.equal(zero.query.weekday, null, "weekday=0 不回显为约束");
  assert.equal(zero.query.periodStart, null);
  assert.equal(zero.query.periodEnd, null);
  assert.deepEqual(zero.items, plain.items, "0 填充与省略等价");
});

test("query_schedule_range: 节次过滤作用于每个教学周", () => {
  const env = callTool("query_schedule_range", {
    entityType: "class",
    entityName: "2025级A班",
    weekStart: 1,
    weekEnd: 4,
    weekday: 5,
    periodStart: 5,
    periodEnd: 6,
  });
  assert.equal(env.success, true);
  assert.ok(env.items.length >= 1, "fri-afternoon-ab-overlap 场景应在窗口内命中");
  for (const item of env.items) {
    assert.equal(item.weekday, 5);
    assert.ok(item.periodStart <= 6 && item.periodEnd >= 5, "节次应与 5-6 节存在交集");
  }
});

test("query_schedule_range: 周次越界 / 反向窗口 / 缺参受控失败", () => {
  const out = callTool("query_schedule_range", {
    entityType: "teacher", entityName: "教师003", weekStart: 21, weekEnd: 21,
  });
  assert.equal(out.success, false);
  assert.equal(out.error.code, "OUT_OF_RANGE");

  const reversed = callTool("query_schedule_range", {
    entityType: "teacher", entityName: "教师003", weekStart: 4, weekEnd: 1,
  });
  assert.equal(reversed.success, false);
  assert.equal(reversed.error.code, "INVALID_PARAM");

  const missing = callTool("query_schedule_range", { entityType: "teacher", entityName: "教师003" });
  assert.equal(missing.success, false);
  assert.equal(missing.error.code, "MISSING_PARAM");
});

test("query_schedule_range: 实体不存在 / 无匹配周", () => {
  const notFound = callTool("query_schedule_range", {
    entityType: "class", entityName: "2099级Z班", weekStart: 1, weekEnd: 4,
  });
  assert.equal(notFound.success, false);
  assert.equal(notFound.error.code, "ENTITY_NOT_FOUND");

  const empty = callTool("query_schedule_range", {
    entityType: "teacher", entityName: "教师003", weekStart: 1, weekEnd: 1, weekday: 7,
  });
  assert.equal(empty.success, true);
  assert.equal(empty.items.length, 0, "周日无课应返回空结果而非报错");
  assert.equal(empty.evidence.note, "EMPTY_RESULT");
});

// ---------------------------------------------------------------------------
// 通用分发与数据守卫
// ---------------------------------------------------------------------------
test("callTool: 未知工具", () => {
  const env = callTool("hack_everything", {});
  assert.equal(env.success, false);
  assert.equal(env.error.code, "INVALID_PARAM");
});

test("数据守卫: 非 competition-demo 数据文件被拒绝加载", () => {
  const { spawnSync } = require("child_process");
  const r = spawnSync(process.execPath, ["-e", `
    process.env.CAMPUS_DATA_PATH = ${JSON.stringify(path.join(__dirname, "..", "package.json"))};
    try { require(${JSON.stringify(path.join(__dirname, "..", "src", "data.js"))}).loadDataset(); process.exit(7); }
    catch (e) { process.exit(e.code === "DATA_GUARD" ? 0 : 9); }
  `], { encoding: "utf8" });
  assert.equal(r.status, 0, "应抛出 DATA_GUARD");
});

// ---------------------------------------------------------------------------
// 服务端集成测试：/health、REST、MCP
// ---------------------------------------------------------------------------
test("server: /health + REST + MCP 全链路", async (t) => {
  process.env.PORT = "0"; // 随机端口
  const { server } = require("../src/server");
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => server.close());
  const base = `http://127.0.0.1:${server.address().port}`;

  // /health
  const health = await (await fetch(`${base}/health`)).json();
  assert.equal(health.status, "ok");
  assert.equal(health.dataVersion, "competition-demo-v1");
  assert.equal(health.tools, TOOL_DEFS.length);

  // REST
  const rest = await (
    await fetch(`${base}/api/query_schedule`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ entityType: "teacher", entityName: "教师003", week: 1, weekday: 1 }),
    })
  ).json();
  assert.equal(rest.success, true);
  assert.ok(rest.items.length >= 1);

  // MCP tools/list
  const listRes = await (
    await fetch(`${base}/mcp`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }),
    })
  ).json();
  assert.equal(listRes.result.tools.length, TOOL_DEFS.length);

  // MCP tools/call
  const callRes = await (
    await fetch(`${base}/mcp`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 2,
        method: "tools/call",
        params: { name: "get_academic_context", arguments: { dateText: "明天", baseDate: "2026-08-31" } },
      }),
    })
  ).json();
  assert.equal(callRes.result.structuredContent.success, true);
  assert.equal(callRes.result.structuredContent.items[0].resolvedDate, "2026-09-01");
  assert.equal(callRes.result.structuredContent.items[0].week, 1);

  // MCP initialize
  const initRes = await (
    await fetch(`${base}/mcp`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 3, method: "initialize", params: {} }),
    })
  ).json();
  assert.equal(initRes.result.serverInfo.name, "campus-tools-mcp");

  // 旧式 SSE 兼容：先接收 endpoint，再通过 /messages 调用 tools/list。
  const sseRes = await fetch(`${base}/sse`);
  const reader = sseRes.body.getReader();
  const firstChunk = Buffer.from((await reader.read()).value).toString("utf8");
  const endpoint = firstChunk.match(/data:\s*(\/messages\?sessionId=[^\s]+)/);
  assert.ok(endpoint, "SSE 应下发 messages endpoint");
  const messageRes = await fetch(`${base}${endpoint[1]}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 4, method: "tools/list" }),
  });
  assert.equal(messageRes.status, 202);
  const secondChunk = Buffer.from((await reader.read()).value).toString("utf8");
  assert.match(secondChunk, /event: message/);
  assert.match(secondChunk, /query_schedule/);
  await reader.cancel();
});
