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
const EXPECTED_SOURCE_SHA256 = "9f0c4aeb6e9c47c90b32879ecbc0ee3bc3e0e97d7d18dafb740b9ca3ecefcda6";
const PREVIEW_COLOR_MAP = new Map(Object.entries({
  "#FBFAF7": "#FFFDFC",
  "#EAF3EE": "#E8F8F0",
  "#2F6B59": "#159A62",
  "#FFF0EC": "#FFF0EB",
  "#DF5E48": "#F0644B",
  "#B94735": "#D94B36",
  "#9F3426": "#C83F2A",
  "#66706B": "#77827D",
  "#18201D": "#26312D",
  "#E7EAE7": "#E7EFEA",
  "#F1F7F3": "#F0FAF5",
  "#F2F5FA": "#F1F6FF",
  "#3F6FE5": "#4F7FE8",
  "#FBF0EF": "#FFF1F1",
  "#F3F4F2": "#F7F9F8",
  "#FBF3E8": "#FFF7E3",
  "#EEF2FB": "#EEF5FF",
  "#EDF5F1": "#EEFAF4",
  "#B97828": "#D88A18",
  "#B94A48": "#D84C4C",
  "#8A918D": "#A2AAA6",
  "#4F5954": "#68736E",
  "#8E3432": "#B23B3B",
  "#F7F8F5": "#FAFCFB",
  "#8A5A22": "#A8660D",
  "#F3F6F4": "#F6FAF8",
}));

function hash(buffer) {
  return crypto.createHash("sha256").update(buffer).digest("hex");
}

function synchronizePreviewColors(value) {
  if (Array.isArray(value)) return value.map(synchronizePreviewColors);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, synchronizePreviewColors(item)]));
  }
  if (typeof value === "string") return PREVIEW_COLOR_MAP.get(value.toUpperCase()) || value;
  return value;
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
    // Preserve the platform-generated preview tree as a structural import hint,
    // while keeping its template-only palette aligned with encodedWidget.view.
    // Runtime rendering is governed by encodedWidget.view and current state.
    outputJsonPreview: synchronizePreviewColors(outer.outputJsonPreview),
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
