#!/usr/bin/env node
"use strict";
// Operations-only adapter: original preflight runs first and keeps all gates.
// Only a proven native lifecycle metadata difference can replace byte equality.
const fs = require("node:fs"), path = require("node:path"), crypto = require("node:crypto");
const host = require("../oracle-runtime-cutover/execute");
function fail(code) { throw Object.assign(new Error(code), { code }); }
const read = file => JSON.parse(fs.readFileSync(file, "utf8"));
function lifecycle() { return require("../oracle-runtime-cutover/lifecycle-guard"); }
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
  const controlled = original.replace(marker, `preflight() { node "${adapter}" --guard-config="${configFile}"`)
    .replace(imageCompression, 'docker image save "$old_image" | /usr/bin/pigz -p 2 -1 -n > "$backup/previous-image.tar.gz"')
    .replace(storageCompression, 'tar --use-compress-program="/usr/bin/pigz -p 2 -1" -cf "$backup/state.tar.gz" -C "$app_dir/server" storage .env');
  const operateFile = path.join(controlledDir, "operate.sh"); host.durable(operateFile, controlled);
  return { configFile, configSha256: host.fileHash(configFile), operateFile, operateSha256: host.fileHash(operateFile), adapterSha256: host.fileHash(adapter), lifecycleGuardSha256: config.lifecycleGuardSha256, originalOperateSha256: artifacts.operateSha256, originalCallsiteCount: 1, compressionCallsiteCount: 2, compression: "/usr/bin/pigz -p 2 -1", backupDataScope: "UNCHANGED" };
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
  if (fs.existsSync(record)) return readCapture(c, hash).capture;
  const capture = guard.captureStaging({ storageDir: path.join(c.appDir, "server/storage"), stateDir: c.captureDir, label: "capture-" + crypto.randomBytes(16).toString("hex"), expectedHash: hash });
  host.durable(record, capture);
  return capture;
}
function readCapture(c, hash) {
  const file = path.join(c.captureDir, `${hash || "absent"}.capture.json`);
  if (!fs.existsSync(file)) fail("STAGING_PRESTATE_OBJECT_UNAVAILABLE");
  host.safePath(file, { regular: true, privateFile: true });
  const cap = read(file);
  if (cap.sha256 !== hash || typeof cap.exists !== "boolean") fail("ADAPTER_CAPTURE_CONFLICT");
  if (!cap.exists) { if (hash !== null) fail("ADAPTER_CAPTURE_CONFLICT"); return { capture: cap, object: null }; }
  host.safePath(cap.path, { regular: true, privateFile: true });
  if (path.dirname(cap.path) !== c.captureDir || host.fileHash(cap.path) !== hash) fail("ADAPTER_CAPTURE_CONFLICT");
  return { capture: cap, object: read(cap.path) };
}
function compareProtected(before, after, c, { guard = lifecycle(), allowAdmissionControl = false } = {}) {
  if (before.schema !== "oracle-sample-preflight.v1" || before.liveBaseSha !== "a3dfd1989705f51c921f13883bcde1cce4502883" || before.status !== "PASS" || after.status !== "PASS" || before.envSha256 !== after.envSha256 || before.containerContractSha256 !== after.containerContractSha256) fail("PROTECTED_STATE_CHANGED");
  const expected = { ...before.protectedFiles }, current = { ...after.protectedFiles };
  if (allowAdmissionControl) { delete expected["ops/campus-sync/control.json"]; delete current["ops/campus-sync/control.json"]; }
  delete expected["staging-latest.json"]; delete current["staging-latest.json"];
  if (!host.equal(expected, current)) fail("PROTECTED_STATE_CHANGED");
  const old = readCapture(c, before.protectedFiles["staging-latest.json"]), fresh = capture(c, after, guard), freshObject = fresh.exists ? read(fresh.path) : null;
  const authority = guard.readActiveAuthority(path.join(c.appDir, "server/storage"));
  const proof = guard.compareStaging(old.object, freshObject, authority, { earliest: old.capture.capturedAt, latest: new Date().toISOString() });
  if (proof.status !== "PASS") fail("STAGING_LIFECYCLE_CONTRACT_FAILED");
  return { ...proof, beforeSha256: old.capture.sha256, afterSha256: fresh.sha256, historicalP0PreState: "SEPARATE_EVIDENCE" };
}
async function main(args = process.argv.slice(2), deps = {}) {
  const matches = args.filter(a => a.startsWith("--guard-config="));
  if (matches.length !== 1) fail("ADAPTER_CONFIG_REQUIRED");
  const c = deps.config || config(matches[0].slice("--guard-config=".length)), originalArgs = args.filter(a => !a.startsWith("--guard-config=")), o = options(originalArgs);
  if (o["app-dir"] !== c.appDir || o["runtime-dir"] !== c.runtimeDir || o.manifest !== c.manifest) fail("ADAPTER_OPERATION_SCOPE_CHANGED");
  const original = deps.preflight || require(path.join(c.candidateDir, "deploy/oracle-sample/preflight.js")), guard = deps.guard || lifecycle();
  try {
    const report = await original.main(originalArgs); capture(c, report, guard); return report;
  } catch (error) {
    if (error.code !== "PROTECTED_STATE_CHANGED" || !(o.before || o["compare-before"])) throw error;
  }
  // Original rejected only its comparison. Run its entire current-state gate
  // again, including signed Sample readiness, inventory and Compose identity.
  const fullArgs = [`--app-dir=${c.appDir}`, `--runtime-dir=${c.runtimeDir}`, `--manifest=${c.manifest}`, ...(o["verify-after"] ? [`--expected-sha=${o["verify-after"]}`] : [])];
  const after = await original.main(fullArgs), beforeFile = o.before || o["compare-before"];
  host.safePath(beforeFile, { regular: true, privateFile: true });
  const before = read(beforeFile), proof = compareProtected(before, after, c, { guard });
  host.durable(path.join(c.stateDir, `staging-guard.${Date.now()}.${process.pid}.private.json`), { beforeFile, beforeReport: before, afterReport: after, proof });
  return { ...after, stagingLifecycleGuard: proof, originalByteComparison: "PROTECTED_STATE_CHANGED", deploymentDataWrites: 0 };
}
if (require.main === module) main().then(r => console.log(JSON.stringify(r, null, 2))).catch(e => { console.error(JSON.stringify({ status: "BLOCKED", reason: /^[A-Z0-9_]+$/.test(e.code || "") ? e.code : "STAGING_ADAPTER_FAILED", schoolRequests: 0, configurationChanged: false })); process.exitCode = 2; });
module.exports = { setup, config, options, capture, readCapture, compareProtected, main };
