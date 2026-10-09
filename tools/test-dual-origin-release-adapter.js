"use strict";
const assert = require("assert"), fs = require("fs"), os = require("os"), path = require("path"), http = require("http");
const root = fs.mkdtempSync(path.join(os.tmpdir(), "fosu-dual-origin-adapter-"));
const storage = path.join(root, "storage"), oracleFiles = path.join(root, "oracle", "releases"), oracleRuntime = path.join(root, "oracle", "runtime"), cloudRoot = path.join(root, "cloudbase");
Object.assign(process.env, { FOSU_STORAGE_DIR: storage, FOSU_DATA_DIR: path.join(root, "data"), OPENRESTY_STATIC_RELEASE_DIR: oracleFiles, OPENRESTY_STATIC_RUNTIME_DIR: oracleRuntime, STATIC_RELEASE_SYNC_ENABLED: "true", NODE_ENV: "test" });
const release = require("../server/src/services/releaseService"), runtime = require("../server/src/services/runtimePointerService"), registry = require("../server/src/services/termRegistryService"), statics = require("../server/src/services/staticReleaseSyncService"), guard = require("../server/src/shared/publicationGuard"), distribution = require("../server/src/shared/verifyImmutableDistribution"), adapter = require("../server/src/services/dualOriginReleaseService"), cli = require("../server/scripts/publish-prepared-dual-origin"), publisher = require("./fosu-publisher/publish");
const { calculateFingerprint } = require("../server/src/utils/stagingFingerprint");
let passed = 0, requests = [], missing = "", pointerFail = false, writes = [], hidden;
async function test(name, fn) { await fn(); passed++; console.log("PASS " + name); }
function fixture(version, title) {
  const term = "2026-2027-1";
  const course = { courseName: title, teacherName: "Fixture Teacher A", classroom: "Fixture Room", weekday: 1, startSection: 1, endSection: 2, sections: [1, 2], weeks: [1, 2] };
  const other = { ...course, teacherName: "Fixture Teacher B" };
  return { schemaVersion: 1, version, releaseVersion: version, term, semester: term, termStartDate: "2026-09-07", generatedAt: "2026-10-10T00:00:00Z", updatedAt: "2026-10-10T00:00:00Z", termConfig: { term, semesterText: term, termStartDate: "2026-09-07", weekStart: "monday", totalWeeks: 20 }, catalog: { colleges: [{ code: "01", name: "Fixture College" }], grades: ["2026"] }, majors: [{ code: "01", collegeCode: "01", name: "Fixture Major", grade: "2026" }], classSchedules: [{ className: "26Fixture1班", semester: term, collegeCode: "01", grade: "2026", majorCode: "01", courses: [course, other] }], resources: { teachers: [{ teacherName: course.teacherName }, { teacherName: other.teacherName }], classrooms: [{ roomName: course.classroom }], courses: [{ courseName: title }], teacherSchedules: [course, other].map(item => ({ teacherName: item.teacherName, semester: term, courses: [item] })), classroomSchedules: [{ roomName: course.classroom, semester: term, courses: [course, other] }], courseSchedules: [{ courseName: title, semester: term, courses: [course, other] }] } };
}
function safeTarget(base, relative) {
  const file = path.resolve(base, relative), diff = path.relative(base, file);
  assert.ok(diff && !diff.startsWith("..") && !path.isAbsolute(diff)); return file;
}
const server = http.createServer((req, res) => {
  const pathname = decodeURIComponent(new URL(req.url, "http://127.0.0.1").pathname);
  requests.push(pathname);
  let file;
  if (pathname.startsWith("/oracle/releases/")) file = safeTarget(oracleFiles, pathname.slice("/oracle/releases/".length));
  else if (pathname.startsWith("/oracle/runtime/")) file = safeTarget(oracleRuntime, pathname.slice("/oracle/runtime/".length));
  else if (pathname.startsWith("/cloudbase/")) file = safeTarget(cloudRoot, pathname.slice("/cloudbase/".length));
  if (!file || pathname === missing || !fs.existsSync(file) || !fs.statSync(file).isFile()) { res.writeHead(404); res.end(); return; }
  res.writeHead(200, { "content-type": "application/json" }); res.end(fs.readFileSync(file));
});
async function commandRunner(localPath, remotePath) {
  writes.push(remotePath);
  if (remotePath === "runtime/active.json") {
    assert.equal(release.getActiveReleaseInfo().releaseVersion, "adapter-next");
    assert.ok(fs.existsSync(path.join(cloudRoot, "releases", "adapter-next", hidden)));
    if (pointerFail) throw Object.assign(new Error("fixture pointer failure"), { code: "FIXTURE_POINTER_FAILED" });
  } else {
    // Preparation must preserve both Oracle pointers through the last file upload.
    const active = runtime.readActivePointer();
    if (active.releaseVersion === "adapter-old") assert.equal(JSON.parse(fs.readFileSync(path.join(oracleRuntime, "active.json"))).releaseVersion, "adapter-old");
  }
  const target = safeTarget(cloudRoot, remotePath);
  fs.mkdirSync(path.dirname(target), { recursive: true }); fs.cpSync(localPath, target, { recursive: true });
}
async function main() {
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  const origin = "http://127.0.0.1:" + server.address().port;
  Object.assign(process.env, { PUBLIC_BASE_URL: origin + "/oracle/releases", FOSU_STATIC_RUNTIME_BASE_URL: origin + "/oracle/runtime", FOSU_CLOUDBASE_HOSTING_BASE_URL: origin + "/cloudbase", FOSU_DUAL_ORIGIN_PUBLICATION: "0" });
  fs.mkdirSync(oracleFiles, { recursive: true }); fs.mkdirSync(oracleRuntime, { recursive: true });
  registry.createPlannedTerm({ term: "2026-2027-1", semesterText: "2026-2027-1", termStartDate: "2026-09-07", weekStart: "monday", totalWeeks: 20 });
  const old = release.writeReleaseSnapshot(fixture("adapter-old", "Fixture Old Course"));
  release.activateReleaseVersion(old.version);
  await statics.syncIfEnabled(old.version, { prepareOnly: true });
  fs.mkdirSync(path.join(cloudRoot, "runtime"), { recursive: true });
  fs.writeFileSync(path.join(cloudRoot, "runtime", "active.json"), JSON.stringify(runtime.readActivePointer()));
  const next = release.writeReleaseSnapshot(fixture("adapter-next", "Fixture Next Course"));
  const local = require("./cloudbase/release-pack-utils").verifyLocalReleasePack({ releaseVersion: next.version });
  const samples = new Set(local.samples.map(item => item.detail));
  hidden = Object.keys(local.manifest.files).find(item => item.startsWith("detail/") && !samples.has(item));
  assert.ok(hidden, "fixture has a non-sampled detail");
  const plan = { releaseVersion: next.version, canonicalHash: calculateFingerprint(release.readReleaseSnapshot(next.version)).canonicalHash, expectedActiveReleaseVersion: old.version, confirmation: "CONFIRM_DUAL_ORIGIN_PUBLICATION" };
  const deps = { fixtureOnly: true, commandRunner };
  await test("production adapter defaults disabled without any distribution writes", async () => {
    await assert.rejects(adapter.publishPrepared(plan, deps), /DISABLED/); assert.equal(writes.length, 0);
  });
  process.env.FOSU_DUAL_ORIGIN_PUBLICATION = "1";
  await test("explicit confirmation and immutable approval hash are enforced", async () => {
    await assert.rejects(adapter.publishPrepared({ ...plan, confirmation: "" }, deps), /APPROVAL_REQUIRED/);
    await assert.rejects(adapter.publishPrepared({ ...plan, canonicalHash: "a".repeat(64) }, deps), /IMMUTABLE_HASH_MISMATCH/);
    assert.equal(writes.length, 0);
  });
  await test("missing non-sampled detail prevents both pointers from activating", async () => {
    missing = "/cloudbase/releases/adapter-next/" + hidden;
    await assert.rejects(adapter.publishPrepared(plan, deps), error => error.receipt.status === "failed-before-activation");
    assert.equal(runtime.readActivePointer().releaseVersion, "adapter-old");
    assert.equal(JSON.parse(fs.readFileSync(path.join(oracleRuntime, "active.json"))).releaseVersion, "adapter-old");
    assert.equal(JSON.parse(fs.readFileSync(path.join(cloudRoot, "runtime", "active.json"))).releaseVersion, "adapter-old");
    assert.ok(!writes.includes("runtime/active.json")); missing = "";
  });
  await test("stale completion is rejected before a second upload", async () => {
    const before = writes.length;
    await assert.rejects(adapter.publishPrepared({ ...plan, expectedActiveReleaseVersion: "superseded" }, deps), /BASELINE_CHANGED/);
    assert.equal(writes.length, before);
  });
  await test("post Oracle failure is recorded for reconciliation without changing personal services", async () => {
    pointerFail = true;
    await assert.rejects(adapter.publishPrepared(plan, deps), error => error.receipt.oracleActivated && error.receipt.status === "reconciliation-required");
    assert.equal(runtime.readActivePointer().releaseVersion, "adapter-next");
    assert.equal(JSON.parse(fs.readFileSync(path.join(cloudRoot, "runtime", "active.json"))).releaseVersion, "adapter-old");
    pointerFail = false;
  });
  await test("resume keeps the committed Oracle epoch and repairs the CloudBase mirror", async () => {
    const before = runtime.readActivePointer().cacheEpoch;
    const receipt = await adapter.publishPrepared(plan, deps);
    assert.equal(receipt.status, "published"); assert.equal(runtime.readActivePointer().cacheEpoch, before);
    const remote = JSON.parse(fs.readFileSync(path.join(cloudRoot, "runtime", "active.json")));
    assert.equal(remote.releaseVersion, "adapter-next"); assert.equal(remote.cacheEpoch, before);
    assert.ok(requests.includes("/cloudbase/releases/adapter-next/" + hidden));
    const journal = fs.readFileSync(path.join(adapter.RECEIPTS, "adapter-next.jsonl"), "utf8").trim().split("\n").map(line => JSON.parse(line));
    assert.ok(journal.some(item => item.status === "reconciliation-required"));
    assert.equal(journal.at(-1).status, "published");
  });
  await test("CloudBase ahead of the Oracle authority blocks new writes", async () => {
    const file = path.join(cloudRoot, "runtime", "active.json"), previous = fs.readFileSync(file);
    const remote = JSON.parse(previous); remote.cacheEpoch += 100000; fs.writeFileSync(file, JSON.stringify(remote));
    const count = writes.length; await assert.rejects(adapter.publishPrepared(plan, deps), /REGRESSION/); assert.equal(writes.length, count); fs.writeFileSync(file, previous);
  });
  await test("unforgeable publication lock cannot be supplied by a JSON request", () => {
    assert.throws(() => release.activateReleaseVersion(old.version, { publicationLease: { directory: "fake" } }), /LEASE_REJECTED/);
    const directory = path.join(storage, "ops", "publication"), lease = guard.acquire(directory);
    try { guard.assertOwned(directory, lease); assert.throws(() => guard.acquire(directory), /LOCKED/); } finally { lease(); }
  });
  await test("intentional rollback uses a new monotonic epoch in the runtime pointer", () => {
    const previous = runtime.readActivePointer().cacheEpoch, realNow = Date.now;
    try { Date.now = () => previous - 60000; release.activateReleaseVersion(old.version, { expectedActiveReleaseVersion: next.version }); } finally { Date.now = realNow; }
    const pointer = runtime.readActivePointer(), active = JSON.parse(fs.readFileSync(release.ACTIVE_RELEASE_PATH));
    assert.ok(pointer.cacheEpoch > previous); assert.equal(pointer.cacheEpoch, active.cacheEpoch); assert.equal(pointer.releaseVersion, old.version);
  });
  await test("server CLI preview is local only and Windows legacy publish payload stays unchanged", async () => {
    const count = writes.length, preview = await cli.main(["--release=adapter-next"]);
    assert.equal(preview.productionWrites, 0); assert.equal(preview.schoolRequests, 0); assert.equal(writes.length, count);
    assert.deepEqual(publisher.buildStagingPublicationRequest({}), { force: false, readyOnly: false, releaseNote: "Published by fosu-publisher" });
    assert.equal(publisher.buildStagingPublicationRequest({ "publication-confirmation": plan.confirmation }).publicationConfirmation, plan.confirmation);
    assert.throws(() => publisher.buildStagingPublicationRequest({ "publication-confirmation": "wrong" }), /APPROVAL_REQUIRED/);
  });
  await test("activation failure restores registry, both Oracle pointers and compatibility snapshots", () => {
    const files = [release.ACTIVE_RELEASE_PATH, path.join(storage, "snapshots", "current.json"), path.join(storage, "snapshots", "current.json.gz"), registry.REGISTRY_PATH, require("../server/src/services/termReleaseIndexService").TERM_INDEX_PATH, runtime.ACTIVE_RUNTIME_PATH, path.join(oracleRuntime, "active.json")];
    const before = files.map(file => fs.existsSync(file) ? fs.readFileSync(file) : null);
    const write = runtime.writeActivePointerForManifest;
    runtime.writeActivePointerForManifest = (...args) => { write(...args); throw Object.assign(new Error("fixture post write fault"), { code: "FIXTURE_ACTIVATION_FAILED" }); };
    try { assert.throws(() => release.activateReleaseVersion(next.version, { expectedActiveReleaseVersion: old.version }), error => error.rollbackApplied === true); } finally { runtime.writeActivePointerForManifest = write; }
    files.forEach((file, index) => assert.deepEqual(fs.existsSync(file) ? fs.readFileSync(file) : null, before[index]));
    assert.equal(runtime.readActivePointer().releaseVersion, old.version);
  });
  await test("TLS and manifest path protections cannot be relaxed for production", () => {
    assert.equal(guard.epoch({ cacheEpoch: 100, updatedAt: "2099-01-01T00:00:00Z" }), 100);
    assert.throws(() => distribution.assertBaseUrl("http://example.com"), /HTTPS_REQUIRED/);
    assert.throws(() => distribution.assertBaseUrl("http://example.com", true), /HTTPS_REQUIRED/);
    assert.throws(() => distribution.assertBaseUrl("https://user:password@example.com"), /HTTPS_REQUIRED/);
    for (const item of ["../secret", "detail/../secret", "/absolute", "detail%2fsecret", "detail\\secret", "x?y=1"]) assert.throws(() => distribution.safePath(item), /PATH_REJECTED/);
  });
  await test("a changed active during async Staging construction cannot replace the reviewed baseline", async () => {
    const staging = require("../server/src/services/stagingPublishService");
    const data = fixture("adapter-stale", "Fixture Late Old Job");
    fs.writeFileSync(staging.STAGING_LATEST_PATH, JSON.stringify(data));
    const write = release.writeReleaseSnapshotAsync;
    const publish = adapter.publishPrepared;
    adapter.publishPrepared = candidate => publish(candidate, deps);
    release.writeReleaseSnapshotAsync = async (...args) => {
      const built = await write(...args);
      const later = release.writeReleaseSnapshot(fixture("adapter-later", "Fixture Newer Completed Job"));
      await statics.syncIfEnabled(later.version, { prepareOnly: true });
      release.activateReleaseVersion(later.version, { expectedActiveReleaseVersion: old.version });
      return built;
    };
    try { await assert.rejects(staging.runStagingPublish({ publicationConfirmation: plan.confirmation }), /BASELINE_CHANGED/); } finally { release.writeReleaseSnapshotAsync = write; adapter.publishPrepared = publish; }
    assert.equal(runtime.readActivePointer().releaseVersion, "adapter-later");
    assert.equal(fs.existsSync(path.join(cloudRoot, "releases", "adapter-stale")), false);
  });
  console.log(`dual-origin release adapter: ${passed} fixtures PASS; real local HTTP byte verification, schoolRequests=0, productionWrites=0`);
}
main().catch(error => { console.error(error); process.exitCode = 1; }).finally(async () => {
  await new Promise(resolve => server.close(resolve));
  const relative = path.relative(os.tmpdir(), root);
  if (relative && !relative.startsWith("..") && !path.isAbsolute(relative)) fs.rmSync(root, { recursive: true, force: true });
});
