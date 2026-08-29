"use strict";
// R49-MA 自动测试 7：knowledge dynamic-fact guard
// 知识库只承载静态知识（产品介绍/功能导航/教学周规则/数据口径/隐私规范/失败说明）；
// 动态校园事实（课表/空教室/风险/日计划/态势）必须由 CampusTools 确定性工具提供。
const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const path = require("path");

const KNOWLEDGE = path.join(__dirname, "..", "..", "knowledge");
const APP_CONFIG = path.join(__dirname, "..", "..", "workflows", "application-config.json");

// 知识库中不得出现的“动态事实宣称”短语（已核对全文，当前 0 命中）
const FORBIDDEN_DYNAMIC_CLAIM = ["实时课表", "实时空教室", "实时风险", "实时负载", "实时态势", "知识库查询课表"];

function knowledgeFiles() {
  return fs.readdirSync(KNOWLEDGE).filter((f) => f.endsWith(".md")).sort();
}

test("知识库存在 01-08 文档 + taxonomy.json", () => {
  const files = knowledgeFiles();
  for (let i = 1; i <= 8; i++) {
    const prefix = `${String(i).padStart(2, "0")}-`;
    assert.ok(files.some((f) => f.startsWith(prefix)), `知识库缺 ${i} 文档`);
  }
  assert.ok(fs.existsSync(path.join(KNOWLEDGE, "taxonomy.json")), "缺 taxonomy.json");
  assert.strictEqual(files.length, 8, "知识库应为 8 份文档（01-08）");
});

test("知识库不得宣称提供动态校园事实", () => {
  for (const f of knowledgeFiles()) {
    const txt = fs.readFileSync(path.join(KNOWLEDGE, f), "utf8");
    for (const phrase of FORBIDDEN_DYNAMIC_CLAIM) {
      assert.ok(!txt.includes(phrase), `${f} 出现动态事实宣称短语：${phrase}`);
    }
  }
});

test("知识库 04 明确防幻觉守卫：动态事实只能来自工具、不得由模型生成、知识库不存动态课表", () => {
  const c4 = fs.readFileSync(path.join(KNOWLEDGE, "04-数据版本核验和防幻觉机制.md"), "utf8");
  assert.ok(c4.includes("不得由模型生成"), "04 缺「不得由模型生成」守卫");
  assert.ok(c4.includes("不存放动态课表事实"), "04 缺「知识库不存放动态课表事实」守卫");
});

test("知识库数据版本锚点与 competition-demo-v2 一致（v2 实测证据，非记忆手填）", () => {
  const c1 = fs.readFileSync(path.join(KNOWLEDGE, "01-产品能力与使用边界.md"), "utf8");
  assert.ok(c1.includes("competition-demo-v2"), "01 未引用 v2 数据版本");
  assert.ok(c1.includes("sha1:4f3bbbb45d1f"), "01 未引用 v2 dataHash 锚点");
  const c4 = fs.readFileSync(path.join(KNOWLEDGE, "04-数据版本核验和防幻觉机制.md"), "utf8");
  assert.ok(c4.includes("competition-demo-v2"), "04 未引用 v2 数据版本");
  assert.ok(c4.includes("sha1:4f3bbbb45d1f"), "04 未引用 v2 dataHash 锚点");
  const c7 = fs.readFileSync(path.join(KNOWLEDGE, "07-校园任务智能体常见问题.md"), "utf8");
  assert.ok(c7.includes("competition-demo-v2"), "07 未引用 v2 数据版本");
});

test("knowledge/08 功能导航已补建，taxonomy 含对应类别", () => {
  const c8 = fs.readFileSync(path.join(KNOWLEDGE, "08-功能导航与演示问题.md"), "utf8");
  assert.ok(c8.length > 100, "08 文档过短，疑似未补建");
  const tax = JSON.parse(fs.readFileSync(path.join(KNOWLEDGE, "taxonomy.json"), "utf8"));
  const text = JSON.stringify(tax);
  assert.ok(/功能导航/.test(text), "taxonomy 缺「功能导航」类别");
});

test("application-config 数据版本 v3 + 匿名模式（生产数据未被改写）", () => {
  const cfg = JSON.parse(fs.readFileSync(APP_CONFIG, "utf8"));
  assert.strictEqual(cfg.appVariables.data_version, "competition-demo-v3");
  assert.strictEqual(cfg.appVariables.data_mode, "anonymous");
  assert.strictEqual(cfg.appVariables.environment, "competition");
});
