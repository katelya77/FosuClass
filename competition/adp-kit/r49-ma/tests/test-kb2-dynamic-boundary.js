"use strict";
// CSF P3 Knowledge Base 2.0 —— dynamic-fact leakage gate（2026-08-19）
// D1 静态知识不得断言动态事实（具体教学周 / 学期首日 / 当前数据版本 / 负载等运行时值）；
// D2 每节文档必须声明「动态事实以 CampusTools 核验为准」的边界；
// D3 README 明确静态知识 vs 动态事实的分工。
const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const path = require("path");

const CURRENT = path.join(__dirname, "..", "..", "knowledge", "current");

const SECTION_FILES = fs.readdirSync(CURRENT).filter((f) => /^\d{2}-.*\.md$/.test(f));

test("D1. 静态知识不得断言动态事实", () => {
  for (const rel of SECTION_FILES) {
    const text = fs.readFileSync(path.join(CURRENT, rel), "utf8");
    assert.ok(!/第\d{1,2}周/.test(text), `${rel} 不得断言具体教学周`);
    assert.ok(!/学期首日|学期开始|教学周首日/.test(text), `${rel} 不得断言学期日期`);
    assert.ok(!/当前数据版本|数据版本为|dataVersion/i.test(text), `${rel} 不得断言数据版本`);
    assert.ok(!/最高负载|最忙的|利用率最高/.test(text), `${rel} 不得断言负载/利用率等运行时事实`);
    assert.ok(!/共\s*\d+\s*(个|名|间|门)/.test(text), `${rel} 不得断言实体数量`);
  }
});

test("D2. 每节文档声明动态事实边界（以 CampusTools 核验为准）", () => {
  for (const rel of SECTION_FILES) {
    const text = fs.readFileSync(path.join(CURRENT, rel), "utf8");
    assert.ok(text.includes("动态事实"), `${rel} 必须包含「动态事实」边界表述`);
    assert.ok(/CampusTools|工具/.test(text), `${rel} 必须指向 CampusTools 核验`);
  }
});

test("D3. README 明确静态知识 vs 动态事实分工", () => {
  const readme = fs.readFileSync(path.join(CURRENT, "README.md"), "utf8");
  assert.ok(readme.includes("静态知识"), "README 必须定义静态知识");
  assert.ok(readme.includes("动态事实"), "README 必须定义动态事实");
  assert.ok(/CampusTools|工具/.test(readme), "README 必须声明动态事实来自 CampusTools");
});