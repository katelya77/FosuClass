"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const KIT = path.join(__dirname, "..", "..");
const CONTRACT_PATH = path.join(KIT, "r51", "mission", "handoff-contract.js");
const DESIRED = path.join(KIT, "ops", "runtime-control-plane", "desired-state");
const { loadDesiredState, makeSyntheticMatchingSnapshot } = require(path.join(KIT, "ops", "runtime-control-plane", "lib", "desired-state.js"));
const { diffState } = require(path.join(KIT, "ops", "runtime-control-plane", "lib", "drift.js"));

function contract() {
  return fs.existsSync(CONTRACT_PATH) ? require(CONTRACT_PATH) : null;
}

test("FI1 keyboard and sys.chat user turns both enter through Main", () => {
  const api = contract();
  assert.ok(api, "handoff contract must exist");
  assert.equal(api.newTurnStart("keyboard"), "main");
  assert.equal(api.newTurnStart("sys.chat"), "main");
  assert.equal(api.newTurnStart("tool-result"), null);
});

test("FI2 topology permits Main-to-domain and Child-to-Main only", () => {
  const api = contract();
  assert.ok(api, "handoff contract must exist");
  for (const child of ["schedule", "risk", "insight"]) {
    assert.equal(api.allowedTransfer("main", child), true, `main -> ${child}`);
    assert.equal(api.allowedTransfer(child, "main"), true, `${child} -> main`);
  }
  for (const from of ["schedule", "risk", "insight"]) {
    for (const to of ["schedule", "risk", "insight"]) {
      assert.equal(api.allowedTransfer(from, to), false, `${from} must not transfer to ${to}`);
    }
  }
});

test("FI3 Schedule returns to Main when Risk remains, but may finish a pure Schedule goal", () => {
  const api = contract();
  assert.ok(api, "handoff contract must exist");
  assert.deepEqual(api.decideChildReturn({
    domain: "schedule",
    requiredDomains: ["schedule", "risk"],
    completedDomains: ["schedule"],
  }), { action: "return_main", remainingDomains: ["risk"] });
  assert.deepEqual(api.decideChildReturn({
    domain: "schedule",
    requiredDomains: ["schedule"],
    completedDomains: ["schedule"],
  }), { action: "complete", remainingDomains: [] });
});

test("FI4 Insight-to-Schedule-to-Risk always returns through Main between domains", () => {
  const api = contract();
  assert.ok(api, "handoff contract must exist");
  const requiredDomains = ["insight", "schedule", "risk"];
  assert.deepEqual(api.decideChildReturn({ domain: "insight", requiredDomains, completedDomains: ["insight"] }), {
    action: "return_main", remainingDomains: ["schedule", "risk"],
  });
  assert.deepEqual(api.decideChildReturn({ domain: "schedule", requiredDomains, completedDomains: ["insight", "schedule"] }), {
    action: "return_main", remainingDomains: ["risk"],
  });
  assert.deepEqual(api.decideChildReturn({ domain: "risk", requiredDomains, completedDomains: requiredDomains }), {
    action: "complete", remainingDomains: [],
  });
});

test("FI5 desired state freezes start policy, exact graph, and direct output OFF for all 13 operations", () => {
  const runtime = JSON.parse(fs.readFileSync(path.join(DESIRED, "runtime.json"), "utf8"));
  const tools = JSON.parse(fs.readFileSync(path.join(DESIRED, "campus-tools.json"), "utf8"));
  assert.equal(runtime.interaction.newTurnStartAgent, "main");
  assert.deepEqual(runtime.interaction.newTurnSources, ["keyboard", "sys.chat"]);
  assert.deepEqual(runtime.interaction.allowedTransfers, [
    "main->schedule", "main->risk", "main->insight",
    "schedule->main", "risk->main", "insight->main",
  ]);
  assert.equal(runtime.invariants.toolDirectResultOutput, false);
  assert.equal(Object.keys(tools.directResultOutput).length, 13);
  assert.deepEqual(Object.keys(tools.directResultOutput).sort(), tools.operationIds.slice().sort());
  for (const value of Object.values(tools.directResultOutput)) assert.equal(value, false);
});

test("FI6 Final prompts preserve complete-goal ownership without test entities or visible orchestration", () => {
  const main = fs.readFileSync(path.join(KIT, "final", "prompts", "main-orchestrator.md"), "utf8");
  assert.match(main, /完整用户目标/);
  assert.match(main, /领域阶段.*不代表.*任务完成|阶段完成.*不代表.*完整目标/);
  assert.match(main, /未完成.*领域.*继续/);
  for (const file of ["schedule-space.md", "risk-planning.md", "campus-insight.md"]) {
    const text = fs.readFileSync(path.join(KIT, "final", "prompts", file), "utf8");
    assert.match(text, /完整目标.*其他领域|其他领域.*完整目标/);
    assert.match(text, /交还.*主协调/);
    assert.match(text, /纯属.*本领域|完全属于.*本领域/);
    assert.doesNotMatch(text, /教师\d{3}|测试用例|golden case/i);
    assert.match(text, /不.*展示.*(?:转交|内部过程)|不向用户展示/);
  }
});

test("FI7 control plane audits the latest real Widget ID, not name alone", () => {
  const desired = loadDesiredState();
  assert.equal(desired.widget.widgetId, "601418106a374b2eb7de54c65a3de7e0");
  const matching = makeSyntheticMatchingSnapshot(desired);
  assert.equal(matching.widget.widgetId, desired.widget.widgetId);
  assert.equal(diffState(desired, matching).MANUAL_CONSOLE_REQUIRED.length, 0);
  const stale = structuredClone(matching);
  stale.widget.widgetId = "978b004b2f054e8bbd5438159c7329ff";
  assert.ok(diffState(desired, stale).MANUAL_CONSOLE_REQUIRED.some((item) => item.code === "WIDGET_ID_DRIFT"));
});
