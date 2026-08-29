#!/usr/bin/env node
"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");

const inputDir = process.argv[2];
if (!inputDir) {
  console.error("usage: node test-native-import-preview-contract.js <widget-directory>");
  process.exit(2);
}

const files = fs.readdirSync(inputDir)
  .filter((name) => name.endsWith(".widget"))
  .sort((a, b) => a.localeCompare(b, "zh-CN"));

assert.strictEqual(files.length, 6, `expected 6 .widget files, got ${files.length}`);

const previews = [];
for (const file of files) {
  const fullPath = path.join(inputDir, file);
  const widget = JSON.parse(fs.readFileSync(fullPath, "utf8"));
  const preview = widget.outputJsonPreview;
  const serialized = JSON.stringify(preview);

  assert(preview && preview.type === "Card", `${file}: preview root must be Card`);
  assert(!serialized.includes("Campus Task Widget"), `${file}: placeholder preview leaked`);
  assert(!serialized.includes("Untitled widget"), `${file}: untitled placeholder leaked`);
  assert(serialized.includes('"type":"Button"'), `${file}: preview must contain interactive Button`);
  assert(serialized.includes('"type":"sys.chat"'), `${file}: preview must contain sys.chat action`);

  previews.push(JSON.stringify(preview, Object.keys(preview).sort()));
}

const canonical = files.map((file) => {
  const widget = JSON.parse(fs.readFileSync(path.join(inputDir, file), "utf8"));
  return JSON.stringify(widget.outputJsonPreview);
});
assert.strictEqual(new Set(canonical).size, 6, "all six outputJsonPreview payloads must be distinct");

console.log("Native Widget import preview contract passed: 6 unique visual previews + interactive sys.chat actions");
