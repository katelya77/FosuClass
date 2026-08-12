"use strict";

const assert = require("assert");
const path = require("path");
const { loadTermConfig } = require("../shared/termConfig");
const { buildCurrentTermInvocation, latestProgressRunId } = require("./fosu-sync-client/current-term");

const root = path.resolve(__dirname, "..");
const config = loadTermConfig("2026-2027-1", { root });
assert.strictEqual(config.termStartDate, "2026-09-07");
assert.strictEqual(config.totalWeeks, 20);
assert.strictEqual(config.weekStart, "monday");
const invocation = buildCurrentTermInvocation([], { root, env: {} });
assert.strictEqual(invocation.plan.term, "2026-2027-1");
assert.strictEqual(invocation.plan.profile, "new-term");
assert.strictEqual(invocation.plan.catalogPolicy, "network-only");
assert.strictEqual(invocation.plan.schedulePolicy, "network-only");
assert.strictEqual(invocation.plan.mergeOldData, false);
assert.strictEqual(invocation.plan.activate, false);
assert.strictEqual(invocation.plan.termConfig.termStartDate, "2026-09-07");
assert.strictEqual(invocation.plan.termConfig.totalWeeks, 20);
assert(invocation.args.includes("--term=2026-2027-1"));
assert(invocation.args.includes("--term-start-date=2026-09-07"));
assert(!invocation.args.includes("--activate"));
const resumable = latestProgressRunId(root, config.term);
if (resumable) {
  const resumed = buildCurrentTermInvocation(["--resume"], { root, env: {} });
  assert.strictEqual(resumed.plan.profile, "new-term");
  assert.strictEqual(resumed.plan.progressPolicy, "resume");
  assert.strictEqual(resumed.plan.runId, resumable);
  assert(resumed.plan.scopes.includes("classSchedules"));
  assert(resumed.args.includes("--resume"));
  assert(!resumed.args.includes("--activate"));
}
console.log("test-current-term-one-click passed");
