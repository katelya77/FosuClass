#!/usr/bin/env node
"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { project } = require("./variant-adapters.js");

const ROOT = path.join(__dirname, "fixtures");
const OUTPUT = path.join(ROOT, "expected");
const CASES = [
  ["schedule", "campus_schedule_query"],
  ["space", "campus_classroom_search"],
  ["collaboration", "campus_group_plan"],
  ["risk", "campus_risk_check"],
  ["reschedule", "campus_reschedule_feasibility"],
  ["ranking", "campus_teacher_load_query"],
  ["overview", "campus_overview"],
  ["empty", "campus_schedule_query"],
  ["error", "campus_schedule_query"],
  ["message", "campus_entity_search"],
];

for (const [name, toolName] of CASES) {
  const raw = JSON.parse(fs.readFileSync(path.join(ROOT, `${name}.json`), "utf8"));
  const result = project(raw, toolName);
  if (!result.ok) throw new Error(`${name}: ${result.errors.join("; ")}`);
  fs.writeFileSync(path.join(OUTPUT, `${name}.json`), `${JSON.stringify(result.envelope, null, 2)}\n`, "utf8");
}
process.stdout.write(`R50.2 Widget snapshots generated: ${CASES.length}\n`);
