"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const ADP_KIT = path.join(__dirname, "..", "..");
const R501 = path.join(ADP_KIT, "r50.1");

const read = (file) => fs.readFileSync(path.join(R501, file), "utf8");
const CUTOVER = read("R50.1-ADP-CONSOLE-CUTOVER.md");
const ACCEPTANCE = read("R50.1-CONSOLE-ACCEPTANCE.md");

const CANONICAL = {
  schedule: [
    "campus_schedule_query",
    "campus_schedule_range_query",
    "campus_classroom_search",
    "campus_entity_search",
    "campus_academic_context",
    "campus_common_free_time_query",
    "campus_group_plan",
  ],
  risk: [
    "campus_risk_check",
    "campus_day_plan",
    "campus_academic_context",
    "campus_reschedule_feasibility",
  ],
  insight: [
    "campus_overview",
    "campus_teacher_load_query",
    "campus_room_utilization_query",
  ],
};

function extractTableRow(markdown, agentLabel) {
  const re = new RegExp(`^\\|\\s*${agentLabel}[^|]*\\|([^\\n]+)\\|`, "m");
  const match = markdown.match(re);
  assert.ok(match, `missing binding row for ${agentLabel}`);
  return match[1];
}

function assertExactTools(row, expected, label) {
  const toolNames = [...row.matchAll(/campus_[a-z0-9_]+/g)].map((m) => m[0]);
  assert.deepEqual(toolNames, expected, `${label} binding row drifted from canonical tool order/set`);
}

test("R50.1.1 console cutover uses the canonical Schedule/Risk/Insight binding map", () => {
  assertExactTools(extractTableRow(CUTOVER, "课程空间（Schedule）"), CANONICAL.schedule, "Schedule");
  assertExactTools(extractTableRow(CUTOVER, "风险规划（Risk）"), CANONICAL.risk, "Risk");
  assertExactTools(extractTableRow(CUTOVER, "校园洞察（Insight）"), CANONICAL.insight, "Insight");
});

test("R50.1.1 documents 13 unique operations but 14 Agent bindings with one intentional shared tool", () => {
  for (const text of [CUTOVER, ACCEPTANCE]) {
    assert.match(text, /13\s*个\s*(?:unique\s*)?Agent Tool|13\s*个\s*unique\s*operations/i,
      "docs must state there are 13 unique Agent Tool operations");
    assert.match(text, /14\s*个\s*Agent\s*绑定|14\s*个\s*绑定/i,
      "docs must state there are 14 Agent bindings");
    assert.match(text, /campus_academic_context/,
      "docs must name campus_academic_context as the intentional shared tool");
    assert.match(text, /(Schedule|课程空间)[^\n]{0,250}campus_academic_context/i,
      "docs must bind campus_academic_context to Schedule");
    assert.match(text, /(Risk|风险规划)[^\n]{0,250}campus_academic_context/i,
      "docs must bind campus_academic_context to Risk");
    assert.match(text, /(其余|其他)[^。\n]{0,30}(工具|CampusTool)[^。\n]{0,30}(不得|禁止)[^。\n]{0,20}(重复|跨域)/,
      "docs must forbid other cross-domain duplicate bindings");
  }
  assert.doesNotMatch(CUTOVER, /全部\s*13\s*个\s*Agent Tool\s*恰好各出现一次|13\s*个[^。\n]{0,20}各出现一次/,
    "cutover must not claim every one of the 13 unique operations is bound exactly once");
});

test("R50.1.1 acceptance checklist names the canonical per-Agent map", () => {
  for (const tool of CANONICAL.schedule) {
    assert.match(ACCEPTANCE, new RegExp(`Schedule[^\\n]{0,600}${tool}|课程空间[^\\n]{0,600}${tool}`), `acceptance missing Schedule tool ${tool}`);
  }
  for (const tool of CANONICAL.risk) {
    assert.match(ACCEPTANCE, new RegExp(`Risk[^\\n]{0,600}${tool}|风险规划[^\\n]{0,600}${tool}`), `acceptance missing Risk tool ${tool}`);
  }
  for (const tool of CANONICAL.insight) {
    assert.match(ACCEPTANCE, new RegExp(`Insight[^\\n]{0,600}${tool}|校园洞察[^\\n]{0,600}${tool}`), `acceptance missing Insight tool ${tool}`);
  }
});
