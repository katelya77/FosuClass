#!/usr/bin/env node
"use strict";
// Host-local maintenance. Public output contains codes/identities only; Docker
// inspect, resolved environments and per-file manifests stay in a root-only dir.
const fs = require("node:fs"), path = require("node:path"), crypto = require("node:crypto");
const { execFileSync, spawnSync } = require("node:child_process");
const BASE = "a3dfd1989705f51c921f13883bcde1cce4502883";
const MIGRATOR_BLOB = "f25b93d07f23e379b100c7171aca93817e6c9238";
const NAME = "fosuclass-api", SERVICE = "fosu-api", UNIT = "fosu-runtime-cutover";
const RECOVERY_SECONDS = 1200;
const TERMINAL = new Set(["PREPARED", "PASS", "RECOVERED_ORIGINAL", "RECOVERED_PERSISTENT"]);
const POST_SWITCH = new Set(["SWITCH_INTENT", "STARTED", "VERIFYING", "PASS", "RECOVERED_PERSISTENT"]);
const preflight = require("../oracle-sample/preflight");
const lifecycle = require("./lifecycle-guard");
function fail(code) { throw Object.assign(new Error(code), { code }); }
function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object") return Object.fromEntries(Object.keys(value).sort().map(k => [k, canonical(value[k])]));
  return value;
}
function equal(a, b) { return JSON.stringify(canonical(a)) === JSON.stringify(canonical(b)); }
function hash(bytes) { return crypto.createHash("sha256").update(bytes).digest("hex"); }
function fileHash(file) {
  const h = crypto.createHash("sha256"), fd = fs.openSync(file, "r"), b = Buffer.allocUnsafe(1024 * 1024);
  try { for (;;) { const n = fs.readSync(fd, b, 0, b.length, null); if (!n) break; h.update(b.subarray(0, n)); } }
  finally { fs.closeSync(fd); }
  return h.digest("hex");
}
function blobHash(file) { const bytes = fs.readFileSync(file); return crypto.createHash("sha1").update(`blob ${bytes.length}\0`).update(bytes).digest("hex"); }
function safePath(file, { regular = false, privateFile = false, createDirectory = false } = {}) {
  if (!path.isAbsolute(file || "") || /[\r\n\0]/.test(file) || path.resolve(file) !== file) fail("PATH_REJECTED");
  let current = path.parse(file).root;
  for (const segment of file.slice(current.length).split(path.sep).filter(Boolean)) {
    current = path.join(current, segment);
    if (fs.existsSync(current) && fs.lstatSync(current).isSymbolicLink()) fail("LINK_REJECTED");
  }
  if (createDirectory && !fs.existsSync(file)) fs.mkdirSync(file, { recursive: true, mode: 0o700 });
  if (!fs.existsSync(file)) fail("REQUIRED_PATH_MISSING");
  const s = fs.lstatSync(file);
  if (regular && !s.isFile() || !regular && !s.isDirectory()) fail("PATH_TYPE_REJECTED");
  if (privateFile && process.platform !== "win32" && ((s.mode & 0o077) !== 0 || s.uid !== 0)) fail("ROOT_ONLY_REQUIRED");
  return file;
}
function durable(file, value) {
  const bytes = Buffer.from(typeof value === "string" ? value : JSON.stringify(value, null, 2) + "\n");
  const temp = file + `.tmp-${process.pid}-${crypto.randomBytes(4).toString("hex")}`;
  const fd = fs.openSync(temp, "wx", 0o600);
  try { fs.writeFileSync(fd, bytes); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
  fs.renameSync(temp, file);
  if (process.platform !== "win32") { const dir = fs.openSync(path.dirname(file), "r"); try { fs.fsyncSync(dir); } finally { fs.closeSync(dir); } }
}
function read(file) { return JSON.parse(fs.readFileSync(file, "utf8")); }
function command(bin, args, options = {}) {
  try { return execFileSync(bin, args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], timeout: 30000, maxBuffer: 32 * 1024 * 1024, ...options }); }
  catch (_) { fail("HOST_COMMAND_FAILED"); }
}
function docker(args, options) { return command("docker", args, options); }
function inspect(name) { return JSON.parse(docker(["inspect", name]))[0]; }
function image(id) { return JSON.parse(docker(["image", "inspect", id]))[0]; }
function envMap(values) { return Object.fromEntries((values || []).map(v => { const i = v.indexOf("="); return [v.slice(0, i), v.slice(i + 1)]; })); }
function mountContract(mounts) { return (mounts || []).map(m => ({ type: m.Type, source: m.Type === "volume" ? m.Name : m.Source, target: m.Destination, rw: m.RW, propagation: m.Propagation || "" })).sort((a, b) => a.target.localeCompare(b.target)); }
function containerContract(record, omitData = false) {
  const config = structuredClone(record.Config), host = structuredClone(record.HostConfig);
  if (config.Hostname === record.Id.slice(0, 12)) delete config.Hostname;
  config.Env = envMap(config.Env); delete config.Image;
  config.Labels = Object.fromEntries(Object.entries(config.Labels || {}).filter(([k]) => !k.startsWith("com.docker.compose.")));
  // Mount representations differ between short/long Compose syntax. Compare
  // the effective mounts separately, including readonly and propagation.
  delete host.Binds; delete host.Mounts;
  const mounts = mountContract(record.Mounts).filter(m => !omitData || m.target !== "/app/data");
  const networks = Object.fromEntries(Object.entries(record.NetworkSettings?.Networks || {}).map(([name, n]) => [name, {
    IPAMConfig: n.IPAMConfig, Links: n.Links,
    Aliases: (n.Aliases || []).filter(v => v !== record.Id && v !== record.Id.slice(0, 12)).sort(),
    DriverOpts: n.DriverOpts,
  }]));
  return canonical({ config, host, mounts, networks });
}
function assertRuntimeMatchesCompose(record, img, resolved) {
  const labels = record.Config.Labels || {}, service = resolved.services?.[SERVICE];
  if (resolved.name !== labels["com.docker.compose.project"] || !service || service.container_name !== NAME) fail("COMPOSE_IDENTITY_MISMATCH");
  const expectedEnv = { ...envMap(img.Config?.Env), ...Object.fromEntries(Object.entries(service.environment || {}).map(([k, v]) => [k, String(v)])) };
  if (!equal(expectedEnv, envMap(record.Config.Env))) fail("COMPOSE_ENVIRONMENT_MISMATCH");
  const mounts = mountContract(record.Mounts).map(({ propagation, ...m }) => m);
  const expectedMounts = (service.volumes || []).map(m => ({ type: m.type, source: m.type === "volume" ? resolved.volumes?.[m.source]?.name : m.source, target: m.target, rw: m.read_only !== true })).sort((a, b) => a.target.localeCompare(b.target));
  if (!equal(mounts, expectedMounts)) fail("COMPOSE_MOUNTS_MISMATCH");
  const ports = {};
  for (const p of service.ports || []) (ports[`${p.target}/${p.protocol || "tcp"}`] ||= []).push({ HostIp: p.host_ip || "0.0.0.0", HostPort: String(p.published) });
  if (!equal(ports, record.HostConfig.PortBindings || {})) fail("COMPOSE_PORTS_MISMATCH");
  const networks = Object.keys(service.networks || {}).map(k => resolved.networks?.[k]?.name).sort();
  if (networks.some(v => !v) || !equal(networks, Object.keys(record.NetworkSettings.Networks || {}).sort())) fail("COMPOSE_NETWORKS_MISMATCH");
  const cfg = record.Config, host = record.HostConfig;
  if (!equal(service.command ?? img.Config.Cmd, cfg.Cmd) || !equal(service.entrypoint ?? img.Config.Entrypoint, cfg.Entrypoint)
    || (service.user || img.Config.User || "") !== (cfg.User || "") || (service.working_dir || img.Config.WorkingDir || "") !== cfg.WorkingDir
    || (service.restart || "no") !== host.RestartPolicy.Name || Number(service.mem_limit || 0) !== Number(host.Memory || 0)
    || Math.round(Number(service.cpus || 0) * 1e9) !== Number(host.NanoCpus || 0)) fail("COMPOSE_RUNTIME_MISMATCH");
}
function escapeInterpolation(value) {
  if (typeof value === "string") return value.replace(/\$/g, "$$$$");
  if (Array.isArray(value)) return value.map(escapeInterpolation);
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, escapeInterpolation(v)]));
  return value;
}
function persistenceCompose(baseline, imageId, target) {
  const next = structuredClone(baseline), s = next.services?.[SERVICE];
  if (!s || (s.volumes || []).some(m => m.target === "/app/data")) fail("DATA_MOUNT_ALREADY_PRESENT");
  s.image = imageId; s.pull_policy = "never";
  (s.volumes ||= []).push({ type: "bind", source: target, target: "/app/data", bind: { create_host_path: false } });
  return next;
}
function assertOnlyPersistenceDelta(baseline, next, imageId, target) {
  const expected = persistenceCompose(baseline, imageId, target);
  if (!equal(expected, next)) fail("COMPOSE_UNAPPROVED_DELTA");
}
function loadConfig(file) {
  safePath(file, { regular: true, privateFile: true });
  const c = read(file), required = ["appDir", "runtimeDir", "prebackupDir", "pinnedMigrator", "stateDir", "maintenanceCredentialsFile"];
  if (Object.keys(c).some(k => ![...required, "windowSeconds"].includes(k)) || required.some(k => typeof c[k] !== "string")) fail("CONFIG_REJECTED");
  for (const k of required.filter(k => k !== "stateDir")) safePath(c[k], { regular: ["pinnedMigrator", "maintenanceCredentialsFile"].includes(k), privateFile: ["pinnedMigrator", "maintenanceCredentialsFile"].includes(k) });
  if (!c.stateDir.startsWith("/root/") || !/^[A-Za-z0-9_./-]+$/.test(c.stateDir)) fail("STATE_ROOT_REJECTED");
  safePath(c.stateDir, { createDirectory: true, privateFile: true });
  c.targetDir = path.join(c.appDir, "server/storage/runtime-data");
  c.windowSeconds = c.windowSeconds ?? 900;
  if (!Number.isInteger(c.windowSeconds) || c.windowSeconds < 120 || c.windowSeconds > 1800) fail("WINDOW_BUDGET_REJECTED");
  c.configFile = file; return c;
}
function stateFile(c) { return path.join(c.stateDir, "state.json"); }
function saveState(c, changes) { const old = fs.existsSync(stateFile(c)) ? read(stateFile(c)) : {}; const value = { ...old, ...changes, updatedAt: new Date().toISOString() }; durable(stateFile(c), value); return value; }
function checksumPrebackup(dir) {
  const archive = safePath(path.join(dir, "runtime-data.tar.gz"), { regular: true, privateFile: true });
  const candidates = [archive + ".sha256", path.join(dir, "SHA256SUMS"), path.join(dir, "runtime-data.sha256")].filter(fs.existsSync);
  const entries = candidates.flatMap(file => fs.readFileSync(safePath(file, { regular: true, privateFile: true }), "utf8").split(/\r?\n/)).map(line => line.trim().match(/^([a-f0-9]{64})\s+\*?(.*)$/)).filter(m => m && path.basename(m[2]) === path.basename(archive));
  if (!entries.length || new Set(entries.map(m => m[1])).size !== 1 || fileHash(archive) !== entries[0][1]) fail("HISTORICAL_BACKUP_HASH_INVALID");
  docker(["version", "--format", "{{.Server.Version}}"]);
  command("tar", ["-tzf", archive], { stdio: ["ignore", "ignore", "pipe"], timeout: 120000 });
  return { archiveSha256: entries[0][1] };
}
function composeArgs(c, info, file) {
  return ["compose", "--project-directory", info.workingDir, "-p", info.project,
    ...info.envFiles.map((_, i) => ["--env-file", path.join(c.stateDir, `compose-env-${i}.env`)]).flat(), "-f", file];
}
function originalComposeArgs(info) { return ["compose", "--project-directory", info.workingDir, "-p", info.project, ...info.envFiles.flatMap(f => ["--env-file", f]), ...info.configFiles.flatMap(f => ["-f", f])]; }
async function get(route, headers = {}) {
  let response;
  try { response = await fetch("http://127.0.0.1:18318" + route, { headers, redirect: "error", signal: AbortSignal.timeout(10000) }); }
  catch (_) { fail("API_REQUEST_FAILED"); }
  if (!response.ok) fail("API_STATUS_REJECTED");
  try { return await response.json(); } catch (_) { fail("API_RESPONSE_INVALID"); }
}
async function probes(c, { requireIdle = false } = {}) {
  const env = preflight.parseEnv(fs.readFileSync(path.join(c.appDir, "server/.env"))), health = await get("/api/health"), ready = await get("/api/health/ready");
  if (health.success !== true || ready.success !== true || ready.status !== "ready" || !ready.activeReleaseVersion) fail("API_NOT_READY");
  const security = await get("/api/admin/security/status", { "X-Admin-Token": env.ADMIN_API_TOKEN });
  if (security.deployment?.commitSha !== BASE) fail("LIVE_REVISION_CHANGED");
  if (typeof env.CAMPUS_AGENT_TOKEN !== "string" || env.CAMPUS_AGENT_TOKEN.length < 32 || typeof env.CAMPUS_AGENT_SIGNING_SECRET !== "string" || env.CAMPUS_AGENT_SIGNING_SECRET.length < 32) fail("PERSONAL_SIGNATURE_CONFIG_MISSING");
  const route = "/api/campus-agent/v1/health", timestamp = String(Date.now()), nonce = crypto.randomBytes(16).toString("hex");
  const signature = require("../../server/src/security/campusAgentSignature").signRequest(env.CAMPUS_AGENT_SIGNING_SECRET, { method: "GET", path: route, timestamp, nonce, body: Buffer.alloc(0) });
  const broker = await get(route, { Authorization: "Bearer " + env.CAMPUS_AGENT_TOKEN, "X-Campus-Agent-ID": env.CAMPUS_AGENT_ID || "wyz-campus-01", "X-Campus-Timestamp": timestamp, "X-Campus-Nonce": nonce, "X-Campus-Signature": signature });
  if (broker.ok !== true) fail("PERSONAL_BROKER_HEALTH_FAILED");
  const snapshot = await get("/api/admin/campus-sync/snapshot", { "X-Admin-Token": env.ADMIN_API_TOKEN });
  if (requireIdle) { preflight.requirePersonalIdle(snapshot); if (snapshot.snapshot.service.maintenance.paused !== true) fail("PERSONAL_ADMISSION_NOT_PAUSED"); }
  const queue = require("../../tools/oracle-sample/maintenance-admin").safeQueue(snapshot);
  return { health: true, ready: true, revision: BASE, personalBrokerReady: true, activeReleaseVersion: ready.activeReleaseVersion, personalAdmissionPaused: queue.paused, personalAgentOnline: queue.agentOnline };
}
function helper(c, mode) {
  const file = path.resolve(__dirname, "../../tools/oracle-sample/maintenance-admin.js");
  command(process.execPath, [file, mode, `--app-dir=${c.appDir}`, `--credentials-file=${c.maintenanceCredentialsFile}`, `--state-file=${path.join(c.stateDir, "maintenance.json")}`, ...(mode === "acquire" ? ["--approve-maintenance=PAUSE_PERSONAL_ADMISSION"] : [])], { timeout: 180000, stdio: ["ignore", "ignore", "pipe"] });
}
function protectedState(c, releaseRoot) { return preflight.protectedFiles(path.join(c.appDir, "server/storage"), c.runtimeDir, releaseRoot); }
function ensureBaseline(c, info) {
  const record = inspect(NAME);
  if (record.Id !== info.originalId || record.Image !== info.originalImage || record.State.Running !== true || record.State.Paused === true || record.State.Health?.Status !== "healthy") fail("ORIGINAL_IDENTITY_CHANGED");
  for (const item of info.sourceHashes) if (fileHash(item.file) !== item.sha256) fail("SOURCE_CONFIGURATION_CHANGED");
  if (!equal(containerContract(record), info.contract)) fail("ORIGINAL_RUNTIME_CHANGED");
  if (blobHash(c.pinnedMigrator) !== MIGRATOR_BLOB) fail("PINNED_MIGRATOR_CHANGED");
  if (image(info.originalImage).Config?.Labels?.["org.opencontainers.image.revision"] !== BASE) fail("ORIGINAL_IMAGE_CHANGED");
}
function prepareInventory(storage, inventory = preflight.inventory) {
  try { return { verified: true, ...inventory(storage) }; }
  catch (error) {
    // Read-only recovery preparation is useful even with an orphan record.
    // This is a visible preparation blocker, never permission to stop traffic.
    if (error.code !== "SERVER_JOB_IN_FLIGHT") throw error;
    return { verified: false, code: "ORPHAN_RECONCILIATION_REQUIRED", strictStartGate: "SERVER_JOB_IN_FLIGHT" };
  }
}
async function prepare(c) {
  if (fs.existsSync(stateFile(c))) {
    const state = read(stateFile(c));
    if (state.phase !== "PREPARED") fail("EXISTING_OPERATION_REQUIRES_STATUS_OR_RECOVERY");
    const info = read(path.join(c.stateDir, "baseline.json")); ensureBaseline(c, info); await probes(c);
    saveState(c, { preparationInventory: prepareInventory(path.join(c.appDir, "server/storage")) }); return publicStatus(c);
  }
  if (blobHash(c.pinnedMigrator) !== MIGRATOR_BLOB) fail("PINNED_MIGRATOR_HASH_MISMATCH");
  const record = inspect(NAME), img = image(record.Image), labels = record.Config?.Labels || {};
  if (!record.State?.Running || record.State.Paused || record.State.Health?.Status !== "healthy" || img.Architecture !== "arm64" || command("uname", ["-m"]).trim() !== "aarch64"
    || labels["org.opencontainers.image.revision"] !== BASE || img.Config?.Labels?.["org.opencontainers.image.revision"] !== BASE) fail("ORIGINAL_BASELINE_REJECTED");
  if (envMap(record.Config.Env).FOSU_DATA_DIR !== "/app/data" || record.Mounts.some(m => m.Destination === "/app/data")) fail("UNEXPECTED_DATA_LAYOUT");
  if (fs.existsSync(c.targetDir)) fail("TARGET_ALREADY_EXISTS_NO_STALE_REUSE");
  const info = { originalId: record.Id, originalImage: record.Image, project: labels["com.docker.compose.project"], workingDir: labels["com.docker.compose.project.working_dir"],
    configFiles: String(labels["com.docker.compose.project.config_files"] || "").split(",").filter(Boolean), envFiles: String(labels["com.docker.compose.project.environment_file"] || path.join(labels["com.docker.compose.project.working_dir"] || "", ".env")).split(",").filter(Boolean) };
  if (info.project !== "server" || labels["com.docker.compose.service"] !== SERVICE || info.workingDir !== path.join(c.appDir, "server") || !info.configFiles.length || !info.envFiles.length || info.configFiles.length > 8 || info.envFiles.length > 8) fail("COMPOSE_CONTEXT_REJECTED");
  info.sourceHashes = [...new Set([...info.configFiles, ...info.envFiles, path.join(c.appDir, "server/.env")])].map(file => ({ file: safePath(file, { regular: true }), sha256: fileHash(file) }));
  const resolved = JSON.parse(docker([...originalComposeArgs(info), "config", "--format", "json"]));
  assertRuntimeMatchesCompose(record, img, resolved);
  const required = { "/app/storage": path.join(c.appDir, "server/storage"), "/openresty-static/runtime": c.runtimeDir };
  if (record.Mounts.length !== 3) fail("UNEXPECTED_EXISTING_MOUNTS");
  for (const [target, source] of Object.entries(required)) if (!record.Mounts.some(m => m.Type === "bind" && m.Destination === target && m.RW && fs.realpathSync(m.Source) === fs.realpathSync(source))) fail("EXISTING_BIND_MISMATCH");
  const releaseMount = record.Mounts.find(m => m.Type === "bind" && m.Destination === "/openresty-static/releases" && m.RW);
  if (!releaseMount) fail("RELEASE_BIND_MISSING");
  info.releaseRoot = releaseMount.Source; info.contract = containerContract(record); info.prebackup = checksumPrebackup(c.prebackupDir);
  info.preparationInventory = prepareInventory(path.join(c.appDir, "server/storage"));
  const free = fs.statfsSync(c.stateDir); if (Number(free.bavail) * Number(free.bsize) < Number(img.Size || 0) + 1024 ** 3) fail("PRIVATE_BACKUP_CAPACITY_INSUFFICIENT");
  info.probes = await probes(c); info.protectedFiles = protectedState(c, info.releaseRoot);
  info.stagingCapture = lifecycle.captureStaging({ storageDir: path.join(c.appDir, "server/storage"), stateDir: c.stateDir, label: "prepare", expectedHash: info.protectedFiles["staging-latest.json"] });
  for (let i = 0; i < info.configFiles.length; i++) durable(path.join(c.stateDir, `compose-source-${i}.yml`), fs.readFileSync(info.configFiles[i], "utf8"));
  for (let i = 0; i < info.envFiles.length; i++) durable(path.join(c.stateDir, `compose-env-${i}.env`), fs.readFileSync(info.envFiles[i], "utf8"));
  durable(path.join(c.stateDir, "original-inspect.json"), record); durable(path.join(c.stateDir, "original-image.json"), img);
  const next = persistenceCompose(resolved, info.originalImage, c.targetDir);
  durable(path.join(c.stateDir, "resolved.original.json"), resolved);
  durable(path.join(c.stateDir, "persistent.compose.json"), escapeInterpolation(next));
  const parsedNext = JSON.parse(docker([...composeArgs(c, info, path.join(c.stateDir, "persistent.compose.json")), "config", "--format", "json"]));
  assertOnlyPersistenceDelta(resolved, parsedNext, info.originalImage, c.targetDir);
  docker(["cp", `${info.originalId}:/app/server/src/services/runtimeDataBootstrapService.js`, path.join(c.stateDir, "bootstrap.pinned.js")]);
  fs.chmodSync(path.join(c.stateDir, "bootstrap.pinned.js"), 0o600);
  // This is an image recovery artifact, NOT a runtime-data backup. The latter
  // is obtained once from the stopped container inside the maintenance window.
  docker(["image", "save", "--output", path.join(c.stateDir, "original-image.tar"), info.originalImage], { timeout: 600000, stdio: ["ignore", "ignore", "pipe"] });
  fs.chmodSync(path.join(c.stateDir, "original-image.tar"), 0o600);
  info.imageArchiveSha256 = fileHash(path.join(c.stateDir, "original-image.tar"));
  info.bootstrapSha256 = fileHash(path.join(c.stateDir, "bootstrap.pinned.js"));
  info.persistentComposeSha256 = fileHash(path.join(c.stateDir, "persistent.compose.json"));
  info.approval = hash(JSON.stringify(canonical(info)));
  durable(path.join(c.stateDir, "baseline.json"), info);
  saveState(c, { schema: "oracle-runtime-cutover.v1", phase: "PREPARED", approval: info.approval, originalId: info.originalId, originalImage: info.originalImage, configSha256: fileHash(c.configFile), preparationInventory: info.preparationInventory, persistenceValidated: false, dataMayHaveNewWrites: false });
  return publicStatus(c);
}
function validatePrepared(c, info) {
  const state = read(stateFile(c));
  if (state.configSha256 !== fileHash(c.configFile) || info.persistentComposeSha256 !== fileHash(path.join(c.stateDir, "persistent.compose.json")) || info.bootstrapSha256 !== fileHash(path.join(c.stateDir, "bootstrap.pinned.js"))) fail("PREPARED_INPUT_CHANGED");
}
async function waitHealthy(c, expectedImage, seconds = 180) {
  const end = Date.now() + seconds * 1000;
  while (Date.now() < end) {
    try { const current = inspect(NAME); if (current.Image === expectedImage && current.State.Running && !current.State.Paused && current.State.Health?.Status === "healthy") { await probes(c); return current; } } catch (_) {}
    await new Promise(resolve => setTimeout(resolve, 2000));
  }
  fail("PRODUCTION_HEALTH_TIMEOUT");
}
function migrationEvidence(c, result, native) {
  if (result.reconciled || result.archiveVerified !== true || result.sourceConsistency?.sourceState !== "stopped" || !result.sourceConsistency?.quiesced || result.sourceConsistency.sourceIdentity.containerId !== read(path.join(c.stateDir, "baseline.json")).originalId) fail("FINAL_COPY_NOT_AUTHORITATIVE");
  if (fileHash(result.archivePath) !== result.archiveSha256 || !native.verifyFileManifest(c.targetDir, result.files).ok) fail("FINAL_COPY_FINGERPRINT_FAILED");
  const bootstrap = require(path.join(c.stateDir, "bootstrap.pinned.js"));
  const emptySeed = path.join(c.stateDir, "empty-seed"); fs.mkdirSync(emptySeed, { mode: 0o700 });
  const acceptance = bootstrap.bootstrapRuntimeData({ seedDir: emptySeed, dataDir: c.targetDir, requireMigration: true });
  if (acceptance.migrationVerified !== true || acceptance.copied.length !== 0 || acceptance.migrationDataFingerprint !== result.dataFingerprint) fail("BOOTSTRAP_ACCEPTANCE_FAILED");
  const receipt = read(path.join(c.targetDir, ".fosu-runtime-bootstrap.json"));
  if (receipt.state !== "migration-accepted" || receipt.migrationMarkerSha256 !== fileHash(path.join(c.targetDir, ".fosu-runtime-migration.json")) || receipt.migrationArchiveSha256 !== result.archiveSha256) fail("BOOTSTRAP_RECEIPT_INVALID");
  return { files: result.files.length, bytes: result.files.reduce((s, f) => s + f.size, 0), fingerprint: result.dataFingerprint, archiveSha256: result.archiveSha256 };
}
function directoryInventory(root) {
  const dirs = [];
  function visit(dir) {
    for (const item of fs.readdirSync(dir, { withFileTypes: true })) {
      if (item.isSymbolicLink()) fail("DATA_LINK_REJECTED");
      if (item.isDirectory()) { const child = path.join(dir, item.name); dirs.push(path.relative(root, child).split(path.sep).join("/")); visit(child); }
    }
  }
  visit(root); return dirs.sort();
}
function preserveDirectories(target, dirs) {
  for (const relative of dirs) {
    if (!relative || relative.startsWith("../") || relative.includes("\\") || path.posix.normalize(relative) !== relative || path.posix.isAbsolute(relative)) fail("DIRECTORY_MANIFEST_INVALID");
    safePath(path.join(target, ...relative.split("/")), { createDirectory: true });
  }
  if (!equal(directoryInventory(target), dirs)) fail("DIRECTORY_PRESERVATION_FAILED");
}
function liveFilePolicy(relative) {
  // These paths are backed by the existing runtime services, not a general
  // exception for all AI data. Static knowledge/config snapshots stay exact.
  if (["admin-audit-log.jsonl", "maintenance-audit.jsonl", "ai/kb-audit.jsonl", "ai/config-kernel/audit/audit.jsonl"].includes(relative)) return "append";
  if (["ai/durable-tasks.json", "ai/proactive-cooldown/cooldowns.json", "ai/run-store/journal.jsonl", "ai/run-store/snapshot.json"].includes(relative)
    || /^(ai\/(conversations|user-preferences|course-reminders|wechat-recipients)\/).+\.json$/.test(relative)) return "live";
  return "exact";
}
function assertPostSwitchData(c, files) {
  // Migration acceptance already proves EVERY source byte before new code can
  // write. Post-start checks must not pretend mutable live state is frozen.
  const evidence = { exactFiles: 0, appendFiles: 0, mutableFiles: 0, mutableFilesChanged: 0 };
  for (const entry of files) {
    const file = path.join(c.targetDir, ...entry.path.split("/")); safePath(file, { regular: true });
    const policy = liveFilePolicy(entry.path);
    if (policy === "append") {
      const fd = fs.openSync(file, "r"), h = crypto.createHash("sha256"), b = Buffer.allocUnsafe(1024 * 1024); let remaining = entry.size;
      try { while (remaining) { const n = fs.readSync(fd, b, 0, Math.min(remaining, b.length), null); if (!n) fail("AUDIT_PREFIX_TRUNCATED"); h.update(b.subarray(0, n)); remaining -= n; } } finally { fs.closeSync(fd); }
      if (h.digest("hex") !== entry.sha256) fail("AUDIT_PREFIX_CHANGED");
      evidence.appendFiles++;
    } else if (policy === "live") {
      evidence.mutableFiles++;
      if (fs.statSync(file).size !== entry.size || fileHash(file) !== entry.sha256) evidence.mutableFilesChanged++;
    } else {
      if (fs.statSync(file).size !== entry.size || fileHash(file) !== entry.sha256) fail("RUNTIME_FILE_CHANGED_REVIEW_REQUIRED");
      evidence.exactFiles++;
    }
  }
  return evidence;
}
async function run(c) {
  const info = read(path.join(c.stateDir, "baseline.json")), state = read(stateFile(c));
  if (state.phase !== "START_REQUESTED") fail("DETACHED_START_REQUIRED");
  validatePrepared(c, info); ensureBaseline(c, info);
  saveState(c, { phase: "ADMISSION_INTENT", workerPid: process.pid, deadline: Date.now() + c.windowSeconds * 1000 });
  try {
    helper(c, "acquire"); saveState(c, { phase: "ADMISSION_PAUSED" });
    await probes(c, { requireIdle: true }); preflight.inventory(path.join(c.appDir, "server/storage"));
    ensureBaseline(c, info);
    const protectedBefore = protectedState(c, info.releaseRoot);
    const stagingBefore = lifecycle.captureStaging({ storageDir: path.join(c.appDir, "server/storage"), stateDir: c.stateDir, label: "before", expectedHash: protectedBefore["staging-latest.json"] });
    durable(path.join(c.stateDir, "protected.before.json"), protectedBefore);
    durable(path.join(c.stateDir, "staging.before-capture.private.json"), stagingBefore);
    if (fs.existsSync(c.targetDir)) fail("TARGET_EXISTS_NO_MIGRATION_REPLAY");
    saveState(c, { phase: "STOP_INTENT" });
    docker(["stop", "--time", "30", info.originalId], { timeout: 45000 });
    const frozen = inspect(info.originalId); if (frozen.State.Running || frozen.State.Paused) fail("SOURCE_NOT_STOPPED");
    saveState(c, { phase: "MIGRATING" });
    const native = require(c.pinnedMigrator);
    let directories;
    const result = native.migrateRuntimeData({ sourceContainer: info.originalId, targetDir: c.targetDir, backupDir: path.join(c.stateDir, "final-runtime-backup"),
      dockerCopy(source, destination) {
        // Reuse the native copy seam once; preserve empty directories which the
        // native regular-file staging intentionally does not enumerate.
        docker(["cp", `${source}:/app/data/.`, destination], { timeout: 300000, stdio: ["ignore", "ignore", "pipe"] });
        directories = directoryInventory(destination);
        durable(path.join(c.stateDir, "directories.private.json"), directories);
      },
    });
    preserveDirectories(c.targetDir, directories);
    durable(path.join(c.stateDir, "migration.private.json"), result);
    const evidence = migrationEvidence(c, result, native);
    saveState(c, { phase: "MIGRATED", persistenceValidated: true, migrationEvidence: { ...evidence, directories: directories.length, directoryFingerprint: hash(JSON.stringify(directories)) } });
    // Durable switch intent is deliberately conservative. From this point even
    // a lost Compose response must recover with CURRENT persistent data only.
    saveState(c, { phase: "SWITCH_INTENT", dataMayHaveNewWrites: true });
    docker([...composeArgs(c, info, path.join(c.stateDir, "persistent.compose.json")), "up", "-d", "--no-build", "--pull", "never", "--no-deps", SERVICE], { timeout: 180000, stdio: ["ignore", "ignore", "pipe"] });
    saveState(c, { phase: "STARTED" });
    const current = await waitHealthy(c, info.originalImage);
    if (!equal(containerContract(current, true), info.contract)) fail("LIVE_CONFIGURATION_CHANGED");
    const dataMount = current.Mounts.find(m => m.Destination === "/app/data");
    if (!dataMount || dataMount.Type !== "bind" || !dataMount.RW || dataMount.Source !== c.targetDir) fail("LIVE_PERSISTENCE_MISMATCH");
    saveState(c, { phase: "VERIFYING" });
    const liveDataEvidence = assertPostSwitchData(c, result.files);
    saveState(c, { liveDataEvidence });
    if (directories.some(relative => !fs.existsSync(path.join(c.targetDir, ...relative.split("/"))) || !fs.lstatSync(path.join(c.targetDir, ...relative.split("/"))).isDirectory())) fail("RUNTIME_DIRECTORY_MISSING");
    const protectedAfter = protectedState(c, info.releaseRoot);
    const exactBefore = { ...protectedBefore }, exactAfter = { ...protectedAfter };
    if (exactBefore["staging-latest.json"] !== exactAfter["staging-latest.json"]) {
      const beforeObject = stagingBefore.exists ? read(stagingBefore.path) : null;
      if (stagingBefore.exists && fileHash(stagingBefore.path) !== protectedBefore["staging-latest.json"]) fail("STAGING_CAPTURE_HASH_CHANGED");
      const stagingAcceptance = lifecycle.compareStaging(beforeObject, fs.existsSync(path.join(c.appDir, "server/storage/staging-latest.json")) ? read(path.join(c.appDir, "server/storage/staging-latest.json")) : null,
        lifecycle.readActiveAuthority(path.join(c.appDir, "server/storage")), { earliest: stagingBefore.capturedAt, latest: new Date().toISOString() });
      durable(path.join(c.stateDir, "staging.lifecycle-acceptance.private.json"), stagingAcceptance);
      delete exactBefore["staging-latest.json"]; delete exactAfter["staging-latest.json"];
    }
    if (!equal(exactBefore, exactAfter)) fail("PROTECTED_BUSINESS_STATE_CHANGED");
    await probes(c, { requireIdle: true });
    helper(c, "restore");
    await probes(c);
    saveState(c, { phase: "PASS", productionApi: "HEALTHY", personalAgent: "UNCHANGED", originalRuntimeDataPreserved: true, rollback: "READY", finishedAt: new Date().toISOString() });
    return publicStatus(c);
  } catch (error) {
    saveState(c, { failureCode: /^[A-Z_]+$/.test(error.code || "") ? error.code : "CUTOVER_FAILED" });
    lockedRecover(c); throw error;
  }
}
function recoveryPolicy(state, originalExists, currentStarted) {
  if (state.persistenceValidated && (state.dataMayHaveNewWrites || POST_SWITCH.has(state.phase) || currentStarted)) return "CURRENT_PERSISTENT_DATA";
  if (originalExists && !state.dataMayHaveNewWrites && !currentStarted) return "ORIGINAL_WRITABLE_LAYER";
  return "BLOCKED_PRESERVE_SCENE";
}
async function recoverInner(c, deps = {}) {
  if (!fs.existsSync(stateFile(c))) return { phase: "NO_OPERATION" };
  const state = read(stateFile(c)); if (["PREPARED", "PASS", "RECOVERED_ORIGINAL", "RECOVERED_PERSISTENT"].includes(state.phase)) return publicStatus(c);
  const info = read(path.join(c.stateDir, "baseline.json"));
  let original = null, current = null;
  const ops = { inspect, docker, image, waitHealthy, helper, probes, ...deps };
  try { original = ops.inspect(info.originalId); } catch (_) {}
  try { current = ops.inspect(NAME); } catch (_) {}
  const newStarted = !!current && current.Id !== info.originalId && current.State?.StartedAt && !current.State.StartedAt.startsWith("0001-");
  const policy = recoveryPolicy(state, !!original, newStarted);
  saveState(c, { phase: "RECOVERING", recoveryPolicy: policy, recoveryFromPhase: state.recoveryFromPhase || state.phase });
  try {
    if (policy === "ORIGINAL_WRITABLE_LAYER") {
      if (original.State.Paused) ops.docker(["unpause", info.originalId]);
      if (!original.State.Running) ops.docker(["start", info.originalId]);
      await ops.waitHealthy(c, info.originalImage);
      // A resumed original can have new writes. Its old target is NEVER replayed
      // or overwritten. A subsequent maintenance requires a new private state
      // and independently reviewed fresh generation.
      saveState(c, { targetGenerationStale: fs.existsSync(c.targetDir) });
    } else if (policy === "CURRENT_PERSISTENT_DATA") {
      validatePrepared(c, info); safePath(c.targetDir);
      if (!fs.existsSync(path.join(c.targetDir, ".fosu-runtime-migration.json"))) fail("RECOVERY_DATA_MARKER_MISSING");
      try { ops.image(info.originalImage); } catch (_) {
        if (fileHash(path.join(c.stateDir, "original-image.tar")) !== info.imageArchiveSha256) fail("ROLLBACK_IMAGE_ARCHIVE_CHANGED");
        ops.docker(["image", "load", "--input", path.join(c.stateDir, "original-image.tar")], { timeout: 600000, stdio: ["ignore", "ignore", "pipe"] });
      }
      // No restore/extract/copy of any data snapshot occurs here.
      if (current?.State?.Paused) ops.docker(["unpause", current.Id]);
      ops.docker([...composeArgs(c, info, path.join(c.stateDir, "persistent.compose.json")), "up", "-d", "--no-build", "--pull", "never", "--no-deps", SERVICE], { timeout: 180000, stdio: ["ignore", "ignore", "pipe"] });
      await ops.waitHealthy(c, info.originalImage);
    } else fail("AUTOMATIC_RECOVERY_UNSAFE");
    if (fs.existsSync(path.join(c.stateDir, "maintenance.json"))) ops.helper(c, "restore");
    await ops.probes(c);
    saveState(c, { phase: policy === "ORIGINAL_WRITABLE_LAYER" ? "RECOVERED_ORIGINAL" : "RECOVERED_PERSISTENT", productionApi: "HEALTHY", dataRestoredFromBackup: false, finishedAt: new Date().toISOString() });
  } catch (error) {
    saveState(c, { phase: "RECOVERY_BLOCKED", recoveryFailure: /^[A-Z_]+$/.test(error.code || "") ? error.code : "RECOVERY_FAILED", productionApi: "UNVERIFIED", preserveScene: true });
    throw error;
  }
  return publicStatus(c);
}
function unitText(node, script, config, stateDir, seconds) {
  for (const value of [node, script, config, stateDir]) if (!/^\/[A-Za-z0-9_./-]+$/.test(value)) fail("UNIT_PATH_REJECTED");
  const worker = `[Unit]\nDescription=Fosu runtime persistence cutover\nAfter=docker.service network-online.target\nRequires=docker.service\n[Service]\nType=exec\nUser=root\nUMask=0077\nExecStart=${node} ${script} run --config=${config}\nExecStopPost=${node} ${script} recover --config=${config} --force\nRuntimeMaxSec=${seconds}\nTimeoutStopSec=${RECOVERY_SECONDS + 30}\nKillMode=control-group\nStandardOutput=append:${stateDir}/worker.private.log\nStandardError=append:${stateDir}/worker.private.log\n`;
  const recovery = `[Unit]\nDescription=Fosu cutover crash and boot recovery\nAfter=docker.service network-online.target\nWants=docker.service\n[Service]\nType=oneshot\nUser=root\nUMask=0077\nExecStart=${node} ${script} recover --config=${config}\nTimeoutStartSec=${RECOVERY_SECONDS + 30}\nStandardOutput=append:${stateDir}/recovery.private.log\nStandardError=append:${stateDir}/recovery.private.log\n[Install]\nWantedBy=multi-user.target\n`;
  const timer = `[Unit]\nDescription=Fosu independent cutover watchdog\n[Timer]\nOnBootSec=15s\nOnUnitActiveSec=15s\nAccuracySec=1s\nUnit=${UNIT}-recovery.service\n[Install]\nWantedBy=timers.target\n`;
  return { worker, recovery, timer };
}
function start(c, approval) {
  const info = read(path.join(c.stateDir, "baseline.json")), state = read(stateFile(c));
  if (state.phase !== "PREPARED" || approval !== info.approval) fail("EXACT_MAINTENANCE_APPROVAL_REQUIRED");
  validatePrepared(c, info); ensureBaseline(c, info);
  // Preparation may have recorded an orphan blocker. Before installing or
  // starting maintenance, the original inventory gate must genuinely pass.
  const strictInventory = preflight.inventory(path.join(c.appDir, "server/storage"));
  saveState(c, { preparationInventory: { verified: true, ...strictInventory } });
  if (!fs.existsSync(path.resolve(__dirname, "../../tools/oracle-sample/maintenance-admin.js"))) fail("MAINTENANCE_HELPER_MISSING");
  command("systemctl", ["is-active", "docker.service"]);
  const active = spawnSync("systemctl", ["is-active", `${UNIT}.service`], { encoding: "utf8" });
  if (active.stdout?.trim() === "active" || active.stdout?.trim() === "activating") fail("WORKER_ALREADY_ACTIVE");
  const units = unitText(process.execPath, fs.realpathSync(__filename), c.configFile, c.stateDir, c.windowSeconds);
  // Recovery is enabled before any admission, stop or migration mutation.
  durable(`/etc/systemd/system/${UNIT}.service`, units.worker);
  durable(`/etc/systemd/system/${UNIT}-recovery.service`, units.recovery);
  durable(`/etc/systemd/system/${UNIT}-recovery.timer`, units.timer);
  command("systemctl", ["daemon-reload"]);
  command("systemctl", ["enable", "--now", `${UNIT}-recovery.service`, `${UNIT}-recovery.timer`]);
  saveState(c, { phase: "START_REQUESTED", deadline: Date.now() + c.windowSeconds * 1000 });
  command("systemctl", ["start", `${UNIT}.service`]);
  return { status: "STARTED_DETACHED", unit: UNIT, approval: info.approval };
}
function recover(c, force = false) {
  const state = fs.existsSync(stateFile(c)) ? read(stateFile(c)) : null;
  if (!state || TERMINAL.has(state.phase) && !(force && state.phase === "RECOVERY_BLOCKED")) return publicStatus(c);
  const active = spawnSync("systemctl", ["is-active", `${UNIT}.service`], { encoding: "utf8" }).stdout?.trim();
  if (!force && (active === "active" || active === "activating") && Date.now() < state.deadline) return { status: "WORKER_RUNNING" };
  if (!force && state.phase === "START_REQUESTED" && Date.now() - Date.parse(state.updatedAt) < 20000) return { status: "WORKER_STARTING" };
  // An independent systemd process and kernel flock cover SIGKILL, lost SSH,
  // deadline and boot. A shell trap is not the sole recovery owner.
  if (active === "active" || active === "activating") command("systemctl", ["kill", "--kill-whom=all", "--signal=KILL", `${UNIT}.service`]);
  return lockedRecover(c);
}
function lockedRecover(c) {
  const result = spawnSync("flock", ["--nonblock", "--conflict-exit-code", "75", path.join(c.stateDir, "recovery.lock"), process.execPath, __filename, "recover-inner", `--config=${c.configFile}`], { encoding: "utf8", timeout: RECOVERY_SECONDS * 1000, maxBuffer: 1024 * 1024, stdio: ["ignore", "pipe", "pipe"] });
  if (result.status === 75) return { status: "RECOVERY_ALREADY_RUNNING" };
  if (result.status !== 0 || result.error) fail("RECOVERY_EXECUTOR_FAILED");
  try { return JSON.parse(result.stdout); } catch (_) { fail("RECOVERY_RESPONSE_INVALID"); }
}
function publicStatus(c) {
  if (!fs.existsSync(stateFile(c))) return { status: "NOT_PREPARED", ORACLE_PERSISTENCE: "PENDING", PRODUCTION_API: "PENDING" };
  const s = read(stateFile(c));
  return { schema: s.schema, status: s.phase, originalContainerId: s.originalId, originalImageId: s.originalImage, approval: s.approval,
    ORACLE_PERSISTENCE: s.phase === "PASS" ? "PASS" : "PENDING", ORIGINAL_RUNTIME_DATA_PRESERVED: s.phase === "PASS" ? "YES" : "PENDING",
    PRODUCTION_API: s.productionApi || "PENDING", PERSONAL_AGENT: s.personalAgent || "PENDING", ROLLBACK: s.rollback || "PENDING",
    failureCode: s.failureCode || s.recoveryFailure || null, preparationBlocker: s.preparationInventory?.verified === false ? s.preparationInventory.code : null,
    targetGenerationStale: !!s.targetGenerationStale, migrationEvidence: s.migrationEvidence || null, schoolRequests: 0 };
}
function pythonJsonHash(value) {
  // Matches the already captured Python probe convention: sorted object keys,
  // original array order, compact separators and ensure_ascii=True.
  // Serialize keys directly: JSON.stringify reorders integer-like object keys,
  // even when insertion order was sorted ("11" would precede "01").
  const encode = v => Array.isArray(v) ? "[" + v.map(encode).join(",") + "]"
    : v && typeof v === "object" ? "{" + Object.keys(v).sort().map(k => JSON.stringify(k) + ":" + encode(v[k])).join(",") + "}"
    : JSON.stringify(v);
  return hash(encode(value).replace(/[^\x00-\x7f]/g, c => "\\u" + c.charCodeAt(0).toString(16).padStart(4, "0")));
}
async function liveBusinessAcceptance(c, evidenceFile, request = get) {
  safePath(evidenceFile, { regular: true, privateFile: true });
  const evidence = read(evidenceFile), expected = evidence.probes;
  if (expected?.schema !== "oracle-business-probes.v1" || !/^[A-Za-z0-9._-]+$/.test(expected.activeReleaseVersion || "") || typeof expected.term !== "string") fail("BUSINESS_EVIDENCE_INVALID");
  const query = "?releaseVersion=" + encodeURIComponent(expected.activeReleaseVersion) + "&term=" + encodeURIComponent(expected.term);
  const manifest = await request("/api/fosu/release-pack/manifest" + query);
  if (manifest.success !== true || pythonJsonHash(manifest) !== expected.manifestSha256) fail("BUSINESS_MANIFEST_CHANGED");
  const sources = {};
  for (const kind of ["class", "teacher", "classroom", "course"]) {
    const value = await request("/api/fosu/release-pack/index/" + kind + query), original = expected.sources?.[kind];
    if (value.success !== true || !Array.isArray(value.items) || original?.success !== true || value.items.length !== original.items || pythonJsonHash(value.items) !== original.itemsSha256) fail("BUSINESS_INDEX_CHANGED");
    sources[kind] = { success: true, items: value.items.length, itemsSha256: pythonJsonHash(value.items) };
  }
  const env = preflight.parseEnv(fs.readFileSync(path.join(c.appDir, "server/.env")));
  const notices = await request("/api/admin/notices", { "X-Admin-Token": env.ADMIN_API_TOKEN });
  if (notices.success !== true || !Array.isArray(notices.items)) fail("BUSINESS_NOTICES_INVALID");
  const content = notices.items.map(item => Object.fromEntries(Object.entries(item).filter(([key]) => key !== "reactions"))), noticeHash = pythonJsonHash(content);
  if (expected.notices?.success !== true || content.length !== expected.notices.count || noticeHash !== expected.notices.contentSha256) fail("BUSINESS_NOTICES_CHANGED");
  return { activeReleaseVersion: expected.activeReleaseVersion, manifestSha256: expected.manifestSha256, sources, notices: { success: true, count: content.length, contentSha256: noticeHash }, evidenceSha256: fileHash(evidenceFile), liveRequests: 6 };
}
async function accept(c, options, deps = {}) {
  const ops = { inspect, image, probes, protectedState, ...deps }, s = read(stateFile(c)), info = read(path.join(c.stateDir, "baseline.json"));
  if (!["RECOVERED_PERSISTENT", "PASS"].includes(s.phase) || s.persistenceValidated !== true || s.migrationEvidence?.fingerprint === undefined) fail("PERSISTENCE_ACCEPTANCE_STATE_REQUIRED");
  validatePrepared(c, info);
  const originalStateSha256 = fileHash(stateFile(c)), current = ops.inspect(NAME);
  if (current.Image !== info.originalImage || !current.State.Running || current.State.Paused || current.State.Health?.Status !== "healthy" || !equal(containerContract(current, true), info.contract)) fail("PERSISTENCE_ACCEPTANCE_RUNTIME_CHANGED");
  const mount = current.Mounts.find(m => m.Destination === "/app/data");
  if (!mount || mount.Type !== "bind" || !mount.RW || mount.Source !== c.targetDir) fail("LIVE_PERSISTENCE_MISMATCH");
  if (ops.image(info.originalImage).Config?.Labels?.["org.opencontainers.image.revision"] !== BASE) fail("ORIGINAL_IMAGE_CHANGED");
  const migration = read(path.join(c.stateDir, "migration.private.json")), markerFile = path.join(c.targetDir, ".fosu-runtime-migration.json"), receiptFile = path.join(c.targetDir, ".fosu-runtime-bootstrap.json"), marker = read(markerFile), receipt = read(receiptFile);
  if (migration.archiveVerified !== true || migration.sourceConsistency?.sourceState !== "stopped" || migration.sourceConsistency?.sourceIdentity?.containerId !== info.originalId || migration.dataFingerprint !== s.migrationEvidence.fingerprint || fileHash(migration.archivePath) !== migration.archiveSha256 || migration.archiveSha256 !== s.migrationEvidence.archiveSha256 || marker.dataFingerprint !== migration.dataFingerprint
    || receipt.state !== "migration-accepted" || receipt.migrationVerified !== true || receipt.migrationMarkerSha256 !== fileHash(markerFile) || receipt.migrationDataFingerprint !== migration.dataFingerprint || receipt.migrationArchiveSha256 !== migration.archiveSha256) fail("PERSISTENCE_ACCEPTANCE_MIGRATION_PROOF_INVALID");
  const liveDataEvidence = assertPostSwitchData(c, migration.files), directories = read(path.join(c.stateDir, "directories.private.json"));
  if (directories.some(relative => !fs.existsSync(path.join(c.targetDir, ...relative.split("/"))) || !fs.lstatSync(path.join(c.targetDir, ...relative.split("/"))).isDirectory())) fail("RUNTIME_DIRECTORY_MISSING");
  const before = read(path.join(c.stateDir, "protected.before.json")), after = ops.protectedState(c, info.releaseRoot), protectedBefore = { ...before }, protectedAfter = { ...after };
  delete protectedBefore["staging-latest.json"]; delete protectedAfter["staging-latest.json"];
  delete protectedBefore["ops/campus-sync/control.json"]; delete protectedAfter["ops/campus-sync/control.json"];
  // This independent acceptance runs after normal traffic was restored. Votes
  // may have legitimately changed since the window. Preserve the old hashes
  // and report the missing historical proof; deployment preflight stays strict.
  const historicalReactionsUnchanged = before.reactions === after.reactions ? "PASS" : "PENDING";
  delete protectedBefore.reactions; delete protectedAfter.reactions;
  if (!equal(protectedBefore, protectedAfter)) fail("PROTECTED_BUSINESS_STATE_CHANGED");
  const health = await ops.probes(c), maintenance = read(path.join(c.stateDir, "maintenance.json"));
  if (maintenance.phase !== "RESTORED" || health.personalAdmissionPaused !== maintenance.originalPaused || health.personalAgentOnline !== true || health.activeReleaseVersion === undefined) fail("PERSONAL_ADMISSION_ACCEPTANCE_FAILED");
  const business = await liveBusinessAcceptance(c, options["business-evidence"], deps.get || get);
  if (business.activeReleaseVersion !== health.activeReleaseVersion) fail("BUSINESS_ACTIVE_CHANGED");
  const storageDir = path.join(c.appDir, "server/storage"), capture = lifecycle.captureStaging({ storageDir, stateDir: c.stateDir, label: "accepted", expectedHash: after["staging-latest.json"] });
  const staging = capture.exists ? read(capture.path) : null, authority = lifecycle.readActiveAuthority(storageDir);
  let historicalStagingUnchanged = "PENDING", preStateObjectAvailable = false, stagingLifecycle = null;
  const captureBeforeFile = path.join(c.stateDir, "staging.before-capture.private.json");
  if (fs.existsSync(captureBeforeFile)) {
    const oldCapture = read(captureBeforeFile);
    if (oldCapture.sha256 !== before["staging-latest.json"] || oldCapture.exists && fileHash(oldCapture.path) !== oldCapture.sha256) fail("STAGING_CAPTURE_HASH_CHANGED");
    stagingLifecycle = lifecycle.compareStaging(oldCapture.exists ? read(oldCapture.path) : null, staging, authority, { earliest: oldCapture.capturedAt, latest: new Date().toISOString() });
    historicalStagingUnchanged = "PASS"; preStateObjectAvailable = true;
  } else if (before["staging-latest.json"] === after["staging-latest.json"]) historicalStagingUnchanged = "PASS";
  let sourceEvidence = null;
  if (options["source-evidence"]) {
    const file = safePath(options["source-evidence"], { regular: true, privateFile: true }), witness = read(file), uploadId = staging?.stagingUploadId || staging?.meta?.stagingUploadId;
    if (witness.schema !== "oracle-current-staging-source-proof.v1" || witness.payloadOriginalShaMatch !== true || witness.termMatch !== true || witness.versionMatch !== true || witness.payloadCanonicalHash !== authority.canonicalHash || witness.stagingCanonicalHash !== authority.canonicalHash || !/^[A-Za-z0-9_-]+$/.test(uploadId || "")) fail("STAGING_SOURCE_EVIDENCE_INVALID");
    const uploadDir = path.join(storageDir, "staging-uploads", uploadId), originalManifest = read(safePath(path.join(uploadDir, "manifest.json"), { regular: true })), payload = safePath(path.join(uploadDir, "payload.json"), { regular: true });
    if (fileHash(payload) !== originalManifest.originalSha256 || originalManifest.originalSha256 !== witness.payloadSha256 || (staging.canonicalHash || staging.meta?.canonicalHash) !== authority.canonicalHash) fail("STAGING_SOURCE_ORIGINAL_HASH_CHANGED");
    sourceEvidence = { schema: witness.schema, evidenceSha256: fileHash(file), payloadSha256: witness.payloadSha256, originalUploadHashCheckedLive: true, sourceDataComparison: "ATTACHED_PRIVATE_EVIDENCE", historicalPrestateProved: false };
  }
  if (fileHash(path.join(c.stateDir, "original-image.tar")) !== info.imageArchiveSha256 || fileHash(stateFile(c)) !== originalStateSha256) fail("ROLLBACK_OR_OPERATION_STATE_CHANGED");
  const result = { schema: "oracle-runtime-persistence-acceptance.v1", observedAt: new Date().toISOString(), operationPhase: s.phase, originalStateSha256, baselineSha256: fileHash(path.join(c.stateDir, "baseline.json")), originalImageId: info.originalImage, liveContainerId: current.Id, liveImageId: current.Image,
    migrationDataFingerprint: migration.dataFingerprint, migrationArchiveSha256: migration.archiveSha256, markerSha256: fileHash(markerFile), bootstrapReceiptSha256: fileHash(receiptFile), runtimePersistence: "PASS", runtimeDataPreserved: "YES", productionApi: "HEALTHY", personalAgent: "UNCHANGED", personalAgentOnline: true, personalAdmissionRestored: true, activeReleaseUnchanged: true, rollbackReady: true,
    historicalStagingUnchanged, historicalReactionsUnchanged, reactionHashes: { before: before.reactions, observed: after.reactions }, preStateObjectAvailable, stagingLifecycle, stagingCapture: capture.path, stagingCaptureSha256: capture.sha256, sourceEvidence, liveDataEvidence, business,
    readOnly: true, containerMutation: false, dataCopy: false, schoolRequests: 0 };
  durable(path.join(c.stateDir, "readonly-acceptance.private.json"), result);
  return result;
}
async function main(argv = process.argv.slice(2)) {
  const mode = argv.shift() || "prepare", options = {};
  for (const arg of argv) { if (arg === "--force") { options.force = true; continue; } const m = arg.match(/^--(config|approve|business-evidence|source-evidence)=(.+)$/); if (!m || options[m[1]]) fail("ARGUMENT_REJECTED"); options[m[1]] = m[2]; }
  if (process.platform !== "linux" || typeof process.getuid !== "function" || process.getuid() !== 0) fail("LINUX_ROOT_REQUIRED");
  if (Number(process.versions.node.split(".")[0]) < 20) fail("NODE_20_REQUIRED");
  if (!["prepare", "start", "run", "recover", "recover-inner", "status", "accept"].includes(mode) || !options.config || options.approve && mode !== "start" || options.force && mode !== "recover" || (options["business-evidence"] || options["source-evidence"]) && mode !== "accept" || mode === "accept" && !options["business-evidence"]) fail("ARGUMENT_REJECTED");
  process.umask(0o077); const c = loadConfig(options.config);
  if (mode === "prepare") return prepare(c);
  if (mode === "start") return start(c, options.approve);
  if (mode === "run") return run(c);
  if (mode === "recover") return recover(c, options.force);
  if (mode === "recover-inner") return recoverInner(c);
  if (mode === "accept") return accept(c, options);
  return publicStatus(c);
}
if (require.main === module) main().then(result => process.stdout.write(JSON.stringify(result) + "\n")).catch(error => { process.stderr.write(JSON.stringify({ status: "BLOCKED", code: /^[A-Z_]+$/.test(error.code || "") ? error.code : "CUTOVER_FAILED", productionVerified: false }) + "\n"); process.exitCode = 2; });
module.exports = { BASE, MIGRATOR_BLOB, RECOVERY_SECONDS, canonical, equal, fileHash, blobHash, durable, safePath, envMap, containerContract, assertRuntimeMatchesCompose, escapeInterpolation, persistenceCompose, assertOnlyPersistenceDelta, recoveryPolicy, unitText, migrationEvidence, liveFilePolicy, assertPostSwitchData, recoverInner, directoryInventory, preserveDirectories, prepareInventory, pythonJsonHash, liveBusinessAcceptance, accept };
