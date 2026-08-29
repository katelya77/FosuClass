#!/usr/bin/env node
"use strict";

const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

const ROOT = __dirname;
const OUTPUT = path.join(ROOT, "reports", "generated-assets-manifest.json");
const CHECK = process.argv.includes("--check");
const ASSET_ROOTS = [
  "knowledge",
  "qa",
  "evaluation",
  "mock-data",
  "workflows",
  "openapi",
  "mcp/campus-tools-mcp",
  "cloudfunctions",
  "widget",
];
const EXCLUDED_SEGMENTS = new Set(["node_modules", "dist", ".tmp", "__pycache__"]);
const EXCLUDED_FILES = new Set(["package-lock.json"]);

function listFiles(relativeRoot) {
  const absoluteRoot = path.join(ROOT, relativeRoot);
  const results = [];

  function visit(absoluteDir) {
    for (const entry of fs.readdirSync(absoluteDir, { withFileTypes: true })) {
      if (EXCLUDED_SEGMENTS.has(entry.name)) continue;
      const absolutePath = path.join(absoluteDir, entry.name);
      if (entry.isDirectory()) {
        visit(absolutePath);
        continue;
      }
      if (!entry.isFile() || EXCLUDED_FILES.has(entry.name)) continue;
      results.push(path.relative(ROOT, absolutePath).split(path.sep).join("/"));
    }
  }

  visit(absoluteRoot);
  return results;
}

function buildEntries() {
  return ASSET_ROOTS.flatMap(listFiles)
    .sort((left, right) => left.localeCompare(right, "zh-CN"))
    .map((relativePath) => {
      const content = fs.readFileSync(path.join(ROOT, relativePath));
      return {
        path: relativePath,
        bytes: content.length,
        sha256: crypto.createHash("sha256").update(content).digest("hex"),
      };
    });
}

const entries = buildEntries();

if (CHECK) {
  const saved = JSON.parse(fs.readFileSync(OUTPUT, "utf8"));
  const actual = JSON.stringify(entries);
  const expected = JSON.stringify(saved.files || []);
  if (actual !== expected) {
    console.error("[fail] ADP 资产清单与当前文件不一致；请运行 node sync-assets-manifest.js");
    process.exit(1);
  }
  console.log(`[pass] ADP 资产清单一致（${entries.length} files）`);
  process.exit(0);
}

const manifest = {
  schema: "campusflow-adp-assets/v1",
  generatedAt: new Date().toISOString(),
  note: "知识、工作流和评测为受审阅的权威文件；本清单记录当前可交付资产，不包含报告、截图、依赖目录和锁文件。",
  files: entries,
};
fs.mkdirSync(path.dirname(OUTPUT), { recursive: true });
fs.writeFileSync(OUTPUT, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
console.log(`[ok] 已更新 ADP 资产清单（${entries.length} files）`);
