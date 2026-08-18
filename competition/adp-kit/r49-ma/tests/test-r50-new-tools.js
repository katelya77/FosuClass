"use strict";
// R50.0 新增测试：6 个新 Agent Tool Façade HTTP smoke（V2 数据）
// 链路：真实 server 进程 → HTTP POST /api/campus_* → agent-tools.js → CampusTools
// 实体一律从 competition-demo-v2.json 动态发现，不硬编码 V3 特有 ID。
// 同时覆盖 adapter.js 对 campus_room_utilization_query 的 weekEnd>=weekStart 跨字段校验。
const test = require("node:test");
const assert = require("node:assert");
const net = require("net");
const path = require("path");
const fs = require("fs");
const { spawn } = require("child_process");

const SERVER_JS = path.join(__dirname, "..", "..", "mcp", "campus-tools-mcp", "src", "server.js");
const V2_PATH = path.join(__dirname, "..", "..", "mock-data", "competition-demo-v2.json");
const dataset = JSON.parse(fs.readFileSync(V2_PATH, "utf8"));

const EXPECTED_DATA_VERSION = "competition-demo-v2";
const FIRST_TEACHERS = dataset.teachers.slice(0, 2).map((t) => ({ type: "teacher", id: t.id, name: t.name }));
const FIRST_LESSON = dataset.lessons[0];

async function reservePort() {
  const probe = net.createServer();
  await new Promise((resolve) => probe.listen(0, "127.0.0.1", resolve));
  const port = probe.address().port;
  await new Promise((resolve) => probe.close(resolve));
  return port;
}

async function startServer(t) {
  const port = await reservePort();
  const child = spawn(process.execPath, [SERVER_JS], {
    cwd: path.dirname(SERVER_JS),
    env: Object.assign({}, process.env, {
      PORT: String(port),
      CAMPUS_DATA_PATH: V2_PATH,
      LOG_LEVEL: "error",
    }),
    stdio: ["ignore", "pipe", "pipe"],
  });
  let stderr = "";
  child.stderr.on("data", (chunk) => { stderr += chunk.toString("utf8"); });
  t.after(() => {
    if (!child.killed) child.kill();
  });
  const base = `http://127.0.0.1:${port}`;
  for (let attempt = 0; attempt < 40; attempt += 1) {
    if (child.exitCode != null) throw new Error(`服务启动失败：${stderr}`);
    try {
      const response = await fetch(`${base}/health`);
      if (response.ok) return { base, child };
    } catch {
      // 启动窗口内预期连接失败，继续短轮询。
    }
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error(`服务启动超时：${stderr}`);
}

async function postJson(base, apiPath, body) {
  return fetch(`${base}${apiPath}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

function assertEnvelope(env, label) {
  assert.ok(env, `${label}: 应返回统一信封`);
  assert.strictEqual(env.success, true, `${label}: success 应为 true`);
  assert.strictEqual(env.dataVersion, EXPECTED_DATA_VERSION, `${label}: dataVersion 应为 ${EXPECTED_DATA_VERSION}`);
  assert.strictEqual(env.error, null, `${label}: error 应为 null`);
}

test("R50-1 campus_entity_search：空关键词清单 + exact 确定性命中", async (t) => {
  const { base } = await startServer(t);
  const list = await (await postJson(base, "/api/campus_entity_search", { entityType: "teacher", limit: 5 })).json();
  assertEnvelope(list, "R50-1-list");
  assert.ok(Array.isArray(list.items) && list.items.length > 0, "R50-1: 教师清单应非空");
  assert.ok(list.items.every((i) => i.type === "teacher" && i.matchType === "list"), "R50-1: 清单条目应携带 type/matchType");

  const exact = await (await postJson(base, "/api/campus_entity_search", { entityType: "teacher", keyword: FIRST_TEACHERS[0].name })).json();
  assertEnvelope(exact, "R50-1-exact");
  assert.ok(exact.items.length > 0 && exact.items[0].id === FIRST_TEACHERS[0].id, "R50-1: exact 应命中第一位教师");
  assert.strictEqual(exact.items[0].matchType, "exact", "R50-1: 完全命中应为 exact");
});

test("R50-2 campus_academic_context：intent=future_weeks 走 Temporal Semantic Core", async (t) => {
  const { base } = await startServer(t);
  const res = await postJson(base, "/api/campus_academic_context", {
    intent: { kind: "future_weeks", count: 4 },
    baseDate: "2026-08-18",
  });
  assert.strictEqual(res.status, 200);
  const env = await res.json();
  assertEnvelope(env, "R50-2");
  const item = env.items[0];
  assert.ok(item.temporalContext, "R50-2: 必须暴露 temporalContext");
  assert.strictEqual(item.temporalContext.resolutionKind, "future_weeks", "R50-2: resolutionKind 应为 future_weeks");
  assert.strictEqual(item.temporalContext.resolvedWeekStart, 1, "R50-2: 开学前未来4教学周应从第1周开始");
  assert.strictEqual(item.temporalContext.resolvedWeekEnd, 4, "R50-2: 开学前未来4教学周应到第4周");
  assert.strictEqual(item.inSemester, false, "R50-2: 2026-08-18 未开学，inSemester 应为 false");
});

test("R50-3 campus_common_free_time_query：两位教师共同空闲窗口（结构 smoke）", async (t) => {
  const { base } = await startServer(t);
  const res = await postJson(base, "/api/campus_common_free_time_query", {
    entities: FIRST_TEACHERS,
    week: 1,
    minConsecutivePeriods: 1,
  });
  assert.strictEqual(res.status, 200);
  const env = await res.json();
  assertEnvelope(env, "R50-3");
  assert.ok(Array.isArray(env.items), "R50-3: items 应为数组");
  assert.strictEqual(env.summary.entityCount, 2, "R50-3: 应解析 2 个实体");
  for (const it of env.items.slice(0, 5)) {
    assert.ok(it.week === 1 && it.weekday >= 1 && it.weekday <= 7, "R50-3: 条目应含 week/weekday");
    assert.ok(it.periodStart <= it.periodEnd, "R50-3: periodStart<=periodEnd");
    assert.ok(Array.isArray(it.entities) && it.entities.length === 2, "R50-3: 每个窗口应携带参与实体");
  }
});

test("R50-4 campus_room_utilization_query：week1..4 利用率排名（Ranking Core）", async (t) => {
  const { base } = await startServer(t);
  const res = await postJson(base, "/api/campus_room_utilization_query", {
    weekStart: 1, weekEnd: 4, sort: "highest", topN: 3,
  });
  assert.strictEqual(res.status, 200);
  const env = await res.json();
  assertEnvelope(env, "R50-4");
  assert.ok(env.items.length > 0, "R50-4: 应返回利用率排名");
  assert.strictEqual(env.items.length, 3, "R50-4: topN=3 只返回 3 条");
  assert.strictEqual(env.items[0].rank, 1, "R50-4: 首位 rank 应为 1");
  for (const it of env.items) {
    assert.ok(typeof it.utilizationRate === "number" && it.utilizationRate >= 0 && it.utilizationRate <= 1, "R50-4: utilizationRate 应在 0..1");
    assert.ok(Number.isInteger(it.occupiedPeriodUnits), "R50-4: occupiedPeriodUnits 应为整数");
    assert.ok(it.entity && it.entity.type === "room", "R50-4: 默认 groupBy=room，entity.type 应为 room");
  }
  assert.deepEqual(env.window, { weekStart: 1, weekEnd: 4 }, "R50-4: 窗口应回显");
});

test("R50-5 campus_reschedule_feasibility：What-if 模拟（绝不修改数据）", async (t) => {
  const { base } = await startServer(t);
  const sourceLessonId = FIRST_LESSON.id;
  const target = { week: 1, weekday: 1, periodStart: 3, periodEnd: 4 };
  const res = await postJson(base, "/api/campus_reschedule_feasibility", { sourceLessonId, target });
  assert.strictEqual(res.status, 200);
  const env = await res.json();
  assertEnvelope(env, "R50-5");
  assert.ok(env.summary && typeof env.summary.feasible === "boolean", "R50-5: 必须返回 feasible 布尔值");
  const item = env.items[0];
  assert.strictEqual(item.sourceLesson.lessonId, sourceLessonId, "R50-5: 应回显源课程");
  assert.ok(item.checks.teacherConflict && item.checks.classConflict && item.checks.roomConflict, "R50-5: 应含三类冲突检查");
  assert.strictEqual(env.simulation.mutatedData, false, "R50-5: 模拟绝不修改数据");
});

test("R50-6 campus_group_plan：两位教师第1周群体计划候选（ranked）", async (t) => {
  const { base } = await startServer(t);
  const res = await postJson(base, "/api/campus_group_plan", {
    entities: FIRST_TEACHERS,
    week: 1,
    minConsecutivePeriods: 1,
  });
  assert.strictEqual(res.status, 200);
  const env = await res.json();
  assertEnvelope(env, "R50-6");
  assert.ok(Array.isArray(env.items), "R50-6: items 应为数组");
  for (const it of env.items) {
    assert.ok(Number.isInteger(it.rank) && it.rank >= 1, "R50-6: 候选应携带 rank");
    assert.ok(Array.isArray(it.rooms) && it.rooms.length > 0, "R50-6: 候选应含空教室列表");
    assert.ok(Number.isInteger(it.freePeriodCount) && it.freePeriodCount >= 1, "R50-6: 候选应含空闲节数");
  }
  if (env.items.length > 1) {
    assert.ok(env.items[0].roomCount >= env.items[1].roomCount, "R50-6: 候选按 roomCount 降序");
  }
});

test("adapter：campus_room_utilization_query 的 weekEnd<weekStart 应 FAIL CLOSED", () => {
  const { resolveAgentToolParams } = require(path.join(__dirname, "..", "tools", "adapter", "adapter.js"));
  const result = resolveAgentToolParams("campus_room_utilization_query", { weekStart: 5, weekEnd: 3 });
  assert.strictEqual(result.ok, false, "adapter: weekEnd<weekStart 必须失败关闭");
  assert.strictEqual(result.status, "clarification");
  assert.ok(result.errors.some((e) => e.includes("weekEnd")), "adapter: 错误信息应指向 weekEnd");
});
