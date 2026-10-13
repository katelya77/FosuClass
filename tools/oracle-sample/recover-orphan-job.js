"use strict";
// Host-local, explicitly approved metadata recovery. No new public route,
// image replacement, release rebuild, data publish, task kill or school access.
const fs = require("node:fs"), path = require("node:path"), crypto = require("node:crypto");
const { execFileSync } = require("node:child_process");
const cutover = require("../../deploy/oracle-runtime-cutover/execute");
const maintenance = require("./maintenance-admin");
const { parseEnv } = require("../../deploy/oracle-sample/preflight");
function fail(code) { throw Object.assign(new Error(code), { code }); }
function digest(value) { return crypto.createHash("sha256").update(value).digest("hex"); }
function parse(argv) {
  const mode = argv[0], o = {};
  if (!["prepare", "apply", "status"].includes(mode)) fail("ORPHAN_MODE_REJECTED");
  for (const arg of argv.slice(1)) { const m = arg.match(/^--(state-dir|job-id|credentials-file|approveOrphan)=(.+)$/); if (!m || o[m[1]] !== undefined || /[\r\n\0]/.test(m[2])) fail("ORPHAN_ARGUMENT_REJECTED"); o[m[1]] = m[2]; }
  if (!path.isAbsolute(o["state-dir"] || "") || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,180}$/.test(o["job-id"] || "")) fail("ORPHAN_ARGUMENT_REJECTED");
  if (mode === "apply" && (!path.isAbsolute(o["credentials-file"] || "") || !/^MARK_ORPHAN_FAILED:[a-f0-9]{64}$/.test(o.approveOrphan || ""))) fail("ORPHAN_INDEPENDENT_APPROVAL_REQUIRED");
  if (mode !== "apply" && o.approveOrphan) fail("ORPHAN_ARGUMENT_REJECTED");
  return { mode, ...o };
}
// Serialized and run via docker exec node stdin. Session material appears only
// in process stdin; it never becomes argv, a saved file, output or audit text.
function containerMain(input, deps = {}) {
  const fs = require("node:fs"), path = require("node:path"), crypto = require("node:crypto");
  function bad(code) { throw Object.assign(new Error(code), { code }); }
  function sha(bytes) { return crypto.createHash("sha256").update(bytes).digest("hex"); }
  const root = deps.moduleRoot || "/app/server/src/services";
  const pins = { "jobService.js": "19bf855b9bb86ad9e0ffe0136dbec2b336b6fe48", "adminWriteGuard.js": "116f8887bbcf87eea5693f658c0ce1834e7f6ddb", "adminAuditService.js": "ada4662122b77aee9ced79967fe7341ce87139d7" };
  if (!deps.skipPins) for (const [name, expected] of Object.entries(pins)) {
    const bytes = fs.readFileSync(path.join(root, name));
    if (crypto.createHash("sha1").update(`blob ${bytes.length}\0`).update(bytes).digest("hex") !== expected) bad("ORPHAN_NATIVE_SOURCE_CHANGED");
  }
  const jobs = deps.jobs || require(path.join(root, "jobService"));
  const file = path.join(jobs.JOBS_DIR, input.jobId + ".json");
  const jobStat = fs.lstatSync(file);
  if (!jobStat.isFile() || jobStat.isSymbolicLink() || jobStat.size > 2 * 1024 * 1024) bad("ORPHAN_JOB_PATH_REJECTED");
  function authorize() {
    const auth = deps.auth || require(path.join(root, "adminAuth")), guard = deps.guard || require(path.join(root, "adminWriteGuard"));
    const req = { method: "POST", path: "/api/admin/jobs/" + input.jobId + "/recover-orphan", originalUrl: "/api/admin/jobs/" + input.jobId + "/recover-orphan", baseUrl: "", headers: { cookie: input.session?.cookie, "x-fosu-csrf": input.session?.csrf, origin: "https://class.katelya.eu.org", "x-request-id": input.operationId }, ip: "127.0.0.1", socket: { remoteAddress: "127.0.0.1" } };
    const res = { status() { return this; }, json(value) { bad(/^[A-Z0-9_]+$/.test(value?.code || "") ? value.code : "ORPHAN_NATIVE_AUTH_REJECTED"); } };
    let passed = false; guard.verifyAdminWriteAccess(req, res, () => { passed = true; }); if (!passed) bad("ORPHAN_NATIVE_AUTH_REJECTED");
    passed = false; auth.requireScopes(["admin:full"])(req, res, () => { passed = true; }); if (!passed) bad("ADMIN_SCOPE_DENIED");
    const identity = auth.getAuditIdentity(req);
    if (identity.authMethod !== "admin-cookie") bad("ORPHAN_COOKIE_SESSION_REQUIRED");
    return identity;
  }
  const identity = input.action === "apply" ? authorize() : null;
  const audit = input.action === "apply" ? (deps.audit || require(path.join(root, "adminAuditService"))) : null;
  let before = fs.readFileSync(file), job = JSON.parse(before);
  if (job.id !== input.jobId || job.type !== "release-pack-rebuild") bad("ORPHAN_JOB_IDENTITY_REJECTED");
  const recovered = input.action === "apply" && job.status === "failed" && job.recovery?.operationId === input.operationId && job.recovery?.originalSha256 === input.originalSha256;
  const now = (deps.now || Date.now)(), updatedAt = Date.parse(recovered ? input.observation?.updatedAt : (job.updatedAt || job.startedAt || job.createdAt || "")), startedAt = Date.parse(input.containerStartedAt);
  const staleMs = Number(process.env.FOSU_JOB_LOCK_STALE_MS || 1800000);
  if (!Number.isFinite(staleMs) || staleMs <= 0 || !Number.isFinite(updatedAt) || !Number.isFinite(startedAt) || updatedAt >= startedAt || now - updatedAt <= staleMs) bad("ORPHAN_LIFECYCLE_NOT_PROVEN");
  const procRoot = deps.procRoot || "/proc", workerPath = "/app/server/src/workers/releaseWorker.js";
  const workerCount = fs.readdirSync(procRoot).filter(n => /^\d+$/.test(n) && Number(n) !== process.pid).reduce((count, pid) => {
    let argv; try { argv = fs.readFileSync(path.join(procRoot, pid, "cmdline")).toString().split("\0").filter(Boolean); } catch (error) { if (["ENOENT", "ESRCH"].includes(error.code)) return count; bad("ORPHAN_PROCESS_SCAN_UNVERIFIABLE"); }
    const index = argv.indexOf(workerPath); return count + (index >= 0 && argv[index + 1] === input.jobId ? 1 : 0);
  }, 0);
  if (workerCount !== 0 || jobs.getRunningJobByLockGroup("release-heavy")) bad("ORPHAN_WORKER_OR_LOCK_ACTIVE");
  const pidPresent = Number.isInteger(job.workerPid) && job.workerPid > 0 && fs.existsSync(path.join(procRoot, String(job.workerPid)));
  const observation = { jobId: job.id, type: job.type, status: job.status, updatedAt: job.updatedAt, originalSha256: sha(before), bytes: before.length, workerPid: job.workerPid || null, workerKind: job.worker?.kind || null, workerPidPresent: pidPresent, workerCount, nativeLockEmpty: true, staleMs, containerStartedAt: input.containerStartedAt, observedAt: new Date(now).toISOString() };
  if (input.action === "observe") {
    if (!["running", "queued"].includes(job.status)) bad("ORPHAN_ALREADY_TERMINAL");
    return { ...observation, recordBase64: before.toString("base64") };
  }
  if (input.action !== "apply" || input.approveOrphan !== "MARK_ORPHAN_FAILED:" + input.approval) bad("ORPHAN_INDEPENDENT_APPROVAL_REQUIRED");
  if (!recovered && (!["running", "queued"].includes(job.status) || sha(before) !== input.originalSha256)) bad("ORPHAN_RECORD_CHANGED");
  const existingIntent = audit.findOperation(input.operationId + ":intent");
  // A retry authenticates a fresh real cookie, but the durable operation keeps
  // its original initiating session identity so audit deduplication is stable.
  const common = { module: "job-metadata", target: input.jobId, originalSha256: input.originalSha256, backupSha256: input.backupSha256, operator: identity.operator || "admin", operatorName: identity.operator || "admin", authMethod: identity.authMethod, scopes: identity.scopes || [], sessionIdPrefix: existingIntent?.event?.sessionIdPrefix || identity.sessionIdPrefix || "", requestId: input.operationId, ip: "127.0.0.0", legacyToken: false };
  const intent = { ...common, time: input.preparedAt, action: "orphan-job-recovery-intent", summary: "Close independently approved orphan release worker metadata only; no release execution or publication." };
  if (recovered && !existingIntent) bad("ORPHAN_INTENT_AUDIT_MISSING");
  audit.appendOperation(intent, input.operationId + ":intent"); // fail closed before metadata mutation
  if (!recovered) {
    if (sha(fs.readFileSync(file)) !== input.originalSha256) bad("ORPHAN_RECORD_CHANGED");
    const error = Object.assign(new Error("旧任务所属进程已结束，维护核验后关闭孤立状态记录；未重新执行构建或修改课表。"), { code: "RELEASE_WORKER_ORPHANED" });
    jobs.finishJobFailed(input.jobId, error, { recovery: { operationId: input.operationId, originalSha256: input.originalSha256, backupSha256: input.backupSha256, approvedScope: "FAILED_METADATA_ONLY", preparedAt: input.preparedAt } });
  }
  const after = fs.readFileSync(file), result = JSON.parse(after);
  if (result.status !== "failed" || result.recovery?.operationId !== input.operationId || result.error?.code !== "RELEASE_WORKER_ORPHANED") bad("ORPHAN_FAILED_STATE_NOT_VERIFIED");
  const complete = { ...common, time: input.preparedAt, action: "orphan-job-recovery-complete", afterSha256: sha(after), summary: "Orphan job metadata marked failed; original bytes retained privately, no task replay." };
  audit.appendOperation(complete, input.operationId + ":complete");
  if (!audit.findOperation(input.operationId + ":intent") || !audit.findOperation(input.operationId + ":complete")) bad("ORPHAN_AUDIT_NOT_VERIFIED");
  return { status: "ORPHAN_RECOVERY_PASS", jobId: input.jobId, originalSha256: input.originalSha256, afterSha256: sha(after), backupSha256: input.backupSha256, audited: true, duplicate: recovered, releaseExecution: false, personalAgentChanged: false, schoolRequests: 0 };
}
function runDocker(args, options = {}) {
  try { return execFileSync("docker", args, { encoding: "utf8", timeout: 30000, maxBuffer: 8 * 1024 * 1024, stdio: ["pipe", "pipe", "pipe"], ...options }); } catch { fail("ORPHAN_DOCKER_COMMAND_FAILED"); }
}
function inspect(deps) {
  const record = JSON.parse((deps.docker || runDocker)(["inspect", "fosuclass-api"]))[0];
  if (!record.State?.Running || record.State.Paused || record.State.Health?.Status !== "healthy" || record.Config?.Labels?.["org.opencontainers.image.revision"] !== cutover.BASE) fail("ORPHAN_ORIGINAL_CONTAINER_REQUIRED");
  return { id: record.Id, image: record.Image, startedAt: record.State.StartedAt };
}
function container(input, record, deps) {
  if (deps.container) return deps.container(input, record);
  const script = "Promise.resolve((" + containerMain.toString() + ")(" + JSON.stringify(input) + ")).then(value => process.stdout.write(JSON.stringify(value))).catch(error => {process.stdout.write(JSON.stringify({errorCode:/^[A-Z0-9_]+$/.test(error.code||'')?error.code:'ORPHAN_EXECUTOR_FAILED'}));});";
  const result = JSON.parse((deps.docker || runDocker)(["exec", "-i", record.id, "node", "-"], { input: script }));
  if (result.errorCode) fail(result.errorCode); return result;
}
function summary(plan, result) { return result || { status: "ORPHAN_RECONCILIATION_REQUIRED", jobId: plan.jobId, originalContainerId: plan.originalContainerId, originalImageId: plan.originalImageId, originalSha256: plan.originalSha256, recordBytes: plan.recordBytes, workerCount: plan.observation.workerCount, workerPidPresent: plan.observation.workerPidPresent, nativeLockEmpty: plan.observation.nativeLockEmpty, approveOrphan: "MARK_ORPHAN_FAILED:" + plan.approval, productionMutation: false }; }
async function main(argv = process.argv.slice(2), deps = {}) {
  const opts = parse(argv);
  if (!deps.skipRootCheck && (process.platform !== "linux" || process.getuid?.() !== 0)) fail("LINUX_ROOT_REQUIRED");
  process.umask(0o077); const stateDir = opts["state-dir"];
  if (!deps.skipRootCheck && (!stateDir.startsWith("/root/") || !/^\/[A-Za-z0-9_./-]+$/.test(stateDir))) fail("ORPHAN_STATE_ROOT_REQUIRED");
  cutover.safePath(stateDir, { createDirectory: true, privateFile: true });
  const planFile = path.join(stateDir, "orphan-plan.private.json"), backup = path.join(stateDir, "job-original.private.json"), resultFile = path.join(stateDir, "orphan-result.private.json");
  if (opts.mode === "status") return summary(JSON.parse(fs.readFileSync(planFile)), fs.existsSync(resultFile) ? JSON.parse(fs.readFileSync(resultFile)) : null);
  const record = inspect(deps);
  if (opts.mode === "prepare") {
    if (fs.existsSync(planFile)) { const plan = JSON.parse(fs.readFileSync(planFile)); if (plan.jobId !== opts["job-id"] || plan.originalContainerId !== record.id || cutover.fileHash(backup) !== plan.originalSha256) fail("ORPHAN_EXISTING_PLAN_CHANGED"); return summary(plan, fs.existsSync(resultFile) ? JSON.parse(fs.readFileSync(resultFile)) : null); }
    const input = { action: "observe", jobId: opts["job-id"], containerStartedAt: record.startedAt };
    const first = container(input, record, deps);
    await (deps.sleep || (ms => new Promise(resolve => setTimeout(resolve, ms))))(10000);
    const second = container(input, record, deps), later = inspect(deps);
    if (record.id !== later.id || record.image !== later.image || record.startedAt !== later.startedAt || first.originalSha256 !== second.originalSha256 || first.recordBase64 !== second.recordBase64) fail("ORPHAN_OBSERVATION_CHANGED");
    const bytes = Buffer.from(second.recordBase64, "base64"); if (digest(bytes) !== second.originalSha256) fail("ORPHAN_BACKUP_HASH_INVALID");
    cutover.durable(backup, bytes.toString("utf8")); if (cutover.fileHash(backup) !== second.originalSha256) fail("ORPHAN_BACKUP_HASH_INVALID");
    cutover.durable(backup + ".sha256", second.originalSha256 + "  " + path.basename(backup) + "\n");
    delete second.recordBase64;
    const plan = { schema: "oracle-orphan-job-recovery.v1", jobId: opts["job-id"], originalContainerId: record.id, originalImageId: record.image, containerStartedAt: record.startedAt, originalSha256: second.originalSha256, recordBytes: bytes.length, observation: second, operationId: "orphan-job-" + crypto.randomBytes(16).toString("hex"), preparedAt: new Date().toISOString(), approvedScope: "FAILED_METADATA_ONLY" };
    plan.approval = digest(JSON.stringify(cutover.canonical(plan))); cutover.durable(planFile, plan);
    return summary(plan);
  }
  const plan = JSON.parse(fs.readFileSync(cutover.safePath(planFile, { regular: true, privateFile: true })));
  const expectedApproval = digest(JSON.stringify(cutover.canonical(Object.fromEntries(Object.entries(plan).filter(([key]) => key !== "approval")))));
  if (opts.approveOrphan !== "MARK_ORPHAN_FAILED:" + plan.approval || expectedApproval !== plan.approval || plan.jobId !== opts["job-id"]) fail("ORPHAN_INDEPENDENT_APPROVAL_REQUIRED");
  if (record.id !== plan.originalContainerId || record.image !== plan.originalImageId || record.startedAt !== plan.containerStartedAt) fail("ORPHAN_CONTAINER_CHANGED");
  if (cutover.fileHash(cutover.safePath(backup, { regular: true, privateFile: true })) !== plan.originalSha256) fail("ORPHAN_BACKUP_HASH_INVALID");
  const credentials = parseEnv((deps.readCredentials || maintenance.privateFile)(opts["credentials-file"]));
  const session = await maintenance.login(credentials, deps);
  const result = container({ action: "apply", ...plan, backupSha256: plan.originalSha256, session, approveOrphan: opts.approveOrphan }, record, deps);
  const later = inspect(deps); if (record.id !== later.id || record.image !== later.image) fail("ORPHAN_CONTAINER_CHANGED");
  cutover.durable(resultFile, result); return result;
}
if (require.main === module) main().then(value => process.stdout.write(JSON.stringify(value) + "\n")).catch(error => { process.stderr.write(JSON.stringify({ status: "BLOCKED", code: /^[A-Z0-9_]+$/.test(error.code || "") ? error.code : "ORPHAN_RECOVERY_FAILED", schoolRequests: 0 }) + "\n"); process.exitCode = 2; });
module.exports = { parse, containerMain, main };
