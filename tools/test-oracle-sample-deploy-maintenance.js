"use strict";
require("./fixture-network-only");
const test = require("node:test"), assert = require("node:assert/strict"), fs = require("node:fs"), os = require("node:os"), path = require("node:path");
const m = require("../deploy/oracle-sample/maintenance"), cutover = require("../deploy/oracle-runtime-cutover/execute");
const preflight = require("../deploy/oracle-sample/preflight");
function fixture(phase = "DEPLOYING") {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "fosu-sample-maintenance-"));
  const c = { stateDir: dir, appDir: path.join(dir, "app"), runtimeDir: path.join(dir, "runtime"), manifest: path.join(dir, "receipt.json"), p0StateFile: path.join(dir, "p0.json") };
  const baseline = { persistence: true, envSha256: "fixture-env", protectedFiles: { active: "active", class: "class", teacher: "teacher", classroom: "classroom", course: "course", "ops/campus-sync/control.json": "before-pause" }, compose: { project: "server", workingDir: path.join(c.appDir, "server"), envFiles: [path.join(c.appDir, "server/.env")], configFiles: [path.join(c.appDir, "server/compose.json")] } };
  fs.writeFileSync(path.join(dir, "rollback.compose.json"), "fixture frozen old Compose with current data bind");
  const state = { schema: "oracle-sample-maintenance.v1", phase, persistence: true, composeMayHaveChanged: !["DRAINING", "START_REQUESTED"].includes(phase), rollbackSha256: cutover.fileHash(path.join(dir, "rollback.compose.json")) };
  cutover.durable(path.join(dir, "baseline.private.json"), baseline); state.baselineSha256 = cutover.fileHash(path.join(dir, "baseline.private.json")); cutover.durable(path.join(dir, "state.json"), state); cutover.durable(c.p0StateFile, { phase: "PASS", persistenceValidated: true });
  const commands = [], healthy = [], restored = [];
  const deps = { command(bin, args) { commands.push([bin, ...args]); return ""; }, inspect() { return { Image: m.PIN.image, State: { Running: true } }; }, async waitHealthy(c, expected) { healthy.push(expected); }, async probes(c, expected) { return { commit: expected, apiHealthy: true }; }, async preflight() { return { envSha256: baseline.envSha256, protectedFiles: { ...baseline.protectedFiles, "ops/campus-sync/control.json": "paused-audited" } }; }, async restore() { restored.push(true); } };
  return { c, baseline, commands, healthy, restored, deps, state: () => JSON.parse(fs.readFileSync(path.join(dir, "state.json"))), close: () => fs.rmSync(dir, { recursive: true, force: true }) };
}
test("exact human approval is checked before any host inspection or mutation", () => {
  const f = fixture(); try { assert.throws(() => m.start(f.c, "not-approved"), { code: "EXACT_MAINTENANCE_APPROVAL_REQUIRED" }); assert.deepEqual(f.commands, []); } finally { f.close(); }
});
test("boot and independent watchdog are armed separately from worker and kill all its children", () => {
  const u = m.unitText("/usr/bin/node", "/root/p1/maintenance.js", "/root/p1/config.json", "/root/p1/state", 900);
  assert.match(u.worker, /ExecStopPost=.*recover .*--force/); assert.match(u.worker, /RuntimeMaxSec=900/); assert.match(u.worker, /KillMode=control-group/);
  const stop = Number(u.worker.match(/TimeoutStopSec=(\d+)/)[1]), recovery = Number(u.recovery.match(/TimeoutStartSec=(\d+)/)[1]);
  assert.equal(m.RECOVERY_SECONDS, 1200); assert.equal(stop, 1230); assert.equal(recovery, 1230); assert.ok(stop > m.RECOVERY_SECONDS && recovery > m.RECOVERY_SECONDS, "systemd must let the recovery subprocess finish before killing its group");
  assert.match(u.recovery, /WantedBy=multi-user.target/); assert.match(u.timer, /OnBootSec=15s/); assert.match(u.timer, /OnUnitActiveSec=15s/);
  assert.throws(() => m.unitText("/usr/bin/node", "/root/a b.js", "/root/p1/config.json", "/root/p1/state", 900), { code: "UNIT_PATH_REJECTED" });
});
test("lost Compose response restores only pinned old code with current persistent data", async () => {
  const f = fixture(); try {
    const result = await m.recoverInner(f.c, f.deps);
    assert.equal(result.status, "RECOVERED"); assert.equal(result.ORACLE_API, "HEALTHY"); assert.equal(result.originalAdmissionRestored, true);
    const compose = f.commands.find(args => args.includes("compose")); assert.ok(compose.includes("never")); assert.ok(compose.includes("--no-deps")); assert.ok(compose.includes(path.join(f.c.stateDir, "rollback.compose.json")));
    assert.deepEqual(f.healthy, [m.PIN.oldImage]); assert.equal(f.restored.length, 1);
    assert.equal(f.commands.some(args => args.includes("rm") || args.includes("tar") || args.includes("load")), false, "data must never be replaced by historical archive");
  } finally { f.close(); }
});
test("failure during Docker pause backup unpauses and recovers without data replay", async () => {
  const f = fixture(); try {
    f.deps.inspect = () => ({ Image: m.PIN.oldImage, State: { Running: true, Paused: true } });
    const result = await m.recoverInner(f.c, f.deps); assert.equal(result.status, "RECOVERED");
    assert.deepEqual(f.commands[0], ["docker", "unpause", "fosuclass-api"]); assert.equal(f.restored.length, 1);
  } finally { f.close(); }
});
test("drain timeout restores admission without restarting old API or personal Agent", async () => {
  const f = fixture("DRAINING"); try {
    f.deps.inspect = () => ({ Image: m.PIN.oldImage, State: { Running: true } });
    assert.equal((await m.recoverInner(f.c, f.deps)).status, "RECOVERED");
    assert.equal(f.commands.some(args => args.includes("compose")), false); assert.equal(f.commands.some(args => args.includes("systemctl")), false); assert.equal(f.restored.length, 1);
  } finally { f.close(); }
});
test("crash after accepted deployment preserves healthy candidate and restores original admission", async () => {
  const f = fixture("ACCEPTED"); try {
    const result = await m.recoverInner(f.c, f.deps); assert.equal(result.status, "PASS"); assert.equal(result.SAMPLE_BACKEND, "PASS");
    assert.deepEqual(f.healthy, [m.PIN.image]); assert.equal(f.commands.some(args => args.includes("compose")), false); assert.equal(f.restored.length, 1);
  } finally { f.close(); }
});
test("unknown production image cannot be overwritten during recovery", async () => {
  const f = fixture(); try {
    f.deps.inspect = () => ({ Image: "sha256:unknown", State: { Running: true } });
    assert.equal((await m.recoverInner(f.c, f.deps)).status, "RECOVERY_BLOCKED");
    assert.equal(f.commands.some(args => args.includes("compose") || args.includes("unpause")), false); assert.equal(f.state().recoveryFailure, "RECOVERY_UNKNOWN_IMAGE_REJECTED"); assert.equal(f.restored.length, 1);
  } finally { f.close(); }
});
test("missing validated P0 forbids fallback to unmounted writable-layer container", async () => {
  const f = fixture(); try {
    cutover.durable(f.c.p0StateFile, { phase: "RECOVERY_BLOCKED", persistenceValidated: true });
    assert.equal((await m.recoverInner(f.c, f.deps)).status, "RECOVERY_BLOCKED");
    assert.equal(f.commands.some(args => args.includes("compose")), false); assert.equal(f.state().recoveryFailure, "RECOVERY_P0_EVIDENCE_REQUIRED"); assert.equal(f.restored.length, 1);
  } finally { f.close(); }
});
test("tampered rollback Compose is not executed and scene is retained", async () => {
  const f = fixture(); try {
    fs.appendFileSync(path.join(f.c.stateDir, "rollback.compose.json"), " changed");
    assert.equal((await m.recoverInner(f.c, f.deps)).status, "RECOVERY_BLOCKED"); assert.equal(f.state().preserveScene, true);
    assert.equal(f.commands.some(args => args.includes("compose")), false); assert.equal(f.restored.length, 1);
  } finally { f.close(); }
});
test("rollback failure retains data and attempts original admission recovery", async () => {
  const f = fixture(); try {
    f.deps.command = (bin, args) => { f.commands.push([bin, ...args]); if (args.includes("compose")) throw Object.assign(new Error("fixture"), { code: "FIXTURE_COMPOSE_FAILED" }); };
    assert.equal((await m.recoverInner(f.c, f.deps)).status, "RECOVERY_BLOCKED"); assert.equal(f.state().dataRestored, false); assert.equal(f.state().originalAdmissionRestored, true);
    assert.ok(fs.existsSync(path.join(f.c.stateDir, "rollback.compose.json"))); assert.equal(f.restored.length, 1);
  } finally { f.close(); }
});
test("already terminal PASS recovery is idempotent and performs no host work", async () => {
  const f = fixture("PASS"); try { assert.equal((await m.recoverInner(f.c, f.deps)).status, "PASS"); assert.deepEqual(f.commands, []); assert.equal(f.restored.length, 0); } finally { f.close(); }
});
test("transient recovery failure is retryable and later restores production", async () => {
  const f = fixture(); try {
    const normal = f.deps.waitHealthy;
    f.deps.waitHealthy = async () => { throw Object.assign(new Error("fixture"), { code: "RECOVERY_HEALTH_TIMEOUT" }); };
    assert.equal((await m.recoverInner(f.c, f.deps)).status, "RECOVERY_BLOCKED"); assert.ok(f.state().recoveryRetryAfter > Date.now());
    f.deps.waitHealthy = normal;
    assert.equal((await m.recoverInner(f.c, f.deps)).status, "RECOVERED"); assert.equal(f.state().originalAdmissionRestored, true);
  } finally { f.close(); }
});
test("tampered baseline cannot alter recovery's Compose identity", async () => {
  const f = fixture(); try {
    fs.appendFileSync(path.join(f.c.stateDir, "baseline.private.json"), " ");
    assert.equal((await m.recoverInner(f.c, f.deps)).status, "RECOVERY_BLOCKED");
    assert.equal(f.state().recoveryFailure, "RECOVERY_BASELINE_CHANGED"); assert.equal(f.commands.some(args => args.includes("compose")), false);
  } finally { f.close(); }
});
test("running historical record remains an explicit preparation gate and strict inventory still blocks", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "fosu-inventory-gate-"));
  try {
    fs.mkdirSync(path.join(dir, "jobs")); fs.writeFileSync(path.join(dir, "jobs", "historical.json"), JSON.stringify({ status: "running" }));
    assert.deepEqual(m.preparationInventory(dir), ["SERVER_JOB_IN_FLIGHT"]);
    assert.throws(() => preflight.inventory(dir), { code: "SERVER_JOB_IN_FLIGHT" });
    fs.writeFileSync(path.join(dir, "jobs", "historical.json"), JSON.stringify({ status: "failed" }));
    assert.deepEqual(m.preparationInventory(dir), []);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
test("other malformed inventory data is never downgraded into a preparation item", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "fosu-inventory-gate-"));
  try {
    fs.mkdirSync(path.join(dir, "jobs")); fs.writeFileSync(path.join(dir, "jobs", "invalid.json"), "not-json");
    assert.throws(() => m.preparationInventory(dir), { code: "STATE_UNREADABLE" });
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
test("job reconciliation preparation cannot start or trigger recovery mutations", async () => {
  const f = fixture("PREPARED_JOB_RECONCILIATION_REQUIRED"); try {
    assert.throws(() => m.start(f.c, "approval"), { code: "EXACT_MAINTENANCE_APPROVAL_REQUIRED" });
    assert.equal((await m.recoverInner(f.c, f.deps)).status, "PREPARED_JOB_RECONCILIATION_REQUIRED"); assert.deepEqual(f.commands, []);
  } finally { f.close(); }
});
