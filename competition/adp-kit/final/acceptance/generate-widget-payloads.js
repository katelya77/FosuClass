#!/usr/bin/env node
"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { project } = require("../../r50.2/widget/variant-adapters.js");
const { projectViewModel } = require("../../r50.2/widget/view-model.js");
const { validateWidgetPayload } = require("../../widget/native/campus-result-unified-v1/payload-validator.js");

const FIXTURES = path.join(__dirname, "..", "..", "r50.2", "widget", "fixtures");
const OUTPUT = path.join(__dirname, "widget-payloads");

function raw(name) {
  return JSON.parse(fs.readFileSync(path.join(FIXTURES, `${name}.json`), "utf8"));
}

function render(source, toolName) {
  const built = project(source, toolName);
  if (!built.ok) throw new Error(`${toolName}: ${built.errors.join("; ")}`);
  const view = projectViewModel(source, toolName, built.envelope);
  if (!view.ok || !view.viewModel) throw new Error(`${toolName}: ${view.errors.join("; ")}`);
  const validation = validateWidgetPayload(view.viewModel);
  if (!validation.ok) throw new Error(`${toolName}: ${validation.errors.join("; ")}`);
  return view.viewModel;
}

const scheduleWeek = raw("schedule");
const scheduleDay = JSON.parse(JSON.stringify(scheduleWeek));
scheduleDay.query.weekday = 1;
scheduleDay.items = scheduleDay.items.filter((item) => {
  const lesson = item && item.lesson ? item.lesson : item;
  return lesson && lesson.weekday === 1;
});

const cases = {
  "schedule-week": render(scheduleWeek, "campus_schedule_query"),
  "schedule-day": render(scheduleDay, "campus_schedule_query"),
  space: render(raw("space"), "campus_classroom_search"),
  collaboration: render(raw("collaboration"), "campus_group_plan"),
  risk: render(raw("risk"), "campus_risk_check"),
  reschedule: render(raw("reschedule"), "campus_reschedule_feasibility"),
  ranking: render(raw("ranking"), "campus_teacher_load_query"),
  overview: render(raw("overview"), "campus_overview"),
  empty: render(raw("empty"), "campus_schedule_query"),
  error: render(raw("error"), "campus_schedule_query"),
};

fs.mkdirSync(OUTPUT, { recursive: true });
for (const [name, payload] of Object.entries(cases)) {
  fs.writeFileSync(path.join(OUTPUT, `${name}.json`), `${JSON.stringify(payload, null, 2)}\n`, "utf8");
}
process.stdout.write(`Final Widget payloads generated: ${Object.keys(cases).length}\n`);
