"use strict";
// Host-local, read-only preflight. No container restart, school request or storage write.
const fs = require("node:fs"), path = require("node:path"), crypto = require("node:crypto");
const { execFileSync } = require("node:child_process");
const PINNED_BASE = "a3dfd1989705f51c921f13883bcde1cce4502883";
function fail(code) { throw Object.assign(new Error(code), { code }); }
function hash(bytes) { return crypto.createHash("sha256").update(bytes).digest("hex"); }
function fileHash(file) { return hash(fs.readFileSync(file)); }
function json(file) { try { return JSON.parse(fs.readFileSync(file, "utf8")); } catch { fail("STATE_UNREADABLE"); } }
function parseEnv(bytes) {
  const out = {};
  for (const line of String(bytes).split(/\r?\n/)) {
    const match = line.match(/^([A-Z][A-Z0-9_]*)=(.*)$/);
    if (match) out[match[1]] = match[2].replace(/^(['"])(.*)\1$/, "$2");
  }
  return out;
}
function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object") return Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])]));
  return value;
}
function same(left, right) { return JSON.stringify(canonical(left)) === JSON.stringify(canonical(right)); }
function envMap(entries) {
  const out = {};
  for (const entry of entries || []) { const offset = String(entry).indexOf("="); if (offset > 0) out[entry.slice(0, offset)] = entry.slice(offset + 1); }
  return out;
}
function stableEnv(env) { const value = { ...env }; delete value.FOSU_DEPLOY_COMMIT_SHA; return value; }
function safeFile(file) {
  if (!path.isAbsolute(file) || /[\r\n]/.test(file) || !fs.existsSync(file) || !fs.lstatSync(file).isFile() || fs.lstatSync(file).isSymbolicLink()) fail("COMPOSE_SOURCE_UNVERIFIABLE");
  return path.resolve(file);
}
function containerContract(inspected, image, app, runtime, run) {
  const labels = inspected.Config?.Labels || {}, project = labels["com.docker.compose.project"], workingDir = labels["com.docker.compose.project.working_dir"];
  if (!/^[a-z0-9][a-z0-9_-]{0,63}$/.test(project || "") || labels["com.docker.compose.service"] !== "fosu-api" || !path.isAbsolute(workingDir || "") || !fs.existsSync(workingDir) || !fs.statSync(workingDir).isDirectory()) fail("COMPOSE_IDENTITY_UNVERIFIABLE");
  const sourceFiles = String(labels["com.docker.compose.project.config_files"] || "").split(",").filter(Boolean).map(safeFile);
  if (!sourceFiles.length || sourceFiles.length > 8) fail("COMPOSE_SOURCE_UNVERIFIABLE");
  const envFiles = String(labels["com.docker.compose.project.environment_file"] || path.join(workingDir, ".env")).split(",").filter(Boolean).map(safeFile);
  if (!envFiles.length || envFiles.length > 8) fail("COMPOSE_SOURCE_UNVERIFIABLE");
  const composeArgs = ["compose", "--project-directory", workingDir, "-p", project, ...envFiles.flatMap(file => ["--env-file", file]), ...sourceFiles.flatMap(file => ["-f", file]), "config", "--format", "json"];
  let resolved;
  try { resolved = JSON.parse(run("docker", composeArgs, { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] })); } catch { fail("COMPOSE_RESOLUTION_FAILED"); }
  const service = resolved.services?.["fosu-api"];
  if (!service || resolved.name !== project || service.container_name !== "fosuclass-api") fail("COMPOSE_IDENTITY_MISMATCH");
  const actualEnv = envMap(inspected.Config.Env), expectedEnv = { ...envMap(image.Config?.Env), ...Object.fromEntries(Object.entries(service.environment || {}).map(([key, value]) => [key, String(value)])) };
  if (!same(stableEnv(actualEnv), stableEnv(expectedEnv)) || actualEnv.FOSU_STORAGE_DIR !== "/app/storage" || actualEnv.CAMPUS_SYNC_OPS_DIR !== "/app/storage/ops/campus-sync" || actualEnv.SCHEDULE_COLLECTOR_DIR !== "/app/storage/ops/schedule-collector") fail("CONTAINER_ENVIRONMENT_MISMATCH");
  const mounts = (inspected.Mounts || []).map(mount => ({ type: mount.Type, source: mount.Type === "volume" ? mount.Name : mount.Source, target: mount.Destination, readOnly: mount.RW === false })).sort((a, b) => a.target.localeCompare(b.target));
  const expectedMounts = (service.volumes || []).map(mount => ({ type: mount.type, source: mount.type === "volume" ? resolved.volumes?.[mount.source]?.name : mount.source, target: mount.target, readOnly: mount.read_only === true })).sort((a, b) => a.target.localeCompare(b.target));
  if (!same(mounts, expectedMounts)) fail("COMPOSE_MOUNTS_MISMATCH");
  function hostMount(target, expectedSource) {
    const mount = mounts.find(mount => mount.target === target);
    if (!mount || mount.type !== "bind" || !path.isAbsolute(mount.source || "") || !fs.existsSync(mount.source) || fs.realpathSync(mount.source) !== fs.realpathSync(expectedSource || mount.source)) fail("BACKUP_MOUNT_TARGET_MISMATCH");
    return mount.source;
  }
  hostMount("/app/storage", path.join(app, "server/storage"));
  hostMount("/openresty-static/runtime", runtime);
  const releaseRoot = hostMount("/openresty-static/releases");
  const dataDir = actualEnv.FOSU_DATA_DIR;
  if (!path.posix.isAbsolute(dataDir || "") || path.posix.normalize(dataDir) !== dataDir || dataDir.includes("\\")) fail("RUNTIME_DATA_NOT_PERSISTENT");
  const dataMount = mounts.filter(mount => dataDir === mount.target || dataDir.startsWith(mount.target.replace(/\/$/, "") + "/")).sort((a, b) => b.target.length - a.target.length)[0];
  if (!dataMount || !["bind", "volume"].includes(dataMount.type)) fail("RUNTIME_DATA_NOT_PERSISTENT");
  if (dataMount.type !== "bind") fail("UNBACKED_DATA_DIR");
  const dataSource = path.join(dataMount.source, ...path.posix.relative(dataMount.target, dataDir).split("/").filter(Boolean));
  if (!fs.existsSync(dataSource)) fail("UNBACKED_DATA_DIR");
  const relativeData = path.relative(fs.realpathSync(path.join(app, "server/storage")), fs.realpathSync(dataSource));
  if (relativeData === ".." || relativeData.startsWith(".." + path.sep) || path.isAbsolute(relativeData)) fail("UNBACKED_DATA_DIR");
  const expectedPorts = {};
  for (const port of service.ports || []) {
    const key = `${port.target}/${port.protocol || "tcp"}`;
    (expectedPorts[key] ||= []).push({ HostIp: port.host_ip || "0.0.0.0", HostPort: String(port.published) });
  }
  if (!same(expectedPorts, inspected.HostConfig?.PortBindings || {})) fail("COMPOSE_PORTS_MISMATCH");
  const expectedNetworks = Object.keys(service.networks || {}).map(key => resolved.networks?.[key]?.name).sort();
  if (expectedNetworks.some(value => !value) || !same(expectedNetworks, Object.keys(inspected.NetworkSettings?.Networks || {}).sort())) fail("COMPOSE_NETWORKS_MISMATCH");
  const command = service.command || image.Config?.Cmd, entrypoint = service.entrypoint || image.Config?.Entrypoint;
  if (!same(command, inspected.Config.Cmd) || !same(entrypoint, inspected.Config.Entrypoint) || (service.user || image.Config?.User || "") !== (inspected.Config.User || "") || (service.working_dir || image.Config?.WorkingDir || "") !== inspected.Config.WorkingDir || (service.restart || "no") !== inspected.HostConfig?.RestartPolicy?.Name || Number(service.mem_limit || 0) !== Number(inspected.HostConfig?.Memory || 0) || Math.round(Number(service.cpus || 0) * 1e9) !== Number(inspected.HostConfig?.NanoCpus || 0)) fail("COMPOSE_RUNTIME_MISMATCH");
  const contract = { project, workingDir, envFiles: envFiles.map(file => [file, fileHash(file)]), mounts, ports: inspected.HostConfig.PortBindings, networks: expectedNetworks, environment: stableEnv(actualEnv), command, entrypoint, user: inspected.Config.User || "", workingDirectory: inspected.Config.WorkingDir, restart: inspected.HostConfig.RestartPolicy, memory: inspected.HostConfig.Memory, nanoCpus: inspected.HostConfig.NanoCpus };
  return { releaseRoot, containerContractSha256: hash(JSON.stringify(canonical(contract))), composeSourcesVerified: true, backupMountsVerified: true, runtimeDataBackedByStorage: true };
}
function requirePersonalIdle(value) {
  const queue = value?.snapshot?.service?.queue;
  if (value?.success !== true || !queue || typeof value?.snapshot?.service?.maintenance?.paused !== "boolean" || [queue.queued, queue.processing, queue.active].some(count => !Number.isInteger(count) || count < 0) || queue.active !== queue.queued + queue.processing) fail("PERSONAL_BROKER_IDLE_UNVERIFIABLE");
  if (queue.active !== 0) fail("PERSONAL_BROKER_JOB_IN_FLIGHT");
  return true;
}
function validateState(state, now = Date.now()) {
  if (!state || typeof state !== "object" || Array.isArray(state) || !Array.isArray(state.runs) || typeof state.paused !== "boolean") fail("COLLECTOR_STATE_INCOMPATIBLE");
  if (state.current && !state.current.finishedAt || state.lock && state.lock.expiresAt > now) fail("COLLECTOR_RUN_IN_FLIGHT");
}
function inventory(storage) {
  const collectorState = path.join(storage, "ops/schedule-collector/state.json");
  if (fs.existsSync(collectorState)) validateState(json(collectorState));
  const jobs = path.join(storage, "jobs");
  if (fs.existsSync(jobs)) {
    for (const name of fs.readdirSync(jobs).filter(n => n.endsWith(".json"))) {
      const job = json(path.join(jobs, name));
      if (["running", "queued"].includes(job.status)) fail("SERVER_JOB_IN_FLIGHT");
    }
  }
  let bytes = 0;
  function visit(dir) {
    for (const item of fs.readdirSync(dir, { withFileTypes: true })) {
      if (item.isSymbolicLink()) fail("STORAGE_LINK_REJECTED");
      const p = path.join(dir, item.name);
      if (item.isDirectory()) visit(p); else if (item.isFile()) bytes += fs.statSync(p).size;
    }
  }
  visit(storage);
  const stats = fs.statfsSync(storage);
  if (Number(stats.bavail) * Number(stats.bsize) < bytes * 2 + 512 * 1024 * 1024) fail("BACKUP_CAPACITY_INSUFFICIENT");
  return { jsonCompatible: true, storageBytes: bytes, backupCapacity: true };
}
function protectedFiles(storage, runtime, releaseRoot) {
  const internal = path.join(storage, "public/runtime/active.json"), external = path.join(runtime, "active.json");
  const pointer = json(internal), version = pointer.releaseVersion || pointer.version;
  if (!/^[A-Za-z0-9._-]+$/.test(version || "")) fail("ACTIVE_VERSION_INVALID");
  if (fileHash(internal) !== fileHash(external)) fail("ACTIVE_POINTER_MISMATCH");
  const release = path.join(storage, "public/releases", version);
  const files = { active: fileHash(internal), manifest: fileHash(path.join(release, "manifest.json")) };
  for (const kind of ["class", "teacher", "classroom", "course"]) files[kind] = fileHash(path.join(release, "index", kind, "all.json"));
  if (releaseRoot) {
    const externalRelease = path.join(releaseRoot, version);
    if (fileHash(path.join(externalRelease, "manifest.json")) !== files.manifest) fail("PUBLISHED_MOUNT_CONTENT_MISMATCH");
    for (const kind of ["class", "teacher", "classroom", "course"]) if (fileHash(path.join(externalRelease, "index", kind, "all.json")) !== files[kind]) fail("PUBLISHED_MOUNT_CONTENT_MISMATCH");
  }
  for (const relative of ["staging-latest.json", "releases/active.json", "notices.json", "ops/campus-sync/policy.json", "ops/campus-sync/control.json"]) {
    const target = path.join(storage, relative); files[relative] = fs.existsSync(target) ? fileHash(target) : null;
  }
  const reactions = path.join(storage, "notice-reactions");
  files.reactions = fs.existsSync(reactions) ? hash(fs.readdirSync(reactions).filter(n => n.endsWith(".json")).sort().map(n => n + ":" + fileHash(path.join(reactions, n))).join("\n")) : null;
  return files;
}
async function request(route, headers = {}) {
  const response = await fetch("http://127.0.0.1:18318" + route, { headers, redirect: "error", signal: AbortSignal.timeout(10000) });
  if (!response.ok) fail("LOOPBACK_HEALTH_OR_AUTH_FAILED");
  return response.json();
}
async function main(args = process.argv.slice(2), deps = {}) {
  const opts = {};
  for (const arg of args) {
    const m = arg.match(/^--(app-dir|runtime-dir|manifest|verify-after|before|expected-sha|compare-before)=(.+)$/);
    if (!m || opts[m[1]]) fail("PREFLIGHT_ARGUMENT_REJECTED");
    opts[m[1]] = m[2];
  }
  if (!opts["app-dir"] || !opts["runtime-dir"] || !opts.manifest) fail("PREFLIGHT_ARGUMENT_REJECTED");
  const app = path.resolve(opts["app-dir"]), storage = path.join(app, "server/storage"), envFile = path.join(app, "server/.env");
  const manifest = json(opts.manifest);
  if (manifest.schema !== "oracle-sample-candidate.v1" || manifest.baseSha !== PINNED_BASE || manifest.expectedProductionSha !== PINNED_BASE) fail("CANDIDATE_BASE_REJECTED");
  if (Boolean(opts["verify-after"]) !== Boolean(opts.before)) fail("PREFLIGHT_ARGUMENT_REJECTED");
  if (opts["verify-after"] && opts["expected-sha"]) fail("PREFLIGHT_ARGUMENT_REJECTED");
  if (opts["compare-before"] && (opts.before || opts["verify-after"])) fail("PREFLIGHT_ARGUMENT_REJECTED");
  const expected = opts["verify-after"] || opts["expected-sha"] || PINNED_BASE;
  if (!/^[a-f0-9]{40}$/.test(expected) || (opts["verify-after"] || opts["expected-sha"]) && manifest.gitCommit !== expected) fail("CANDIDATE_COMMIT_REQUIRED");
  const env = parseEnv(fs.readFileSync(envFile));
  const agentSecrets = [env.FULL_SYNC_AGENT_TOKEN, env.FULL_SYNC_SIGNING_SECRET, env.CAMPUS_AGENT_TOKEN, env.CAMPUS_AGENT_SIGNING_SECRET];
  if (!env.ADMIN_API_TOKEN || agentSecrets.some(value => typeof value !== "string" || value.length < 32) || new Set(agentSecrets).size !== agentSecrets.length) fail("ISOLATED_CREDENTIALS_REQUIRED");
  const get = deps.request || request;
  const health = await get("/api/health");
  if (health.success !== true) fail("API_HEALTH_FAILED");
  const ready = await get("/api/health/ready");
  if (ready.success !== true || ready.status !== "ready" || !ready.activeReleaseVersion) fail("API_RUNTIME_NOT_READY");
  const status = await get("/api/admin/security/status", { "X-Admin-Token": env.ADMIN_API_TOKEN });
  if (status.deployment?.commitSha !== expected) fail("LIVE_BASE_CHANGED");
  const brokerRoute = "/api/campus-agent/v1/health", brokerTimestamp = String(Date.now()), brokerNonce = crypto.randomBytes(16).toString("hex");
  const brokerSignature = require("../../server/src/security/campusAgentSignature").signRequest(env.CAMPUS_AGENT_SIGNING_SECRET, { method: "GET", path: brokerRoute, timestamp: brokerTimestamp, nonce: brokerNonce, body: Buffer.alloc(0) });
  const broker = await get(brokerRoute, { Authorization: "Bearer " + env.CAMPUS_AGENT_TOKEN, "X-Campus-Agent-ID": env.CAMPUS_AGENT_ID || "wyz-campus-01", "X-Campus-Timestamp": brokerTimestamp, "X-Campus-Nonce": brokerNonce, "X-Campus-Signature": brokerSignature });
  if (broker.ok !== true) fail("PERSONAL_BROKER_HEALTH_FAILED");
  const personalSnapshot = await get("/api/admin/campus-sync/snapshot", { "X-Admin-Token": env.ADMIN_API_TOKEN });
  const personalBrokerIdle = requirePersonalIdle(personalSnapshot), personalAdmissionPaused = personalSnapshot.snapshot.service.maintenance.paused;
  const run = deps.run || ((command, argv, options) => execFileSync(command, argv, { timeout: 10000, ...options }));
  const inspected = JSON.parse(run("docker", ["inspect", "fosuclass-api"], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }))[0];
  if (!inspected?.State?.Running || inspected.State.Health?.Status !== "healthy" || inspected.Config?.Labels?.["org.opencontainers.image.revision"] !== expected) fail("IMAGE_FINGERPRINT_OR_HEALTH_MISMATCH");
  const image = JSON.parse(run("docker", ["image", "inspect", inspected.Image], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }))[0];
  if (image.Config?.Labels?.["org.opencontainers.image.revision"] !== expected) fail("IMAGE_FINGERPRINT_OR_HEALTH_MISMATCH");
  const container = containerContract(inspected, image, app, path.resolve(opts["runtime-dir"]), run);
  const state = inventory(storage), files = protectedFiles(storage, path.resolve(opts["runtime-dir"]), container.releaseRoot);
  delete container.releaseRoot;
  if (expected !== PINNED_BASE) {
    const route = "/api/full-sync/v1/sample/readiness", timestamp = String(Date.now()), nonce = crypto.randomBytes(16).toString("hex");
    const signature = require("../../server/src/security/fullSyncSignature").signRequest(env.FULL_SYNC_SIGNING_SECRET, { method: "GET", path: route, timestamp, nonce, body: Buffer.alloc(0) });
    const sample = await get(route, { Authorization: "Bearer " + env.FULL_SYNC_AGENT_TOKEN, "X-Full-Sync-Agent-ID": env.FULL_SYNC_AGENT_ID || "wyz-schedule-collector", "X-Full-Sync-Timestamp": timestamp, "X-Full-Sync-Nonce": nonce, "X-Full-Sync-Signature": signature });
    if (sample.protocol !== "collector-manual.v1" || sample.ready !== true || sample.sampleOnly !== true || sample.publishable !== false || sample.coverageValid !== false) fail("SAMPLE_API_NOT_READY");
  }
  if (opts.before || opts["compare-before"]) {
    const before = json(opts.before || opts["compare-before"]);
    if (before.schema !== "oracle-sample-preflight.v1" || before.liveBaseSha !== PINNED_BASE || before.status !== "PASS" || JSON.stringify(before.protectedFiles) !== JSON.stringify(files) || before.envSha256 !== fileHash(envFile) || before.containerContractSha256 !== container.containerContractSha256) fail("PROTECTED_STATE_CHANGED");
  }
  return { schema: "oracle-sample-preflight.v1", status: "PASS", liveBaseSha: expected, rollbackImage: inspected.Image, protectedFiles: files, envSha256: fileHash(envFile), personalBrokerReady: true, personalBrokerIdle, personalAdmissionPaused, ...container, ...state, at: new Date().toISOString(), schoolRequests: 0, configurationChanged: false, deployment: "BLOCKED_PENDING_COMMIT_CI_BACKUP_AND_APPROVAL" };
}
if (require.main === module) main().then(value => console.log(JSON.stringify(value, null, 2))).catch(error => { console.error(JSON.stringify({ status: "BLOCKED", reason: /^[A-Z_]+$/.test(error.code || "") ? error.code : "HOST_PREFLIGHT_FAILED", schoolRequests: 0, configurationChanged: false })); process.exitCode = 2; });
module.exports = { parseEnv, validateState, inventory, protectedFiles, containerContract, requirePersonalIdle, main };
