"use strict";

const assert = require("assert");
const mockEnv = require("./mock-env");

mockEnv.clearStorage();
const storage = require("../miniprogram/utils/storage");

storage.saveSettings({
  semester: "2025-2026-2",
  semesterId: "2025-2026-2",
  className: "legacy-class",
});
mockEnv.storage.set(storage.BOOTSTRAP_CACHE_KEY, {
  success: true,
  data: {
    term: "2025-2026-2",
    semester: "2025-2026-2",
    releaseVersion: "old-release",
  },
});
mockEnv.storage.set(storage.SCHOOL_FILTER_CACHE_KEY, {
  semesterValue: "2025-2026-2",
  collegeCode: "04",
});
mockEnv.storage.set(storage.SCHOOL_ACTIVE_SNAPSHOT_CACHE_KEY, {
  term: "2025-2026-2",
  releaseVersion: "old-release",
});

const result = storage.reconcileSettingsWithActiveTerm("2026-2027-1", {
  releaseVersion: "new-release",
});
const settings = storage.getSettings();

assert.strictEqual(result.changed, true);
assert.strictEqual(settings.semester, "2026-2027-1");
assert.strictEqual(settings.semesterId, "2026-2027-1");
assert.strictEqual(settings.className, "legacy-class", "term migration must preserve the selected class identity");
assert.strictEqual(mockEnv.storage.has(storage.BOOTSTRAP_CACHE_KEY), false, "old-term bootstrap cache must be evicted");
assert.strictEqual(mockEnv.storage.has(storage.SCHOOL_FILTER_CACHE_KEY), false, "unscoped old-term filter cache must be evicted");
assert.strictEqual(mockEnv.storage.has(storage.SCHOOL_ACTIVE_SNAPSHOT_CACHE_KEY), false, "old-term active snapshot must be evicted");

const second = storage.reconcileSettingsWithActiveTerm("2026-2027-1", {
  releaseVersion: "new-release",
});
assert.strictEqual(second.changed, false, "same active term reconciliation must be idempotent");

mockEnv.storage.set(storage.BOOTSTRAP_CACHE_KEY, {
  data: { term: "2025-2026-2", releaseVersion: "old-release" },
});
mockEnv.storage.set(storage.SCHOOL_ACTIVE_SNAPSHOT_CACHE_KEY, {
  term: "2025-2026-2",
  releaseVersion: "old-release",
});
mockEnv.storage.set(storage.SCHOOL_FILTER_CACHE_KEY, {
  semesterValue: "2025-2026-2",
});
storage.reconcileSettingsWithActiveTerm("2026-2027-1");
assert.strictEqual(
  mockEnv.storage.has(storage.BOOTSTRAP_CACHE_KEY),
  false,
  "stale nested bootstrap data must be evicted even when settings already use the active term"
);
assert.strictEqual(mockEnv.storage.has(storage.SCHOOL_ACTIVE_SNAPSHOT_CACHE_KEY), false);
assert.strictEqual(mockEnv.storage.has(storage.SCHOOL_FILTER_CACHE_KEY), false);

console.log("test-active-term-settings-reconciliation passed");
