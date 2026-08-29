"use strict";
// R49.1 新增测试：ADP Tool Smoke Fixtures（7 个 Agent Tool，共 8 个 case）
// 验证链路：adapter.resolveAgentToolParams → buildRestRequest → 本地 callTool(competition-demo-v2)
// 每个 case 断言统一信封：success / dataVersion / evidence.dataHash / evidence.verified / error / contract。
const test = require("node:test");
const assert = require("node:assert");
const path = require("path");

// 强制使用 competition-demo-v2（比赛主数据源）。必须在 require mcp tools 之前设置。
const V2_PATH = path.join(__dirname, "..", "..", "mock-data", "competition-demo-v2.json");
process.env.CAMPUS_DATA_PATH = V2_PATH;

const tools = require("../../mcp/campus-tools-mcp/src/tools.js");
const adapter = require("../tools/adapter/adapter.js");

const EXPECTED_DATA_VERSION = "competition-demo-v2";
const EXPECTED_DATA_HASH = "sha1:4f3bbbb45d1f";
const DEMO_USER_ID = "user-demo-001"; // 唯一真源 = v2.json demoUsers[0].id

/** adapter → REST body（JSON）→ 本地 callTool（模拟 REST 层反序列化后调用） */
function smoke(name, rawParams) {
  const r = adapter.resolveAgentToolParams(name, rawParams);
  assert.ok(r.ok, `${name} 参数解析应成功：${(r.errors || []).join("; ")}`);
  const req = adapter.buildRestRequest(name, r.params, { baseUrl: "http://local.test", token: "" });
  assert.strictEqual(req.method, "POST", "REST 请求必须为 POST");
  assert.strictEqual(req.headers["Content-Type"], "application/json");
  const body = JSON.parse(req.body);
  return tools.callTool(r.tool.campusTool, body);
}

function assertEnvelope(env, label) {
  assert.ok(env, `${label}: 应返回统一信封`);
  assert.strictEqual(env.success, true, `${label}: success 应为 true`);
  assert.strictEqual(env.dataVersion, EXPECTED_DATA_VERSION, `${label}: dataVersion 应为 ${EXPECTED_DATA_VERSION}`);
  assert.ok(env.evidence, `${label}: 应含 evidence`);
  assert.strictEqual(env.evidence.dataHash, EXPECTED_DATA_HASH, `${label}: dataHash 应匹配 v2`);
  assert.strictEqual(env.evidence.verified, true, `${label}: evidence.verified 应为 true`);
  assert.strictEqual(env.error, null, `${label}: error 应为 null`);
}

test("case1 campus_schedule_query: teacher / T09 / week=1", () => {
  const env = smoke("campus_schedule_query", { entityType: "teacher", entityName: "T09", week: 1 });
  assertEnvelope(env, "case1");
  assert.strictEqual(env.resolvedEntity.type, "teacher");
  assert.strictEqual(env.resolvedEntity.name, "教师009", "T09 应归一化为 教师009");
  assert.ok(Array.isArray(env.items), "items 应为数组");
  assert.strictEqual(env.query.week, 1);
});

test("case2 campus_classroom_search: 校区A / 2026-09-03 / 5-6节 / minCapacity=60", () => {
  const env = smoke("campus_classroom_search", {
    campus: "校区A",
    date: "2026-09-03",
    periodStart: 5,
    periodEnd: 6,
    minCapacity: 60,
  });
  assertEnvelope(env, "case2");
  assert.ok(Array.isArray(env.items) && env.items.length > 0, "case2: 校区A 周四 5-6 节应存在空教室");
  for (const it of env.items) {
    assert.strictEqual(it.campusName, "校区A");
    assert.ok(it.capacity >= 60, `case2: 容量 ${it.capacity} 应 >= 60`);
  }
});

test("case3 campus_risk_check SELF: teacher / T09 / week=1（无需第二对象）", () => {
  const r = adapter.resolveAgentToolParams("campus_risk_check", {
    mode: "self", entityType: "teacher", entityName: "T09", week: 1,
  });
  assert.ok(r.ok, "self 模式不应要求 secondEntityType/secondEntityName（未报 clarification）");
  assert.strictEqual(r.params.mode, undefined, "底层 compare_schedules 不接收 mode");
  // adapter 确定性复制 second=first
  assert.strictEqual(r.params.secondEntityType, "teacher");
  assert.strictEqual(r.params.secondEntityName, "T09");

  const env = smoke("campus_risk_check", {
    mode: "self", entityType: "teacher", entityName: "T09", week: 1,
  });
  assertEnvelope(env, "case3");
  assert.strictEqual(env.summary.selfCompare, true, "self 模式 selfCompare 应为 true");
  assert.ok(typeof env.summary.hasConflict === "boolean");
});

test("case4 campus_risk_check COMPARE: T03 vs T09 / week=1", () => {
  const r = adapter.resolveAgentToolParams("campus_risk_check", {
    mode: "compare",
    entityType: "teacher", entityName: "T03",
    secondEntityType: "teacher", secondEntityName: "T09",
    week: 1,
  });
  assert.ok(r.ok, "compare 模式带第二对象应通过");
  const env = smoke("campus_risk_check", {
    mode: "compare",
    entityType: "teacher", entityName: "T03",
    secondEntityType: "teacher", secondEntityName: "T09",
    week: 1,
  });
  assertEnvelope(env, "case4");
  assert.strictEqual(env.summary.selfCompare, false, "compare 不同对象 selfCompare 应为 false");
  assert.strictEqual(env.compared[0].name, "教师003");
  assert.strictEqual(env.compared[1].name, "教师009");
});

test("case5 campus_day_plan: date=2026-09-04 visitorId=真源 user-demo-001", () => {
  const env = smoke("campus_day_plan", { date: "2026-09-04", visitorId: DEMO_USER_ID });
  assertEnvelope(env, "case5");
  assert.ok(Array.isArray(env.items), "case5: items 应为数组");
});

test("case6 campus_overview: 空输入 {}", () => {
  const env = smoke("campus_overview", {});
  assertEnvelope(env, "case6");
  assert.ok(Array.isArray(env.items) && env.items.length > 0, "case6: overview 应返回固定窗口聚合");
  const it = env.items[0];
  assert.ok(it.window && it.summary && it.campusResources && it.teacherLoadTop && it.peakSlot && it.risks,
    "case6: overview 输出应含 window/summary/campusResources/teacherLoadTop/peakSlot/risks");
});

test("case7 campus_teacher_load_query: weekStart=1 / weekEnd=1 / topN=3", () => {
  const env = smoke("campus_teacher_load_query", { weekStart: 1, weekEnd: 1, topN: 3 });
  assertEnvelope(env, "case7");
  assert.deepEqual(env.window, { weekStart: 1, weekEnd: 1 }, "case7: 窗口应回显");
  assert.strictEqual(env.items.length, 3, "case7: topN=3 只返回 3 名教师");
  assert.strictEqual(env.items[0].rank, 1);
  for (const it of env.items) {
    assert.ok(it.teacher && typeof it.teacher.name === "string");
    assert.ok(Number.isInteger(it.lessonOccurrences) && it.lessonOccurrences > 0);
  }
});

test("case8 campus_schedule_range_query: teacher / T09 / W1..W4 逐周展开", () => {
  const env = smoke("campus_schedule_range_query", {
    entityType: "teacher", entityName: "T09", weekStart: 1, weekEnd: 4,
  });
  assertEnvelope(env, "case8");
  assert.deepEqual(env.window, { weekStart: 1, weekEnd: 4 }, "case8: 窗口应回显");
  assert.ok(env.items.length > 0, "case8: T09 在第 1..4 周应有课");
  const weeks = env.items.map((it) => it.academicWeek);
  for (const w of weeks) {
    assert.ok(Number.isInteger(w) && w >= 1 && w <= 4, "case8: academicWeek 必须在 1..4 之间");
  }
});
