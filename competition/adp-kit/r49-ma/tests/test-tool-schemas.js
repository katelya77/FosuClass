"use strict";
// R49-MA 自动测试 1：Agent Tool 契约 schema 校验（真源 tools/schemas/agent-tools.json）
const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const path = require("path");

const CONTRACT_PATH = path.join(__dirname, "..", "tools", "schemas", "agent-tools.json");
const contract = JSON.parse(fs.readFileSync(CONTRACT_PATH, "utf8"));

// 7 个 Agent Tool → CampusTools 确定性映射（不允许把内部 resolver 直接暴露）
const EXPECTED_MAP = {
  campus_schedule_query: "query_schedule",
  campus_classroom_search: "find_available_classrooms",
  campus_risk_check: "compare_schedules",
  campus_day_plan: "generate_day_plan",
  campus_overview: "get_campus_teaching_overview",
  campus_teacher_load_query: "query_teacher_load",
  campus_schedule_range_query: "query_schedule_range",
};

const OUTPUT_STATUSES = ["success", "clarification", "no_result", "error"];

test("agent-tools.json 存在且恰为 7 个 Agent Tool", () => {
  assert.ok(contract.toolContractVersion, "缺 toolContractVersion");
  assert.ok(Array.isArray(contract.tools), "tools 必须是数组");
  assert.strictEqual(contract.tools.length, 7, "必须是 7 个 Agent Tool（不暴露内部 resolver）");
});

test("工具名唯一，且映射到稳定 CampusTools 工具", () => {
  const names = contract.tools.map((t) => t.name);
  assert.strictEqual(new Set(names).size, 7, "工具名不允许重复");
  for (const [agentTool, campusTool] of Object.entries(EXPECTED_MAP)) {
    const t = contract.tools.find((x) => x.name === agentTool);
    assert.ok(t, `缺少 Agent Tool: ${agentTool}`);
    assert.strictEqual(t.campusTool, campusTool, `${agentTool} 必须映射 ${campusTool}`);
    assert.strictEqual(t.restPath, `/api/${campusTool}`, `${agentTool} restPath 必须匹配`);
  }
});

test("每个工具字段完整且 schema 合法", () => {
  for (const t of contract.tools) {
    for (const f of ["name", "agent", "campusTool", "restPath", "description", "inputSchema", "outputStatus"]) {
      assert.ok(t[f] !== undefined && t[f] !== null && t[f] !== "", `${t.name} 缺字段 ${f}`);
    }
    assert.strictEqual(t.inputSchema.type, "object", `${t.name} inputSchema 必须是 object`);
    assert.ok(typeof t.inputSchema.properties === "object" && t.inputSchema.properties !== null, `${t.name} properties 缺失`);
    assert.ok(Array.isArray(t.inputSchema.required), `${t.name} required 必须是数组`);
    assert.ok(Array.isArray(t.outputStatus), `${t.name} outputStatus 必须是数组`);
    for (const s of t.outputStatus) {
      assert.ok(OUTPUT_STATUSES.includes(s), `${t.name} outputStatus 含非法状态 ${s}`);
    }
    // 契约层不允许要求内部 resolver 参数
    for (const key of t.inputSchema.required || []) {
      assert.ok(!/resolver/i.test(key), `${t.name} required 暴露内部 resolver 参数 ${key}`);
    }
  }
});

test("campus_risk_check：顶层 required 只含第一对象 + if/then 条件约束第二对象", () => {
  const risk = contract.tools.find((t) => t.name === "campus_risk_check");
  assert.ok(risk, "缺少 campus_risk_check");
  const required = risk.inputSchema.required || [];
  assert.ok(required.includes("entityType") && required.includes("entityName"), "第一对象必须 required");
  assert.ok(!required.includes("secondEntityType"), "secondEntityType 不得在顶层 required");
  assert.ok(!required.includes("secondEntityName"), "secondEntityName 不得在顶层 required");
  // 条件约束：mode=compare 才必填第二对象
  assert.ok(risk.inputSchema.if && risk.inputSchema.then, "必须有 if/then 条件约束");
  const thenRequired = risk.inputSchema.then.required || [];
  assert.ok(thenRequired.includes("secondEntityType") && thenRequired.includes("secondEntityName"), "compare 分支必须要求第二对象");
  // mode 枚举
  const modeProp = risk.inputSchema.properties.mode;
  assert.ok(modeProp && Array.isArray(modeProp.enum) && modeProp.enum.includes("self") && modeProp.enum.includes("compare"), "mode 枚举必须含 self/compare");
});

test("outputStatus 覆盖 success/clarification/no_result/error 四态", () => {
  for (const t of contract.tools) {
    for (const required of ["success", "clarification", "no_result", "error"]) {
      assert.ok(t.outputStatus.includes(required), `${t.name} 缺输出状态 ${required}`);
    }
  }
});
