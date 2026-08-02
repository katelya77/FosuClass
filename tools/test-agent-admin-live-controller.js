#!/usr/bin/env node
const assert = require("assert");

const { createLiveRefreshController } = require("../apps/agent-admin/public/agent-platform-live");

function fakeDocument() {
  const listeners = new Map();
  return {
    hidden: false,
    addEventListener(type, listener) { listeners.set(type, listener); },
    removeEventListener(type) { listeners.delete(type); },
    dispatch(type) { const listener = listeners.get(type); if (listener) listener(); },
  };
}

async function run() {
  const doc = fakeDocument();
  const timers = [];
  const cancelled = [];
  const calls = { operations: 0, runs: 0, advanced: 0, status: [] };
  const controller = createLiveRefreshController({
    document: doc,
    loadOperations: async () => { calls.operations += 1; },
    loadRuns: async () => { calls.runs += 1; },
    loadAdvanced: async () => { calls.advanced += 1; },
    onStatus: (status) => calls.status.push(status),
    schedule: (callback, delayMs) => {
      const timer = { callback, delayMs, id: timers.length + 1 };
      timers.push(timer);
      return timer.id;
    },
    cancel: (id) => cancelled.push(id),
    operationsIntervalMs: 5000,
    runsIntervalMs: 3000,
  });

  await controller.bootstrap();
  assert.deepStrictEqual(calls, {
    operations: 1,
    runs: 1,
    advanced: 0,
    status: ["refreshing", "live"],
  }, "first paint loads only runtime truth in parallel; advanced config stays lazy");
  assert.deepStrictEqual(timers.map((timer) => timer.delayMs), [5000, 3000]);

  await controller.ensureAdvanced();
  await controller.ensureAdvanced();
  assert.strictEqual(calls.advanced, 1, "advanced configuration loads only on its first expansion");

  doc.hidden = true;
  await timers[0].callback();
  await timers[1].callback();
  assert.strictEqual(calls.operations, 1);
  assert.strictEqual(calls.runs, 1);

  doc.hidden = false;
  doc.dispatch("visibilitychange");
  await new Promise((resolve) => setImmediate(resolve));
  assert.strictEqual(calls.operations, 2, "becoming visible refreshes facts immediately");
  assert.strictEqual(calls.runs, 2);

  controller.stop();
  assert.deepStrictEqual(cancelled, [1, 2]);

  const recoveryDoc = fakeDocument();
  const recoveryTimers = [];
  const recoveryStatuses = [];
  let operationsShouldFail = false;
  const recoveryController = createLiveRefreshController({
    document: recoveryDoc,
    loadOperations: async () => {
      if (operationsShouldFail) throw new Error("temporary operations failure");
    },
    loadRuns: async () => {},
    onStatus: (status) => recoveryStatuses.push(status),
    schedule: (callback, delayMs) => {
      recoveryTimers.push({ callback, delayMs });
      return recoveryTimers.length;
    },
    cancel: () => {},
    operationsIntervalMs: 5000,
    runsIntervalMs: 3000,
  });
  await recoveryController.bootstrap();
  operationsShouldFail = true;
  await recoveryTimers[0].callback();
  assert.strictEqual(recoveryStatuses[recoveryStatuses.length - 1], "retrying");
  operationsShouldFail = false;
  await recoveryTimers[0].callback();
  assert.strictEqual(recoveryStatuses[recoveryStatuses.length - 1], "live",
    "a successful periodic refresh must clear a stale retrying indicator without a manual reload");
  recoveryController.stop();

  console.log("test-agent-admin-live-controller: PASS");
}

run().catch((error) => {
  console.error(error && error.stack || error);
  process.exit(1);
});
