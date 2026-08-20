"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");

const KIT = path.join(__dirname, "..", "..");
const PROMPT_DIR = path.join(KIT, "final", "prompts");
const DESIRED = path.join(KIT, "ops", "runtime-control-plane", "desired-state");
const PROMPTS = ["main-orchestrator.md", "schedule-space.md", "risk-planning.md", "campus-insight.md"];

function readPrompt(name) {
  return fs.readFileSync(path.join(PROMPT_DIR, name), "utf8");
}

test("FP1 four bounded final prompts exist and contain no test-specific or engineering protocol vocabulary", () => {
  const forbidden = [
    /MissionState|GoalSpec|DecisionBundle|CampusTools|queryId|dataHash|dataVersion|receiptVersion/i,
    /\bR(?:47|50|51)\b|CSF|golden case|test case|为了通过测试/i,
    /教师\d{3}|班级\d{3}|截图\s*\d+/i,
    /如果用户输入这句话|如果用户问.*教师/i,
  ];
  for (const file of PROMPTS) {
    const text = readPrompt(file);
    assert.ok(text.length >= 700 && text.length <= 3600, `${file} length=${text.length}`);
    for (const pattern of forbidden) assert.doesNotMatch(text, pattern, `${file}: ${pattern}`);
  }
});

test("FP2 Main is a concise three-domain coordinator with one clarification exit and no CampusTool list", () => {
  const text = readPrompt("main-orchestrator.md");
  for (const domain of ["课程与空间", "风险与规划", "校园洞察"]) assert.match(text, new RegExp(domain));
  assert.match(text, /最多.*一个.*问题|一次只问.*一个/);
  assert.match(text, /结论在前/);
  assert.match(text, /不得重新排序|不重新排序/);
  assert.doesNotMatch(text, /campus_[a-z0-9_]+/i);
  assert.doesNotMatch(text, /图片理解工具|视觉理解工具/);
});

test("FP3 children preserve fresh-fact, verified-fact and quiet execution disciplines", () => {
  for (const file of PROMPTS.slice(1)) {
    const text = readPrompt(file);
    assert.match(text, /重新.*核验|重新获取.*事实|重新查询/);
    assert.match(text, /动态.*事实|课表.*事实/);
    assert.match(text, /不.*执行过程|不.*调用过程|不.*内部过程/);
  }
});

test("FP4 final prompt desired state preserves Console truth and downgrades unavailable multimodal dependency", () => {
  const agents = JSON.parse(fs.readFileSync(path.join(DESIRED, "agents.json"), "utf8"));
  const app = JSON.parse(fs.readFileSync(path.join(DESIRED, "app.json"), "utf8"));
  const runtime = JSON.parse(fs.readFileSync(path.join(DESIRED, "runtime.json"), "utf8"));
  assert.equal(agents.length, 4);
  for (const agent of agents) {
    assert.equal(agent.model, "DeepSeek-V3-0324", agent.key);
    assert.match(agent.promptSource, /^competition\/adp-kit\/final\/prompts\//);
    assert.equal(agent.officialVisionToolRequired, false);
  }
  assert.deepEqual(agents.find((agent) => agent.key === "main").campusTools, []);
  assert.equal(app.expectedAgentCount, 4);
  assert.equal(app.publishAllowed, false);
  assert.equal(app.model, "DeepSeek-V3-0324");
  assert.equal(runtime.multimodal.mainOfficialVisionToolRequired, false);
  assert.equal(runtime.invariants.campusToolCount, 13);
  assert.equal(runtime.invariants.bindingCount, 14);
  assert.equal(runtime.invariants.mainCampusToolCount, 0);
});
