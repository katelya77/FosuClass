const assert = require("assert");
const fs = require("fs");
const path = require("path");
const { buildSidecarMeta } = require("../server/src/utils/stagingFingerprint");

const syncSource = fs.readFileSync(path.join(__dirname, "fosu-sync-client", "sync.js"), "utf-8");
const fingerprintSource = fs.readFileSync(path.join(__dirname, "..", "server", "src", "utils", "stagingFingerprint.js"), "utf-8");

assert(syncSource.includes("params.fresh"), "sync CLI should parse --fresh");
assert(syncSource.includes("full-fresh"), "sync CLI should expose full-fresh crawl mode");
assert(syncSource.includes("resource-fresh"), "sync CLI should expose resource-fresh crawl mode");
assert(syncSource.includes("ignoreProgress"), "--fresh should ignore progress cache");
assert(syncSource.includes("ignoreNoScheduleCache"), "--fresh should ignore no-schedule cache");
assert(syncSource.includes("!forceRefresh && (completedProgressCount > 0 || pendingMajors.length === 0)"), "fresh crawl must not merge old classSchedules cache");
assert(syncSource.includes("actualNetworkRequestCount += 1"), "sync crawl should count real network requests");
assert(syncSource.includes("freshRunId"), "fresh crawl should emit a fresh run id");
assert(syncSource.includes("SYNC_FORCE_RESOURCE_CRAWL"), "sync CLI should support force resource crawl");
assert(syncSource.includes("buildResourcesForClassSchedules"), "fresh/resource flows should use source-aware resource generation");
assert(syncSource.includes("本次结果可能受本地缓存影响"), "unchanged staging hash should warn when cache was used");
assert(syncSource.includes("resourceSource"), "sync snapshot should record resource source mode");
assert(fingerprintSource.includes("usedNoScheduleCache"), "sidecar metadata should include no-schedule cache usage");

const meta = buildSidecarMeta({
  term: "2025-2026-2",
  meta: {
    crawlMode: "full-fresh",
    usedProgressCache: false,
    usedNoScheduleCache: false,
    usedClassScheduleCache: false,
    actualNetworkRequestCount: 12,
    skippedByProgressCount: 0,
    skippedByNoScheduleCount: 0,
    freshRunId: "fresh-test",
    resourceSource: "direct",
  },
  catalog: {},
  majors: [],
  classSchedules: [],
  resources: {},
});

assert.strictEqual(meta.crawlMode, "full-fresh");
assert.strictEqual(meta.usedProgressCache, false);
assert.strictEqual(meta.usedNoScheduleCache, false);
assert.strictEqual(meta.usedClassScheduleCache, false);
assert.strictEqual(meta.actualNetworkRequestCount, 12);
assert.strictEqual(meta.freshRunId, "fresh-test");
assert.strictEqual(meta.resourceSource, "direct");

console.log("test-sync-fresh-mode passed");
