#!/usr/bin/env node
"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const { syncWidget } = require("./sync-native-widget-wrapper");
const { auditWidget } = require("./audit-widget-contract");

const root = __dirname;
const contract = JSON.parse(fs.readFileSync(path.join(root, "schedule-runtime-safe-v3-contract.json"), "utf8"));
const schema = JSON.parse(fs.readFileSync(path.join(root, "schedule-runtime-safe-v3-schema.json"), "utf8"));
const defaults = JSON.parse(fs.readFileSync(path.join(root, "schedule-runtime-safe-v3-default.json"), "utf8"));
const template = fs.readFileSync(path.join(root, "schedule-runtime-safe-v3-template.txt"), "utf8");

const inner = {
  name: "小序-课表票据-V2",
  id: contract.widgetId,
  view: template,
  defaultState: defaults,
  states: {},
  schema: JSON.stringify(schema),
  schemaValidity: "valid",
  viewValidity: "valid",
  defaultStateValidity: "valid",
};

const stale = {
  version: "1",
  name: "小序-课表票据-V2",
  template: "",
  jsonSchema: {
    type: "object",
    properties: {
      title: { type: "string" },
      timeText: { type: "string" },
      queryId: { type: "string" },
      dataVersion: { type: "string" },
      summary: { type: "object" },
      items: { type: "array" },
      actions: { type: "array" },
    },
  },
  encodedWidget: Buffer.from(JSON.stringify(inner)).toString("base64"),
};

assert.strictEqual(auditWidget(stale, contract).pass, false);
const synced = syncWidget(JSON.parse(JSON.stringify(stale)));
const result = auditWidget(synced, contract);
assert.strictEqual(result.pass, true, JSON.stringify(result, null, 2));
assert.strictEqual(synced.template, template);
assert.deepStrictEqual(Object.keys(synced.jsonSchema.properties), contract.fields.map((field) => field.name));

console.log("Widget wrapper sync tests: PASS");
