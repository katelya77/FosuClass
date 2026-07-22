#!/usr/bin/env node
const assert = require("assert");

const storage = new Map();
global.wx = {
  getStorageSync(key) { return storage.has(key) ? storage.get(key) : ""; },
  setStorageSync(key, value) { storage.set(key, value); },
  removeStorageSync(key) { storage.delete(key); },
};

const tracker = require("../miniprogram/services/scheduleChangeTracker");

const first = {
  enabled: true,
  fingerprint: "v1",
  courses: [{ courseName: "动物解剖学", teacherName: "张老师", classroom: "B8-201", weekday: 3, startSection: 6, endSection: 7, weeks: [20] }],
};
const second = {
  enabled: true,
  fingerprint: "v2",
  courses: [{ courseName: "动物解剖学", teacherName: "张老师", classroom: "B8-203", weekday: 3, startSection: 6, endSection: 7, weeks: [20] }],
};

const initial = tracker.capture(first);
assert.strictEqual(initial.pending, false);
assert.strictEqual(initial.baseline, null);

const unchanged = tracker.capture(first);
assert.strictEqual(unchanged.pending, false);

const changed = tracker.capture(second);
assert.strictEqual(changed.pending, true);
assert.strictEqual(changed.baseline.fingerprint, "v1");
assert.strictEqual(changed.currentFingerprint, "v2");
assert.ok(!JSON.stringify(storage).includes("studentId"));

const stillPending = tracker.capture(second);
assert.strictEqual(stillPending.pending, true);
assert.strictEqual(stillPending.baseline.fingerprint, "v1");

tracker.acknowledge(second);
assert.strictEqual(tracker.getPending(), null);
const afterAck = tracker.capture(second);
assert.strictEqual(afterAck.pending, false);

console.log("test-schedule-change-tracker: PASS");
