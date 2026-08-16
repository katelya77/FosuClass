"use strict";
// R49-MA 自动测试 2：campus_risk_check self/compare 契约
// 核心回归：self 模式绝不要求第二对象；adapter 确定性复制 second=first 后调用底层 compare_schedules
const test = require("node:test");
const assert = require("node:assert");
const adapter = require("../tools/adapter/adapter.js");
const contract = adapter.CONTRACT;

const risk = contract.tools.find((t) => t.name === "campus_risk_check");

test("campus_risk_check 顶层 required 不得含第二对象", () => {
  const required = risk.inputSchema.required || [];
  assert.ok(!required.includes("secondEntityType"), "secondEntityType 出现在顶层 required（会再次导致 self-risk 失败）");
  assert.ok(!required.includes("secondEntityName"), "secondEntityName 出现在顶层 required");
  assert.ok(required.includes("entityType") && required.includes("entityName"), "第一对象必须必填");
});

test("self 模式（默认缺省 mode）只需第一对象，且确定性复制 second=first", () => {
  const r = adapter.resolveAgentToolParams("campus_risk_check", { entityType: "teacher", entityName: "教师009" });
  assert.strictEqual(r.ok, true, JSON.stringify(r.errors));
  assert.strictEqual(r.mode, "self");
  assert.strictEqual(r.params.secondEntityType, "teacher");
  assert.strictEqual(r.params.secondEntityName, "教师009");
  assert.ok(!("mode" in r.params), "底层 compare_schedules 不应接收 mode 字段");
});

test("self 模式（显式 mode=self）同样通过", () => {
  const r = adapter.resolveAgentToolParams("campus_risk_check", { mode: "self", entityType: "teacher", entityName: "教师009" });
  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.mode, "self");
});

test("compare 模式缺少第二对象 → FAIL CLOSED (clarification)", () => {
  const r = adapter.resolveAgentToolParams("campus_risk_check", { mode: "compare", entityType: "teacher", entityName: "教师003" });
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.status, "clarification");
  assert.ok(r.errors.some((e) => e.includes("compare 模式缺少必填参数")), `错误信息应指向 compare 缺参: ${JSON.stringify(r.errors)}`);
});

test("compare 模式带第二对象 → ok", () => {
  const r = adapter.resolveAgentToolParams("campus_risk_check", {
    mode: "compare",
    entityType: "teacher",
    entityName: "教师003",
    secondEntityType: "teacher",
    secondEntityName: "教师009",
  });
  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.mode, "compare");
  assert.strictEqual(r.params.secondEntityName, "教师009");
});

test("schema 校验：非法 enum / 日期格式被拦截", () => {
  const r = adapter.resolveAgentToolParams("campus_risk_check", { entityType: "teacher", entityName: "教师009", date: "2026/09/04" });
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.status, "clarification");
  const r2 = adapter.resolveAgentToolParams("campus_schedule_query", { entityType: "teacher", entityName: "教师009", week: 99 });
  assert.strictEqual(r2.ok, false);
});

test("未知 Agent Tool → FAIL CLOSED error", () => {
  const r = adapter.resolveAgentToolParams("not_a_tool", {});
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.status, "error");
});

test("buildRestRequest 指向 CampusTools REST，且默认 baseUrl 为占位符", () => {
  const req = adapter.buildRestRequest("campus_risk_check", { entityType: "teacher", entityName: "教师009", secondEntityType: "teacher", secondEntityName: "教师009" }, { baseUrl: "https://example.invalid", token: "t" });
  assert.strictEqual(req.method, "POST");
  assert.strictEqual(req.url, "https://example.invalid/api/compare_schedules");
  assert.strictEqual(req.headers.Authorization, "Bearer t");
  const req2 = adapter.buildRestRequest("campus_schedule_query", { entityType: "class", entityName: "2025级A班" });
  assert.ok(req2.url.includes("PLACEHOLDER_CAMPUS_API_BASE_URL"), "未配置真实 Endpoint 时必须使用占位符");
});

test("isFailClosed：无真实 Endpoint 时返回 true", () => {
  assert.strictEqual(adapter.isFailClosed({}), true);
  assert.strictEqual(adapter.isFailClosed({ baseUrl: "PLACEHOLDER_CAMPUS_API_BASE_URL" }), true);
  assert.strictEqual(adapter.isFailClosed({ baseUrl: "https://real.example.com" }), false);
});
