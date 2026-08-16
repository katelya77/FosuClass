"use strict";
// R49.1.1 新增测试：真实 HTTP Boundary（Agent Tool Façade）
// 链路：真实 server 进程 → HTTP POST /api/campus_* → server.js → agent-tools.js → CampusTools
// 与 test-adp-smoke.js（adapter → 本地 callTool）不同，这里证明 CloudBase 运行时路径真实可用，
// 且不依赖 r49-ma adapter。
// 同时覆盖：/health 新字段（agentTools / adpContractVersion）、鉴权（无 token 401 / 正确 token 200）。
const test = require("node:test");
const assert = require("node:assert");
const crypto = require("crypto");
const net = require("net");
const path = require("path");
const { spawn } = require("child_process");

const SERVER_JS = path.join(__dirname, "..", "..", "mcp", "campus-tools-mcp", "src", "server.js");
const V2_PATH = path.join(__dirname, "..", "..", "mock-data", "competition-demo-v2.json");

const EXPECTED_DATA_VERSION = "competition-demo-v2";
const EXPECTED_DATA_HASH = "sha1:4f3bbbb45d1f";
const EXPECTED_ADP_CONTRACT_VERSION = "R49.1.1";
const DEMO_USER_ID = "user-demo-001"; // 唯一真源 = v2.json demoUsers[0].id

async function reservePort() {
  const probe = net.createServer();
  await new Promise((resolve) => probe.listen(0, "127.0.0.1", resolve));
  const port = probe.address().port;
  await new Promise((resolve) => probe.close(resolve));
  return port;
}

async function startServer(t, extraEnv) {
  const port = await reservePort();
  const child = spawn(process.execPath, [SERVER_JS], {
    cwd: path.dirname(SERVER_JS),
    env: Object.assign({}, process.env, {
      PORT: String(port),
      CAMPUS_DATA_PATH: V2_PATH,
      LOG_LEVEL: "error",
    }, extraEnv),
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

async function postJson(base, apiPath, body, headers) {
  return fetch(`${base}${apiPath}`, {
    method: "POST",
    headers: Object.assign({ "Content-Type": "application/json" }, headers),
    body: JSON.stringify(body),
  });
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

test("/health 暴露 tools=7 + agentTools=5 + adpContractVersion=R49.1.1", async (t) => {
  const { base } = await startServer(t);
  const res = await fetch(`${base}/health`);
  assert.strictEqual(res.status, 200);
  const health = await res.json();
  assert.strictEqual(health.status, "ok");
  assert.strictEqual(health.dataVersion, EXPECTED_DATA_VERSION);
  assert.strictEqual(health.dataHash, EXPECTED_DATA_HASH);
  assert.strictEqual(health.tools, 7, "tools=7 表示底层 CampusTools 数量");
  assert.strictEqual(health.agentTools, 5, "agentTools=5 表示 ADP Agent Tool Façade 数量");
  assert.strictEqual(health.adpContractVersion, EXPECTED_ADP_CONTRACT_VERSION);
});

test("case1 HTTP POST /api/campus_schedule_query: teacher / T09 / week=1", async (t) => {
  const { base } = await startServer(t);
  const res = await postJson(base, "/api/campus_schedule_query", {
    entityType: "teacher", entityName: "T09", week: 1,
  });
  assert.strictEqual(res.status, 200);
  const env = await res.json();
  assertEnvelope(env, "case1");
  assert.strictEqual(env.resolvedEntity.type, "teacher");
  assert.strictEqual(env.resolvedEntity.name, "教师009", "T09 应归一化为 教师009");
  assert.ok(Array.isArray(env.items), "items 应为数组");
  assert.strictEqual(env.query.week, 1);
});

test("case2 HTTP POST /api/campus_classroom_search: 校区A / 2026-09-03 / 5-6节 / minCapacity=60", async (t) => {
  const { base } = await startServer(t);
  const res = await postJson(base, "/api/campus_classroom_search", {
    campus: "校区A",
    date: "2026-09-03",
    periodStart: 5,
    periodEnd: 6,
    minCapacity: 60,
  });
  assert.strictEqual(res.status, 200);
  const env = await res.json();
  assertEnvelope(env, "case2");
  assert.ok(Array.isArray(env.items) && env.items.length > 0, "case2: 校区A 周四 5-6 节应存在空教室");
  for (const it of env.items) {
    assert.strictEqual(it.campusName, "校区A");
    assert.ok(it.capacity >= 60, `case2: 容量 ${it.capacity} 应 >= 60`);
  }
});

test("case3 P0 HTTP POST /api/campus_risk_check SELF: teacher / T09 / week=1（无第二对象）", async (t) => {
  const { base } = await startServer(t);
  const res = await postJson(base, "/api/campus_risk_check", {
    mode: "self", entityType: "teacher", entityName: "T09", week: 1,
  });
  assert.strictEqual(res.status, 200);
  const env = await res.json();
  assertEnvelope(env, "case3");
  assert.strictEqual(env.summary.selfCompare, true, "self 模式 selfCompare 应为 true");
  const raw = JSON.stringify(env);
  assert.ok(!raw.includes("MISSING_PARAM"), "self 模式不得出现 MISSING_PARAM");
  assert.ok(!raw.includes("second object required"), "self 模式不得要求第二对象");
  assert.strictEqual(env.error, null);
});

test("case4 HTTP POST /api/campus_risk_check COMPARE: T03 vs T09 / week=1", async (t) => {
  const { base } = await startServer(t);
  const res = await postJson(base, "/api/campus_risk_check", {
    mode: "compare",
    entityType: "teacher", entityName: "T03",
    secondEntityType: "teacher", secondEntityName: "T09",
    week: 1,
  });
  assert.strictEqual(res.status, 200);
  const env = await res.json();
  assertEnvelope(env, "case4");
  assert.strictEqual(env.summary.selfCompare, false, "compare 不同对象 selfCompare 应为 false");
  assert.strictEqual(env.compared[0].name, "教师003");
  assert.strictEqual(env.compared[1].name, "教师009");
});

test("case5 P0 HTTP POST /api/campus_day_plan: 不传 visitorId 也必须确定性使用 demoUsers[0].id", async (t) => {
  const { base } = await startServer(t);
  const res = await postJson(base, "/api/campus_day_plan", { date: "2026-09-04" });
  assert.strictEqual(res.status, 200);
  const env = await res.json();
  assertEnvelope(env, "case5");
  assert.strictEqual(env.resolvedEntity.id, DEMO_USER_ID, "未传 visitorId 时应确定性使用 demoUsers[0].id");
  assert.ok(Array.isArray(env.items), "case5: items 应为数组");
});

test("case5b 显式 visitorId 正常校验（非法 id FAIL CLOSED）", async (t) => {
  const { base } = await startServer(t);
  const bad = await postJson(base, "/api/campus_day_plan", { date: "2026-09-04", visitorId: "not-a-real-id" });
  const badEnv = await bad.json();
  assert.strictEqual(badEnv.success, false, "非法显式 visitorId 应失败关闭");
  assert.strictEqual(badEnv.error.code, "ENTITY_NOT_FOUND");
});

test("case6 HTTP POST /api/campus_overview: 空输入 {}", async (t) => {
  const { base } = await startServer(t);
  const res = await postJson(base, "/api/campus_overview", {});
  assert.strictEqual(res.status, 200);
  const env = await res.json();
  assertEnvelope(env, "case6");
  assert.ok(Array.isArray(env.items) && env.items.length > 0, "case6: overview 应返回固定窗口聚合");
  const it = env.items[0];
  assert.ok(it.window && it.summary && it.campusResources && it.teacherLoadTop && it.peakSlot && it.risks,
    "case6: overview 输出应含 window/summary/campusResources/teacherLoadTop/peakSlot/risks");
});

test("鉴权：无 Authorization → 401；正确 Bearer token → 200", async (t) => {
  // 随机生成 token，禁止把真实 token 写入任何文件/快照。
  const token = crypto.randomBytes(24).toString("hex");
  const { base } = await startServer(t, {
    CAMPUS_API_AUTH_MODE: "token",
    CAMPUS_API_TOKEN: token,
    CAMPUS_API_SIGNING_SECRET: "",
  });

  const denied = await postJson(base, "/api/campus_schedule_query", {
    entityType: "teacher", entityName: "T09", week: 1,
  });
  assert.strictEqual(denied.status, 401, "无 token 必须 401");
  const deniedBody = await denied.json();
  assert.strictEqual(deniedBody.success, false);
  assert.strictEqual(deniedBody.error.code, "UNAUTHORIZED");

  const allowed = await postJson(base, "/api/campus_risk_check",
    { mode: "self", entityType: "teacher", entityName: "T09", week: 1 },
    { Authorization: `Bearer ${token}` });
  assert.strictEqual(allowed.status, 200, "正确 token 必须 200");
  const env = await allowed.json();
  assert.strictEqual(env.success, true);
  assert.strictEqual(env.summary.selfCompare, true);
});

test("底层 REST /api/query_schedule 等旧接口保持兼容（禁止破坏）", async (t) => {
  const { base } = await startServer(t);
  const res = await postJson(base, "/api/query_schedule", {
    entityType: "teacher", entityName: "T09", week: 1,
  });
  assert.strictEqual(res.status, 200);
  const env = await res.json();
  assertEnvelope(env, "legacy");
  assert.strictEqual(env.resolvedEntity.name, "教师009");
});
