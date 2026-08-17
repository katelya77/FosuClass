"use strict";
// R49.1 新增测试：ADP Import-Ready OpenAPI 规范
// 验证：campus-agent-tools.adp-import.json 是 5 operation 的合法 OpenAPI 3.0；
//       server 指向真实比赛 CloudBase endpoint；不含 token 字面量；
//       campus_risk_check self/compare 条件契约；campus_day_plan date 必填 + visitorId 保留；
//       campus_overview 输入可为空；canonical 模板保持占位符（可移植）。
const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const path = require("path");

const IMPORT_PATH = path.join(__dirname, "..", "tools", "openapi", "campus-agent-tools.adp-import.json");
const CANONICAL_PATH = path.join(__dirname, "..", "tools", "openapi", "campus-agent-tools.openapi.json");
const spec = JSON.parse(fs.readFileSync(IMPORT_PATH, "utf8"));
const canonical = JSON.parse(fs.readFileSync(CANONICAL_PATH, "utf8"));
const raw = fs.readFileSync(IMPORT_PATH, "utf8");

const EXPECTED_OPERATIONS = [
  "campus_schedule_query",
  "campus_classroom_search",
  "campus_risk_check",
  "campus_day_plan",
  "campus_overview",
];

test("import spec 是合法 OpenAPI 3.0 且恰为 5 个 operation", () => {
  assert.strictEqual(spec.openapi, "3.0.0");
  const ops = Object.values(spec.paths).flatMap((p) => Object.values(p).map((m) => m.operationId));
  assert.strictEqual(ops.length, 5, "必须恰为 5 个 operation");
  for (const op of EXPECTED_OPERATIONS) {
    assert.ok(ops.includes(op), `缺 operation ${op}`);
  }
});

test("import spec server 指向真实比赛 CloudBase endpoint（非占位符）", () => {
  assert.ok(Array.isArray(spec.servers) && spec.servers.length >= 1, "servers 必须存在");
  const url = spec.servers[0].url;
  assert.ok(
    url === "https://cloud1-d3g17rpe7566d3d5c-1442900641.ap-shanghai.app.tcloudbase.com/campusflow-adp-tools",
    "server 必须为真实比赛 endpoint",
  );
  assert.ok(!url.includes("PLACEHOLDER"), "import spec 不得含占位符 server");
});

test("import spec 不含任何 token/密钥字面量，仅声明 bearer 鉴权", () => {
  assert.ok(
    !/["']?(?:token|api_key|apikey|secret|access_token)["']?\s*:\s*["'][A-Za-z0-9_\-]{8,}["']/i.test(raw),
    "不得出现 token/密钥字面量赋值",
  );
  assert.ok(!/Bearer\s+[A-Za-z0-9_\-]{12,}/.test(raw), "不得出现具体 Bearer token 值");
  assert.ok(
    spec.components && spec.components.securitySchemes && spec.components.securitySchemes.bearerAuth,
    "必须声明 bearerAuth security scheme",
  );
  assert.ok(Array.isArray(spec.security) && spec.security.length >= 1, "全局 security 必须声明");
});

test("risk_check：self 只需第一对象，compare 才要求第二对象", () => {
  const risk = spec.components.schemas.RiskCheckInput;
  assert.ok(risk.required.includes("entityType") && risk.required.includes("entityName"), "第一对象必须必填");
  assert.ok(
    !risk.required.includes("secondEntityType") && !risk.required.includes("secondEntityName"),
    "second 不得在顶层 required（self 不应要求第二对象）",
  );
  const thenReq = risk.allOf[0].then.required;
  assert.ok(thenReq.includes("secondEntityType") && thenReq.includes("secondEntityName"), "compare 分支必须要求第二对象");
});

test("day_plan：date 必填且 visitorId 保留在 API 契约层", () => {
  const dp = spec.components.schemas.DayPlanInput;
  assert.ok(dp.required.includes("date"), "date 必须必填");
  assert.ok(dp.properties.visitorId, "visitorId 必须保留在 API 契约层（即使 ADP 层可隐藏）");
});

test("overview：输入可为空（无 required），不允许模型伪造 TopN", () => {
  const ov = spec.components.schemas.OverviewInput;
  assert.ok(!ov.required || ov.required.length === 0, "overview 输入应可为空（{} 即合法）");
  assert.strictEqual(ov.type, "object");
});

test("canonical 模板保持占位符 server（可移植模板），与 import 版本 operationId 镜像一致", () => {
  const cUrl = canonical.servers[0].url;
  assert.ok(cUrl.includes("PLACEHOLDER"), "canonical 模板 server 应为占位符（部署时替换）");
  const cOps = Object.values(canonical.paths).flatMap((p) => Object.values(p).map((m) => m.operationId)).sort();
  const iOps = Object.values(spec.paths).flatMap((p) => Object.values(p).map((m) => m.operationId)).sort();
  assert.deepStrictEqual(cOps, iOps, "canonical 与 import 的 operation 集合必须一致");
});

test("R49.1.1：import spec 每个 path 都是真实 server 可识别的 Agent Tool façade path", () => {
  // 防止再次出现「OpenAPI 看起来正确、adapter 测试也正确，但 HTTP Runtime 不认识」的边界缺陷：
  // import spec 的 path 必须与权威 server 层（mcp/campus-tools-mcp/src/agent-tools.js）注册的
  // Agent Tool façade path 完全一致，且 operationId 与 path 名称一一对应。
  const agentTools = require("../../mcp/campus-tools-mcp/src/agent-tools.js");
  assert.strictEqual(agentTools.AGENT_TOOL_PATHS.length, 7, "server 必须恰有 7 个 Agent Tool façade");
  const paths = Object.keys(spec.paths);
  assert.strictEqual(paths.length, 5, "import spec 必须恰有 5 个 path");
  for (const p of paths) {
    assert.ok(p.startsWith("/api/"), `${p} 必须是 /api/ 前缀`);
    const name = p.slice("/api/".length);
    assert.ok(agentTools.isAgentToolPath(name), `${p} 必须是 server 可识别的 Agent Tool façade path`);
    assert.ok(agentTools.AGENT_TOOL_MAP[name], `${p} 必须在 server façade 中有底层 CampusTools 映射`);
    const op = spec.paths[p].post;
    assert.strictEqual(op.operationId, name, `${p} 的 operationId 必须与 path 名一致`);
  }
  // 每个 import path 都有明确 description，帮助 ADP 模型理解何时调用。
  for (const p of paths) {
    const op = spec.paths[p].post;
    assert.ok(op.description && op.description.length >= 20, `${p} 必须带明确 description`);
  }
});
