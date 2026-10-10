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
const externalReleases = path.join(temp, "external-releases"); fs.cpSync(path.join(storage, "public/releases"), externalReleases, { recursive: true });
const composeFile = path.join(temp, "server/docker-compose.yml"); fs.writeFileSync(composeFile, "services: {}\n");
fs.mkdirSync(path.join(storage, "runtime-data"));
const imageEnv = ["NODE_ENV=production", "FOSU_STORAGE_DIR=/app/storage", "FOSU_DATA_DIR=/app/storage/runtime-data"];
const serviceEnv = { ...parseEnv(env), CAMPUS_SYNC_OPS_DIR: "/app/storage/ops/campus-sync", SCHEDULE_COLLECTOR_DIR: "/app/storage/ops/schedule-collector" };
const mounts = [{ Type: "bind", Source: storage, Destination: "/app/storage", RW: true }, { Type: "bind", Source: runtime, Destination: "/openresty-static/runtime", RW: true }, { Type: "bind", Source: externalReleases, Destination: "/openresty-static/releases", RW: true }];
const compose = { name: "fixture-project", services: { "fosu-api": { container_name: "fosuclass-api", environment: serviceEnv, volumes: mounts.map(m => ({ type: m.Type, source: m.Source, target: m.Destination })), ports: [{ target: 3000, published: "18318", host_ip: "127.0.0.1", protocol: "tcp" }], networks: { default: null }, restart: "unless-stopped", mem_limit: 4294967296, cpus: 1.5 } }, networks: { default: { name: "fixture-project_default" } } };
const args = ["--app-dir=" + temp, "--runtime-dir=" + runtime, "--manifest=" + manifest];
const inspect = { State: { Running: true, Health: { Status: "healthy" } }, Image: "sha256:" + "e".repeat(64), Mounts: mounts, HostConfig: { PortBindings: { "3000/tcp": [{ HostIp: "127.0.0.1", HostPort: "18318" }] }, RestartPolicy: { Name: "unless-stopped", MaximumRetryCount: 0 }, Memory: 4294967296, NanoCpus: 1500000000 }, NetworkSettings: { Networks: { "fixture-project_default": {} } }, Config: { Env: [...imageEnv, ...Object.entries(serviceEnv).map(([k,v]) => k + "=" + v)], Cmd: ["node", "src/app.js"], Entrypoint: null, User: "", WorkingDir: "/app/server", Labels: { "org.opencontainers.image.revision": base, "com.docker.compose.project": "fixture-project", "com.docker.compose.service": "fosu-api", "com.docker.compose.project.working_dir": path.join(temp, "server"), "com.docker.compose.project.config_files": composeFile } } };
function deps(sha = base, image = inspect, resolved = compose) {
  return { request: async p => p === "/api/health" ? { success: true } : p === "/api/health/ready" ? { success: true, status: "ready", activeReleaseVersion: "fixture-v1" } : p === "/api/campus-agent/v1/health" ? { ok: true } : p === "/api/admin/campus-sync/snapshot" ? { success: true, snapshot: { service: { maintenance: { paused: false }, queue: { queued: 0, processing: 0, active: 0 } } } } : p.endsWith("/sample/readiness") ? { protocol: "collector-manual.v1", ready: true, sampleOnly: true, publishable: false, coverageValid: false } : { deployment: { commitSha: sha } }, run: (cmd, argv) => {
    assert.equal(cmd, "docker");
    if (argv[0] === "inspect") return JSON.stringify([image]);
    if (argv[0] === "image") return JSON.stringify([{ Config: { Env: imageEnv, Cmd: inspect.Config.Cmd, Entrypoint: null, User: "", WorkingDir: "/app/server", Labels: { "org.opencontainers.image.revision": image.Config.Labels["org.opencontainers.image.revision"] } } }]);
    assert.equal(argv[0], "compose"); assert.ok(argv.includes("config")); assert.equal(argv[argv.indexOf("-p") + 1], image.Config.Labels["com.docker.compose.project"]); assert.equal(argv[argv.indexOf("--project-directory") + 1], image.Config.Labels["com.docker.compose.project.working_dir"]); assert.equal(argv[argv.indexOf("--env-file") + 1], path.join(temp, "server/.env"));
    return JSON.stringify(resolved);
  } };
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
  const image = { ...inspect, Config: { ...inspect.Config, Labels: { ...inspect.Config.Labels, "org.opencontainers.image.revision": candidateSha } } };
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
test("health success cannot conceal queued or claimed personal jobs, or a missing idle snapshot", async () => {
  for (const queue of [null, { queued: 1, processing: 0, active: 1 }, { queued: 0, processing: 1, active: 1 }, { queued: 0, processing: 0, active: 1 }, { queued: "0", processing: 0, active: 0 }]) {
    const stub = deps(), original = stub.request;
    stub.request = (route, headers) => route === "/api/admin/campus-sync/snapshot" ? { success: true, snapshot: { service: { queue } } } : original(route, headers);
    await assert.rejects(main(args, stub), /PERSONAL_BROKER_(JOB_IN_FLIGHT|IDLE_UNVERIFIABLE)/);
  }
});
test("Compose project identity and original config are mandatory, with no guessed fallback", async () => {
  for (const label of ["com.docker.compose.project", "com.docker.compose.project.working_dir", "com.docker.compose.project.config_files"]) {
    const changed = structuredClone(inspect); delete changed.Config.Labels[label];
    await assert.rejects(main(args, deps(base, changed)), /COMPOSE_(IDENTITY|SOURCE)_UNVERIFIABLE/);
  }
});
test("a self-consistent Compose model still blocks backing up the wrong storage or runtime mount", async () => {
  const other = path.join(temp, "other-data"); fs.mkdirSync(other);
  for (const destination of ["/app/storage", "/openresty-static/runtime"]) {
    const changed = structuredClone(inspect), model = structuredClone(compose);
    changed.Mounts.find(m => m.Destination === destination).Source = other;
    model.services["fosu-api"].volumes.find(m => m.target === destination).source = other;
    await assert.rejects(main(args, deps(base, changed, model)), /BACKUP_MOUNT_TARGET_MISMATCH/);
  }
});
test("unrecorded environment, port and mount changes cannot be replayed from Compose", async () => {
  const changedEnv = structuredClone(inspect); changedEnv.Config.Env.push("UNRECORDED_OVERRIDE=changed");
  await assert.rejects(main(args, deps(base, changedEnv)), /CONTAINER_ENVIRONMENT_MISMATCH/);
  const changedPort = structuredClone(inspect); changedPort.HostConfig.PortBindings["3000/tcp"][0].HostIp = "0.0.0.0";
  await assert.rejects(main(args, deps(base, changedPort)), /COMPOSE_PORTS_MISMATCH/);
  const changedMount = structuredClone(inspect); changedMount.Mounts[0].RW = false;
  await assert.rejects(main(args, deps(base, changedMount)), /COMPOSE_MOUNTS_MISMATCH/);
});
test("served OpenResty indexes must match the protected internal release", async () => {
  const target = path.join(externalReleases, "fixture-v1/index/class/all.json"), before = fs.readFileSync(target);
  fs.writeFileSync(target, "{}"); await assert.rejects(main(args, deps()), /PUBLISHED_MOUNT_CONTENT_MISMATCH/); fs.writeFileSync(target, before);
});
test("runtime Agent data in a writable image layer or an unbacked separate mount blocks", async () => {
  const changed = structuredClone(inspect), model = structuredClone(compose);
  changed.Config.Env = changed.Config.Env.map(value => value.startsWith("FOSU_DATA_DIR=") ? "FOSU_DATA_DIR=/app/data" : value);
  model.services["fosu-api"].environment.FOSU_DATA_DIR = "/app/data";
  await assert.rejects(main(args, deps(base, changed, model)), /RUNTIME_DATA_NOT_PERSISTENT/);
  const outside = path.join(temp, "unbacked-runtime-data"); fs.mkdirSync(outside);
  changed.Mounts.push({ Type: "bind", Source: outside, Destination: "/app/data", RW: true });
  model.services["fosu-api"].volumes.push({ type: "bind", source: outside, target: "/app/data" });
  await assert.rejects(main(args, deps(base, changed, model)), /UNBACKED_DATA_DIR/);
  changed.Mounts[3] = { Type: "volume", Source: outside, Name: "fixture-project_agent-data", Destination: "/app/data", RW: true };
  model.services["fosu-api"].volumes[3] = { type: "volume", source: "agent-data", target: "/app/data" };
  model.volumes = { "agent-data": { name: "fixture-project_agent-data" } };
  await assert.rejects(main(args, deps(base, changed, model)), /UNBACKED_DATA_DIR/);
});
test("rollback rechecks the original stable container contract and protected state", async () => {
  const beforePath = path.join(temp, "rollback-before.json"), before = await main(args, deps()); fs.writeFileSync(beforePath, JSON.stringify(before));
  const result = await main([...args, "--compare-before=" + beforePath], deps()); assert.equal(result.status, "PASS");
  const changed = structuredClone(inspect), model = structuredClone(compose); changed.HostConfig.Memory = 2147483648; model.services["fosu-api"].mem_limit = 2147483648;
  await assert.rejects(main([...args, "--compare-before=" + beforePath], deps(base, changed, model)), /PROTECTED_STATE_CHANGED/);
});
after(() => { assert.ok(path.resolve(temp).startsWith(path.resolve(os.tmpdir()) + path.sep)); fs.rmSync(temp, { recursive: true, force: true }); });
