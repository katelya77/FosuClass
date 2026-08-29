#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");

function syncWidget(widget) {
  if (!widget || !widget.encodedWidget) throw new Error("missing encodedWidget");
  const inner = JSON.parse(Buffer.from(widget.encodedWidget, "base64").toString("utf8"));
  if (!inner.view) throw new Error("encodedWidget.view is empty");

  widget.template = inner.view;

  if (typeof inner.schema === "object" && inner.schema) {
    widget.jsonSchema = inner.schema;
  } else {
    const schemaText = String(inner.schema || "").trim();
    if (!schemaText.startsWith("{")) {
      throw new Error(
        "encodedWidget.schema is not JSON Schema; save Zod in Tencent ADP first so the platform can canonicalize outer jsonSchema"
      );
    }
    widget.jsonSchema = JSON.parse(schemaText);
  }

  if (inner.name) widget.name = inner.name;
  return widget;
}

function listWidgetFiles(inputPath) {
  const stat = fs.statSync(inputPath);
  if (stat.isFile()) return [inputPath];
  return fs.readdirSync(inputPath)
    .filter((name) => name.endsWith(".widget"))
    .map((name) => path.join(inputPath, name));
}

if (require.main === module) {
  const inputPath = process.argv[2];
  const outputPath = process.argv[3] || inputPath;
  if (!inputPath) {
    console.error("usage: node sync-native-widget-wrapper.js <file-or-dir> [output-file-or-dir]");
    process.exit(2);
  }

  const files = listWidgetFiles(inputPath);
  if (!files.length) throw new Error(`no .widget files found in ${inputPath}`);

  const inputIsFile = fs.statSync(inputPath).isFile();
  if (!inputIsFile) fs.mkdirSync(outputPath, { recursive: true });

  for (const file of files) {
    const widget = JSON.parse(fs.readFileSync(file, "utf8"));
    const synced = syncWidget(widget);
    const target = inputIsFile
      ? outputPath
      : path.join(outputPath, path.basename(file));
    fs.writeFileSync(target, `${JSON.stringify(synced, null, 2)}\n`, "utf8");
    console.log(`synced ${file} -> ${target}`);
  }
}

module.exports = { syncWidget };
