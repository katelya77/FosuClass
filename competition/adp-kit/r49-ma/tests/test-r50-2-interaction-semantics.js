"use strict";
// R50.2A Interaction Semantics 门禁（2026-08-19）
// 目标：验证 r50/agents 语义源满足 R50.2-A 交互语义契约：
//  P1 五个目标意图族（goal-oriented，非字面句式）已进入 shared intent-policy；
//  P2 BROWSE_LIST 已知类别清单请求不因「更多精度」而强制澄清；
//  P3 AVAILABILITY_DISCOVERY 与 GROUP_PLANNING 分离（规划目标不需要用户说「教室」）；
//  P4 RESCHEDULE_SIMULATION what-if 且 target.room 可选、不得虚构；
//  P5 R50.2 控制台 Prompt 快照与编译器产物字节一致（Task 5 追加）。
const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const path = require("path");

const KIT = path.join(__dirname, "..", "..");
const R50 = path.join(KIT, "r50");
const R502 = path.join(KIT, "r50.2");
const read = (p) => fs.readFileSync(path.join(R50, p), "utf8");
const intent = read("agents/shared/intent-policy.md");
const main = read("agents/main-orchestrator.md");
const schedule = read("agents/schedule-space.md");
const risk = read("agents/risk-planning.md");
const insight = read("agents/campus-insight.md");

test("R50.2A intent families are goal-oriented and generic", () => {
  for (const name of [
    "BROWSE_LIST",
    "SEARCH_ENTITY",
    "AVAILABILITY_DISCOVERY",
    "GROUP_PLANNING",
    "RESCHEDULE_SIMULATION",
  ]) assert.match(intent, new RegExp(name));
});

test("bounded browse/list does not force clarification", () => {
  assert.match(main, /BROWSE_LIST[\s\S]{0,500}(直接|执行|清单|bounded)/i);
  assert.match(main, /(不|无需)[^。\n]{0,40}澄清/);
});

test("availability discovery and group planning remain distinct", () => {
  assert.match(schedule, /AVAILABILITY_DISCOVERY[\s\S]{0,400}campus_common_free_time_query/);
  assert.match(schedule, /GROUP_PLANNING[\s\S]{0,400}campus_group_plan/);
  assert.match(schedule, /(安排|计划|候选方案|推荐)[\s\S]{0,500}campus_group_plan/);
});

test("reschedule stays what-if and optional room is not invented", () => {
  assert.match(risk, /RESCHEDULE_SIMULATION|调课可行性/);
  assert.match(risk, /room|教室/);
  assert.match(risk, /(可选|未指定|不要求)/);
  assert.doesNotMatch(risk, /已成功调课|已经调课|已修改课表/);
});

test("no silent week=1 anywhere in the four domain prompts", () => {
  for (const [name, text] of [["MAIN", main], ["SCHEDULE", schedule], ["RISK", risk], ["INSIGHT", insight]]) {
    assert.match(text, /(绝不|不得)[^。\n]{0,24}week\s*=\s*1|绝不[^。\n]{0,24}默认/, `${name} 必须声明绝不静默默认 week=1`);
  }
});

test("R50.2A console snapshots equal compiler output byte-for-byte", () => {
  const map = {
    "main-orchestrator": "main-orchestrator.compiled.md",
    "schedule-space": "schedule-space.compiled.md",
    "risk-planning": "risk-planning.compiled.md",
    "campus-insight": "campus-insight.compiled.md",
  };
  for (const [role, compiled] of Object.entries(map)) {
    const snapshot = path.join(R502, "prompts", `${role}.final.md`);
    assert.ok(fs.existsSync(snapshot), `R50.2A console snapshot 缺失: ${role}.final.md`);
    assert.equal(
      fs.readFileSync(snapshot, "utf8"),
      fs.readFileSync(path.join(R50, "agents", "compiled", compiled), "utf8"),
      `R50.2 ${role} console snapshot must equal compiler output`
    );
  }
});