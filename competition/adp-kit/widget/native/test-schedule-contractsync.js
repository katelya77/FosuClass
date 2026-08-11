#!/usr/bin/env node
"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const { auditWidget } = require("./audit-widget-contract");

const root = __dirname;
const contract = JSON.parse(fs.readFileSync(path.join(root, "schedule-runtime-safe-v3-contract.json"), "utf8"));
const schema = JSON.parse(fs.readFileSync(path.join(root, "schedule-runtime-safe-v3-schema.json"), "utf8"));
const defaults = JSON.parse(fs.readFileSync(path.join(root, "schedule-runtime-safe-v3-default.json"), "utf8"));
const template = fs.readFileSync(path.join(root, "schedule-runtime-safe-v3-template.txt"), "utf8");

const expected = contract.fields.map((field) => field.name);
assert.deepStrictEqual(Object.keys(schema.properties), expected, "RuntimeSafe V3 schema order/keys drifted from canonical contract");
assert.deepStrictEqual(Object.keys(defaults), expected, "RuntimeSafe V3 default keys drifted from canonical contract");
for (const field of expected) {
  assert(new RegExp(`\\b${field}\\b`).test(template), `template does not reference ${field}`);
}
assert.strictEqual(schema.properties.shownCount.type, "integer");
for (const field of contract.fields.filter((value) => value.name !== "shownCount")) {
  assert.strictEqual(schema.properties[field.name].type, "string", `${field.name} must remain string`);
}

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

const staleOuter = {
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
const staleAudit = auditWidget(staleOuter, contract);
assert.strictEqual(staleAudit.pass, false, "mixed V2 outer / V3 inner export must fail audit");
assert.strictEqual(staleAudit.outerTemplateEmpty, true);
assert.strictEqual(staleAudit.checks.outerSchemaMatchesInnerSchema, false);

const synced = {
  ...staleOuter,
  template,
  jsonSchema: schema,
};
const syncedAudit = auditWidget(synced, contract);
assert.strictEqual(syncedAudit.pass, true, JSON.stringify(syncedAudit, null, 2));

console.log("Schedule ContractSync tests: PASS");
