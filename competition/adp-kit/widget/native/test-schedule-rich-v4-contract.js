#!/usr/bin/env node
"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");

const root = path.join(__dirname, "schedule-rich-v4");
const contract = JSON.parse(fs.readFileSync(path.join(root, "contract.json"), "utf8"));
const schema = JSON.parse(fs.readFileSync(path.join(root, "schema.json"), "utf8"));
const defaults = JSON.parse(fs.readFileSync(path.join(root, "default.json"), "utf8"));
const day = JSON.parse(fs.readFileSync(path.join(root, "samples", "day.json"), "utf8"));
const zod = fs.readFileSync(path.join(root, "zod.txt"), "utf8");
const template = fs.readFileSync(path.join(root, "template.txt"), "utf8");
const adapter = fs.readFileSync(path.join(root, "adapter.py"), "utf8");

const fields = contract.fields.map((field) => field.name);
assert.deepStrictEqual(Object.keys(schema.properties), fields);
assert.deepStrictEqual(Object.keys(defaults), fields);
assert.deepStrictEqual(Object.keys(day), fields);
for (const field of fields) {
  assert(new RegExp(`^  ${field}:`, "m").test(zod), `Zod is missing top-level ${field}`);
}
assert.strictEqual(contract.widgetId, null, "must not fabricate a WidgetID");
assert.strictEqual(contract.widgetIdPolicy, "FAIL_CLOSED_REAL_TENCENT_EXPORT_ONLY");
assert(template.includes("items.map"), "rich schedule must render the complete array");
assert(!template.includes("limit={2}"), "rich schedule must not preserve the RuntimeSafe two-row limit");
assert(template.includes("query: action.query"), "sys.chat must include a standalone query");
for (const field of ["intent", "entityType", "entityName", "week", "weekday", "date"]) {
  assert(template.includes(`${field}: action.${field}`), `sys.chat payload must include ${field}`);
}
assert(!adapter.includes("[:2]"), "Rich V4 adapter must not truncate schedule items");
for (const sample of [defaults, day]) {
  assert.strictEqual(sample.summary.totalCount, sample.items.length);
  for (const item of sample.items) {
    assert.deepStrictEqual(Object.keys(item), contract.itemFields);
    assert(item.weekday >= 1 && item.weekday <= 7);
  }
  for (const action of sample.actions) {
    assert.deepStrictEqual(Object.keys(action), contract.actionFields);
    assert(action.query.includes(action.entityName));
  }
}
assert.strictEqual(defaults.items.length, 5, "WEEK sample must retain all five real lessons");
assert.strictEqual(day.actions.find((action) => action.intent === "schedule_risk_check").intent,
  "schedule_risk_check");

console.log("Schedule Rich V4 contract tests: PASS (Template/Zod/JSON Schema/Default/samples)");
