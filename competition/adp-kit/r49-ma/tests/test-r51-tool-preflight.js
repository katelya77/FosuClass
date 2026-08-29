"use strict";
// R51-D ToolCallPreflight / Canonical Slot Normalizer 门禁（2026-08-19）
// P1 中文实体类型 → 规范 enum（教师→teacher / 班级→class / 教室→room / 课程→course）；
// P2 允许值从现有 OpenAPI operation contract 派生；非法值在 Tool 调用前 fail-closed
//    （不先发送一次错误请求再重试 —— 问题 B 回归）；
// P3 可选字段空缺不澄清、不伪造，按契约缺省透传；
// P4 别名表每个目标值必须 ∈ OpenAPI enum（测试断言）。
const test = require("node:test");
const assert = require("node:assert");
const path = require("path");

const R51 = path.join(__dirname, "..", "..", "r51");
const {
  preflightToolCall, normalizeEntityType, loadOperationContracts, resolveAlias,
} = require(path.join(R51, "mission", "preflight.js"));
const aliases = require(path.join(R51, "data", "canonical-aliases.json"));
const openapi = require(path.join("..", "..", "r49-ma", "tools", "openapi", "campus-agent-tools.adp-import.json"));

test("D1. 中文实体类型规范化：教师/班级/教室/课程 → 规范 enum", () => {
  assert.strictEqual(normalizeEntityType("教师"), "teacher");
  assert.strictEqual(normalizeEntityType("班级"), "class");
  assert.strictEqual(normalizeEntityType("教室"), "room");
  assert.strictEqual(normalizeEntityType("课程"), "course");
  assert.strictEqual(normalizeEntityType("teacher"), "teacher", "规范值原样通过");
});

test("D2. risk_check 首次调用直接成功（问题 B 回归：不再先发中文 entityType 再重试）", () => {
  const r = preflightToolCall("campus_risk_check", { entityType: "教师", entityName: "教师009" });
  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.params.entityType, "teacher");
});

test("D3. 非法 enum 在 Tool 调用前 fail-closed（INVALID_PARAM，不允许模型发明 enum）", () => {
  const r = preflightToolCall("campus_risk_check", { entityType: "讲师", entityName: "x" });
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.error, "INVALID_PARAM");
  assert.strictEqual(r.field, "entityType");
  assert.ok(Array.isArray(r.allowed) && r.allowed.includes("teacher"));
});

test("D4. 规范化在调用前完成：normalize 后参数即合法契约值", () => {
  const r = preflightToolCall("campus_schedule_query", { entityType: "班级", entityName: "2025级A班", weekStart: 1, weekEnd: 1 });
  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.params.entityType, "class");
});

test("D5. room_utilization groupBy/sort 别名规范化", () => {
  const r = preflightToolCall("campus_room_utilization_query", { groupBy: "楼栋", sort: "最高" });
  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.params.groupBy, "building");
  assert.strictEqual(r.params.sort, "highest");
});

test("D6. 可选字段空缺：不澄清、不伪造，原样透传", () => {
  const r = preflightToolCall("campus_classroom_search", { date: "2026-09-01" });
  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.params.date, "2026-09-01");
  assert.strictEqual(r.params.building, undefined, "未提供的可选字段不得被补默认值");
});

test("D7. 未知工具 → 受控失败 UNKNOWN_TOOL", () => {
  const r = preflightToolCall("campus_hallucinated_tool", {});
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.error, "UNKNOWN_TOOL");
});

test("D8. 别名表目标值全部 ∈ OpenAPI enum（数据来自契约，不允许别名指向非法值）", () => {
  const contracts = loadOperationContracts();
  const entityEnum = contracts.campus_risk_check.params.entityType.enum;
  const groupByEnum = contracts.campus_room_utilization_query.params.groupBy.enum;
  const sortEnum = contracts.campus_room_utilization_query.params.sort.enum;
  const modeEnum = contracts.campus_risk_check.params.mode.enum;

  for (const v of Object.values(aliases.entityType)) assert.ok(entityEnum.includes(v), `entityType 别名目标 ${v} 必须 ∈ OpenAPI enum`);
  for (const v of Object.values(aliases.groupBy)) assert.ok(groupByEnum.includes(v), `groupBy 别名目标 ${v} 必须 ∈ OpenAPI enum`);
  for (const v of Object.values(aliases.sort)) assert.ok(sortEnum.includes(v), `sort 别名目标 ${v} 必须 ∈ OpenAPI enum`);
  for (const v of Object.values(aliases.mode)) assert.ok(modeEnum.includes(v), `mode 别名目标 ${v} 必须 ∈ OpenAPI enum`);
  assert.strictEqual(resolveAlias("entityType", "教师"), "teacher");
  assert.strictEqual(resolveAlias("entityType", "unknown-zzz"), null);
});

test("D9. 13 个 operation 全部可 preflight（契约完整可加载）", () => {
  const contracts = loadOperationContracts();
  assert.strictEqual(Object.keys(contracts).length, 13);
  for (const name of Object.keys(contracts)) {
    const r = preflightToolCall(name, {});
    assert.ok(r.ok === true || r.ok === false, `${name} preflight 必须返回结构化结果`);
  }
  assert.ok(openapi.info.title.includes("R49-MA"), "preflight 来源 = 现有 ADP OpenAPI（R49-MA）");
});