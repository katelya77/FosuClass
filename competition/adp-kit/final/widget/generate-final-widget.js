#!/usr/bin/env node
"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");

const FINAL_ROOT = __dirname;
const KIT = path.join(FINAL_ROOT, "..", "..");
const UNIFIED = path.join(KIT, "widget", "native", "campus-result-unified-v1");
const DEFAULT_SOURCE = "C:\\Users\\Katelya\\Downloads\\小序-校园智序结果卡.widget";
const OUTPUT = path.join(FINAL_ROOT, "小序-校园智序结果卡.widget");
const CONSOLE_WIDGET = path.join(KIT, "r50.2", "console-bundle", "widget");
const EXPECTED_ID = "601418106a374b2eb7de54c65a3de7e0";
const EXPECTED_SOURCE_SHA256 = "93bbc0b1619ee2bdfbbc7817ad15d3b0ad0a42054a345e35d7ccb290e40ef252";

function hash(buffer) {
  return crypto.createHash("sha256").update(buffer).digest("hex");
}

function main() {
  const sourcePath = process.argv[2] || process.env.FOSU_FINAL_WIDGET_ORACLE || DEFAULT_SOURCE;
  const sourceBytes = fs.readFileSync(sourcePath);
  if (hash(sourceBytes) !== EXPECTED_SOURCE_SHA256) throw new Error("Widget Oracle hash mismatch");
  const outer = JSON.parse(sourceBytes.toString("utf8"));
  const inner = JSON.parse(Buffer.from(outer.encodedWidget, "base64").toString("utf8"));
  if (outer.name !== "小序-校园智序结果卡" || inner.id !== EXPECTED_ID) throw new Error("Widget Oracle identity mismatch");

  const schema = JSON.parse(fs.readFileSync(path.join(UNIFIED, "schema.json"), "utf8"));
  const defaultState = JSON.parse(fs.readFileSync(path.join(UNIFIED, "default.json"), "utf8"));
  const view = fs.readFileSync(path.join(UNIFIED, "template.txt"), "utf8").trimEnd();
  const zod = fs.readFileSync(path.join(UNIFIED, "schema.zod.txt"), "utf8").trimEnd() + "\n";
  const generatedInner = {
    ...inner,
    name: outer.name,
    id: EXPECTED_ID,
    view,
    defaultState,
    states: [],
    schema: zod,
  };
  const generated = {
    version: outer.version,
    name: outer.name,
    template: "",
    jsonSchema: schema,
    // Preserve the platform-generated preview tree as a structural import hint.
    // Runtime rendering is governed by encodedWidget.view and current state.
    outputJsonPreview: outer.outputJsonPreview,
    encodedWidget: Buffer.from(JSON.stringify(generatedInner), "utf8").toString("base64"),
  };
  fs.mkdirSync(FINAL_ROOT, { recursive: true });
  fs.writeFileSync(OUTPUT, `${JSON.stringify(generated)}\n`, "utf8");
  for (const file of ["adapter.py", "contract.json", "default.json", "schema.json", "template.txt"]) {
    fs.copyFileSync(path.join(UNIFIED, file), path.join(CONSOLE_WIDGET, file));
  }
  fs.copyFileSync(
    path.join(KIT, "r50.2", "widget", "view-model.js"),
    path.join(CONSOLE_WIDGET, "view-model.js"),
  );
  process.stdout.write(`Final Widget generated: ${OUTPUT}\n`);
}

main();
