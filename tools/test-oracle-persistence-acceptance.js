"use strict";
require("./fixture-network-only");
const test = require("node:test"), assert = require("node:assert/strict"), fs = require("node:fs"), os = require("node:os"), path = require("node:path"), crypto = require("node:crypto");
const cutover = require("../deploy/oracle-runtime-cutover/execute"), guard = require("../deploy/oracle-runtime-cutover/lifecycle-guard");
const HASH = "a".repeat(64), EARLY = "2026-10-13T03:00:00.000Z", LATE = "2026-10-13T03:02:00.000Z";
function temporary(t) { const root = fs.mkdtempSync(path.join(os.tmpdir(), "fosu-readonly-accept-")); t.after(() => fs.rmSync(root, { recursive: true, force: true })); return root; }
function write(file, bytes) { fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 }); fs.writeFileSync(file, typeof bytes === "string" ? bytes : JSON.stringify(bytes), { mode: 0o600 }); return file; }
function staging() { return { canonicalHash: HASH, stagingUploadId: "stg_fixture", classSchedules: [{ className: "fixture", courses: [{ courseName: "fixture course", weekday: 1 }] }], meta: { canonicalHash: HASH, counts: { classes: 1 }, previousHash: "b".repeat(64), stagingUploadStatus: "pending-review" } }; }
const authority = { canonicalHash: HASH, version: "2026-10-12T18-31-55", publishedAt: "2026-10-12T18:32:00.000Z" };
function reconciled(before) { const next = structuredClone(before); Object.assign(next.meta, { stagingUploadStatus: "published", releaseStatus: "published", publishedReleaseVersion: authority.version, publishedAt: authority.publishedAt, active: true, reconciledAt: "2026-10-13T03:01:00.000Z" }); return next; }
test("only six source-proven root meta fields may evolve with exact Active authority", () => {
  const before = staging(), after = reconciled(before), result = guard.compareStaging(before, after, authority, { earliest: EARLY, latest: LATE });
  assert.equal(result.metadataOnly, true); assert.deepEqual(result.changedPaths.sort(), guard.META_KEYS.map(k => "meta." + k).sort());
  for (const mutate of [v => { v.classSchedules[0].courses[0].weekday = 2; }, v => { v.meta.counts.classes = 2; }, v => { v.meta.previousHash = "changed"; }, v => { v.canonicalHash = "c".repeat(64); }, v => { v.stagingUploadId = "other"; }, v => { v.meta.reason = "startup"; }]) {
    const wrong = structuredClone(after); mutate(wrong); assert.throws(() => guard.compareStaging(before, wrong, authority, { earliest: EARLY, latest: LATE }), { code: "STAGING_PROTECTED_CONTENT_CHANGED" });
  }
});
test("lifecycle values/timestamps are validated; absent old object is never invented", () => {
  const before = staging(), after = reconciled(before);
  assert.throws(() => guard.compareStaging(undefined, after, authority, { earliest: EARLY, latest: LATE }), { code: "STAGING_PRESTATE_OBJECT_UNAVAILABLE" });
  for (const [key, value] of [["active", false], ["releaseStatus", "failed"], ["publishedReleaseVersion", "different"]]) { const wrong = structuredClone(after); wrong.meta[key] = value; assert.throws(() => guard.compareStaging(before, wrong, authority, { earliest: EARLY, latest: LATE }), { code: "STAGING_LIFECYCLE_VALUE_INVALID" }); }
  const wrongTime = structuredClone(after); wrongTime.meta.reconciledAt = EARLY.replace("03:00", "02:59");
  assert.throws(() => guard.compareStaging(before, wrongTime, authority, { earliest: EARLY, latest: LATE }), { code: "STAGING_RECONCILE_TIME_INVALID" });
  const wrongPublished = structuredClone(after); wrongPublished.meta.publishedAt = LATE;
  assert.throws(() => guard.compareStaging(before, wrongPublished, authority, { earliest: EARLY, latest: LATE }), { code: "STAGING_PUBLISHED_TIME_INVALID" });
});
test("complete staging capture preserves original bytes/hash; next-stage snapshot cannot fake old generation", t => {
  const root = temporary(t), storage = path.join(root, "storage"), state = path.join(root, "state"); fs.mkdirSync(state, { mode: 0o700 });
  const file = write(path.join(storage, "staging-latest.json"), JSON.stringify(staging(), null, 2) + "\n"), original = fs.readFileSync(file);
  const captured = guard.captureStaging({ storageDir: storage, stateDir: state, label: "accepted", expectedHash: cutover.fileHash(file) });
  assert.deepEqual(fs.readFileSync(captured.path), original); assert.equal(captured.sha256, cutover.fileHash(file));
  assert.throws(() => guard.captureStaging({ storageDir: storage, stateDir: state, label: "before", expectedHash: "f".repeat(64) }), { code: "STAGING_CAPTURE_HASH_CHANGED" });
  assert.equal(fs.existsSync(path.join(state, "staging.before.private.json")), false);
});
test("probe hash matches independent Python ensure_ascii JSON convention", () => {
  const value = { 学校: "佛山", n: 3, list: [{ a: true }], emoji: "😀" };
  const pythonEncoding = '{"emoji":"\\ud83d\\ude00","list":[{"a":true}],"n":3,"\\u5b66\\u6821":"\\u4f5b\\u5c71"}';
  assert.equal(cutover.pythonJsonHash(value), crypto.createHash("sha256").update(pythonEncoding).digest("hex"));
});
test("probe hash preserves Python ordering of integer-like and zero-prefixed college IDs", () => {
  const value = { byCollege: { "2": "third", "11": "second", "01": "first" } };
  const pythonEncoding = '{"byCollege":{"01":"first","11":"second","2":"third"}}';
  assert.equal(cutover.pythonJsonHash(value), crypto.createHash("sha256").update(pythonEncoding).digest("hex"));
});
test("live six-request business revalidation tolerates new reactions but rejects one changed index/notice byte", async t => {
  const root = temporary(t), apiManifest = { success: true, releaseVersion: authority.version, term: "2026-2027-1", counts: { classes: 1 } }, notices = [{ id: 1, title: "fixture 公告", reactions: { total: 2 } }];
  const items = [{ id: "fixture", name: "fixture 班级" }], sources = Object.fromEntries(["class", "teacher", "classroom", "course"].map(kind => [kind, { success: true, items: 1, itemsSha256: cutover.pythonJsonHash(items) }]));
  const evidence = write(path.join(root, "business.private.json"), { probes: { schema: "oracle-business-probes.v1", activeReleaseVersion: authority.version, term: apiManifest.term, manifestSha256: cutover.pythonJsonHash(apiManifest), sources, notices: { success: true, count: 1, contentSha256: cutover.pythonJsonHash(notices.map(({ reactions, ...value }) => value)) } } });
  write(path.join(root, "server/.env"), "ADMIN_API_TOKEN=fixture-only\n"); let calls = 0, changeIndex = false, changeNotice = false;
  const request = async route => { calls++; if (route.includes("/manifest")) return apiManifest; if (route.includes("/index/")) return { success: true, items: changeIndex ? [{ ...items[0], name: "changed" }] : items }; return { success: true, items: [{ ...notices[0], title: changeNotice ? "changed" : notices[0].title, reactions: { total: 99 } }] }; };
  const verified = await cutover.liveBusinessAcceptance({ appDir: root }, evidence, request); assert.equal(calls, 6); assert.equal(verified.sources.class.items, 1);
  changeIndex = true; await assert.rejects(cutover.liveBusinessAcceptance({ appDir: root }, evidence, request), { code: "BUSINESS_INDEX_CHANGED" });
  changeIndex = false; changeNotice = true; await assert.rejects(cutover.liveBusinessAcceptance({ appDir: root }, evidence, request), { code: "BUSINESS_NOTICES_CHANGED" });
});
