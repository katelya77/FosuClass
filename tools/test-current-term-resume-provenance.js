#!/usr/bin/env node
"use strict";

const assert = require("assert");
const { isFreshNetworkSidecar } = require("../shared/syncProvenance");

const runId = "new-term-test-run";
const resumed = {
  crawlMode: "incremental",
  usedProgressCache: true,
  usedNoScheduleCache: false,
  usedClassScheduleCache: true,
  actualNetworkRequestCount: 322,
  skippedByProgressCount: 219,
  partial: false,
  failedTargetCount: 0,
  freshRunId: runId,
  scopeSources: { classSchedules: {
    sourceMode: "network-direct", requested: 322, succeeded: 322, failed: 0, cacheHits: 0,
  } },
};
assert.strictEqual(isFreshNetworkSidecar(resumed, {
  currentRunId: runId,
  snapshotMeta: { cacheSource: `C:/cache/progress/class-${runId}.classSchedules.json` },
}), true);
assert.strictEqual(isFreshNetworkSidecar(resumed, {
  currentRunId: "different-run",
  snapshotMeta: { cacheSource: `C:/cache/progress/class-${runId}.classSchedules.json` },
}), false);
assert.strictEqual(isFreshNetworkSidecar(Object.assign({}, resumed, {
  usedNoScheduleCache: true,
}), { currentRunId: runId, snapshotMeta: { resumedFromRunProgress: true } }), false);
assert.strictEqual(isFreshNetworkSidecar(Object.assign({}, resumed, {
  failedTargetCount: 1,
}), { currentRunId: runId, snapshotMeta: { resumedFromRunProgress: true } }), false);
assert.strictEqual(isFreshNetworkSidecar(Object.assign({}, resumed, {
  scopeSources: { classSchedules: {
    sourceMode: "network-direct", requested: 322, succeeded: 321, failed: 1, cacheHits: 0,
  } },
}), { currentRunId: runId, snapshotMeta: { resumedFromRunProgress: true } }), false);

console.log("test-current-term-resume-provenance passed");
