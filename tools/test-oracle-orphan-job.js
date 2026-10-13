"use strict";
require("./fixture-network-only");
const test = require("node:test"), assert = require("node:assert/strict"), fs = require("node:fs"), path = require("node:path"), crypto = require("node:crypto");
const recovery = require("./oracle-sample/recover-orphan-job"), cutover = require("../deploy/oracle-runtime-cutover/execute");
const { startAdminHttpHarness } = require("./test-helpers/admin-http-harness");
const root = path.resolve(__dirname, "../server/src/services");
const hash = bytes => crypto.createHash("sha256").update(bytes).digest("hex");
async function fixture() {
  const h = await startAdminHttpHarness({ environment: { PORT: "3000", FOSU_ALLOWED_ADMIN_ORIGINS: "https://class.katelya.eu.org" } });
  const jobs = require("../server/src/services/jobService"), audit = require("../server/src/services/adminAuditService");
  const now = Date.now(), jobId = "release-pack-rebuild-fixture-orphan", old = new Date(now - 80 * 86400000).toISOString();
  const job = { id: jobId, type: "release-pack-rebuild", lockGroup: "release-heavy", status: "running", progress: 10, input: { version: "fixture-retained" }, result: null, error: null, logs: [{ at: old, message: "original log retained" }], worker: { kind: "release-worker" }, workerPid: 619, createdAt: old, startedAt: old, updatedAt: old, finishedAt: null };
  fs.mkdirSync(jobs.JOBS_DIR, { recursive: true });
  const file = path.join(jobs.JOBS_DIR, jobId + ".json"); fs.writeFileSync(file, JSON.stringify(job, null, 2));
  const proc = path.join(h.paths.root, "proc"); fs.mkdirSync(proc);
  const login = await h.login(), input = { action: "apply", jobId, containerStartedAt: new Date(now - 4 * 86400000).toISOString(), originalSha256: hash(fs.readFileSync(file)), backupSha256: hash(fs.readFileSync(file)), observation: { updatedAt: old }, approval: "d".repeat(64), approveOrphan: "MARK_ORPHAN_FAILED:" + "d".repeat(64), preparedAt: new Date(now).toISOString(), operationId: "orphan-fixture-" + crypto.randomBytes(8).toString("hex"), session: { cookie: login.cookie, csrf: login.csrfToken } };
  return { h, file, job, input, jobs, audit, proc, deps: { moduleRoot: root, procRoot: proc }, original: fs.readFileSync(file) };
}
test("read-only prepare recognizes exact worker argv and does not match reviewer source literals", async () => {
  const f = await fixture();
  try {
    fs.mkdirSync(path.join(f.proc, "17")); fs.writeFileSync(path.join(f.proc, "17", "cmdline"), ["node", "-e", "const path='/app/server/src/workers/releaseWorker.js'; const id='" + f.input.jobId + "';"].join("\0"));
    const observed = recovery.containerMain({ ...f.input, action: "observe" }, f.deps);
    assert.equal(observed.workerCount, 0); assert.equal(observed.nativeLockEmpty, true); assert.equal(observed.recordBase64, f.original.toString("base64"));
    assert.deepEqual(fs.readFileSync(f.file), f.original);
    fs.mkdirSync(path.join(f.proc, "619")); fs.writeFileSync(path.join(f.proc, "619", "cmdline"), ["node", "--max-old-space-size=3072", "/app/server/src/workers/releaseWorker.js", f.input.jobId, "release-pack-rebuild"].join("\0"));
    assert.throws(() => recovery.containerMain({ ...f.input, action: "observe" }, f.deps), { code: "ORPHAN_WORKER_OR_LOCK_ACTIVE" });
  } finally { await f.h.close(); }
});
test("fresh lifecycle, changed hash or missing independent approval cannot mark failed", async () => {
  const f = await fixture();
  try {
    assert.throws(() => recovery.parse(["apply", "--state-dir=" + f.h.paths.root, "--job-id=" + f.input.jobId, "--credentials-file=" + path.join(f.h.paths.root, "private.env")]), { code: "ORPHAN_INDEPENDENT_APPROVAL_REQUIRED" });
    assert.throws(() => recovery.containerMain({ ...f.input, containerStartedAt: f.job.updatedAt }, f.deps), { code: "ORPHAN_LIFECYCLE_NOT_PROVEN" });
    assert.throws(() => recovery.containerMain({ ...f.input, originalSha256: "f".repeat(64) }, f.deps), { code: "ORPHAN_RECORD_CHANGED" });
    assert.throws(() => recovery.containerMain({ ...f.input, approveOrphan: "wrong" }, f.deps), { code: "ORPHAN_INDEPENDENT_APPROVAL_REQUIRED" });
    assert.deepEqual(fs.readFileSync(f.file), f.original);
  } finally { await f.h.close(); }
});
test("real native cookie CSRF guard rejects bad session before metadata or recovery audit", async () => {
  const f = await fixture();
  try {
    assert.throws(() => recovery.containerMain({ ...f.input, session: { ...f.input.session, csrf: "invalid" } }, f.deps), { code: "ADMIN_CSRF_REJECTED" });
    assert.throws(() => recovery.containerMain({ ...f.input, session: { cookie: "invalid", csrf: "invalid" } }, f.deps), { code: "ORPHAN_NATIVE_AUTH_REJECTED" });
    assert.deepEqual(fs.readFileSync(f.file), f.original); assert.equal(f.audit.findOperation(f.input.operationId + ":intent"), null);
  } finally { await f.h.close(); }
});
test("native finishJobFailed retains payload/logs and paired idempotent audit verifies", async () => {
  const f = await fixture();
  try {
    const result = recovery.containerMain(f.input, f.deps); assert.equal(result.audited, true); assert.equal(result.releaseExecution, false);
    const saved = JSON.parse(fs.readFileSync(f.file)); assert.equal(saved.status, "failed"); assert.deepEqual(saved.input, f.job.input); assert.deepEqual(saved.logs[0], f.job.logs[0]); assert.equal(saved.recovery.originalSha256, hash(f.original));
    const fresh = await f.h.login();
    const duplicate = recovery.containerMain({ ...f.input, session: { cookie: fresh.cookie, csrf: fresh.csrfToken } }, f.deps);
    assert.equal(duplicate.duplicate, true); assert.equal(duplicate.afterSha256, result.afterSha256);
    const entries = f.audit.readAll().filter(e => e.requestId === f.input.operationId); assert.equal(entries.length, 2); assert.ok(entries.every(e => e.authMethod === "admin-cookie"));
    const serialized = JSON.stringify(entries); assert.ok(!serialized.includes(f.input.session.cookie)); assert.ok(!serialized.includes(f.input.session.csrf));
  } finally { await f.h.close(); }
});
test("intent audit failure stops mutation; interrupted complete audit safely resumes with new real session", async () => {
  const f = await fixture();
  try {
    const failAudit = { ...f.audit, appendOperation() { throw Object.assign(new Error("fixture full disk"), { code: "AUDIT_APPEND_FAILED" }); } };
    assert.throws(() => recovery.containerMain(f.input, { ...f.deps, audit: failAudit }), { code: "AUDIT_APPEND_FAILED" }); assert.deepEqual(fs.readFileSync(f.file), f.original);
    const completeFails = { ...f.audit, appendOperation(event, id) { if (id.endsWith(":complete")) throw Object.assign(new Error("fixture interrupted"), { code: "AUDIT_APPEND_FAILED" }); return f.audit.appendOperation(event, id); } };
    assert.throws(() => recovery.containerMain(f.input, { ...f.deps, audit: completeFails }), { code: "AUDIT_APPEND_FAILED" });
    const failedBytes = fs.readFileSync(f.file); assert.equal(JSON.parse(failedBytes).status, "failed");
    const fresh = await f.h.login(), resumed = recovery.containerMain({ ...f.input, session: { cookie: fresh.cookie, csrf: fresh.csrfToken } }, f.deps);
    assert.equal(resumed.audited, true); assert.equal(resumed.duplicate, true); assert.deepEqual(fs.readFileSync(f.file), failedBytes);
  } finally { await f.h.close(); }
});
test("prepare blocker remains visible while other errors stay fatal", () => {
  assert.deepEqual(cutover.prepareInventory("fixture", () => { throw Object.assign(new Error("fixture active"), { code: "SERVER_JOB_IN_FLIGHT" }); }), { verified: false, code: "ORPHAN_RECONCILIATION_REQUIRED", strictStartGate: "SERVER_JOB_IN_FLIGHT" });
  assert.throws(() => cutover.prepareInventory("fixture", () => { throw Object.assign(new Error("fixture corrupt"), { code: "COLLECTOR_STATE_INCOMPATIBLE" }); }), { code: "COLLECTOR_STATE_INCOMPATIBLE" });
});
