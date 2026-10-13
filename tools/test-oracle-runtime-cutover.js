"use strict";
require("./fixture-network-only");
const test = require("node:test"), assert = require("node:assert/strict");
const fs = require("node:fs"), path = require("node:path"), os = require("node:os");
const cutover = require("../deploy/oracle-runtime-cutover/execute");
const native = require("../server/scripts/migrate-runtime-data");
const OLD_ID = "a".repeat(64), NEW_ID = "b".repeat(64), IMAGE = "sha256:" + "c".repeat(64);
function temporary(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "fosu-cutover-fixture-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  return root;
}
function write(file, content) { fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 }); fs.writeFileSync(file, content, { mode: 0o600 }); return file; }
function manifest(root, relative) { const file = path.join(root, relative); return { path: relative, size: fs.statSync(file).size, sha256: cutover.fileHash(file) }; }
function baseline() {
  return { name: "server", services: { "fosu-api": { container_name: "fosuclass-api", image: "original", environment: { FOSU_DATA_DIR: "/app/data", PRIVATE_VALUE: "fixture$dollar" }, ports: [{ target: 3000, published: "18318", host_ip: "127.0.0.1" }], mem_limit: 4294967296, cpus: 1.5, command: ["node", "src/app.js"], volumes: [
    { type: "bind", source: "/srv/storage", target: "/app/storage" },
    { type: "bind", source: "/srv/releases", target: "/openresty-static/releases" },
    { type: "bind", source: "/srv/runtime", target: "/openresty-static/runtime" },
  ] } }, networks: { default: { name: "server_default" } } };
}
test("only the pinned image/pull policy and fourth data bind may change", () => {
  const before = baseline(), copy = structuredClone(before), target = "/srv/storage/runtime-data";
  const next = cutover.persistenceCompose(before, IMAGE, target);
  cutover.assertOnlyPersistenceDelta(before, next, IMAGE, target);
  assert.deepEqual(before, copy); assert.deepEqual(next.services["fosu-api"].volumes.slice(0, 3), before.services["fosu-api"].volumes);
  for (const mutate of [s => { s.environment.PRIVATE_VALUE = "changed"; }, s => { s.ports[0].published = "3000"; }, s => { s.mem_limit = 1; }, s => { s.command = ["false"]; }, s => { s.volumes[0].source = "/unapproved"; }]) {
    const wrong = structuredClone(next); mutate(wrong.services["fosu-api"]);
    assert.throws(() => cutover.assertOnlyPersistenceDelta(before, wrong, IMAGE, target), { code: "COMPOSE_UNAPPROVED_DELTA" });
  }
  assert.equal(cutover.escapeInterpolation(before).services["fosu-api"].environment.PRIVATE_VALUE, "fixture$$dollar");
});
test("interrupted migration uses original writable layer; uncertain switch always uses current persistent data", () => {
  for (const phase of ["ADMISSION_INTENT", "STOP_INTENT", "MIGRATING", "MIGRATED"]) assert.equal(cutover.recoveryPolicy({ phase, persistenceValidated: phase === "MIGRATED" }, true, false), "ORIGINAL_WRITABLE_LAYER");
  for (const phase of ["SWITCH_INTENT", "STARTED", "VERIFYING", "RECOVERY_BLOCKED"]) assert.equal(cutover.recoveryPolicy({ phase, persistenceValidated: true, dataMayHaveNewWrites: true }, false, false), "CURRENT_PERSISTENT_DATA");
  assert.equal(cutover.recoveryPolicy({ phase: "MIGRATING" }, false, true), "BLOCKED_PRESERVE_SCENE");
});
test("native pinned migrator and bootstrap prove all bytes and preserve empty directories", t => {
  const root = temporary(t), source = path.join(root, "source"), target = path.join(root, "target"), state = path.join(root, "state");
  write(path.join(source, "admin-audit-log.jsonl"), '{"action":"fixture"}\n');
  write(path.join(source, "ai", "knowledge-docs.json"), '{"fixture":true}\n');
  fs.mkdirSync(path.join(source, "ai", "empty-directory"), { recursive: true }); fs.mkdirSync(state);
  write(path.join(state, "baseline.json"), JSON.stringify({ originalId: OLD_ID }));
  fs.copyFileSync(path.join(__dirname, "../server/src/services/runtimeDataBootstrapService.js"), path.join(state, "bootstrap.pinned.js"));
  const sourceDirs = cutover.directoryInventory(source);
  const result = native.migrateRuntimeData({ sourceContainer: OLD_ID, targetDir: target, backupDir: path.join(root, "backup"),
    dockerControl: { inspect() { return { running: false, paused: false, containerId: OLD_ID, imageId: IMAGE }; }, pause() { assert.fail("stopped source must not be paused"); } },
    dockerCopy(_, destination) { fs.cpSync(source, destination, { recursive: true }); },
  });
  assert.equal(cutover.blobHash(path.join(__dirname, "../server/scripts/migrate-runtime-data.js")), cutover.MIGRATOR_BLOB);
  cutover.preserveDirectories(target, sourceDirs);
  const evidence = cutover.migrationEvidence({ targetDir: target, stateDir: state }, result, native);
  assert.equal(evidence.files, 2); assert.equal(evidence.archiveSha256, cutover.fileHash(result.archivePath));
  assert.equal(fs.statSync(path.join(target, "ai", "empty-directory")).isDirectory(), true);
  assert.equal(JSON.parse(fs.readFileSync(path.join(target, ".fosu-runtime-bootstrap.json"))).state, "migration-accepted");
});
test("pre-start acceptance refuses one changed byte even when file count and size match", t => {
  const root = temporary(t), target = path.join(root, "target"), state = path.join(root, "state"), archive = write(path.join(root, "archive"), "fixture archive");
  const data = write(path.join(target, "ai", "knowledge-docs.json"), "same-size-A");
  const files = [manifest(target, "ai/knowledge-docs.json")]; write(path.join(state, "baseline.json"), JSON.stringify({ originalId: OLD_ID }));
  fs.writeFileSync(data, "same-size-B");
  const result = { archiveVerified: true, archivePath: archive, archiveSha256: cutover.fileHash(archive), sourceConsistency: { sourceState: "stopped", quiesced: true, sourceIdentity: { containerId: OLD_ID } }, files };
  assert.throws(() => cutover.migrationEvidence({ targetDir: target, stateDir: state }, result, native), { code: "FINAL_COPY_FINGERPRINT_FAILED" });
});
test("post-start permits legitimate AI writes and retains every original audit byte", t => {
  const target = temporary(t);
  write(path.join(target, "admin-audit-log.jsonl"), '{"before":true}\n');
  write(path.join(target, "ai", "conversations", "fixture", "index.json"), '{"v":1}\n');
  write(path.join(target, "ai", "run-store", "journal.jsonl"), '{"seq":1}\n');
  write(path.join(target, "ai", "knowledge-docs.json"), '{"static":true}\n');
  const files = ["admin-audit-log.jsonl", "ai/conversations/fixture/index.json", "ai/run-store/journal.jsonl", "ai/knowledge-docs.json"].map(f => manifest(target, f));
  fs.appendFileSync(path.join(target, "admin-audit-log.jsonl"), '{"after":true}\n');
  fs.writeFileSync(path.join(target, "ai", "conversations", "fixture", "index.json"), '{"v":2}\n');
  fs.writeFileSync(path.join(target, "ai", "run-store", "journal.jsonl"), ""); // existing runtime compaction
  assert.deepEqual(cutover.assertPostSwitchData({ targetDir: target }, files), { exactFiles: 1, appendFiles: 1, mutableFiles: 2, mutableFilesChanged: 2 });
  fs.writeFileSync(path.join(target, "admin-audit-log.jsonl"), '{"before":false}\n');
  assert.throws(() => cutover.assertPostSwitchData({ targetDir: target }, files), { code: "AUDIT_PREFIX_CHANGED" });
});
test("post-start still rejects static corruption and linked runtime paths", t => {
  const target = temporary(t), file = write(path.join(target, "ai", "knowledge-docs.json"), "unchanged");
  const files = [manifest(target, "ai/knowledge-docs.json")]; fs.writeFileSync(file, "bad-bytes");
  assert.throws(() => cutover.assertPostSwitchData({ targetDir: target }, files), { code: "RUNTIME_FILE_CHANGED_REVIEW_REQUIRED" });
  assert.throws(() => cutover.preserveDirectories(target, ["../escape"]), { code: "DIRECTORY_MANIFEST_INVALID" });
});
function recoveryFixture(t, phase) {
  const root = temporary(t), stateDir = path.join(root, "state"), targetDir = path.join(root, "runtime-data");
  const configFile = write(path.join(root, "config.json"), "{}"), compose = write(path.join(stateDir, "persistent.compose.json"), "{}"), bootstrap = write(path.join(stateDir, "bootstrap.pinned.js"), "fixture");
  write(path.join(targetDir, ".fosu-runtime-migration.json"), "{}"); write(path.join(targetDir, "latest-user-data.json"), "new writes must survive");
  write(path.join(stateDir, "maintenance.json"), "{}");
  write(path.join(stateDir, "baseline.json"), JSON.stringify({ originalId: OLD_ID, originalImage: IMAGE, project: "server", workingDir: root, envFiles: [], bootstrapSha256: cutover.fileHash(bootstrap), persistentComposeSha256: cutover.fileHash(compose) }));
  write(path.join(stateDir, "state.json"), JSON.stringify({ phase, originalId: OLD_ID, originalImage: IMAGE, persistenceValidated: true, dataMayHaveNewWrites: phase === "SWITCH_INTENT", configSha256: cutover.fileHash(configFile) }));
  const calls = [], deps = { inspect(id) { if (phase === "MIGRATING") return { Id: OLD_ID, State: { Running: true, Paused: true } }; if (id === OLD_ID) throw new Error("old removed"); return { Id: NEW_ID, State: { Running: true, Paused: false, StartedAt: "2026-10-13T00:00:00Z" } }; }, image() { return {}; }, docker(args) { calls.push(args); }, async waitHealthy() { calls.push(["healthy"]); }, helper(_, mode) { calls.push([mode]); }, async probes() { calls.push(["probes"]); } };
  return { c: { stateDir, targetDir, configFile }, deps, calls };
}
test("crash before switch unpauses original and restores admission without replaying old migration", async t => {
  const f = recoveryFixture(t, "MIGRATING"), result = await cutover.recoverInner(f.c, f.deps);
  assert.equal(result.status, "RECOVERED_ORIGINAL"); assert.equal(result.targetGenerationStale, true);
  assert.deepEqual(f.calls, [["unpause", OLD_ID], ["healthy"], ["restore"], ["probes"]]);
  assert.equal(fs.readFileSync(path.join(f.c.targetDir, "latest-user-data.json"), "utf8"), "new writes must survive");
});
test("lost Compose response recovers original code with latest persistent data; health failure preserves scene", async t => {
  const f = recoveryFixture(t, "SWITCH_INTENT");
  f.deps.waitHealthy = async () => { throw Object.assign(new Error("fixture failure"), { code: "PRODUCTION_HEALTH_TIMEOUT" }); };
  await assert.rejects(cutover.recoverInner(f.c, f.deps), { code: "PRODUCTION_HEALTH_TIMEOUT" });
  let state = JSON.parse(fs.readFileSync(path.join(f.c.stateDir, "state.json")));
  assert.equal(state.phase, "RECOVERY_BLOCKED"); assert.equal(state.preserveScene, true);
  assert.equal(f.calls.length, 1); assert.ok(f.calls[0].includes("--pull")); assert.ok(f.calls[0].includes("never")); assert.ok(!f.calls.flat().includes("cp"));
  assert.equal(fs.readFileSync(path.join(f.c.targetDir, "latest-user-data.json"), "utf8"), "new writes must survive");
  f.deps.waitHealthy = async () => {};
  const result = await cutover.recoverInner(f.c, f.deps); assert.equal(result.status, "RECOVERED_PERSISTENT");
  state = JSON.parse(fs.readFileSync(path.join(f.c.stateDir, "state.json"))); assert.equal(state.dataRestoredFromBackup, false);
  assert.equal(fs.readFileSync(path.join(f.c.targetDir, "latest-user-data.json"), "utf8"), "new writes must survive");
});
test("detached worker, independent watchdog and boot recovery have sufficient recovery lifetime", () => {
  const units = cutover.unitText("/usr/bin/node", "/root/closure/execute.js", "/root/closure/config.json", "/root/closure/state", 900);
  assert.match(units.worker, /ExecStopPost=.* recover .* --force/); assert.match(units.worker, /TimeoutStopSec=1230/); assert.match(units.worker, /RuntimeMaxSec=900/);
  assert.match(units.recovery, /After=docker.service/); assert.match(units.recovery, /WantedBy=multi-user.target/); assert.match(units.recovery, /TimeoutStartSec=1230/);
  assert.match(units.timer, /OnBootSec=15s/); assert.match(units.timer, /OnUnitActiveSec=15s/);
  assert.throws(() => cutover.unitText("/usr/bin/node", "/root/closure/evil path.js", "/root/closure/config.json", "/root/closure/state", 900), { code: "UNIT_PATH_REJECTED" });
});
