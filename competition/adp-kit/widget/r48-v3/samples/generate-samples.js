#!/usr/bin/env node
/*
 * 由 samples/envelopes.json 生成全部 R48 V3 ViewModel 样例。
 * 样例即 Adapter 的真实输出，禁止手工改动 samples/*.json —— 改 fixture 或 adapter。
 */
"use strict";

const fs = require("fs");
const path = require("path");
const adapter = require("../adapter.js");

const HERE = __dirname;
const envelopes = JSON.parse(fs.readFileSync(path.join(HERE, "envelopes.json"), "utf8"));

const ADAPTERS = {
  "schedule-day": (env) => adapter.adaptScheduleV3(env),
  "schedule-week": (env) => adapter.adaptScheduleV3(env),
  "schedule-date": (env) => adapter.adaptScheduleV3(env),
  "classroom-normal": (env) => adapter.adaptClassroomV3(env),
  "classroom-empty": (env) => adapter.adaptClassroomV3(env),
  "conflict-compare": (env) => adapter.adaptConflictV3(env),
  "conflict-self": (env) => adapter.adaptConflictV3(env),
  "conflict-safe": (env) => adapter.adaptConflictV3(env),
  "day-plan": (env) => adapter.adaptDayPlanV3(env),
  "campus-overview": (env) => adapter.adaptCampusOverviewV3(env),
  "choice": (env) => adapter.adaptChoiceV3(env, { originalTask: "刚才的课表查询" }),
  "recovery-range": (env) => adapter.adaptRecoveryV3(env),
  "recovery-tool": (env) => adapter.adaptRecoveryV3(env),
};

const out = {};
for (const [name, adapt] of Object.entries(ADAPTERS)) {
  if (!envelopes[name]) throw new Error(`missing envelope fixture: ${name}`);
  const view = adapt(envelopes[name]);
  out[name] = view;
  fs.writeFileSync(path.join(HERE, `${name}.json`), `${JSON.stringify(view, null, 2)}\n`);
}

const banner = "/* 由 generate-samples.js 生成，请勿手工编辑 */\n";
fs.writeFileSync(
  path.join(HERE, "samples.js"),
  `${banner}window.R48V3Samples = ${JSON.stringify(out, null, 2)};\n`,
);

console.log(`generated ${Object.keys(out).length} view models -> samples/`);
