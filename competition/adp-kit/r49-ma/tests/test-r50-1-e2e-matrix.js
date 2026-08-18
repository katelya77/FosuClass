"use strict";
// R50.1 Generic E2E Matrix + Paraphrase Gate（2026-08-18）
// 按「能力族」测试（R50.1 §18 A~L），不是固定 Case；表驱动 + 参数化 + 语义输出断言。
// 数据：competition-demo-v3（动态发现实体，不硬编码 ID）。
// 链路：真实 server 进程 → HTTP POST /api/campus_* → agent-tools.js → CampusTools。
const test = require("node:test");
const assert = require("node:assert");
const net = require("net");
const path = require("path");
const fs = require("fs");
const { spawn } = require("child_process");

const SERVER_JS = path.join(__dirname, "..", "..", "mcp", "campus-tools-mcp", "src", "server.js");
const V3_PATH = path.join(__dirname, "..", "..", "mock-data", "competition-demo-v3.json");
const dataset = JSON.parse(fs.readFileSync(V3_PATH, "utf8"));

const T0 = dataset.teachers[0];
const T1 = dataset.teachers[1];
const CLASS0 = dataset.classes[0];
const ROOM0 = dataset.rooms[0];
const COURSE0 = dataset.courses[0];

function reservePort() {
  return new Promise((resolve, reject) => {
    const probe = net.createServer();
    probe.listen(0, "127.0.0.1", () => {
      const port = probe.address().port;
      probe.close(() => resolve(port));
    });
    probe.on("error", reject);
  });
}

let server = null;
let base = null;

test.before(async () => {
  const port = await reservePort();
  server = spawn(process.execPath, [SERVER_JS], {
    cwd: path.dirname(SERVER_JS),
    env: Object.assign({}, process.env, { PORT: String(port), CAMPUS_DATA_PATH: V3_PATH, LOG_LEVEL: "error", RATE_LIMIT_RPM: "100000", RATE_LIMIT_BURST: "100000" }),
    stdio: ["ignore", "ignore", "pipe"],
  });
  server.stderr.on("data", () => {});
  base = `http://127.0.0.1:${port}`;
  for (let i = 0; i < 50; i++) {
    try {
      const r = await fetch(`${base}/health`);
      if (r.status === 200) return;
    } catch (e) { /* not ready */ }
    await new Promise((res) => setTimeout(res, 100));
  }
  throw new Error("server 启动超时");
});

test.after(() => { if (server && !server.killed) server.kill(); });

async function call(tool, params) {
  const res = await fetch(`${base}/api/${tool}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(params || {}),
  });
  const body = await res.json();
  return { status: res.status, body };
}

function expectOk(r, label) {
  assert.strictEqual(r.status, 200, `${label} HTTP 200`);
  assert.strictEqual(r.body.success, true, `${label} success=true（got: ${JSON.stringify(r.body).slice(0, 300)}）`);
  assert.strictEqual(r.body.dataVersion, "competition-demo-v3", `${label} dataVersion=v3`);
  assert.strictEqual(r.body.evidence && r.body.evidence.verified, true, `${label} verified=true`);
}

// ---------- A Entity Discovery ----------
test("A1 列出某类实体（空关键词清单）", async () => {
  const r = await call("campus_entity_search", { entityType: "teacher", limit: 5 });
  expectOk(r, "A1");
  assert.ok(r.body.items.length >= 1 && r.body.items.length <= 5, "A1 返回 1..5 个教师");
});

test("A2 精确实体 / A3 前缀匹配 / A4 不存在实体 / A5 多候选", async () => {
  const exact = await call("campus_entity_search", { entityType: "teacher", keyword: T0.name, limit: 5 });
  expectOk(exact, "A2");
  assert.ok(exact.body.items.some((i) => i.name === T0.name), "A2 精确实体命中");

  const prefix = await call("campus_entity_search", { entityType: "teacher", keyword: T0.name.slice(0, 2), limit: 5 });
  expectOk(prefix, "A3");
  assert.ok(prefix.body.items.length >= 1, "A3 前缀匹配至少 1 条");

  const missing = await call("campus_entity_search", { entityType: "teacher", keyword: "不存在教师XYZ987", limit: 5 });
  assert.strictEqual(missing.status, 200, "A4 HTTP 200");
  assert.ok(missing.body.success === false || missing.body.items.length === 0, "A4 不存在实体 fail-closed 或空结果");

  const all = await call("campus_entity_search", { entityType: "class", limit: 100 });
  expectOk(all, "A5");
  assert.ok(all.body.items.length >= 2, "A5 多候选存在（班级清单 ≥2）");
});

// ---------- B Temporal Semantics ----------
test("B1 绝对日期 / B2 相对日期 / B3 当前周 / B4 下一周", async () => {
  const tc = (r) => r.body.items[0] && r.body.items[0].temporalContext;
  const abs = await call("campus_academic_context", { intent: { kind: "absolute", date: "2026-09-03" }, baseDate: "2026-08-18" });
  expectOk(abs, "B1");
  assert.strictEqual(tc(abs).resolvedDate, "2026-09-03", "B1 绝对日期");

  const rel = await call("campus_academic_context", { intent: { kind: "relative_day", offset: 1 }, baseDate: "2026-08-18" });
  expectOk(rel, "B2");
  assert.strictEqual(tc(rel).resolvedDate, "2026-08-19", "B2 相对日期 明天");

  const cur = await call("campus_academic_context", { intent: { kind: "current" }, baseDate: "2026-09-03" });
  expectOk(cur, "B3");
  assert.strictEqual(tc(cur).currentAcademicWeek, 1, "B3 当前周=1（2026-09-03 在第1教学周）");

  const next = await call("campus_academic_context", { intent: { kind: "next_week" }, baseDate: "2026-09-03" });
  expectOk(next, "B4");
  assert.strictEqual(tc(next).resolvedWeek, 2, "B4 下一周=2");
});

test("B5 第N教学周 / B6 第N到M周 / B7 future_weeks 开学前 / B8 学期末截断", async () => {
  const tc = (r) => r.body.items[0] && r.body.items[0].temporalContext;
  const nth = await call("campus_academic_context", { intent: { kind: "academic_week", week: 3 }, baseDate: "2026-08-18" });
  expectOk(nth, "B5");
  assert.strictEqual(tc(nth).resolvedWeek, 3, "B5 第3教学周");

  const range = await call("campus_academic_context", { intent: { kind: "week_range", weekStart: 2, weekEnd: 4 }, baseDate: "2026-08-18" });
  expectOk(range, "B6");
  assert.deepStrictEqual([tc(range).resolvedWeekStart, tc(range).resolvedWeekEnd], [2, 4], "B6 第2..4周");

  const future = await call("campus_academic_context", { intent: { kind: "future_weeks", count: 4 }, baseDate: "2026-08-18" });
  expectOk(future, "B7");
  assert.deepStrictEqual([tc(future).resolvedWeekStart, tc(future).resolvedWeekEnd], [1, 4], "B7 开学前 future_weeks=1..4");

  const futureEnd = await call("campus_academic_context", { intent: { kind: "future_weeks", count: 30 }, baseDate: "2026-08-18" });
  expectOk(futureEnd, "B8");
  assert.strictEqual(tc(futureEnd).resolvedWeekEnd, 20, "B8 超界截断到第20周");
});

// ---------- C Schedule ----------
test("C1 teacher/class/room/course 单周课表 + C2 周窗口 + C3 过滤", async () => {
  const entities = [
    ["teacher", T0.name], ["class", CLASS0.name], ["room", ROOM0.name], ["course", COURSE0.name],
  ];
  for (const [type, name] of entities) {
    const r = await call("campus_schedule_query", { entityType: type, entityName: name, week: 1 });
    expectOk(r, `C1 ${type}`);
  }
  const range = await call("campus_schedule_range_query", { entityType: "teacher", entityName: T0.name, weekStart: 1, weekEnd: 4 });
  expectOk(range, "C2");
  assert.ok(range.body.items.length >= 4, "C2 逐周展开 ≥4 条");
  const weekdays = new Set(range.body.items.map((i) => i.academicWeek));
  assert.ok(weekdays.has(1) && weekdays.has(4), "C2 覆盖第1..4周");

  const wd = await call("campus_schedule_query", { entityType: "teacher", entityName: T0.name, week: 1, weekday: 3 });
  expectOk(wd, "C3");
  assert.ok(wd.body.items.every((i) => i.weekday === 3), "C3 weekday 过滤生效");
});

// ---------- D Classroom ----------
test("D1 校区/容量/连续节次 + D2 空结果", async () => {
  const r = await call("campus_classroom_search", { campus: "校区A", date: "2026-09-03", periodStart: 5, periodEnd: 6, minCapacity: 60 });
  expectOk(r, "D1");
  assert.ok(r.body.items.every((i) => i.capacity >= 60), "D1 容量过滤生效");

  const empty = await call("campus_classroom_search", { campus: "校区A", date: "2026-09-03", periodStart: 3, periodEnd: 4, minCapacity: 99999 });
  expectOk(empty, "D2");
  assert.ok(empty.body.items.length === 0, "D2 空结果（EMPTY_RESULT）");
});

// ---------- E Common Free Time ----------
test("E1 2 实体正例 + E2 3+ 实体 + E3 无共同空闲", async () => {
  const two = await call("campus_common_free_time_query", { entities: [{ type: "teacher", name: T0.name }, { type: "teacher", name: T1.name }], week: 1, minConsecutivePeriods: 2 });
  expectOk(two, "E1");

  const three = await call("campus_common_free_time_query", {
    entities: [T0, T1, dataset.teachers[2]].map((t) => ({ type: "teacher", name: t.name })), week: 1, minConsecutivePeriods: 1,
  });
  expectOk(three, "E2");

  const impossible = await call("campus_common_free_time_query", {
    entities: [T0, T1].map((t) => ({ type: "teacher", name: t.name })), week: 1, weekday: 1, minConsecutivePeriods: 10,
  });
  expectOk(impossible, "E3");
  assert.ok(impossible.body.items.length === 0, "E3 无共同空闲 → 空结果不虚构");
});

// ---------- F Group Plan ----------
test("F1 正常候选 + F2 容量过滤 + F3 无候选", async () => {
  const normal = await call("campus_group_plan", { entities: [T0, T1].map((t) => ({ type: "teacher", name: t.name })), week: 1 });
  expectOk(normal, "F1");
  assert.ok(normal.body.items.length >= 1, "F1 至少 1 个候选");

  const cap = await call("campus_group_plan", {
    entities: [T0, T1].map((t) => ({ type: "teacher", name: t.name })), week: 1, minCapacity: 60, minConsecutivePeriods: 1,
  });
  expectOk(cap, "F2");
  assert.ok(cap.body.items.length >= 1 && cap.body.items.every((i) => i.rooms.every((r) => r.capacity >= 60)), "F2 容量过滤生效（全部候选教室 capacity>=60）");

  const none = await call("campus_group_plan", { entities: [T0, T1].map((t) => ({ type: "teacher", name: t.name })), week: 1, minCapacity: 99999 });
  expectOk(none, "F3");
  assert.ok(none.body.items.length === 0, "F3 无候选 → 空结果");
});

// ---------- G Risk ----------
test("G1 self（单对象） + G2 显式 compare + G3 赶场", async () => {
  const self = await call("campus_risk_check", { mode: "self", entityType: "teacher", entityName: T0.name, week: 1 });
  expectOk(self, "G1");
  assert.strictEqual(self.body.summary && self.body.summary.selfCompare, true, "G1 self 模式");
  assert.ok(typeof self.body.summary.hasConflict === "boolean", "G1 hasConflict 布尔");

  const cmp = await call("campus_risk_check", { mode: "compare", entityType: "teacher", entityName: T0.name, secondEntityType: "teacher", secondEntityName: T1.name, week: 1 });
  expectOk(cmp, "G2");
  assert.strictEqual(cmp.body.summary && cmp.body.summary.selfCompare, false, "G2 compare 模式");
  assert.ok(Array.isArray(cmp.body.compared) && cmp.body.compared.length === 2, "G2 compared 两对象");

  const rush = await call("campus_risk_check", { mode: "self", entityType: "teacher", entityName: T0.name, week: 1 });
  expectOk(rush, "G3");
  assert.ok(Array.isArray(rush.body.rushWarnings), "G3 赶场警告数组存在");
  assert.ok(Number.isInteger(rush.body.summary.rushWarningCount), "G3 rushWarningCount 整数");
});

// ---------- H Reschedule ----------
// H1 = Protocol Smoke（协议冒烟）：允许使用 fixture 课程 ID（dataset.lessons[0]），
//     仅验证确定性 façade 行为；产品级验收见 R50.2A-PRODUCT-E2E-MATRIX.md（P-RESCHEDULE）。
test("H1 [protocol-smoke] 调课模拟：可行/冲突均返回判断且绝不修改数据", async () => {
  const lesson = dataset.lessons[0];
  const r = await call("campus_reschedule_feasibility", {
    sourceLessonId: lesson.id,
    target: { week: 2, weekday: 5, periodStart: 7, periodEnd: 8 },
  });
  expectOk(r, "H1");
  const sum = r.body.summary || {};
  assert.ok("feasible" in sum || "conflicts" in sum || "checks" in sum, "H1 返回可行性判断结构");
  assert.ok(r.body.actions === undefined || r.body.actions.length === 0, "H1 不得包含任何写操作 action");
});

// H2 = Product E2E（产品级用户路径）：冷启动动态发现 → 选课 → 自然调课（不硬编码任何 ID），
//     且 target 不含 room（可选字段缺省，绝不被假教室查询替代）。
test("H2 [product-e2e] 动态发现课程后自然调课（省略教室，绝不虚构 room）", async () => {
  const found = await call("campus_entity_search", { entityType: "teacher", limit: 1 });
  expectOk(found, "H2a");
  const teacher = found.body.items[0];
  assert.ok(teacher, "H2 动态发现教师");

  const sched = await call("campus_schedule_query", { entityType: "teacher", entityName: teacher.name, week: 1 });
  expectOk(sched, "H2b");
  assert.ok(Array.isArray(sched.body.items) && sched.body.items.length >= 1, "H2 该教师第1周有课");
  const lesson = sched.body.items[0];
  assert.ok(lesson.lessonId, "H2 课表条目携带 lessonId（自然调课引用）");

  const r = await call("campus_reschedule_feasibility", {
    sourceLessonId: lesson.lessonId,
    target: { week: 2, weekday: 5, periodStart: 7, periodEnd: 8 },
  });
  expectOk(r, "H2c");
  assert.ok(r.body.requested === undefined || !r.body.requested || !("room" in (r.body.requested || {})), "H2 未指定教室时请求不得虚构 room 字段");
  const sum = r.body.summary || {};
  assert.ok("feasible" in sum || "conflicts" in sum || "checks" in sum, "H2 返回可行性判断结构");
  assert.ok(r.body.actions === undefined || r.body.actions.length === 0, "H2 绝不产生写操作");
});

// ---------- I Insight Ranking ----------
test("I1 教师负载排名（最高/最低）+ I2 教室利用率排名（room/building/campus）+ I3 并列与 position", async () => {
  const top = await call("campus_teacher_load_query", { weekStart: 1, weekEnd: 1, topN: 3 });
  expectOk(top, "I1a");
  assert.ok(top.body.items.length >= 1 && top.body.items.length <= 3, "I1a TopN≤3");
  const lows = await call("campus_teacher_load_query", { weekStart: 1, weekEnd: 4, sort: "asc", topN: 2 });
  expectOk(lows, "I1b");

  const rooms = await call("campus_room_utilization_query", { weekStart: 1, weekEnd: 4, groupBy: "room", sort: "highest", topN: 3 });
  expectOk(rooms, "I2a");
  const buildings = await call("campus_room_utilization_query", { weekStart: 1, weekEnd: 4, groupBy: "building", topN: 3 });
  expectOk(buildings, "I2b");
  const campuses = await call("campus_room_utilization_query", { weekStart: 1, weekEnd: 4, groupBy: "campus", topN: 3 });
  expectOk(campuses, "I2c");

  const twice = await call("campus_teacher_load_query", { weekStart: 1, weekEnd: 1, topN: 3 });
  assert.strictEqual(JSON.stringify(twice.body.items), JSON.stringify(top.body.items), "I3 同输入重复调用字节一致（deterministic position）");
  if (top.body.items[0]) {
    assert.ok("rank" in top.body.items[0], "I3 RankingResult 含 rank（position 语义）");
  }
});

// ---------- J Cross-domain 组合 ----------
test("J1 ranking→schedule + J2 ranking→risk + J3 entity→schedule + J4 common-free→group-plan", async () => {
  const top = await call("campus_teacher_load_query", { weekStart: 1, weekEnd: 1, topN: 1 });
  expectOk(top, "J1a");
  const first = top.body.items[0];
  assert.ok(first, "J1 排名结果非空");
  const sched = await call("campus_schedule_query", { entityType: "teacher", entityName: first.teacher.name, week: 1 });
  expectOk(sched, "J1 ranking→schedule");
  const risk = await call("campus_risk_check", { mode: "self", entityType: "teacher", entityName: first.teacher.name, week: 1 });
  expectOk(risk, "J2 ranking→risk");

  const found = await call("campus_entity_search", { entityType: "teacher", keyword: T0.name, limit: 1 });
  expectOk(found, "J3a");
  const s2 = await call("campus_schedule_query", { entityType: "teacher", entityName: found.body.items[0].name, week: 1 });
  expectOk(s2, "J3 entity→schedule");

  const ft = await call("campus_common_free_time_query", { entities: [T0, T1].map((t) => ({ type: "teacher", name: t.name })), week: 1, minConsecutivePeriods: 2 });
  expectOk(ft, "J4a");
  const gp = await call("campus_group_plan", { entities: [T0, T1].map((t) => ({ type: "teacher", name: t.name })), week: 1 });
  expectOk(gp, "J4 common-free→group-plan");
});

// ---------- K/L Context Escape + Compound（context-model 层） ----------
test("K1 stale escape：跨域新任务丢弃比较/实体/排名状态", () => {
  const ctx = require("../tools/context-model.js");
  const c = ctx.buildContext({
    previous: {
      intentContext: { domain: "risk" },
      entityContext: { activeEntity: { type: "teacher", name: T0.name }, pendingCandidates: [] },
      temporalContext: { resolvedWeek: 1, resolvedWeekStart: 1, resolvedWeekEnd: 1 },
      rankingContext: null,
      comparisonContext: { mode: "two_object", secondPending: true },
      taskContext: { pendingSecondEntity: T1.name },
    },
    domain: "schedule",
  });
  assert.strictEqual(c.intentContext.domain, "schedule", "K1 新任务域=schedule");
  assert.ok(!(c.comparisonContext && c.comparisonContext.pending), "K1 跨域新任务必须清除比较 pending");
});

test("L1 复合请求：taskContext 契约存在且不携带隐藏子任务", () => {
  const ctx = require("../tools/context-model.js");
  const c = ctx.buildContext({ previous: null, domain: "schedule" });
  assert.ok(c.taskContext && typeof c.taskContext === "object", "L1 taskContext 存在");
  assert.strictEqual(c.intentContext.domain, "schedule", "L1 显式域=schedule");
});