#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");

const KIT_ROOT = path.resolve(__dirname, "..");
const SOURCE_ROOT = path.join(KIT_ROOT, "mcp", "campus-tools-mcp", "src");
const DECISION_ROOT = path.join(KIT_ROOT, "r51", "decision");
const MISSION_ROOT = path.join(KIT_ROOT, "r51", "mission");
const WIDGET_ROOT = path.join(KIT_ROOT, "r50.2", "widget");
const FUNCTION_ROOT = path.join(__dirname, "campusflowAdpTools");
const TARGET_SOURCE_ROOT = path.join(FUNCTION_ROOT, "src");
const TARGET_DATA_ROOT = path.join(FUNCTION_ROOT, "mock-data");
const CHECK = process.argv.includes("--check");
const RUNTIME_FILES = ["agent-tools.js", "data.js", "envelope.js", "ratelimit.js", "server.js", "tools.js", "temporal-core.js", "ranking-core.js"];
const DECISION_FILES = [
  "alternatives.js", "authority-action.js", "candidate-source.js", "constraint-profile.js",
  "controller.js", "credential-leak.js", "evaluator.js", "explainability.js",
  "intrinsic-constraints.js", "next-best-action.js", "outcome-synthesizer.js", "ranking.js",
  "receipt.js", "runtime-activation.js",
];
const MISSION_FILES = ["authority.js", "completion.js"];
const WIDGET_FILES = ["campus-result-envelope.schema.json", "envelope.js", "view-model.js"];
// v3 是线上默认数据源（R50.0 V3 runtime cutover）；v2 保留在部署包中供
// CAMPUS_DEMO_DATA_VERSION=competition-demo-v2 或显式 CAMPUS_DATA_PATH 回滚，
// v1 仅供显式 CAMPUS_DATA_PATH 回滚；运行时默认不会悄悄回退旧版本
// （index.js 默认指向 v3）。
const DATA_FILES = ["competition-demo-v1.json", "competition-demo-v2.json", "competition-demo-v3.json"];

const copies = [
  ...RUNTIME_FILES.map((name) => ({
    source: path.join(SOURCE_ROOT, name),
    target: path.join(TARGET_SOURCE_ROOT, name),
  })),
  ...DECISION_FILES.map((name) => ({
    source: path.join(DECISION_ROOT, name),
    target: path.join(TARGET_SOURCE_ROOT, "decision", name),
  })),
  ...MISSION_FILES.map((name) => ({
    source: path.join(MISSION_ROOT, name),
    target: path.join(TARGET_SOURCE_ROOT, "mission", name),
  })),
  ...WIDGET_FILES.map((name) => ({
    source: path.join(WIDGET_ROOT, name),
    target: path.join(FUNCTION_ROOT, "r50.2", "widget", name),
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
for (const { source, target } of copies) {
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.copyFileSync(source, target);
}
console.log(`[ok] 已同步 HTTP Function 部署包（${copies.length} files）`);
