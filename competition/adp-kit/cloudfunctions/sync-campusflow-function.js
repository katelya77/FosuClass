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
const RUNTIME_FILES = ["data.js", "envelope.js", "ratelimit.js", "server.js", "tools.js"];
const DATA_FILE = "competition-demo-v1.json";

const copies = [
  ...RUNTIME_FILES.map((name) => ({
    source: path.join(SOURCE_ROOT, name),
    target: path.join(TARGET_SOURCE_ROOT, name),
  })),
  {
    source: path.join(KIT_ROOT, "mock-data", DATA_FILE),
    target: path.join(TARGET_DATA_ROOT, DATA_FILE),
  },
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
