#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");

const KIT_ROOT = path.resolve(__dirname, "..");
const SOURCE_ROOT = path.join(KIT_ROOT, "mcp", "campus-tools-mcp", "src");
const FUNCTION_ROOT = path.join(__dirname, "campusflowAdpTools");
const TARGET_SOURCE_ROOT = path.join(FUNCTION_ROOT, "src");
const TARGET_DATA_ROOT = path.join(FUNCTION_ROOT, "mock-data");
const CHECK = process.argv.includes("--check");
const RUNTIME_FILES = ["agent-tools.js", "data.js", "envelope.js", "ratelimit.js", "server.js", "tools.js"];
// v2 是线上默认数据源；v1 保留在部署包中仅供显式 CAMPUS_DATA_PATH 回滚，
// 运行时默认不会悄悄回退到 v1（index.js 默认指向 v2）。
const DATA_FILES = ["competition-demo-v1.json", "competition-demo-v2.json"];

const copies = [
  ...RUNTIME_FILES.map((name) => ({
    source: path.join(SOURCE_ROOT, name),
    target: path.join(TARGET_SOURCE_ROOT, name),
  })),
  ...DATA_FILES.map((name) => ({
    source: path.join(KIT_ROOT, "mock-data", name),
    target: path.join(TARGET_DATA_ROOT, name),
  })),
];

function sameBytes(left, right) {
  return fs.existsSync(right) && fs.readFileSync(left).equals(fs.readFileSync(right));
}

if (CHECK) {
  const drift = copies.filter(({ source, target }) => !sameBytes(source, target));
  if (drift.length) {
    console.error(`[fail] HTTP Function 部署包漂移：${drift.map(({ target }) => path.relative(KIT_ROOT, target)).join(", ")}`);
    process.exit(1);
  }
  console.log(`[pass] HTTP Function 部署包与 CampusTools 权威源一致（${copies.length} files）`);
  process.exit(0);
}

fs.mkdirSync(TARGET_SOURCE_ROOT, { recursive: true });
fs.mkdirSync(TARGET_DATA_ROOT, { recursive: true });
for (const { source, target } of copies) fs.copyFileSync(source, target);
console.log(`[ok] 已同步 HTTP Function 部署包（${copies.length} files）`);
