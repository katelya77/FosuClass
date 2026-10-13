#!/usr/bin/env node
"use strict";
// Detached host-local wrapper around the unchanged, pinned Sample deployment.
// Inspect/environment output is private. Recovery never restores old data.
const fs = require("node:fs"), path = require("node:path"), crypto = require("node:crypto");
const { execFileSync, spawnSync } = require("node:child_process");
const preflight = require("./preflight"), admin = require("../../tools/oracle-sample/maintenance-admin");
const cutover = require("../oracle-runtime-cutover/execute");
const { fetchLoopback } = require("../../tools/oracle-sample/loopback-http");
const PIN = Object.freeze({
  base: "a3dfd1989705f51c921f13883bcde1cce4502883",
  commit: "7ad3b2708ce553e6fff099fd881a4b9c86ebea39",
  oldImage: "sha256:d864c4d92d063a3abc907fe89d3973c33eab8611b03b1caf1d78568bb20ead93",
  configImage: "sha256:b8f6dccc936b161f5b19c8bc583959980ad2b23f54682d9b94b50de7eb3dcafe",
  image: "sha256:23203e0efefc63728baabbc99c3349c48b34761711f75f6cc2365ae55a053fce",
  sourceSha256: "b549aaaa9a759efd164c1de4d3909473c560f7c8f17f896c618a91a8e79911fb",
  imageSha256: "d2831cb98be9c6f5a07130934990db3c0e4ebaeec1755ee1f9444fa67dba2868",
  receiptSha256: "f6339c20e44f5207a42a1bade1598e41f02e95d1c1744effd3577064609ffbe6",
  appBlob: "0157720e46ed1c12dc8c0fe5d844b0e4d8a45367",
  lifecycleBlob: "076189024d9a801f365e6094207c44a71f94f1c5",
});
const NAME = "fosuclass-api", SERVICE = "fosu-api", UNIT = "fosu-oracle-sample-maintenance";
const RECOVERY_SECONDS = 1200, RECOVERY_UNIT_SECONDS = RECOVERY_SECONDS + 30;
const TERMINAL = new Set(["PREPARED", "PREPARED_PERSISTENCE_PENDING", "PREPARED_JOB_RECONCILIATION_REQUIRED", "PASS", "RECOVERED"]);
function fail(code) { throw Object.assign(new Error(code), { code }); }
const read = file => JSON.parse(fs.readFileSync(file, "utf8"));
const sha = bytes => crypto.createHash("sha256").update(bytes).digest("hex");
const fileHash = cutover.fileHash;
function statePath(c) { return path.join(c.stateDir, "state.json"); }
function save(c, delta) { const s = fs.existsSync(statePath(c)) ? read(statePath(c)) : {}; cutover.durable(statePath(c), { ...s, ...delta, updatedAt: new Date().toISOString() }); }
function command(c, bin, args, { name = "command", timeout = 30000, json = false, ...options } = {}) {
  const r = spawnSync(bin, args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], maxBuffer: 32 * 1024 * 1024, timeout, ...options });
  if (r.status !== 0 || r.error) {
    cutover.durable(path.join(c.stateDir, name + ".private.log"), String(r.stdout || "") + "\n" + String(r.stderr || ""));
    fail("HOST_COMMAND_" + name.toUpperCase().replace(/[^A-Z0-9]/g, "_") + "_FAILED");
  }
  return json ? JSON.parse(r.stdout) : r.stdout;
}
function docker(c, args, opts) { return command(c, "docker", args, opts); }
function inspect(c) { return docker(c, ["inspect", NAME], { json: true })[0]; }
function image(c, id) { return docker(c, ["image", "inspect", id], { json: true })[0]; }
function normalizeImageConfig(config) {
  const out = { ...config };
  for (const key of ["OpenStdin", "Tty", "AttachStderr", "Hostname", "StdinOnce", "AttachStdout", "Domainname", "AttachStdin", "Image", "User"]) if ([undefined, null, false, ""].includes(out[key])) delete out[key];
  for (const key of ["OnBuild", "Volumes"]) if (out[key] === undefined || out[key] === null) delete out[key];
  return out;
}
function loadConfig(file) {
  cutover.safePath(file, { regular: true, privateFile: true });
  const c = read(file), fields = ["appDir", "runtimeDir", "candidateDir", "sourceArchive", "manifest", "imageDir", "p0StateFile", "credentialsFile", "stateDir"];
  if (c.schema !== "oracle-sample-maintenance-config.v1" || Object.keys(c).some(k => ![...fields, "schema", "windowSeconds", "drainSeconds"].includes(k)) || fields.some(k => typeof c[k] !== "string")) fail("CONFIG_REJECTED");
  for (const k of fields.filter(k => k !== "stateDir")) cutover.safePath(c[k], { regular: ["sourceArchive", "manifest", "p0StateFile", "credentialsFile"].includes(k), privateFile: ["p0StateFile", "credentialsFile"].includes(k) });
  if (!/^\/root\/[A-Za-z0-9_./-]+$/.test(c.stateDir) || !/^\/[A-Za-z0-9_./-]+$/.test(file)) fail("STATE_PATH_REJECTED");
  cutover.safePath(c.stateDir, { createDirectory: true, privateFile: true });
  c.windowSeconds ??= 900; c.drainSeconds ??= 180;
  if (!Number.isInteger(c.windowSeconds) || c.windowSeconds < 120 || c.windowSeconds > 1800 || !Number.isInteger(c.drainSeconds) || c.drainSeconds < 1 || c.drainSeconds > 900) fail("WINDOW_REJECTED");
  c.configFile = file;
  return c;
}
function artifactEvidence(c) {
  const manifest = read(c.manifest), archive = path.join(c.imageDir, `fosu-oracle-sample-${PIN.commit}-arm64.image.tar.gz`);
  cutover.safePath(archive, { regular: true });
  if (fileHash(c.sourceArchive) !== PIN.sourceSha256 || fileHash(archive) !== PIN.imageSha256 || fileHash(c.manifest) !== PIN.receiptSha256) fail("PINNED_ARTIFACT_HASH_MISMATCH");
  if (manifest.schema !== "oracle-sample-candidate.v1" || manifest.gitCommit !== PIN.commit || manifest.baseSha !== PIN.base || manifest.expectedProductionSha !== PIN.base || manifest.archiveSha256 !== PIN.sourceSha256 || manifest.publishable !== false || manifest.timerEnabled !== false) fail("PINNED_RECEIPT_CONTRACT_MISMATCH");
  if (fs.readFileSync(path.join(c.imageDir, "commit.txt"), "utf8").trim() !== PIN.commit) fail("PINNED_IMAGE_COMMIT_MISMATCH");
  const img = read(path.join(c.imageDir, "image-inspect.json"))[0];
  if (img?.Id !== PIN.configImage || img.Architecture !== "arm64" || img.Config?.Labels?.["org.opencontainers.image.revision"] !== PIN.commit) fail("PINNED_IMAGE_IDENTITY_MISMATCH");
  const imageVerifier = path.join(__dirname, "verify-image.py");
  cutover.safePath(imageVerifier, { regular: true });
  const imageIdentity = command(c, "python3", [imageVerifier, "--archive", archive, "--inspect", path.join(c.imageDir, "image-inspect.json"), "--revision", PIN.commit, "--config-digest", PIN.configImage, "--manifest-digest", PIN.image], { name: "image-graph", timeout: 120000, json: true });
  if (imageIdentity.status !== "PASS" || imageIdentity.rootFsMatchesCi !== true) fail("PINNED_IMAGE_GRAPH_REJECTED");
  let loadedCandidateVerified = false;
  const existing = spawnSync("docker", ["image", "inspect", "fosu-oracle-sample:" + PIN.commit], { encoding: "utf8", timeout: 30000, maxBuffer: 2 * 1024 * 1024 });
  if (existing.status === 0) {
    const actual = JSON.parse(existing.stdout)[0];
    if (actual.Id !== PIN.image || actual.Architecture !== "arm64" || !cutover.equal(actual.RootFS, img.RootFS) || !cutover.equal(normalizeImageConfig(actual.Config), normalizeImageConfig(img.Config))) fail("LOADED_CANDIDATE_IDENTITY_MISMATCH");
    loadedCandidateVerified = true;
  }
  // Match every path/type/size/content digest and reject all extra files. Modes
  // remain root-private; archived 0644 metadata is not a content difference.
  const verifier = path.join(__dirname, "verify-source.py");
  cutover.safePath(verifier, { regular: true });
  const sourceContent = command(c, "python3", [verifier, "--archive", c.sourceArchive, "--candidate-dir", c.candidateDir], { name: "candidate-source", timeout: 120000, json: true });
  if (sourceContent.status !== "PASS" || sourceContent.exactFileSet !== true || sourceContent.writes !== 0) fail("SOURCE_CONTENT_VERIFICATION_FAILED");
  if (cutover.blobHash(path.join(c.candidateDir, "server/src/app.js")) !== PIN.appBlob || cutover.blobHash(path.join(c.candidateDir, "server/src/services/releaseLifecycleService.js")) !== PIN.lifecycleBlob) fail("NATIVE_LIFECYCLE_SOURCE_CHANGED");
  const operate = path.join(c.candidateDir, "deploy/oracle-sample/operate.sh"), pf = path.join(c.candidateDir, "deploy/oracle-sample/preflight.js");
  for (const f of [operate, pf]) cutover.safePath(f, { regular: true });
  command(c, "bash", ["-n", operate], { name: "operate-syntax" });
  return { commit: PIN.commit, sourceSha256: PIN.sourceSha256, imageSha256: PIN.imageSha256, receiptSha256: PIN.receiptSha256, imageId: PIN.image, configImageId: PIN.configImage, imageIdentity, imageVerifierSha256: fileHash(imageVerifier), loadedCandidateVerified, operateSha256: fileHash(operate), preflightSha256: fileHash(pf), verifierSha256: fileHash(verifier), sourceContent, nativeAppBlob: PIN.appBlob, nativeLifecycleBlob: PIN.lifecycleBlob };
}
async function get(route, headers = {}) {
  const r = await fetchLoopback("http://127.0.0.1:18318" + route, { headers, redirect: "error", signal: AbortSignal.timeout(10000) });
  if (!r.ok) fail("LIVE_API_STATUS_REJECTED");
  return r.json();
}
async function probes(c, expected = PIN.base, deps = {}) {
  const request = deps.request || get, env = preflight.parseEnv(fs.readFileSync(path.join(c.appDir, "server/.env")));
  if (!env.ADMIN_API_TOKEN || [env.FULL_SYNC_AGENT_TOKEN, env.FULL_SYNC_SIGNING_SECRET, env.CAMPUS_AGENT_TOKEN, env.CAMPUS_AGENT_SIGNING_SECRET].some(s => typeof s !== "string" || s.length < 32) || new Set([env.FULL_SYNC_AGENT_TOKEN, env.FULL_SYNC_SIGNING_SECRET, env.CAMPUS_AGENT_TOKEN, env.CAMPUS_AGENT_SIGNING_SECRET]).size !== 4) fail("ISOLATED_SIGNATURE_CONFIG_REQUIRED");
  const health = await request("/api/health"), ready = await request("/api/health/ready"), status = await request("/api/admin/security/status", { "X-Admin-Token": env.ADMIN_API_TOKEN });
  if (health.success !== true || ready.success !== true || ready.status !== "ready" || !ready.activeReleaseVersion || status.deployment?.commitSha !== expected) fail("LIVE_API_CONTENT_REJECTED");
  const route = "/api/campus-agent/v1/health", timestamp = String(Date.now()), nonce = crypto.randomBytes(16).toString("hex");
  const signature = require("../../server/src/security/campusAgentSignature").signRequest(env.CAMPUS_AGENT_SIGNING_SECRET, { method: "GET", path: route, timestamp, nonce, body: Buffer.alloc(0) });
  const broker = await request(route, { Authorization: "Bearer " + env.CAMPUS_AGENT_TOKEN, "X-Campus-Agent-ID": env.CAMPUS_AGENT_ID || "wyz-campus-01", "X-Campus-Timestamp": timestamp, "X-Campus-Nonce": nonce, "X-Campus-Signature": signature });
  if (broker.ok !== true) fail("PERSONAL_BROKER_HEALTH_FAILED");
  const queue = admin.safeQueue(await request("/api/admin/campus-sync/snapshot", { "X-Admin-Token": env.ADMIN_API_TOKEN }));
  return { apiHealthy: true, apiReady: true, commit: expected, activeReleaseVersion: ready.activeReleaseVersion, personalBrokerHealthy: true, ...queue };
}
function composeInfo(record) {
  const labels = record.Config?.Labels || {}, workingDir = labels["com.docker.compose.project.working_dir"];
  const result = { project: labels["com.docker.compose.project"], workingDir, configFiles: String(labels["com.docker.compose.project.config_files"] || "").split(",").filter(Boolean), envFiles: String(labels["com.docker.compose.project.environment_file"] || path.join(workingDir || "/", ".env")).split(",").filter(Boolean) };
  if (result.project !== "server" || labels["com.docker.compose.service"] !== SERVICE || !result.configFiles.length || result.configFiles.length > 8 || !result.envFiles.length || result.envFiles.length > 8) fail("COMPOSE_CONTEXT_REJECTED");
  for (const file of [...result.configFiles, ...result.envFiles]) cutover.safePath(file, { regular: true });
  return result;
}
function composeArgs(info, file) { return ["compose", "--project-directory", info.workingDir, "-p", info.project, ...info.envFiles.flatMap(f => ["--env-file", f]), ...(file ? ["-f", file] : info.configFiles.flatMap(f => ["-f", f]))]; }
function validatePersistence(c, record) {
  const mount = record.Mounts?.find(m => m.Destination === "/app/data"), target = path.join(c.appDir, "server/storage/runtime-data");
  const env = cutover.envMap(record.Config.Env);
  if (env.FOSU_DATA_DIR !== "/app/data") fail("DATA_DIRECTORY_CHANGED");
  if (!mount) return false;
  if (mount.Type !== "bind" || mount.Source !== target || mount.RW !== true || !fs.existsSync(target) || fs.realpathSync(target) !== target) fail("PERSISTENT_MOUNT_REJECTED");
  return true;
}
function assertP0(c, record) {
  const s = read(c.p0StateFile);
  if (s.schema !== "oracle-runtime-cutover.v1" || s.persistenceValidated !== true || !validatePersistence(c, record)) fail("P0_PERSISTENCE_PASS_REQUIRED");
  if (s.phase === "PASS") return;
  if (s.phase !== "RECOVERED_PERSISTENT") fail("P0_PERSISTENCE_PASS_REQUIRED");
  const dir = path.dirname(c.p0StateFile), accepted = path.join(dir, "readonly-acceptance.private.json");
  cutover.safePath(accepted, { regular: true, privateFile: true });
  const a = read(accepted), target = path.join(c.appDir, "server/storage/runtime-data");
  const requiredTrue = ["personalAgentOnline", "personalAdmissionRestored", "activeReleaseUnchanged", "rollbackReady", "readOnly"];
  if (a.schema !== "oracle-runtime-persistence-acceptance.v1" || a.operationPhase !== "RECOVERED_PERSISTENT" || a.runtimePersistence !== "PASS" || a.runtimeDataPreserved !== "YES" || a.productionApi !== "HEALTHY" || a.personalAgent !== "UNCHANGED" || requiredTrue.some(k => a[k] !== true) || a.containerMutation !== false || a.dataCopy !== false || a.originalStateSha256 !== fileHash(c.p0StateFile) || a.baselineSha256 !== fileHash(path.join(dir, "baseline.json")) || a.originalImageId !== PIN.oldImage || a.liveImageId !== record.Image || a.liveContainerId !== record.Id || a.markerSha256 !== fileHash(path.join(target, ".fosu-runtime-migration.json")) || a.bootstrapReceiptSha256 !== fileHash(path.join(target, ".fosu-runtime-bootstrap.json"))) fail("P0_READONLY_ACCEPTANCE_NOT_BOUND");
  const marker = read(path.join(target, ".fosu-runtime-migration.json")), receipt = read(path.join(target, ".fosu-runtime-bootstrap.json")), migration = read(path.join(dir, "migration.private.json"));
  if (a.migrationDataFingerprint !== marker.dataFingerprint || a.migrationDataFingerprint !== migration.dataFingerprint || a.migrationArchiveSha256 !== marker.archiveSha256 || a.migrationArchiveSha256 !== migration.archiveSha256 || receipt.state !== "migration-accepted" || receipt.migrationVerified !== true || receipt.migrationMarkerSha256 !== a.markerSha256 || receipt.migrationDataFingerprint !== a.migrationDataFingerprint || receipt.migrationArchiveSha256 !== a.migrationArchiveSha256 || typeof marker.archive !== "string" || path.basename(marker.archive) !== marker.archive || a.migrationArchiveSha256 !== fileHash(path.join(dir, "final-runtime-backup", marker.archive))) fail("P0_READONLY_ACCEPTANCE_NOT_BOUND");
}
function pinnedBaseline(record, img) {
  if (record.Image !== PIN.oldImage || img.Id !== PIN.oldImage || img.Architecture !== "arm64" || record.Config?.Labels?.["org.opencontainers.image.revision"] !== PIN.base || img.Config?.Labels?.["org.opencontainers.image.revision"] !== PIN.base || record.State?.Running !== true || record.State?.Paused !== false || record.State?.Health?.Status !== "healthy") fail("LIVE_BASE_IDENTITY_REJECTED");
}
function preparationInventory(storage) {
  try { preflight.inventory(storage); return []; }
  catch (error) {
    // Preparation preserves this original gate as an explicit approval item.
    // Every actual start/run still executes the unchanged strict inventory.
    if (error.code === "SERVER_JOB_IN_FLIGHT") return ["SERVER_JOB_IN_FLIGHT"];
    throw error;
  }
}
async function prepare(c) {
  const previous = fs.existsSync(statePath(c)) ? read(statePath(c)) : null;
  if (previous && !["PREPARED", "PREPARED_PERSISTENCE_PENDING", "PREPARED_JOB_RECONCILIATION_REQUIRED"].includes(previous.phase)) fail("MAINTENANCE_STATE_ALREADY_USED");
  const artifacts = artifactEvidence(c), record = inspect(c), img = image(c, record.Image);
  command(c, "/usr/bin/pigz", ["--version"], { name: "compression-tool" });
  artifacts.controlledOperation = require("./preflight-adapter").setup(c, artifacts);
  pinnedBaseline(record, img);
  const info = composeInfo(record), resolved = docker(c, [...composeArgs(info), "config", "--format", "json"], { json: true });
  cutover.assertRuntimeMatchesCompose(record, img, resolved);
  const persistence = validatePersistence(c, record), health = await probes(c);
  if (persistence) assertP0(c, record);
  // Existing credentials only; preparation does not log in or mutate admission.
  const credentials = preflight.parseEnv(admin.privateFile(c.credentialsFile));
  if (!credentials.ADMIN_PASSWORD && !credentials.ADMIN_TOKEN) fail("ADMIN_LOGIN_CREDENTIAL_REQUIRED");
  const releaseRoot = record.Mounts.find(m => m.Destination === "/openresty-static/releases")?.Source;
  if (!releaseRoot) fail("RELEASE_MOUNT_REQUIRED");
  const protectedFiles = preflight.protectedFiles(path.join(c.appDir, "server/storage"), c.runtimeDir, releaseRoot);
  const preparationGates = preparationInventory(path.join(c.appDir, "server/storage"));
  let fullPreflight = null;
  if (persistence && health.active === 0 && preparationGates.length === 0) fullPreflight = await preflight.main([`--app-dir=${c.appDir}`, `--runtime-dir=${c.runtimeDir}`, `--manifest=${c.manifest}`]);
  const sourceHashes = [...new Set([...info.envFiles, ...info.configFiles, path.join(c.appDir, "server/.env")])].map(file => ({ file, sha256: fileHash(file) }));
  const baseline = { schema: "oracle-sample-maintenance-baseline.v1", artifacts, originalImage: PIN.oldImage, originalContainerId: record.Id, compose: info, sourceHashes, protectedFiles, envSha256: fileHash(path.join(c.appDir, "server/.env")), configSha256: fileHash(c.configFile), persistence, health, preparationGates };
  cutover.durable(path.join(c.stateDir, "baseline.private.json"), baseline);
  cutover.durable(path.join(c.stateDir, "original-inspect.private.json"), record);
  cutover.durable(path.join(c.stateDir, "resolved.original.private.json"), resolved);
  // Pin old code, but retain the actual current /app/data mount at recovery.
  const rollback = structuredClone(resolved);
  rollback.services[SERVICE].image = PIN.oldImage; rollback.services[SERVICE].pull_policy = "never";
  rollback.services[SERVICE].environment.FOSU_DEPLOY_COMMIT_SHA = PIN.base;
  cutover.durable(path.join(c.stateDir, "rollback.compose.json"), cutover.escapeInterpolation(rollback));
  const parsedRollback = docker(c, [...composeArgs(info, path.join(c.stateDir, "rollback.compose.json")), "config", "--format", "json"], { json: true });
  const expected = structuredClone(resolved); expected.services[SERVICE].image = PIN.oldImage; expected.services[SERVICE].pull_policy = "never"; expected.services[SERVICE].environment.FOSU_DEPLOY_COMMIT_SHA = PIN.base;
  if (!cutover.equal(parsedRollback, expected)) fail("ROLLBACK_COMPOSE_DELTA_REJECTED");
  if (fullPreflight) cutover.durable(path.join(c.stateDir, "prepare-preflight.json"), fullPreflight);
  const approval = sha(JSON.stringify(cutover.canonical({ ...baseline, rollbackSha256: fileHash(path.join(c.stateDir, "rollback.compose.json")) })));
  const phase = !persistence ? "PREPARED_PERSISTENCE_PENDING" : preparationGates.length ? "PREPARED_JOB_RECONCILIATION_REQUIRED" : "PREPARED";
  save(c, { schema: "oracle-sample-maintenance.v1", phase, approval, commit: PIN.commit, originalImage: PIN.oldImage, configSha256: baseline.configSha256, baselineSha256: fileHash(path.join(c.stateDir, "baseline.private.json")), rollbackSha256: fileHash(path.join(c.stateDir, "rollback.compose.json")), persistence, preparationGates, productionApi: "HEALTHY", composeMayHaveChanged: false, schoolRequests: 0 });
  return publicStatus(c);
}
function verifyPrepared(c) {
  const s = read(statePath(c)), b = read(path.join(c.stateDir, "baseline.private.json"));
  if (s.configSha256 !== fileHash(c.configFile) || s.baselineSha256 !== fileHash(path.join(c.stateDir, "baseline.private.json")) || s.rollbackSha256 !== fileHash(path.join(c.stateDir, "rollback.compose.json"))) fail("PREPARED_INPUT_CHANGED");
  if (fileHash(path.join(__dirname, "verify-source.py")) !== b.artifacts.verifierSha256) fail("PREPARED_SOURCE_VERIFIER_CHANGED");
  if (fileHash(path.join(__dirname, "verify-image.py")) !== b.artifacts.imageVerifierSha256) fail("PREPARED_IMAGE_VERIFIER_CHANGED");
  const controlled = b.artifacts.controlledOperation;
  if (!controlled || fileHash(controlled.configFile) !== controlled.configSha256 || fileHash(controlled.operateFile) !== controlled.operateSha256 || fileHash(path.join(__dirname, "preflight-adapter.js")) !== controlled.adapterSha256 || fileHash(path.resolve(__dirname, "../oracle-runtime-cutover/lifecycle-guard.js")) !== controlled.lifecycleGuardSha256) fail("PREPARED_LIFECYCLE_ADAPTER_CHANGED");
  for (const row of b.sourceHashes) if (fileHash(row.file) !== row.sha256) fail("PRODUCTION_CONFIGURATION_CHANGED");
  if (!s.persistence || !b.persistence) fail("P0_PERSISTENCE_PASS_REQUIRED");
  return b;
}
async function helper(c, mode, opts = []) {
  return admin.main([mode, `--app-dir=${c.appDir}`, `--credentials-file=${c.credentialsFile}`, ...(mode === "accept" ? [] : [`--state-file=${path.join(c.stateDir, "admission.private.json")}`]), ...(mode === "acquire" ? ["--approve-maintenance=PAUSE_PERSONAL_ADMISSION", `--wait-seconds=${c.drainSeconds}`] : []), ...opts]);
}
async function restore(c) {
  if (fs.existsSync(path.join(c.stateDir, "admission.private.json"))) return helper(c, "restore");
  return { originalAdmissionRestored: true, admissionMutation: false };
}
function operateArgs(c) { return [path.join(c.stateDir, "controlled-tools/deploy/oracle-sample/operate.sh"), "deploy", `--app-dir=${c.appDir}`, `--runtime-dir=${c.runtimeDir}`, `--manifest=${c.manifest}`, `--image-dir=${c.imageDir}`, `--backup-dir=${path.join(c.stateDir, "deployment-backup")}`, `--approve-commit=${PIN.commit}`]; }
async function guardedPreflight(c, args) { return require("./preflight-adapter").main([`--guard-config=${path.join(c.stateDir, "staging-guard.private.json")}`, ...args]); }
async function run(c) {
  const s = read(statePath(c));
  if (s.phase !== "START_REQUESTED") fail("DETACHED_APPROVED_START_REQUIRED");
  const b = verifyPrepared(c), record = inspect(c);
  assertP0(c, record); pinnedBaseline(record, image(c, record.Image));
  if (record.Id !== b.originalContainerId) fail("BASE_CONTAINER_CHANGED");
  preflight.inventory(path.join(c.appDir, "server/storage"));
  try {
    save(c, { phase: "DRAINING" });
    await helper(c, "acquire");
    const before = await guardedPreflight(c, [`--app-dir=${c.appDir}`, `--runtime-dir=${c.runtimeDir}`, `--manifest=${c.manifest}`]);
    if (before.personalAdmissionPaused !== true) fail("PERSONAL_ADMISSION_NOT_PAUSED");
    cutover.durable(path.join(c.stateDir, "deploy-before.json"), before);
    save(c, { phase: "DEPLOYING", composeMayHaveChanged: true });
    const remaining = Math.max(1, Math.floor((s.deadline - Date.now()) / 1000) - 20);
    // GNU timeout owns a separate process group, so a failed Bash does not leave
    // Compose or tar racing the recovery process. systemd is the outer budget.
    command(c, "timeout", ["--signal=TERM", "--kill-after=5s", String(remaining) + "s", "bash", ...operateArgs(c)], { name: "operate-deploy", timeout: (remaining + 10) * 1000 });
    save(c, { phase: "VERIFYING" });
    const after = await guardedPreflight(c, [`--app-dir=${c.appDir}`, `--runtime-dir=${c.runtimeDir}`, `--manifest=${c.manifest}`, `--verify-after=${PIN.commit}`, `--before=${path.join(c.stateDir, "deploy-before.json")}`]);
    if (after.rollbackImage !== PIN.image) fail("LIVE_CANDIDATE_IMAGE_MISMATCH");
    cutover.durable(path.join(c.stateDir, "deploy-after.json"), after);
    const accepted = await helper(c, "accept", [`--expected-sha=${PIN.commit}`]);
    cutover.durable(path.join(c.stateDir, "admin-acceptance.json"), accepted);
    save(c, { phase: "ACCEPTED", productionApi: "HEALTHY", sampleBackend: "PASS", adminCollectorPage: "API_AUTHENTICATED", activeUnchanged: true });
    const resumed = await restore(c);
    cutover.durable(path.join(c.stateDir, "admission-restored.json"), resumed);
    const health = await probes(c, PIN.commit);
    save(c, { phase: "PASS", productionApi: "HEALTHY", personalAgent: "UNCHANGED", originalAdmissionRestored: true, personalAgentOnline: health.agentOnline, rollback: "READY_CURRENT_PERSISTENT_DATA" });
    return publicStatus(c);
  } catch (error) {
    save(c, { failureCode: /^[A-Z0-9_]+$/.test(error.code || "") ? error.code : "DEPLOYMENT_FAILED" });
    await recoverInner(c);
    return publicStatus(c);
  }
}
async function waitHealthy(c, expected, seconds = 180) {
  const end = Date.now() + seconds * 1000;
  for (;;) {
    try { const r = inspect(c); if (r.State?.Running && r.State.Paused === false && r.State.Health?.Status === "healthy" && r.Image === expected) return r; } catch (_) {}
    if (Date.now() >= end) fail("RECOVERY_HEALTH_TIMEOUT");
    await new Promise(resolve => setTimeout(resolve, 2000));
  }
}
function compareRecovery(c, b, after, override) {
  const file = path.join(c.stateDir, "deploy-before.json");
  if (!override && fs.existsSync(file)) {
    const adapter = require("./preflight-adapter"), config = adapter.config(path.join(c.stateDir, "staging-guard.private.json"));
    const result = adapter.compareProtected(read(file), after, config, { allowAdmissionControl: true, allowLiveReactions: true });
    cutover.durable(path.join(c.stateDir, "recovery-protected-comparison.private.json"), result);
    return result;
  }
  const expectedProtected = fs.existsSync(file) ? read(file).protectedFiles : b.protectedFiles;
  const protectedContent = files => Object.fromEntries(Object.entries(files).filter(([key]) => key !== "ops/campus-sync/control.json"));
  if (after.envSha256 !== b.envSha256 || !cutover.equal(protectedContent(after.protectedFiles), protectedContent(expectedProtected))) fail("RECOVERY_PROTECTED_STATE_CHANGED");
  return { status: "PASS", exact: true };
}
async function recoverInner(c, deps = {}) {
  const op = deps || {}, s = read(statePath(c)), b = read(path.join(c.stateDir, "baseline.private.json"));
  const invoke = op.command || ((bin, args, options) => command(c, bin, args, options));
  if (TERMINAL.has(s.phase)) return publicStatus(c);
  save(c, { phase: "RECOVERING", recoveryFromPhase: s.recoveryFromPhase || s.phase });
  let resumeTarget = /^[a-f0-9]{64}$/.test(b.originalContainerId || "") ? b.originalContainerId : null;
  try {
    if (s.baselineSha256 !== fileHash(path.join(c.stateDir, "baseline.private.json"))) fail("RECOVERY_BASELINE_CHANGED");
    let current;
    try { current = op.inspect ? op.inspect() : inspect(c); } catch (_) { current = null; }
    if (current && ![PIN.oldImage, PIN.image].includes(current.Image)) fail("RECOVERY_UNKNOWN_IMAGE_REJECTED");
    if (current) resumeTarget = current.Id || NAME;
    // Restore liveness for this operation's identified container, even when the
    // failure occurred during tar backup. Never unpause an unrelated image.
    if (resumeTarget) try { invoke("docker", ["unpause", resumeTarget], { name: "recovery-unpause" }); } catch (_) {}
    if ((s.recoveryFromPhase || s.phase) === "ACCEPTED" && current?.Image === PIN.image) {
      await (op.waitHealthy || waitHealthy)(c, PIN.image);
      await (op.probes || probes)(c, PIN.commit);
      const after = op.preflight ? await op.preflight() : await preflight.main([`--app-dir=${c.appDir}`, `--runtime-dir=${c.runtimeDir}`, `--manifest=${c.manifest}`, `--expected-sha=${PIN.commit}`]);
      compareRecovery(c, b, after, op.preflight);
      await (op.restore || restore)(c);
      save(c, { phase: "PASS", productionApi: "HEALTHY", personalAgent: "UNCHANGED", originalAdmissionRestored: true, rollback: "READY_CURRENT_PERSISTENT_DATA" });
      return publicStatus(c);
    }
    if (s.composeMayHaveChanged || !current || current.Image !== PIN.oldImage || !current.State?.Running) {
      // Frozen original configuration includes P0's bind. No snapshot extract,
      // docker rm, image pruning, data replacement or old-container export.
      if (!b.persistence || fileHash(path.join(c.stateDir, "rollback.compose.json")) !== s.rollbackSha256) fail("RECOVERY_PERSISTENCE_NOT_VERIFIED");
      const p0 = read(c.p0StateFile);
      if (p0.persistenceValidated !== true || !["PASS", "RECOVERED_PERSISTENT"].includes(p0.phase)) fail("RECOVERY_P0_EVIDENCE_REQUIRED");
      if (p0.phase === "RECOVERED_PERSISTENT") assertP0(c, read(path.join(c.stateDir, "original-inspect.private.json")));
      invoke("docker", ["image", "inspect", PIN.oldImage], { name: "recovery-image" });
      invoke("docker", [...composeArgs(b.compose, path.join(c.stateDir, "rollback.compose.json")), "up", "-d", "--no-build", "--pull", "never", "--no-deps", SERVICE], { name: "recovery-compose", timeout: 120000 });
    }
    await (op.waitHealthy || waitHealthy)(c, PIN.oldImage);
    const healthy = await (op.probes || probes)(c, PIN.base);
    const after = op.preflight ? await op.preflight() : await preflight.main([`--app-dir=${c.appDir}`, `--runtime-dir=${c.runtimeDir}`, `--manifest=${c.manifest}`]);
    compareRecovery(c, b, after, op.preflight);
    await (op.restore || restore)(c);
    cutover.durable(path.join(c.stateDir, "recovery-after.json"), { ...after, health: healthy, dataRestored: false });
    save(c, { phase: "RECOVERED", productionApi: "HEALTHY", personalAgent: "UNCHANGED", originalAdmissionRestored: true, recoveredImage: PIN.oldImage, rollback: "READY_CURRENT_PERSISTENT_DATA" });
  } catch (error) {
    // Preserve scene and attempt admission restoration even after a verification
    // failure; healthy current service takes priority over a migration PASS.
    if (resumeTarget) try { invoke("docker", ["unpause", resumeTarget], { name: "final-unpause" }); } catch (_) {}
    let admissionRestored = false; try { await (op.restore || restore)(c); admissionRestored = true; } catch (_) {}
    save(c, { phase: "RECOVERY_BLOCKED", recoveryFailure: /^[A-Z0-9_]+$/.test(error.code || "") ? error.code : "RECOVERY_FAILED", originalAdmissionRestored: admissionRestored, productionApi: "UNVERIFIED", preserveScene: true, dataRestored: false, recoveryRetryAfter: Date.now() + 60000 });
  }
  return publicStatus(c);
}
function unitText(node, script, config, stateDir, seconds) {
  for (const value of [node, script, config, stateDir]) if (!/^\/[A-Za-z0-9_./-]+$/.test(value)) fail("UNIT_PATH_REJECTED");
  return {
    worker: `[Unit]\nDescription=Fosu Oracle Sample controlled maintenance\nAfter=docker.service network-online.target\nRequires=docker.service\n[Service]\nType=exec\nUser=root\nUMask=0077\nExecStart=${node} ${script} run --config=${config}\nExecStopPost=${node} ${script} recover --config=${config} --force\nRuntimeMaxSec=${seconds}\nTimeoutStopSec=${RECOVERY_UNIT_SECONDS}\nKillMode=control-group\nStandardOutput=append:${stateDir}/worker.private.log\nStandardError=append:${stateDir}/worker.private.log\n`,
    recovery: `[Unit]\nDescription=Fosu Sample independent crash and boot recovery\nAfter=docker.service network-online.target\nWants=docker.service\n[Service]\nType=oneshot\nUser=root\nUMask=0077\nExecStart=${node} ${script} recover --config=${config}\nTimeoutStartSec=${RECOVERY_UNIT_SECONDS}\nStandardOutput=append:${stateDir}/recovery.private.log\nStandardError=append:${stateDir}/recovery.private.log\n[Install]\nWantedBy=multi-user.target\n`,
    timer: `[Unit]\nDescription=Fosu Sample independent watchdog\n[Timer]\nOnBootSec=15s\nOnUnitActiveSec=15s\nAccuracySec=1s\nUnit=${UNIT}-recovery.service\n[Install]\nWantedBy=timers.target\n`,
  };
}
function start(c, approval) {
  const s = read(statePath(c));
  if (s.phase !== "PREPARED" || approval !== s.approval) fail("EXACT_MAINTENANCE_APPROVAL_REQUIRED");
  const b = verifyPrepared(c), r = inspect(c); assertP0(c, r); pinnedBaseline(r, image(c, r.Image));
  if (r.Id !== b.originalContainerId) fail("BASE_CONTAINER_CHANGED");
  artifactEvidence(c);
  preflight.inventory(path.join(c.appDir, "server/storage"));
  command(c, "systemctl", ["is-active", "docker.service"]);
  const active = spawnSync("systemctl", ["is-active", `${UNIT}.service`], { encoding: "utf8" }).stdout?.trim();
  if (["active", "activating", "deactivating"].includes(active)) fail("WORKER_ALREADY_RUNNING");
  const u = unitText(process.execPath, fs.realpathSync(__filename), c.configFile, c.stateDir, c.windowSeconds);
  for (const [suffix, bytes] of [[".service", u.worker], ["-recovery.service", u.recovery], ["-recovery.timer", u.timer]]) cutover.durable(`/etc/systemd/system/${UNIT}${suffix}`, bytes);
  command(c, "systemctl", ["daemon-reload"]);
  command(c, "systemctl", ["enable", "--now", `${UNIT}-recovery.service`, `${UNIT}-recovery.timer`]);
  save(c, { phase: "START_REQUESTED", deadline: Date.now() + c.windowSeconds * 1000, approvedScope: "ORACLE_SAMPLE_ONLY_WITH_CURRENT_DATA_ROLLBACK" });
  command(c, "systemctl", ["start", `${UNIT}.service`]);
  return { status: "STARTED_DETACHED", unit: UNIT, commit: PIN.commit, schoolRequests: 0 };
}
function recover(c, force = false) {
  if (!fs.existsSync(statePath(c))) return { status: "NOT_PREPARED" };
  const s = read(statePath(c));
  if (TERMINAL.has(s.phase)) return publicStatus(c);
  // A transient Docker/API failure cannot permanently disable boot recovery.
  // Retry with backoff, retaining every image/hash/P0 gate on each attempt.
  if (!force && s.phase === "RECOVERY_BLOCKED" && Date.now() < s.recoveryRetryAfter) return publicStatus(c);
  const active = spawnSync("systemctl", ["is-active", `${UNIT}.service`], { encoding: "utf8" }).stdout?.trim();
  if (!force && ["active", "activating"].includes(active) && Date.now() < s.deadline) return { status: "WORKER_RUNNING" };
  if (!force && s.phase === "START_REQUESTED" && Date.now() - Date.parse(s.updatedAt) < 20000) return { status: "WORKER_STARTING" };
  if (["active", "activating"].includes(active)) command(c, "systemctl", ["kill", "--kill-whom=all", "--signal=KILL", `${UNIT}.service`], { name: "worker-stop" });
  const r = spawnSync("flock", ["--nonblock", "--conflict-exit-code", "75", path.join(c.stateDir, "recovery.lock"), process.execPath, __filename, "recover-inner", `--config=${c.configFile}`], { encoding: "utf8", timeout: RECOVERY_SECONDS * 1000, maxBuffer: 2 * 1024 * 1024 });
  if (r.status === 75) return { status: "RECOVERY_ALREADY_RUNNING" };
  if (r.status !== 0 || r.error) fail("RECOVERY_EXECUTOR_FAILED");
  try { return JSON.parse(r.stdout); } catch (_) { fail("RECOVERY_RESPONSE_INVALID"); }
}
function publicStatus(c) {
  if (!fs.existsSync(statePath(c))) return { status: "NOT_PREPARED", SAMPLE_BACKEND: "PENDING" };
  const s = read(statePath(c));
  return { schema: s.schema, status: s.phase, approval: s.approval, commit: PIN.commit, originalImage: PIN.oldImage, candidateImage: PIN.image, preparationGates: s.preparationGates || [], ORACLE_API: s.productionApi || "PENDING", RUNTIME_PERSISTENCE: s.persistence ? "PASS" : "PENDING", SAMPLE_BACKEND: s.phase === "PASS" ? "PASS" : "PENDING", ADMIN_COLLECTOR_PAGE: s.phase === "PASS" ? "AUTHENTICATED_API_PASS_UI_PENDING" : "PENDING", PERSONAL_AGENT: s.personalAgent || "PENDING", ACTIVE_RELEASE_UNCHANGED: s.activeUnchanged ? "YES" : "PENDING", ROLLBACK_READY: s.rollback || "PENDING", originalAdmissionRestored: s.originalAdmissionRestored === true, failureCode: s.failureCode || s.recoveryFailure || null, schoolRequests: 0 };
}
async function main(args = process.argv.slice(2)) {
  const mode = args[0], opts = {};
  for (const arg of args.slice(1)) { if (arg === "--force") { opts.force = true; continue; } const m = arg.match(/^--(config|approve)=(.+)$/); if (!m || opts[m[1]]) fail("ARGUMENT_REJECTED"); opts[m[1]] = m[2]; }
  if (process.platform !== "linux" || process.getuid?.() !== 0) fail("LINUX_ROOT_REQUIRED");
  if (!["prepare", "start", "run", "recover", "recover-inner", "status"].includes(mode) || !opts.config || opts.approve && mode !== "start" || opts.force && mode !== "recover") fail("ARGUMENT_REJECTED");
  process.umask(0o077); const c = loadConfig(opts.config);
  if (mode === "prepare") return prepare(c);
  if (mode === "start") return start(c, opts.approve);
  if (mode === "run") return run(c);
  if (mode === "recover") return recover(c, opts.force);
  if (mode === "recover-inner") return recoverInner(c);
  return publicStatus(c);
}
if (require.main === module) main().then(r => { console.log(JSON.stringify(r)); if (process.argv[2] === "run" && ["RECOVERED", "RECOVERY_BLOCKED"].includes(r.status)) process.exitCode = 2; }).catch(e => { console.error(JSON.stringify({ status: "BLOCKED", code: /^[A-Z0-9_]+$/.test(e.code || "") ? e.code : "SAMPLE_MAINTENANCE_FAILED", schoolRequests: 0 })); process.exitCode = 2; });
module.exports = { PIN, RECOVERY_SECONDS, RECOVERY_UNIT_SECONDS, normalizeImageConfig, loadConfig, artifactEvidence, probes, composeInfo, composeArgs, validatePersistence, assertP0, pinnedBaseline, preparationInventory, unitText, recoverInner, publicStatus, operateArgs, start, main };
