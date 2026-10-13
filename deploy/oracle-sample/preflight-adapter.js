#!/usr/bin/env node
"use strict";
// Operations-only adapter: original preflight runs first and keeps all gates.
// Only a proven native lifecycle metadata difference can replace byte equality.
const fs = require("node:fs"), path = require("node:path"), crypto = require("node:crypto");
const { execFileSync } = require("node:child_process");
const host = require("../oracle-runtime-cutover/execute");
const { fetchLoopback } = require("../../tools/oracle-sample/loopback-http");
async function liveRequest(route, headers = {}) {
  const r = await fetchLoopback("http://127.0.0.1:18318" + route, { headers, signal: AbortSignal.timeout(10000) });
  if (!r.ok) fail("LOOPBACK_HEALTH_OR_AUTH_FAILED");
  return r.json();
}
function fail(code) { throw Object.assign(new Error(code), { code }); }
const read = file => JSON.parse(fs.readFileSync(file, "utf8"));
function lifecycle() { return require("../oracle-runtime-cutover/lifecycle-guard"); }
async function waitResumed(containerId, deps = {}) {
  if (!/^[a-f0-9]{64}$/.test(containerId || "")) fail("RESUMED_CONTAINER_ID_REQUIRED");
  const inspect = deps.inspect || (() => JSON.parse(execFileSync("docker", ["inspect", containerId], { encoding: "utf8", timeout: 5000, stdio: ["ignore", "pipe", "ignore"] }))[0]);
  const now = deps.now || Date.now, sleep = deps.sleep || (ms => new Promise(resolve => setTimeout(resolve, ms))), deadline = now() + 90000;
  for (;;) {
    const r = inspect();
    if (r?.Id !== containerId || r.Image !== "sha256:d864c4d92d063a3abc907fe89d3973c33eab8611b03b1caf1d78568bb20ead93" || r.State?.Running !== true || r.State.Paused !== false) fail("RESUMED_CONTAINER_IDENTITY_CHANGED");
    const health = r.State.Health?.Status;
    if (health === "healthy") return { status: "RESUMED_HEALTHY", fullPreflight: "STILL_REQUIRED", writes: 0, schoolRequests: 0 };
    if (!["starting", "unhealthy"].includes(health)) fail("RESUMED_CONTAINER_HEALTH_UNVERIFIABLE");
    if (now() >= deadline) fail("RESUMED_CONTAINER_HEALTH_TIMEOUT");
    await sleep(2000);
  }
}
function setup(c, artifacts) {
  const adapter = fs.realpathSync(__filename), guard = path.resolve(__dirname, "../oracle-runtime-cutover/lifecycle-guard.js");
  for (const f of [adapter, guard]) host.safePath(f, { regular: true });
  const captureDir = path.join(c.stateDir, "staging-evidence"), controlledDir = path.join(c.stateDir, "controlled-tools/deploy/oracle-sample");
  for (const dir of [captureDir, controlledDir]) host.safePath(dir, { createDirectory: true, privateFile: true });
  const configFile = path.join(c.stateDir, "staging-guard.private.json");
  for (const f of [adapter, configFile]) if (!/^\/[A-Za-z0-9_./-]+$/.test(f) && process.platform !== "win32") fail("ADAPTER_PATH_REJECTED");
  const config = { schema: "oracle-sample-preflight-guard.v1", appDir: c.appDir, runtimeDir: c.runtimeDir, candidateDir: c.candidateDir, manifest: c.manifest, stateDir: c.stateDir, captureDir, sourcePreflightSha256: artifacts.preflightSha256, lifecycleGuardSha256: host.fileHash(guard) };
  host.durable(configFile, config);
  const original = fs.readFileSync(path.join(c.candidateDir, "deploy/oracle-sample/operate.sh"), "utf8");
  const marker = 'preflight() { node "$candidate_dir/deploy/oracle-sample/preflight.js"';
  if (original.split(marker).length !== 2) fail("CONTROLLED_OPERATE_CALLSITE_CHANGED");
  const imageCompression = 'docker image save "$old_image" | gzip -n > "$backup/previous-image.tar.gz"';
  const storageCompression = 'tar -czf "$backup/state.tar.gz" -C "$app_dir/server" storage .env';
  if (original.split(imageCompression).length !== 2 || original.split(storageCompression).length !== 2) fail("CONTROLLED_OPERATE_COMPRESSION_CALLSITE_CHANGED");
  const identity = '[[ $image_id == $(node -p \'JSON.parse(require("fs").readFileSync(process.argv[1]))[0].Id\' "$image_dir/image-inspect.json") ]]';
  const load = 'docker load -i "$image_archive" > "$backup/candidate-image-load.txt"';
  const pause = 'docker pause fosuclass-api >/dev/null', unpause = 'docker unpause fosuclass-api >/dev/null';
  if (original.split(pause).length !== 2 || original.split(unpause + "\n").length !== 2) fail("CONTROLLED_RESUME_CALLSITE_CHANGED");
  if (!/^sha256:[a-f0-9]{64}$/.test(artifacts.imageId || "") || original.split(identity).length !== 2 || original.split(load).length !== 2) fail("CONTROLLED_IMAGE_IDENTITY_CALLSITE_CHANGED");
  const reusableLoad = artifacts.loadedCandidateVerified === true
    ? `if [[ $(docker image inspect --format '{{.Id}}' "fosu-oracle-sample:$candidate_sha" 2>/dev/null) == "${artifacts.imageId}" ]]; then printf 'VERIFIED_EXISTING_IMAGE\\n' > "$backup/candidate-image-load.txt"; else ${load}; fi`
    : load;
  const controlled = original.replace(marker, `preflight() { node "${adapter}" --guard-config="${configFile}"`)
    .replace(imageCompression, 'docker image save "$old_image" | /usr/bin/pigz -p 2 -1 -n > "$backup/previous-image.tar.gz"')
    .replace(storageCompression, 'tar --use-compress-program="/usr/bin/pigz -p 2 -1" -cf "$backup/state.tar.gz" -C "$app_dir/server" storage .env')
    .replace(identity, `[[ $image_id == "${artifacts.imageId}" ]]`)
    .replace(load, reusableLoad)
    .replace(pause, `resume_container_id=$(docker inspect --format '{{.Id}}' fosuclass-api)\n${pause}`)
    .replace(unpause + "\n", `${unpause}\nnode "${adapter}" --guard-config="${configFile}" --wait-resumed-container="$resume_container_id" >/dev/null\n`);
  const operateFile = path.join(controlledDir, "operate.sh"); host.durable(operateFile, controlled);
  return { configFile, configSha256: host.fileHash(configFile), operateFile, operateSha256: host.fileHash(operateFile), adapterSha256: host.fileHash(adapter), lifecycleGuardSha256: config.lifecycleGuardSha256, originalOperateSha256: artifacts.operateSha256, originalCallsiteCount: 1, compressionCallsiteCount: 2, identityCallsiteCount: 1, reusedImage: artifacts.loadedCandidateVerified === true, runtimeImageId: artifacts.imageId, compression: "/usr/bin/pigz -p 2 -1", backupDataScope: "UNCHANGED" };
}
function config(file) {
  host.safePath(file, { regular: true, privateFile: true });
  const c = read(file), fields = ["schema", "appDir", "runtimeDir", "candidateDir", "manifest", "stateDir", "captureDir", "sourcePreflightSha256", "lifecycleGuardSha256"];
  if (c.schema !== "oracle-sample-preflight-guard.v1" || Object.keys(c).some(k => !fields.includes(k)) || fields.some(k => typeof c[k] !== "string")) fail("ADAPTER_CONFIG_REJECTED");
  for (const f of [c.appDir, c.runtimeDir, c.candidateDir, c.stateDir, c.captureDir]) host.safePath(f, { privateFile: [c.stateDir, c.captureDir].includes(f) });
  host.safePath(c.manifest, { regular: true });
  if (path.dirname(c.captureDir) !== c.stateDir || host.fileHash(path.join(c.candidateDir, "deploy/oracle-sample/preflight.js")) !== c.sourcePreflightSha256 || host.fileHash(path.resolve(__dirname, "../oracle-runtime-cutover/lifecycle-guard.js")) !== c.lifecycleGuardSha256) fail("ADAPTER_BOUND_CODE_CHANGED");
  return c;
}
function options(args) {
  const o = {};
  for (const arg of args) { const m = arg.match(/^--(app-dir|runtime-dir|manifest|verify-after|before|expected-sha|compare-before)=(.+)$/); if (!m || o[m[1]]) fail("ADAPTER_ARGUMENT_REJECTED"); o[m[1]] = m[2]; }
  return o;
}
function capture(c, report, guard = lifecycle()) {
  const hash = report.protectedFiles?.["staging-latest.json"];
  if (hash !== null && !/^[a-f0-9]{64}$/.test(hash || "")) fail("ADAPTER_STAGING_HASH_REJECTED");
  const record = path.join(c.captureDir, `${hash || "absent"}.capture.json`);
  if (fs.existsSync(record)) return readCapture(c, hash, false).capture;
  const capture = guard.captureStaging({ storageDir: path.join(c.appDir, "server/storage"), stateDir: c.captureDir, label: "capture-" + crypto.randomBytes(16).toString("hex"), expectedHash: hash });
  host.durable(record, capture);
  return capture;
}
function readCapture(c, hash, parseObject = true) {
  const file = path.join(c.captureDir, `${hash || "absent"}.capture.json`);
  if (!fs.existsSync(file)) fail("STAGING_PRESTATE_OBJECT_UNAVAILABLE");
  host.safePath(file, { regular: true, privateFile: true });
  const cap = read(file);
  if (cap.sha256 !== hash || typeof cap.exists !== "boolean") fail("ADAPTER_CAPTURE_CONFLICT");
  if (!cap.exists) { if (hash !== null) fail("ADAPTER_CAPTURE_CONFLICT"); return { capture: cap, object: null }; }
  host.safePath(cap.path, { regular: true, privateFile: true });
  if (path.dirname(cap.path) !== c.captureDir || host.fileHash(cap.path) !== hash) fail("ADAPTER_CAPTURE_CONFLICT");
  return { capture: cap, object: parseObject ? read(cap.path) : undefined };
}
function compareProtected(before, after, c, { guard = lifecycle(), allowAdmissionControl = false, allowLiveReactions = false } = {}) {
  if (before.schema !== "oracle-sample-preflight.v1" || before.liveBaseSha !== "a3dfd1989705f51c921f13883bcde1cce4502883" || before.status !== "PASS" || after.status !== "PASS" || before.envSha256 !== after.envSha256 || before.containerContractSha256 !== after.containerContractSha256) fail("PROTECTED_STATE_CHANGED");
  const expected = { ...before.protectedFiles }, current = { ...after.protectedFiles };
  if (allowAdmissionControl) { delete expected["ops/campus-sync/control.json"]; delete current["ops/campus-sync/control.json"]; }
  const reactions = { before: expected.reactions, observed: current.reactions };
  if (allowLiveReactions) { delete expected.reactions; delete current.reactions; }
  delete expected["staging-latest.json"]; delete current["staging-latest.json"];
  if (!host.equal(expected, current)) fail("PROTECTED_STATE_CHANGED");
  if (before.protectedFiles["staging-latest.json"] === after.protectedFiles["staging-latest.json"]) {
    const original = readCapture(c, before.protectedFiles["staging-latest.json"], false);
    return { status: "PASS", exact: true, metadataOnly: false, changedPaths: [], beforeSha256: original.capture.sha256, afterSha256: original.capture.sha256, ...(allowLiveReactions ? { historicalReactionsUnchanged: reactions.before === reactions.observed ? "PASS" : "PENDING", reactionHashes: reactions } : {}) };
  }
  const old = readCapture(c, before.protectedFiles["staging-latest.json"]), fresh = capture(c, after, guard), freshObject = fresh.exists ? read(fresh.path) : null;
  const authority = guard.readActiveAuthority(path.join(c.appDir, "server/storage"));
  const proof = guard.compareStaging(old.object, freshObject, authority, { earliest: old.capture.capturedAt, latest: new Date().toISOString() });
  if (proof.status !== "PASS") fail("STAGING_LIFECYCLE_CONTRACT_FAILED");
  return { ...proof, beforeSha256: old.capture.sha256, afterSha256: fresh.sha256, historicalP0PreState: "SEPARATE_EVIDENCE", ...(allowLiveReactions ? { historicalReactionsUnchanged: reactions.before === reactions.observed ? "PASS" : "PENDING", reactionHashes: reactions } : {}) };
}
async function main(args = process.argv.slice(2), deps = {}) {
  const matches = args.filter(a => a.startsWith("--guard-config="));
  if (matches.length !== 1) fail("ADAPTER_CONFIG_REQUIRED");
  const c = deps.config || config(matches[0].slice("--guard-config=".length)), originalArgs = args.filter(a => !a.startsWith("--guard-config="));
  if (originalArgs.length === 1 && originalArgs[0].startsWith("--wait-resumed-container=")) return waitResumed(originalArgs[0].slice("--wait-resumed-container=".length), deps);
  const o = options(originalArgs);
  if (o["app-dir"] !== c.appDir || o["runtime-dir"] !== c.runtimeDir || o.manifest !== c.manifest) fail("ADAPTER_OPERATION_SCOPE_CHANGED");
  const original = deps.preflight || require(path.join(c.candidateDir, "deploy/oracle-sample/preflight.js")), guard = deps.guard || lifecycle();
  try {
    const report = await original.main(originalArgs, { request: deps.request || liveRequest }); capture(c, report, guard); return report;
  } catch (error) {
    if (error.code !== "PROTECTED_STATE_CHANGED" || !(o.before || o["compare-before"])) throw error;
  }
  // Original rejected only its comparison. Run its entire current-state gate
  // again, including signed Sample readiness, inventory and Compose identity.
  const fullArgs = [`--app-dir=${c.appDir}`, `--runtime-dir=${c.runtimeDir}`, `--manifest=${c.manifest}`, ...(o["verify-after"] ? [`--expected-sha=${o["verify-after"]}`] : [])];
  const after = await original.main(fullArgs, { request: deps.request || liveRequest }), beforeFile = o.before || o["compare-before"];
  host.safePath(beforeFile, { regular: true, privateFile: true });
  const before = read(beforeFile), proof = compareProtected(before, after, c, { guard });
  host.durable(path.join(c.stateDir, `staging-guard.${Date.now()}.${process.pid}.private.json`), { beforeFile, beforeReport: before, afterReport: after, proof });
  return { ...after, stagingLifecycleGuard: proof, originalByteComparison: "PROTECTED_STATE_CHANGED", deploymentDataWrites: 0 };
}
if (require.main === module) main().then(r => console.log(JSON.stringify(r, null, 2))).catch(e => { console.error(JSON.stringify({ status: "BLOCKED", reason: /^[A-Z0-9_]+$/.test(e.code || "") ? e.code : "STAGING_ADAPTER_FAILED", schoolRequests: 0, configurationChanged: false })); process.exitCode = 2; });
module.exports = { setup, config, options, capture, readCapture, compareProtected, waitResumed, main };
