#!/usr/bin/env node
const assert = require("assert");
const fs = require("fs");
const path = require("path");

const ROOT = __dirname;
const JSON_PATH = path.join(ROOT, "standard-qa.json");
const CSV_PATH = path.join(ROOT, "standard-qa.csv");

function csvCell(value) {
  const text = String(value ?? "");
  return `"${text.replace(/"/g, '""')}"`;
}

function renderCsv(items) {
  const rows = [
    ["问题", "标准答案", "分类", "标签"],
    ...items.map((item) => [
      item.question,
      item.answer,
      item.category,
      item.tags.join("|"),
    ]),
  ];
  return `${rows.map((row) => row.map(csvCell).join(",")).join("\n")}\n`;
}

function main() {
  const source = JSON.parse(fs.readFileSync(JSON_PATH, "utf8").replace(/^\uFEFF/, ""));
  assert(Array.isArray(source.items), "standard-qa.json items 必须为数组");
  assert.strictEqual(source.count, source.items.length, "standard-qa.json count 与 items 不一致");
  const expected = renderCsv(source.items);

  if (process.argv.includes("--check")) {
    const actual = fs.readFileSync(CSV_PATH, "utf8").replace(/^\uFEFF/, "").replace(/\r\n/g, "\n");
    assert.strictEqual(actual, expected, "standard-qa.csv 与 standard-qa.json 不一致；请运行 node qa/sync-standard-qa.js");
    console.log(`[pass] 标准问答 JSON/CSV 一致（${source.items.length} 组）`);
    return;
  }

  fs.writeFileSync(CSV_PATH, expected, "utf8");
  console.log(`[ok] 已同步 standard-qa.csv（${source.items.length} 组）`);
}

main();
