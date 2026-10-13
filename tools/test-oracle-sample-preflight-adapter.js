"use strict";
require("./fixture-network-only");
const test = require("node:test"), assert = require("node:assert/strict"), fs = require("node:fs"), path = require("node:path"), os = require("node:os"), crypto = require("node:crypto");
const adapter = require("../deploy/oracle-sample/preflight-adapter"), guard = require("../deploy/oracle-runtime-cutover/lifecycle-guard"), host = require("../deploy/oracle-runtime-cutover/execute");
const BASE = "a3dfd1989705f51c921f13883bcde1cce4502883", COMMIT = "7ad3b2708ce553e6fff099fd881a4b9c86ebea39";
const digest = file => crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "fosu-staging-adapter-"));
  const c = { stateDir: path.join(root, "state"), captureDir: path.join(root, "state", "captures"), appDir: path.join(root, "app"), candidateDir: path.join(root, "candidate"), runtimeDir: path.join(root, "runtime"), manifest: path.join(root, "receipt.json") };
  for (const dir of [c.stateDir, c.captureDir, c.runtimeDir, path.join(c.candidateDir, "deploy/oracle-sample"), path.join(c.appDir, "server/storage/releases"), path.join(c.appDir, "server/storage/public/releases/fixture-release")]) fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  const storage = path.join(c.appDir, "server/storage"), staging = path.join(storage, "staging-latest.json"), publishedAt = new Date(Date.now() - 3600000).toISOString();
  host.durable(path.join(storage, "releases/active.json"), { version: "fixture-release", canonicalHash: "a".repeat(64), activatedAt: publishedAt });
  host.durable(path.join(storage, "public/releases/fixture-release/manifest.json"), { canonicalHash: "a".repeat(64) });
  host.durable(staging, { canonicalHash: "a".repeat(64), releaseVersion: "fixture-release", classSchedules: [{ className: "fixture class", courses: [{ courseName: "fixture course" }] }], meta: { canonicalHash: "a".repeat(64), stagingUploadStatus: "published", releaseStatus: "published", publishedReleaseVersion: "fixture-release", publishedAt, active: true, reconciledAt: publishedAt } });
  host.durable(c.manifest, { gitCommit: COMMIT });
  const calls = [], failure = { first: null, second: null };
  function report(expected = BASE) { return { schema: "oracle-sample-preflight.v1", status: "PASS", liveBaseSha: expected, envSha256: "fixture-env", containerContractSha256: "fixture-contract", protectedFiles: { active: "active", manifest: "manifest", class: "class", teacher: "teacher", classroom: "room", course: "course", "staging-latest.json": digest(staging), "releases/active.json": digest(path.join(storage, "releases/active.json")), "notices.json": "notices", "ops/campus-sync/control.json": "paused", reactions: "reactions" }, personalAdmissionPaused: true, personalBrokerReady: true }; }
  const original = { async main(args) {
    calls.push(args);
    const o = Object.fromEntries(args.map(a => { const i = a.indexOf("="); return [a.slice(2, i), a.slice(i + 1)]; }));
    if (failure.first) throw Object.assign(new Error("fixture"), { code: failure.first });
    if (!o.before && !o["compare-before"] && failure.second) throw Object.assign(new Error("fixture"), { code: failure.second });
    const current = report(o["expected-sha"] || o["verify-after"] || BASE);
    if (o.before || o["compare-before"]) { const before = JSON.parse(fs.readFileSync(o.before || o["compare-before"])); if (!host.equal(before.protectedFiles, current.protectedFiles)) throw Object.assign(new Error("fixture raw comparison"), { code: "PROTECTED_STATE_CHANGED" }); }
    return current;
  } };
  const args = [`--guard-config=${path.join(c.stateDir, "guard.json")}`, `--app-dir=${c.appDir}`, `--runtime-dir=${c.runtimeDir}`, `--manifest=${c.manifest}`], deps = { config: c, preflight: original, guard };
  const beforeFile = path.join(c.stateDir, "before.json");
  return { root, c, storage, staging, calls, failure, args, deps, beforeFile, report, async before() { const before = await adapter.main(args, deps); host.durable(beforeFile, before); return before; }, afterArgs() { return [...args, `--verify-after=${COMMIT}`, `--before=${beforeFile}`]; }, change(mutator) { const data = JSON.parse(fs.readFileSync(staging)); mutator(data); host.durable(staging, data); }, close() { fs.rmSync(root, { recursive: true, force: true }); } };
}
test("native reconcile timestamp passes only after original byte comparison fails and full signed gate reruns", async () => {
  const f = fixture(); try {
    const before = await f.before(), beforeFileHash = digest(f.beforeFile), captured = adapter.readCapture(f.c, before.protectedFiles["staging-latest.json"]), bytes = fs.readFileSync(captured.capture.path);
    f.change(s => { s.meta.reconciledAt = new Date().toISOString(); });
    const after = await adapter.main(f.afterArgs(), f.deps);
    assert.equal(after.status, "PASS"); assert.equal(after.stagingLifecycleGuard.metadataOnly, true); assert.deepEqual(after.stagingLifecycleGuard.changedPaths, ["meta.reconciledAt"]);
    assert.equal(f.calls.length, 3); assert.ok(f.calls[2].includes(`--expected-sha=${COMMIT}`)); assert.equal(f.calls[2].some(a => a.startsWith("--before=")), false);
    assert.equal(digest(f.beforeFile), beforeFileHash); assert.deepEqual(fs.readFileSync(captured.capture.path), bytes, "original raw evidence must never be rewritten");
  } finally { f.close(); }
});
test("unchanged bytes return the unmodified original preflight result without fallback", async () => {
  const f = fixture(); try { await f.before(); const after = await adapter.main(f.afterArgs(), f.deps); assert.equal(after.stagingLifecycleGuard, undefined); assert.equal(f.calls.length, 2); } finally { f.close(); }
});
test("original health or authentication failures never enter lifecycle exception", async () => {
  const f = fixture(); try { await f.before(); f.failure.first = "SAMPLE_API_NOT_READY"; await assert.rejects(adapter.main(f.afterArgs(), f.deps), { code: "SAMPLE_API_NOT_READY" }); assert.equal(f.calls.length, 2); } finally { f.close(); }
});
test("full gate failure on retry cannot be converted to metadata PASS", async () => {
  const f = fixture(); try { await f.before(); f.change(s => { s.meta.reconciledAt = new Date().toISOString(); }); f.failure.second = "PERSONAL_BROKER_JOB_IN_FLIGHT"; await assert.rejects(adapter.main(f.afterArgs(), f.deps), { code: "PERSONAL_BROKER_JOB_IN_FLIGHT" }); } finally { f.close(); }
});
test("course content change with the same claimed canonical hash remains blocked", async () => {
  const f = fixture(); try { await f.before(); f.change(s => { s.meta.reconciledAt = new Date().toISOString(); s.classSchedules[0].courses[0].courseName = "changed fixture"; }); await assert.rejects(adapter.main(f.afterArgs(), f.deps), { code: "STAGING_PROTECTED_CONTENT_CHANGED" }); } finally { f.close(); }
});
test("unknown metadata field changes are blocked", async () => {
  const f = fixture(); try { await f.before(); f.change(s => { s.meta.reconciledAt = new Date().toISOString(); s.meta.publishable = true; }); await assert.rejects(adapter.main(f.afterArgs(), f.deps), { code: "STAGING_PROTECTED_CONTENT_CHANGED" }); } finally { f.close(); }
});
test("allowed metadata name with incorrect real Active version is blocked", async () => {
  const f = fixture(); try { await f.before(); f.change(s => { s.meta.reconciledAt = new Date().toISOString(); s.meta.publishedReleaseVersion = "wrong-release"; }); await assert.rejects(adapter.main(f.afterArgs(), f.deps), { code: "STAGING_LIFECYCLE_VALUE_INVALID" }); } finally { f.close(); }
});
test("another protected file difference is blocked before stage exception", async () => {
  const f = fixture(); try { await f.before(); const b = JSON.parse(fs.readFileSync(f.beforeFile)); b.protectedFiles["notices.json"] = "different"; host.durable(f.beforeFile, b); f.change(s => { s.meta.reconciledAt = new Date().toISOString(); }); await assert.rejects(adapter.main(f.afterArgs(), f.deps), { code: "PROTECTED_STATE_CHANGED" }); } finally { f.close(); }
});
test("missing full before object is explicitly blocked rather than invented", async () => {
  const f = fixture(); try { const report = f.report(); host.durable(f.beforeFile, report); f.change(s => { s.meta.reconciledAt = new Date().toISOString(); }); await assert.rejects(adapter.main(f.afterArgs(), f.deps), { code: "STAGING_PRESTATE_OBJECT_UNAVAILABLE" }); } finally { f.close(); }
});
test("controlled operate has exactly three reviewed substitutions and original candidate bytes stay intact", () => {
  const f = fixture(); try {
    const originalPath = path.resolve(__dirname, "../deploy/oracle-sample/operate.sh"), original = fs.readFileSync(originalPath, "utf8"), target = path.join(f.c.candidateDir, "deploy/oracle-sample/operate.sh");
    fs.writeFileSync(target, original); fs.writeFileSync(path.join(f.c.candidateDir, "deploy/oracle-sample/preflight.js"), "fixture preflight bytes");
    const evidence = adapter.setup(f.c, { operateSha256: digest(target), preflightSha256: digest(path.join(f.c.candidateDir, "deploy/oracle-sample/preflight.js")) });
    const copy = fs.readFileSync(evidence.operateFile, "utf8"); assert.equal(fs.readFileSync(target, "utf8"), original); assert.equal(evidence.originalCallsiteCount, 1); assert.equal(evidence.compressionCallsiteCount, 2);
    assert.match(copy, /\/usr\/bin\/pigz -p 2 -1 -n/); assert.match(copy, /tar --use-compress-program="\/usr\/bin\/pigz -p 2 -1" -cf/);
    const reverted = copy.replace(`preflight() { node "${path.resolve(__dirname, "../deploy/oracle-sample/preflight-adapter.js")}" --guard-config="${evidence.configFile}"`, 'preflight() { node "$candidate_dir/deploy/oracle-sample/preflight.js"')
      .replace('docker image save "$old_image" | /usr/bin/pigz -p 2 -1 -n > "$backup/previous-image.tar.gz"', 'docker image save "$old_image" | gzip -n > "$backup/previous-image.tar.gz"')
      .replace('tar --use-compress-program="/usr/bin/pigz -p 2 -1" -cf "$backup/state.tar.gz" -C "$app_dir/server" storage .env', 'tar -czf "$backup/state.tar.gz" -C "$app_dir/server" storage .env');
    assert.equal(reverted, original, "every other byte and original safety gate must be preserved");
  } finally { f.close(); }
});
