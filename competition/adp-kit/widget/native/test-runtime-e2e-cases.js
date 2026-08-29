#!/usr/bin/env node
"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const { callTool } = require("../../mcp/campus-tools-mcp/src/tools");

const root = __dirname;
const cases = JSON.parse(fs.readFileSync(path.join(root, "runtime-e2e-cases.json"), "utf8"));
const registry = JSON.parse(fs.readFileSync(path.join(root, "widget-registry.json"), "utf8"));
const golden = JSON.parse(fs.readFileSync(path.join(root, "../../evaluation/golden-results.json"), "utf8"));

assert.strictEqual(cases.cases.length, 6);
assert.deepStrictEqual(cases.cases.map((item) => item.kind),
  ["Schedule", "Classroom", "Conflict", "DayPlan", "Choice", "Error"]);
for (const testCase of cases.cases) {
  const widget = registry.widgets[testCase.widgetKey];
  assert(widget && /^[0-9a-f]{32}$/.test(widget.widgetId), `${testCase.kind}: real WidgetID missing`);
  assert(testCase.userInput && testCase.workflow && testCase.tool && testCase.mustAppear.length);
  assert(testCase.action.sysChat.query && testCase.action.nextWorkflow);
}

for (const testCase of cases.cases.filter((item) => item.source === "evaluation/golden-cases.js")) {
  const record = golden.cases.find((item) => item.id === testCase.fixtureId);
  assert(record, `${testCase.kind}: Golden fixture missing`);
  assert.deepStrictEqual(record.input, testCase.toolInput);
  const result = callTool(testCase.tool, testCase.toolInput);
  assert.strictEqual(result.success, true, `${testCase.kind}: canonical tool probe failed`);
  assert.strictEqual(result.evidence.verified, true);
  assert.strictEqual(result.dataVersion, cases.dataVersion);
  assert.strictEqual(result.items.length, record.expected.itemCount);
}

const choice = cases.cases.find((item) => item.kind === "Choice");
const choiceResult = callTool(choice.tool, choice.toolInput);
assert.strictEqual(choiceResult.success, false);
assert.strictEqual(choiceResult.error.code, "AMBIGUOUS_ENTITY");
assert.deepStrictEqual(choiceResult.error.details.candidates.map((item) => item.name),
  ["程序设计基础", "程序设计基础实验"]);

const error = cases.cases.find((item) => item.kind === "Error");
assert.strictEqual(error.fixtureId, "error-conflict-missing-second-object");
assert.strictEqual(Object.prototype.hasOwnProperty.call(error.toolInput, "secondName"), false);

const risk = cases.cases.find((item) => item.kind === "Schedule").action;
assert.strictEqual(risk.sysChat.intent, "schedule_risk_check");
assert.strictEqual(risk.nextWorkflow, "03-课程冲突比较-Final");

console.log("ADP Runtime E2E cases: PASS (6 deterministic fixtures + 6 real WidgetIDs + risk route 03)");
