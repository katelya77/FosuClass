"use strict";
const { test, after } = require("node:test"), assert = require("node:assert/strict");
const fs = require("node:fs"), path = require("node:path"), os = require("node:os");
const { parseEnv, validateState, inventory, protectedFiles, main } = require("../deploy/oracle-sample/preflight");
const base = "a3dfd1989705f51c921f13883bcde1cce4502883";
const temp = fs.mkdtempSync(path.join(os.tmpdir(), "fosu-sample-preflight-"));
const storage = path.join(temp, "server/storage"), runtime = path.join(temp, "runtime");
fs.mkdirSync(storage, { recursive: true }); fs.mkdirSync(runtime);
const state = { paused: false, runs: [], current: null, lock: null };
const env = "ADMIN_API_TOKEN=synthetic-admin\nFULL_SYNC_AGENT_TOKEN=" + "a".repeat(40) + "\nFULL_SYNC_SIGNING_SECRET=" + "b".repeat(40) + "\nCAMPUS_AGENT_TOKEN=" + "c".repeat(40) + "\nCAMPUS_AGENT_SIGNING_SECRET=" + "d".repeat(40) + "\n";
fs.writeFileSync(path.join(temp, "server/.env"), env);
const manifest = path.join(temp, "candidate.json");
fs.writeFileSync(manifest, JSON.stringify({ schema: "oracle-sample-candidate.v1", baseSha: base, expectedProductionSha: base }));
const pointer = JSON.stringify({ releaseVersion: "fixture-v1" });
fs.mkdirSync(path.join(storage, "public/runtime"), { recursive: true });
fs.writeFileSync(path.join(storage, "public/runtime/active.json"), pointer); fs.writeFileSync(path.join(runtime, "active.json"), pointer);
const release = path.join(storage, "public/releases/fixture-v1"); fs.mkdirSync(release, { recursive: true }); fs.writeFileSync(path.join(release, "manifest.json"), "{}");
for (const kind of ["class", "teacher", "classroom", "course"]) { const p = path.join(release, "index", kind); fs.mkdirSync(p, { recursive: true }); fs.writeFileSync(path.join(p, "all.json"), "[]"); }
const args = ["--app-dir=" + temp, "--runtime-dir=" + runtime, "--manifest=" + manifest];
const inspect = { State: { Running: true, Health: { Status: "healthy" } }, Image: "sha256:" + "e".repeat(64), Config: { Labels: { "org.opencontainers.image.revision": base } } };
function deps(sha = base, image = inspect) {
  return { request: async p => p === "/api/health" ? { success: true } : p === "/api/health/ready" ? { success: true, status: "ready", activeReleaseVersion: "fixture-v1" } : p === "/api/campus-agent/v1/health" ? { ok: true } : p.endsWith("/sample/readiness") ? { protocol: "collector-manual.v1", ready: true, sampleOnly: true, publishable: false, coverageValid: false } : { deployment: { commitSha: sha } }, run: (cmd, argv) => { assert.equal(cmd, "docker"); assert.ok(["inspect", "image"].includes(argv[0])); return JSON.stringify([image]); } };
}
test("legacy runs state is accepted without a migration; active leases and runs block", () => {
  validateState(state);
  for (const invalid of [{}, { ...state, runs: {} }, { ...state, current: { id: "sc-fixture" } }, { ...state, lock: { expiresAt: Date.now() + 10000 } }]) assert.throws(() => validateState(invalid));
});
test("malformed persisted jobs cannot silently permit deployment", () => {
  const dir = path.join(storage, "jobs"); fs.mkdirSync(dir); const p = path.join(dir, "fixture.json");
  fs.writeFileSync(p, "{"); assert.throws(() => inventory(storage), /STATE_UNREADABLE/);
  fs.writeFileSync(p, '{"status":"running"}'); assert.throws(() => inventory(storage), /SERVER_JOB_IN_FLIGHT/);
  fs.writeFileSync(p, '{"status":"success"}'); assert.equal(inventory(storage).jsonCompatible, true);
});
test("pointer and four published index hashes are locked before an image change", () => {
  const before = protectedFiles(storage, runtime); assert.equal(Object.keys(before).length, 12);
  fs.writeFileSync(path.join(runtime, "active.json"), "{}"); assert.throws(() => protectedFiles(storage, runtime), /ACTIVE_POINTER_MISMATCH/);
  fs.writeFileSync(path.join(runtime, "active.json"), pointer);
});
test("live commit and image label must both match the actual Oracle ancestor", async () => {
  await assert.rejects(main(args, deps("f".repeat(40))), /LIVE_BASE_CHANGED/);
  await assert.rejects(main(args, deps(base, { ...inspect, Config: { Labels: {} } })), /IMAGE_FINGERPRINT_OR_HEALTH_MISMATCH/);
});
test("preflight succeeds with synthetic host evidence but deployment stays blocked and secrets stay private", async () => {
  const before = fs.readFileSync(path.join(temp, "server/.env")); const out = await main(args, deps());
  assert.equal(out.status, "PASS"); assert.match(out.deployment, /BLOCKED/); assert.equal(out.configurationChanged, false);
  const serialized = JSON.stringify(out); for (const secret of Object.values(parseEnv(env))) assert.ok(!serialized.includes(secret));
  assert.deepEqual(fs.readFileSync(path.join(temp, "server/.env")), before);
});
test("credential reuse between personal and collector agents blocks before a network call", async () => {
  fs.writeFileSync(path.join(temp, "server/.env"), env.replace("c".repeat(40), "a".repeat(40)));
  await assert.rejects(main(args, { request: () => assert.fail("must not send a request") }), /ISOLATED_CREDENTIALS_REQUIRED/);
  fs.writeFileSync(path.join(temp, "server/.env"), env);
});
test("deployment verification rejects formal Staging changes and accepts an exact pinned image", async () => {
  const beforePath = path.join(temp, "before.json"), before = await main(args, deps()); fs.writeFileSync(beforePath, JSON.stringify(before));
  const candidateSha = "f".repeat(40), oldManifest = fs.readFileSync(manifest);
  const value = JSON.parse(oldManifest); value.gitCommit = candidateSha; fs.writeFileSync(manifest, JSON.stringify(value));
  const image = { ...inspect, Config: { Labels: { "org.opencontainers.image.revision": candidateSha } } };
  const postArgs = [...args, "--verify-after=" + candidateSha, "--before=" + beforePath];
  const result = await main(postArgs, deps(candidateSha, image)); assert.equal(result.liveBaseSha, candidateSha);
  const staging = path.join(storage, "staging-latest.json"); fs.writeFileSync(staging, '{"changed":true}');
  await assert.rejects(main(postArgs, deps(candidateSha, image)), /PROTECTED_STATE_CHANGED/);
  fs.unlinkSync(staging); fs.writeFileSync(manifest, oldManifest);
});
test("uncommitted candidate cannot masquerade as a deployed Git revision", async () => {
  await assert.rejects(main([...args, "--expected-sha=" + "f".repeat(40)], { request: () => assert.fail("must not contact host") }), /CANDIDATE_COMMIT_REQUIRED/);
});
test("personal Broker uses only its existing signed GET health and a failed probe blocks", async () => {
  const stub = deps(), original = stub.request;
  let calls = 0;
  stub.request = async (route, headers) => {
    if (route === "/api/campus-agent/v1/health") {
      calls++;
      assert.equal(headers.Authorization, "Bearer " + "c".repeat(40));
      assert.equal(headers["X-Campus-Agent-ID"], "wyz-campus-01");
      const signature = require("../server/src/security/campusAgentSignature").signRequest("d".repeat(40), { method: "GET", path: route, timestamp: headers["X-Campus-Timestamp"], nonce: headers["X-Campus-Nonce"], body: Buffer.alloc(0) });
      assert.equal(headers["X-Campus-Signature"], signature);
      return { ok: false };
    }
    return original(route, headers);
  };
  await assert.rejects(main(args, stub), /PERSONAL_BROKER_HEALTH_FAILED/);
  assert.equal(calls, 1);
});
after(() => { assert.ok(path.resolve(temp).startsWith(path.resolve(os.tmpdir()) + path.sep)); fs.rmSync(temp, { recursive: true, force: true }); });
