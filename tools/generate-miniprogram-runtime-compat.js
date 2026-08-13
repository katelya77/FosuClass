#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const MODULES = [
  { name: "termVisibility", source: "shared/termVisibility.js" },
  { name: "teachingEventResolver", source: "shared/teachingEventResolver.js" },
];

function normalizeNewlines(value) {
  return String(value || "").replace(/\r\n/g, "\n");
}

function header(source) {
  return [
    `// Generated from ${source} by tools/generate-miniprogram-runtime-compat.js.`,
    "// Do not edit this packaged compatibility module directly.",
  ].join("\n");
}

function resolveModule(entry) {
  const sourceFile = path.join(ROOT, entry.source);
  const targetFile = path.join(ROOT, "miniprogram", "shared", `${entry.name}.generated.js`);
  return {
    sourceFile,
    targetFile,
    expected: `${header(entry.source)}\n${normalizeNewlines(fs.readFileSync(sourceFile, "utf8"))}`,
  };
}

function main() {
  const modules = MODULES.map(resolveModule);
  if (process.argv.includes("--check")) {
    const stale = modules.filter(({ targetFile, expected }) => {
      const actual = fs.existsSync(targetFile) ? normalizeNewlines(fs.readFileSync(targetFile, "utf8")) : "";
      return actual !== expected;
    });
    if (stale.length) {
      console.error("miniprogram runtime compatibility module is stale; run npm run build:miniprogram-compat");
      process.exit(1);
    }
    console.log(`miniprogram compatibility modules are current (${modules.length})`);
    return;
  }
  modules.forEach(({ targetFile, expected }) => {
    fs.mkdirSync(path.dirname(targetFile), { recursive: true });
    fs.writeFileSync(targetFile, expected, "utf8");
    console.log(`generated ${path.relative(ROOT, targetFile)}`);
  });
}

main();
