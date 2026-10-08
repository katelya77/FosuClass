"use strict";
const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const snapshot = require("./fixtures/four-direct-source");
const contract = require("../server/src/shared/fourDirectSourceContract");
const cache = require("../shared/syncCacheStore");
const { collectEntities, responseGuard } = require("./fosu-sync-client/directAcquisition");
const fingerprint = require("../server/src/utils/stagingFingerprint");
let cases = 0;
function check(fn) { fn(); cases++; }
async function main() {
  const data = snapshot();
  check(() => assert.equal(contract.assertFourSources(data, data.term).valid, true));
  for (const kind of contract.KINDS) {
    const bad = snapshot(); bad.scopeSources[kind + "Schedules"].sourceMode = "derived-current-run";
    check(() => assert.throws(() => contract.assertFourSources(bad), /FOUR_DIRECT_SOURCE_INVALID/));
  }
  const oldCache = snapshot(); oldCache.meta.allowDerived = true;
  check(() => assert.throws(() => contract.assertFourSources(oldCache), /FOUR_DIRECT_SOURCE_INVALID/));
  check(() => assert.throws(() => contract.assertFourSources(data, "2025-2026-2"), /FOUR_DIRECT_SOURCE_INVALID/));
  for (const key of ["cookie", "Authorization", "password", "rawHtml", "studentId", "base64"]) { const bad = snapshot(); bad.meta[key] = "fixture"; check(() => assert.throws(() => contract.assertFourSources(bad), /STAGING_SENSITIVE/)); }
  const hash = fingerprint.calculateFingerprint(data).canonicalHash;
  const same = snapshot(); same.generatedAt = "2099-01-01"; same.meta.durationMs = 123; same.resources.teacherSchedules[0].courses[0].weeks.reverse();
  check(() => assert.equal(fingerprint.calculateFingerprint(same).canonicalHash, hash));
  const changed = snapshot(); changed.resources.teacherSchedules[0].courses[0].startSection = 3;
  check(() => assert.notEqual(fingerprint.calculateFingerprint(changed).canonicalHash, hash));
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "fosu-direct-"));
  const options = { term: data.term, scope: "teacherSchedules", runId: "fixture-run", baseDir: root, targets: [{ key: "one", name: "测试教师" }, { key: "two", name: "空课表教师" }], sleep: async () => {}, parse: (html, target) => [{ teacherName: target.name, courses: target.key === "one" ? [{ courseName: "测试课程" }] : [] }] };
  let calls = [];
  await assert.rejects(() => collectEntities(Object.assign({}, options, { request: async (target) => { calls.push(target.key); if (target.key === "two") throw Object.assign(new Error("fixture"), { code: "SCHOOL_NETWORK_FAILED" }); return { ok: true, status: 200, text: "<table id='kbtable'></table>" }; } })), /SCHOOL_NETWORK_FAILED/); cases++;
  const resumed = await collectEntities(Object.assign({}, options, { request: async (target) => { calls.push(target.key); return { ok: true, status: 200, text: "<table id='kbtable'></table>" }; } }));
  check(() => assert.deepEqual(calls, ["one", "two", "two"]));
  check(() => assert.equal(resumed.summary.success, 1));
  check(() => assert.equal(resumed.summary.empty, 1));
  check(() => assert.equal(resumed.summary.failed, 0));
  check(() => assert.equal(resumed.summary.coverageValid, true));
  const noRequests = await collectEntities(Object.assign({}, options, { request: async () => { throw new Error("completed entity must not be requested"); } }));
  check(() => assert.equal(noRequests.summary.requestCount, 0));
  check(() => assert.throws(() => responseGuard({ ok: true, status: 200, text: "invalid page" }), /SCHEDULE_PARSE_FAILED/));
  check(() => assert.throws(() => responseGuard({ ok: false, status: 403, text: "" }), /SESSION_EXPIRED/));
  check(() => assert.throws(() => responseGuard({ ok: true, status: 200, text: "滑块验证" }), /SCHOOL_SECURITY_CHALLENGE/));
  const write = cache.writeScheduleLatest(root, data.term, "teacherSchedules", [{ teacherName: "测试教师", courses: [] }], { runId: "unverified" });
  check(() => assert.equal(fs.existsSync(write.latestPath), false));
  check(() => assert.throws(() => cache.promoteValidatedRun(root, data.term, "unverified", ["teacherSchedules"]), /CACHE_PROMOTION_REJECTED/));
  cache.promoteValidatedRun(root, data.term, "unverified", ["teacherSchedules"], contract.assertFourSources(data));
  check(() => assert.equal(fs.existsSync(write.latestPath), true));
  cache.writeScheduleLatest(root, data.term, "teacherSchedules", [], { runId: "failed", failed: 1, partial: true });
  check(() => assert.throws(() => cache.promoteValidatedRun(root, data.term, "failed", ["teacherSchedules"], contract.assertFourSources(data)), /CACHE_PROMOTION_REJECTED/));
  console.log("four-direct-source-production: " + cases + " PASS (fixtures only)");
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
