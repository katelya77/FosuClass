const assert = require("assert");
const syncPlan = require("../shared/syncPlan");

function plan(action, params) {
  return syncPlan.buildSyncPlan(action, Object.assign({ term: "2025-2026-2" }, params || {}), {});
}

const daily = plan("daily");
assert.strictEqual(daily.schedulePolicy, "network-only");
assert.strictEqual(daily.progressPolicy, "ignore");
assert.strictEqual(daily.negativeCachePolicy, "ignore");
assert.strictEqual(daily.mergeOldData, false);
assert.strictEqual(daily.forceRefresh, true);
assert.strictEqual(daily.ignoreProgress, true);
assert.strictEqual(daily.ignoreNoScheduleCache, true);
assert.strictEqual(daily.upload, true);
assert.strictEqual(daily.buildRelease, true);
assert.strictEqual(daily.activate, true);
assert(daily.dynamicScopes.includes("classSchedules"));
assert(daily.dynamicScopes.includes("teacherSchedules"));
assert.strictEqual(daily.sourceRequirements.classSchedules.mode, "network-direct");
assert.strictEqual(daily.sourceRequirements.teacherSchedules.mode, "network-direct");

const publisher = syncPlan.buildSyncPlan("sync:publish", { term: "2025-2026-2" }, {});
assert.strictEqual(publisher.profile, "daily");
assert.strictEqual(publisher.schedulePolicy, "network-only");
assert.strictEqual(publisher.progressPolicy, "ignore");
assert.strictEqual(publisher.upload, true);
assert.strictEqual(publisher.buildRelease, true);

const incremental = syncPlan.buildSyncPlan("sync:publish", {
  term: "2026-2027-1",
  "schedule-policy": "network-only",
  "progress-policy": "resume",
  "negative-cache-policy": "ignore",
  grade: "2026",
}, {});
assert.strictEqual(incremental.forceRefresh, false);
assert.strictEqual(incremental.ignoreProgress, false);
assert.strictEqual(syncPlan.applyPlanToParams(incremental, {}).crawlMode, "incremental");

const full = syncPlan.buildSyncPlan("sync:publish", {
  term: "2026-2027-1",
  "schedule-policy": "network-only",
  "progress-policy": "ignore",
  "negative-cache-policy": "revalidate",
  "force-refresh": true,
}, {});
assert.strictEqual(full.forceRefresh, true);
assert.strictEqual(syncPlan.applyPlanToParams(full, {}).crawlMode, "full-fresh");

const classes = plan("daily:classes");
assert(classes.scopes.includes("classSchedules"), "class-only daily should crawl class schedules");
assert.strictEqual(classes.sourceRequirements.classSchedules.mode, "network-direct");
assert.strictEqual(classes.sourceRequirements.teacherSchedules.mode, "derived-current-run");
assert.strictEqual(syncPlan.applyPlanToParams(classes, {}).resourceSource, "derived");

const teacher = plan("daily:teachers");
assert(teacher.scopes.includes("classSchedules"), "teacher direct refresh should include a current-run class seed");
assert(teacher.scopes.includes("teacherSchedules"));
assert.strictEqual(teacher.sourceRequirements.classSchedules.mode, "network-direct");
assert.strictEqual(teacher.sourceRequirements.teacherSchedules.mode, "network-direct");

const scopes = plan("scopes", { include: "teacherSchedules,classroomSchedules" });
assert(scopes.scopes.includes("classSchedules"), "selected resource scopes must add current-run class seed");
assert(scopes.scopes.includes("teacherSchedules"));
assert(scopes.scopes.includes("classroomSchedules"));
assert.strictEqual(scopes.schedulePolicy, "network-only");

const upload = syncPlan.buildSyncPlan("upload-staging", { term: "2025-2026-2", file: "staging/a.json" }, {});
assert.strictEqual(upload.crawl, false);
assert.strictEqual(upload.schedulePolicy, "cache-only");
assert.strictEqual(upload.cacheOnlyExplicit, true);

const dailyCacheOnly = plan("daily", { "schedule-policy": "cache-only" });
assert.strictEqual(dailyCacheOnly.schedulePolicy, "cache-only");
assert(dailyCacheOnly.warnings.some((item) => /Cache-only/.test(item)));

const newTerm = syncPlan.buildSyncPlan("new-term", {
  term: "2026-2027-1",
  "term-start-date": "2026-09-07",
  "total-weeks": "20",
}, {});
assert.strictEqual(newTerm.catalogPolicy, "network-only");
assert.strictEqual(newTerm.schedulePolicy, "network-only");
assert.strictEqual(newTerm.activate, false);
assert.strictEqual(newTerm.termConfig.termStartDate, "2026-09-07");
assert.strictEqual(newTerm.termConfig.totalWeeks, 20);

const legacy = plan("quick");
assert.strictEqual(legacy.deprecated, true);
assert.strictEqual(legacy.profile, "daily");
assert(legacy.warnings.some((item) => /Deprecated command/.test(item)));

assert(syncPlan.SOURCE_MODES.includes("network-direct"));
assert(syncPlan.SOURCE_MODES.includes("derived-current-run"));
assert(syncPlan.SOURCE_MODES.includes("cache-explicit"));

const command = syncPlan.renderPowerShellCommand("sync:scopes", {
  term: "2025-2026-2",
  scopes: ["classSchedules", "teacherSchedules"],
});
assert(command.includes("npm run sync:scopes -- --term=2025-2026-2 --include=classSchedules,teacherSchedules"));
assert(!command.includes("export "));
assert(!command.includes("SYNC_INCLUDE_SCOPES="));

console.log("test-sync-operations-plan passed");
