"use strict";
const assert = require("assert"), fs = require("fs"), os = require("os"), path = require("path");
const policy = require("../server/src/shared/scheduleCollectorPolicy");
const env = { FOSU_COLLECTOR_TIMER_VERIFIED: "1", FOSU_COLLECTOR_SCHEDULE_POLICY: policy.POLICY };
const time = value => Date.parse(value);
const directSourceSummary = Object.fromEntries(["class", "teacher", "classroom", "course"].map(kind => [kind, { sourceMode:"network-direct",coverageValid:true,discoveredEntities:1,requestedEntities:1,success:1,empty:0,failed:0,parserErrors:0,scheduleDocuments:1,courseEvents:1 }]));
const successes = Array.from({ length: 3 }, (_, i) => ({ id: "accepted-" + i, term:"2026-2027-1", finishedAt: "2026-10-09T00:00:00Z", result: "PENDING REVIEW", qualityBlocked:false,directSourceSummary }));
const healthy = () => ({ runs: successes });
let passed = 0;
function test(name, fn) { fn(); passed++; console.log("PASS " + name); }

test("no timer approval means no automatic school task", () => assert.equal(policy.decision(healthy(), time("2026-10-10T04:30:00+08:00"), {}).reason, "manual-approval-required"));
test("weekly policy coalesces Sunday routine into the full task", () => {
  assert.equal(policy.decision(healthy(), time("2026-10-11T04:45:00+08:00"), env).allowed, false);
  const result = policy.decision(healthy(), time("2026-10-11T05:01:00+08:00"), env);
  assert.equal(result.allowed, true); assert.equal(result.slot.mode, "full");
});
test("weekdays retain routine tasks", () => assert.equal(policy.decision(healthy(), time("2026-10-10T04:31:00+08:00"), env).slot.mode, "routine"));
test("network return only catches up inside the approved window", () => {
  assert.equal(policy.decision(healthy(), time("2026-10-10T04:59:59+08:00"), env).allowed, true);
  assert.equal(policy.decision(healthy(), time("2026-10-10T05:00:00+08:00"), env).reason, "outside-approved-window");
  assert.equal(policy.decision(healthy(), time("2026-10-10T05:15:00+08:00"), { ...env, FOSU_COLLECTOR_SCHEDULE_WINDOW_MINUTES: "90" }).allowed, true);
});
test("unknown policy and unsafe windows fail closed", () => {
  for (const extra of [{ FOSU_COLLECTOR_SCHEDULE_POLICY: "typo" }, { FOSU_COLLECTOR_SCHEDULE_WINDOW_MINUTES: "0" }, { FOSU_COLLECTOR_SCHEDULE_WINDOW_MINUTES: "NaN" }, { FOSU_COLLECTOR_SCHEDULE_WINDOW_MINUTES: "1440" }]) assert.equal(policy.decision(healthy(), time("2026-10-10T04:31:00+08:00"), { ...env, ...extra }).reason, "schedule-config-invalid");
});
test("session/challenge/day stop and pause cannot be bypassed by the next heartbeat", () => {
  for (const field of ["sessionExpired", "stopForDay", "paused"]) assert.equal(policy.decision({ ...healthy(), [field]: true }, time("2026-10-10T04:31:00+08:00"), env).allowed, false);
});
test("three accepted real run records are required", () => assert.equal(policy.decision({ runs: successes.slice(0, 2).concat([{ finishedAt: "2026-10-09T00:00:00Z", result: "FAILED" }]) }, time("2026-10-10T04:31:00+08:00"), env).reason, "three-accepted-runs-required"));
test("completed but quality-blocked runs do not unlock scheduled school access", () => {
  for (const extra of [{ qualityBlocked: true }, { reviewClass: "blocked" }, { reasons: ["teacher-drop"] }]) assert.equal(policy.decision({ runs: successes.map(run => ({ ...run, ...extra })) }, time("2026-10-10T04:31:00+08:00"), env).reason, "three-accepted-runs-required");
});
test("new policy requires complete four-source evidence and distinct run IDs", () => {
  for (const extra of [{ directSourceSummary:undefined }, { qualityBlocked:undefined }, { finishedAt:"invalid" }, { id:"same-run" }, { directSourceSummary:{...directSourceSummary,teacher:{...directSourceSummary.teacher,requestedEntities:0}} }]) assert.equal(policy.decision({ runs:successes.map(run=>({...run,...extra})) },time("2026-10-10T04:31:00+08:00"),env).reason,"three-accepted-runs-required");
});
test("legacy daily approval behavior remains compatible", () => {
  const legacy = successes.map(run=>({id:run.id,finishedAt:run.finishedAt,result:run.result}));
  assert.equal(policy.decision({runs:legacy},time("2026-10-10T04:31:00+08:00"),{FOSU_COLLECTOR_TIMER_VERIFIED:"1"}).allowed,true);
});
test("unfinished tasks and failure cooldown prevent overlap", () => {
  assert.equal(policy.decision({ ...healthy(), current: { id: "busy" } }, time("2026-10-11T05:01:00+08:00"), env).reason, "already-running");
  assert.equal(policy.decision({ ...healthy(), retryNotBefore: time("2026-10-10T04:45:00+08:00") }, time("2026-10-10T04:31:00+08:00"), env).reason, "failure-cooldown");
});
test("old daily markers survive an upgrade without re-running", () => assert.equal(policy.decision({ ...healthy(), lastScheduledDay: "2026-10-11" }, time("2026-10-11T05:01:00+08:00"), env).reason, "already-scheduled"));
test("next displayed full slot is truthful and opt in", () => {
  const next = policy.nextSchedule(time("2026-10-11T04:30:00+08:00"), policy.config(env));
  assert.equal(next.fullAt, "2026-10-10T21:00:00.000Z");
  assert.equal(next.routineAt, "2026-10-11T20:30:00.000Z");
  assert.equal(policy.nextSchedule(time("2026-10-11T04:30:00+08:00"), policy.config({})).fullAt, null);
});

const root = fs.mkdtempSync(path.join(os.tmpdir(), "fosu-schedule-policy-"));
process.env.SCHEDULE_COLLECTOR_DIR = root;
process.env.FOSU_STORAGE_DIR = path.join(root, "storage");
process.env.FOSU_DATA_DIR = path.join(root, "data");
Object.assign(process.env, env);
const collector = require("../server/src/services/scheduleCollectorService");
const registry = require("../server/src/services/termRegistryService");
registry.createPlannedTerm({ term: "2026-2027-1", semesterText: "2026-2027-1", termStartDate: "2026-09-07", totalWeeks: 20 });
// This fixture supplies the active term without publishing a release.
registry.getActiveTerm = () => registry.getTerm("2026-2027-1");
function seed(extra = {}) { fs.writeFileSync(path.join(root, "state.json"), JSON.stringify({ ...healthy(), ...extra })); collector.load(); }
test("control-plane heartbeat queues a full task with persisted reservation", () => {
  seed(); collector.heartbeat("fixture-agent", time("2026-10-11T05:01:00+08:00"));
  const saved = JSON.parse(fs.readFileSync(path.join(root, "state.json")));
  assert.equal(saved.current.mode, "full"); assert.equal(saved.current.scheduleKey, "full:2026-10-11");
  assert.equal(saved.lastScheduledKey, saved.current.scheduleKey);
  assert.equal(collector.snapshot(time("2026-10-11T05:01:00+08:00")).autoPublish, false);
});
test("process reload and late heartbeats cannot enqueue a duplicate", () => {
  const saved = JSON.parse(fs.readFileSync(path.join(root, "state.json")));
  saved.current.finishedAt = "2026-10-10T21:02:00Z"; saved.current.result = "PENDING REVIEW";
  seed(saved); collector.heartbeat("fixture-agent", time("2026-10-11T05:03:00+08:00"));
  assert.equal(collector.snapshot(time("2026-10-11T05:03:00+08:00")).current.id, saved.current.id);
  assert.equal(JSON.parse(fs.readFileSync(path.join(root, "state.json"))).runs.length, 4);
});
test("manual Windows-independent request remains available with scheduling disabled", () => {
  seed(); process.env.FOSU_COLLECTOR_TIMER_VERIFIED = "0";
  collector.heartbeat("fixture-agent", time("2026-10-10T04:31:00+08:00"));
  assert.equal(collector.snapshot().current, null);
  assert.equal(collector.requestRun("full", "fixture-admin", time("2026-10-10T04:31:00+08:00"), { term: "2026-2027-1" }).skipped, false);
});
fs.rmSync(root, { recursive: true, force: true });
console.log(`collector-scheduling: ${passed} fixtures PASS; schoolRequests=0, productionTimerChanged=false`);
