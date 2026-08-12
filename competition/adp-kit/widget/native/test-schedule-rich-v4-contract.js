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

const fields = contract.fields.map((field) => field.name);
assert.deepStrictEqual(Object.keys(schema.properties), fields);
assert.deepStrictEqual(Object.keys(defaults), fields);
assert.deepStrictEqual(Object.keys(day), fields);
for (const field of fields) {
  assert(new RegExp(`^  ${field}:`, "m").test(zod), `Zod is missing top-level ${field}`);
}
assert.strictEqual(contract.widgetId, null, "must not fabricate a WidgetID");
assert(template.includes("items.map"), "rich schedule must render the complete array");
assert(!template.includes("limit={2}"), "rich schedule must not preserve the RuntimeSafe two-row limit");
for (const sample of [defaults, day]) {
  assert.strictEqual(sample.summary.totalCount, sample.items.length);
  for (const item of sample.items) {
    assert.deepStrictEqual(Object.keys(item), contract.itemFields);
    assert(item.weekday >= 1 && item.weekday <= 7);
  }
}
assert.strictEqual(defaults.items.length, 5, "WEEK sample must retain all five real lessons");

console.log("Schedule Rich V4 contract tests: PASS (Template/Zod/JSON Schema/Default/samples)");
