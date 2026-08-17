"use strict";
// R49.1 新增测试：DATA_VERSION 契约收敛 + overview TypeScript 契约补齐
// 验证：contracts.ts 不再把数据版本锁死为单一 v1；get_campus_teaching_overview 已纳入 CampusToolName/Inputs；
//       JS runtime TOOL_DEFS 与 TS contract 工具集合一致（不许 JS 有工具、TS 无工具）。
const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const path = require("path");

const MCP_SRC = path.join(__dirname, "..", "..", "mcp", "campus-tools-mcp", "src");
const CONTRACTS = fs.readFileSync(path.join(MCP_SRC, "contracts.ts"), "utf8");
const TOOLS = fs.readFileSync(path.join(MCP_SRC, "tools.js"), "utf8");

test("DATA_VERSION 契约支持 v1/v2 联合（不再锁死 v1）", () => {
  assert.match(CONTRACTS, /export type CompetitionDataVersion = "competition-demo-v1" \| "competition-demo-v2";/);
  assert.match(
    CONTRACTS,
    /DATA_VERSIONS: readonly CompetitionDataVersion\[\] = \["competition-demo-v1", "competition-demo-v2"\]/,
  );
  assert.ok(
    !/dataVersion: typeof DATA_VERSION/.test(CONTRACTS),
    "Evidence/ToolEnvelope 不得再用 typeof DATA_VERSION 把类型锁死为单一 v1",
  );
  assert.match(CONTRACTS, /dataVersion: CompetitionDataVersion;/);
  // 向后兼容：默认常量保留
  assert.match(CONTRACTS, /export const DATA_VERSION: CompetitionDataVersion = "competition-demo-v1";/);
});

test("overview 已登记进 CampusToolName", () => {
  const block = CONTRACTS.match(/export type CampusToolName =([\s\S]*?);/)[1];
  assert.match(block, /\| "get_campus_teaching_overview"/);
});

test("overview 已登记进 CampusToolInputs + TeachingOverviewInput 存在", () => {
  assert.match(CONTRACTS, /export interface TeachingOverviewInput \{/);
  assert.match(CONTRACTS, /get_campus_teaching_overview: TeachingOverviewInput;/);
});

test("query_teacher_load 已登记进 CampusToolName + CampusToolInputs", () => {
  const block = CONTRACTS.match(/export type CampusToolName =([\s\S]*?);/)[1];
  assert.match(block, /\| "query_teacher_load"/);
  assert.match(CONTRACTS, /export interface QueryTeacherLoadInput \{/);
  assert.match(CONTRACTS, /query_teacher_load: QueryTeacherLoadInput;/);
});

test("query_schedule_range 已登记进 CampusToolName + CampusToolInputs", () => {
  const block = CONTRACTS.match(/export type CampusToolName =([\s\S]*?);/)[1];
  assert.match(block, /\| "query_schedule_range"/);
  assert.match(CONTRACTS, /export interface QueryScheduleRangeInput \{/);
  assert.match(CONTRACTS, /query_schedule_range: QueryScheduleRangeInput;/);
});

test("JS runtime TOOL_DEFS 与 TS contract 工具集合一致（不许 JS 有 TS 没有）", () => {
  const jsTools = [...TOOLS.matchAll(/name: "([a-z_]+)",/g)].map((m) => m[1]);
  const block = CONTRACTS.match(/export type CampusToolName =([\s\S]*?);/)[1];
  const tsTools = [...block.matchAll(/\| "([a-z_]+)"/g)].map((m) => m[1]);
  assert.strictEqual(jsTools.length, 9, "TOOL_DEFS 应为 9 个工具");
  for (const t of jsTools) {
    assert.ok(tsTools.includes(t), `TS contract 缺少 JS 运行时的工具: ${t}`);
  }
});
