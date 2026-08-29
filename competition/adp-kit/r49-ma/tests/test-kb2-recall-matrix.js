"use strict";
// CSF P3 Knowledge Base 2.0 —— knowledge recall matrix（2026-08-19）
// M1 recall-matrix.md 覆盖全部 10 节；
// M2 每节至少 3 个检索键，检索键为自然语言用户意图；
// M3 矩阵标明每节的动态事实来源（CampusTools 工具族）与静态边界。
const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const path = require("path");

const CURRENT = path.join(__dirname, "..", "..", "knowledge", "current");
const MATRIX = fs.readFileSync(path.join(CURRENT, "recall-matrix.md"), "utf8");

const SECTION_IDS = ["01", "02", "03", "04", "05", "06", "07", "08", "09", "10"];

test("M1. recall-matrix.md 覆盖全部 10 节", () => {
  for (const id of SECTION_IDS) {
    assert.ok(MATRIX.includes(`| ${id} `) || MATRIX.includes(`|${id}|`) || MATRIX.includes(`${id}.`),
      `矩阵必须覆盖第 ${id} 节`);
  }
});

test("M2. 每节至少 3 个检索键（自然语言意图）", () => {
  const rows = MATRIX.split(/\r?\n/).filter((line) => /^\|\s*\d{2}\s*\|/.test(line));
  assert.strictEqual(rows.length, 10, `矩阵应恰好 10 行（实际 ${rows.length}）`);
  for (const row of rows) {
    const cells = row.split("|").map((c) => c.trim());
    const keysCell = cells[2] || "";
    const keys = keysCell.split("、").filter((k) => k.length > 0);
    assert.ok(keys.length >= 3, `矩阵行 ${cells[1]} 至少 3 个检索键（实际 ${keys.length}）`);
  }
});

test("M3. 矩阵标明动态事实来源与静态边界", () => {
  assert.ok(MATRIX.includes("动态事实来源"), "矩阵必须包含动态事实来源列");
  assert.ok(MATRIX.includes("CampusTools"), "动态事实来源必须指向 CampusTools 工具族");
});