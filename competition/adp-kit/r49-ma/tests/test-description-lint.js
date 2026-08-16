"use strict";
// R49-MA 自动测试 3：Agent Tool description lint
// 保证 LLM 能准确判断何时调用、不残留未解决占位、不把内部 resolver 暴露给模型
const test = require("node:test");
const assert = require("node:assert");
const contract = require("../tools/schemas/agent-tools.json");

const BANNED_PLACEHOLDER = ["TODO", "TBD", "XXX", "???", "待补充", "未定义", "占位描述"];
const BANNED_INTERNAL = ["resolver", "Resolver", "resolve_entity", "get_academic_context", "data.js", "内部实现"];

test("每个工具 description 非空且达到可理解长度", () => {
  for (const t of contract.tools) {
    assert.ok(typeof t.description === "string" && t.description.length >= 40, `${t.name} description 过短或缺失`);
  }
});

test("description 不含未解决占位符", () => {
  for (const t of contract.tools) {
    for (const bad of BANNED_PLACEHOLDER) {
      assert.ok(!t.description.includes(bad), `${t.name} description 含未解决占位 ${bad}`);
    }
  }
});

test("description 声明动态事实确定性来源（CampusTools，不靠模型记忆）", () => {
  for (const t of contract.tools) {
    assert.ok(/CampusTools/.test(t.description), `${t.name} description 未声明 CampusTools 来源`);
    assert.ok(/确定性/.test(t.description), `${t.name} description 未声明确定性计算`);
  }
});

test("description 不泄露内部 resolver / 内部数据实现", () => {
  for (const t of contract.tools) {
    for (const bad of BANNED_INTERNAL) {
      assert.ok(!t.description.includes(bad), `${t.name} description 泄露内部 ${bad}`);
    }
  }
});

test("description 明确调用条件（何时该调本工具）", () => {
  // 每个 description 至少包含一个行为动词 + 业务名词，便于 LLM 判断
  for (const t of contract.tools) {
    const d = t.description;
    assert.ok(/查询|检查|搜索|汇总|生成|规划|比较|安排/.test(d), `${t.name} description 缺行为动词`);
    assert.ok(/课表|教室|风险|计划|态势|冲突|空闲|负载/.test(d), `${t.name} description 缺业务名词`);
  }
});
