#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");

const root = __dirname;
const sourcePath = path.join(root, "evaluation-dataset.json");
const dataset = JSON.parse(fs.readFileSync(sourcePath, "utf8"));

function csvCell(value) {
  const text = String(value == null ? "" : value);
  return `"${text.replace(/"/g, '""')}"`;
}

const jsonl = `${dataset.items.map((item) => JSON.stringify(item)).join("\n")}\n`;
const header = "id,分类,对话,预期意图,预期工作流,预期工具,关键行为";
const rows = dataset.items.map((item) => [
  item.id,
  item.category,
  item.turns.map((turn) => `${turn.role}:${turn.content}`).join("\\n"),
  item.expected.intent || "",
  item.expected.workflow || "",
  item.expected.tool || "",
  item.expected.behavior || "",
].map(csvCell).join(","));
const csv = `\uFEFF${[header, ...rows].join("\n")}\n`;
const outputs = [
  [path.join(root, "evaluation-dataset.jsonl"), jsonl],
  [path.join(root, "evaluation-dataset.csv"), csv],
];

const checkOnly = process.argv.includes("--check");
let stale = 0;
for (const [file, content] of outputs) {
  const current = fs.existsSync(file) ? fs.readFileSync(file, "utf8") : "";
  if (current === content) continue;
  stale += 1;
  if (checkOnly) console.error(`[fail] 评测派生文件过期：${path.basename(file)}`);
  else fs.writeFileSync(file, content, "utf8");
}
if (checkOnly && stale) process.exit(1);
console.log(`[${checkOnly ? "pass" : "ok"}] evaluation=${dataset.items.length}`);
