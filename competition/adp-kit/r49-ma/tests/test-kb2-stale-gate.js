"use strict";
// CSF P3 Knowledge Base 2.0 —— stale-knowledge gate（2026-08-19）
// K1 当前 SSOT 只认 knowledge/current/（10 节，编号 01-10）；
// K2 静态知识无研发标记：Rxx / competition-demo-vX / dataHash / 固定匿名数量；
// K3 无测试实体 / 固定日期 / 匿名编号 / 旧工作流 ID；
// K4 旧知识库已标记 legacy，不再作为当前 SSOT。
const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const path = require("path");

const KNOWLEDGE = path.join(__dirname, "..", "..", "knowledge");
const CURRENT = path.join(KNOWLEDGE, "current");
const LEGACY = path.join(KNOWLEDGE, "legacy");

const EXPECTED_SECTIONS = [
  "01-定位与能力边界.md",
  "02-课表与校园实体理解.md",
  "03-教学时间与节次规则.md",
  "04-动态事实与可信度.md",
  "05-隐私安全与授权边界.md",
  "06-无结果歧义与恢复.md",
  "07-主动协作原则.md",
  "08-功能导航与自然语言使用.md",
  "09-个人课表导入与同步.md",
  "10-常见问题.md",
];

function docText(rel) {
  return fs.readFileSync(path.join(CURRENT, rel), "utf8");
}

test("K1. knowledge/current/ 为唯一当前 SSOT（10 节）", () => {
  for (const rel of EXPECTED_SECTIONS) {
    assert.ok(fs.existsSync(path.join(CURRENT, rel)), `缺少 ${rel}`);
  }
  assert.ok(fs.existsSync(path.join(CURRENT, "README.md")), "缺少 current/README.md");
  assert.ok(fs.existsSync(path.join(CURRENT, "recall-matrix.md")), "缺少 current/recall-matrix.md");
  const files = fs.readdirSync(CURRENT).filter((f) => f.endsWith(".md"));
  assert.strictEqual(files.length, 12, `current/ 应恰好 10 节 + README + recall-matrix（实际 ${files.join(",")}）`);
});

test("K2. 静态知识无研发标记（Rxx / competition-demo-vX / dataHash）", () => {
  for (const rel of [...EXPECTED_SECTIONS, "README.md"]) {
    const text = docText(rel);
    assert.ok(!/R\d{2,}/.test(text), `${rel} 不得含 Rxx 研发标记`);
    assert.ok(!/competition-demo-v\d/i.test(text), `${rel} 不得含 competition-demo-vX`);
    assert.ok(!/dataHash|datahash/i.test(text), `${rel} 不得含 dataHash`);
  }
});

test("K3. 无测试实体 / 固定日期 / 匿名编号 / 旧工作流 ID", () => {
  for (const rel of [...EXPECTED_SECTIONS, "README.md"]) {
    const text = docText(rel);
    assert.ok(!/教师00\d/.test(text), `${rel} 不得含匿名教师编号`);
    assert.ok(!/\d{4}-\d{2}-\d{2}/.test(text), `${rel} 不得含固定日期`);
    assert.ok(!/教师\d+|班级\d+|教室\d+/.test(text), `${rel} 不得含匿名编号实体`);
    assert.ok(!/-Final/.test(text), `${rel} 不得引用旧工作流 ID`);
    assert.ok(!/(张三|李四|王五)/.test(text), `${rel} 不得含测试人名`);
  }
});

test("K4. 旧知识库已标记 legacy，不再作为当前 SSOT", () => {
  assert.ok(fs.existsSync(path.join(LEGACY, "LEGACY.md")), "缺少 knowledge/legacy/LEGACY.md 标记");
  const marker = fs.readFileSync(path.join(LEGACY, "LEGACY.md"), "utf8");
  assert.ok(marker.includes("legacy"), "LEGACY.md 必须声明 legacy 状态");
  assert.ok(marker.includes("knowledge/current"), "LEGACY.md 必须指向新 SSOT");
  const readme = fs.readFileSync(path.join(CURRENT, "README.md"), "utf8");
  assert.ok(readme.includes("legacy"), "current/README.md 必须说明旧库 legacy 状态");
  assert.ok(readme.includes("唯一"), "current/README.md 必须声明唯一 SSOT");
});