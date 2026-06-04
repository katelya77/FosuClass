const assert = require("assert");
const mockEnv = require("./mock-env");
const {
  SCHOOL_CACHE_SCHEMA_VERSION,
  getSchoolIndexCacheKey,
  getSchoolFilterCacheKey,
  getScheduleDetailCacheKey,
  clearAllSchoolCaches,
} = require("../miniprogram/utils/storage");

mockEnv.clearStorage();

const term = "2025-2026-2";
const releaseVersion = "2026-06-01T23-44-37";
const key = getSchoolIndexCacheKey(term, releaseVersion, "class", { q: "animal", limit: 50 });

assert.strictEqual(SCHOOL_CACHE_SCHEMA_VERSION, 5);
assert(key.includes("school:v5:index"));
assert(key.includes(term));
assert(key.includes(releaseVersion));
assert(key.includes(":class:"));
assert(getSchoolFilterCacheKey(term, releaseVersion).includes("school:v5:filters"));
assert(getScheduleDetailCacheKey(term, releaseVersion, "class", "25animal6").includes("school:v5:detail"));

mockEnv.storage.set("school:v3:index:old", { savedAt: Date.now(), data: [] });
mockEnv.storage.set("school:v2:index:old", { savedAt: Date.now(), data: [] });
mockEnv.storage.set("school:index:old", { savedAt: Date.now(), data: [] });
mockEnv.storage.set("fosu:v5:index:2025-2026-2:old:class", { savedAt: Date.now(), data: [] });
mockEnv.storage.set("fosu:v4:index:2025-2026-1:old:class", { savedAt: Date.now(), data: [] });
mockEnv.storage.set("FOSU_SCHOOL_FILTER_CACHE", { old: true });
mockEnv.storage.set("FOSU_LOCAL_RELEASE_KEY", "old");
mockEnv.storage.set("FOSU_RECENT_SCHEDULES", [{ title: "keep" }]);

clearAllSchoolCaches();

assert.strictEqual(mockEnv.storage.get("school:v3:index:old"), undefined);
assert.strictEqual(mockEnv.storage.get("school:v2:index:old"), undefined);
assert.strictEqual(mockEnv.storage.get("school:index:old"), undefined);
assert.strictEqual(mockEnv.storage.get("fosu:v5:index:2025-2026-2:old:class"), undefined);
assert.strictEqual(mockEnv.storage.get("fosu:v4:index:2025-2026-1:old:class"), undefined);
assert.strictEqual(mockEnv.storage.get("FOSU_SCHOOL_FILTER_CACHE"), undefined);
assert.strictEqual(mockEnv.storage.get("FOSU_LOCAL_RELEASE_KEY"), undefined);
assert.deepStrictEqual(mockEnv.storage.get("FOSU_RECENT_SCHEDULES"), [{ title: "keep" }]);

console.log("test-school-cache-schema passed");
