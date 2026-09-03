const assert = require("assert");
const crypto = require("crypto");
const fs = require("fs");
const os = require("os");
const path = require("path");

process.env.FOSU_PUBLISHER_MOCK = "1";
process.env.ADMIN_API_TOKEN = "publisher-test-token";

const publisher = require("./fosu-publisher/publish");

const root = path.resolve(__dirname, "..");
const runsRoot = path.join(root, ".local", "publisher-runs");
const lockPath = path.join(runsRoot, "publisher.lock");
const testIds = [];
const originalEnv = Object.assign({}, process.env);
const originalLock = fs.existsSync(lockPath) ? fs.readFileSync(lockPath) : null;
const trustedTestTermArgs = [
  "--term=2025-2026-2",
  "--term-start-date=2026-03-09",
  "--total-weeks=20",
  "--week-start=monday",
];

function restoreEnv() {
  Object.keys(process.env).forEach((key) => {
    if (!(key in originalEnv)) delete process.env[key];
  });
  Object.assign(process.env, originalEnv);
  process.env.FOSU_PUBLISHER_MOCK = "1";
  process.env.ADMIN_API_TOKEN = "publisher-test-token";
}

function runId(name) {
  const id = `test-${name}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  testIds.push(id);
  return id;
}

function sha1File(filePath) {
  return crypto.createHash("sha1").update(fs.readFileSync(filePath)).digest("hex");
}

function writeJson(filePath, payload) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(payload, null, 2), "utf8");
}

function buildRelease(rootDir, version) {
  const releaseDir = path.join(rootDir, version);
  ["class", "teacher", "classroom", "course"].forEach((type) => {
    writeJson(path.join(releaseDir, "index", type, "all.json"), {
      success: true,
      releaseVersion: version,
      items: [{ id: `${type}-1`, name: `${type} 1` }],
    });
    writeJson(path.join(releaseDir, "detail", type, `${type}-1.json`), {
      success: true,
      releaseVersion: version,
      id: `${type}-1`,
      courses: [],
    });
  });
  writeJson(path.join(releaseDir, "empty-room", "index.json"), {
    success: true,
    releaseVersion: version,
    rooms: [],
  });
  writeJson(path.join(releaseDir, "calendar.json"), {
    success: true,
    term: "2025-2026-2",
    releaseVersion: version,
    weeks: [{ weekNo: 1, startDate: "2026-03-09", endDate: "2026-03-15" }],
  });
  writeJson(path.join(releaseDir, "bootstrap.json"), {
    success: true,
    term: "2025-2026-2",
    releaseVersion: version,
    catalog: { colleges: [{ code: "01", name: "test" }] },
  });
  const files = {};
  function walk(dir) {
    fs.readdirSync(dir, { withFileTypes: true }).forEach((entry) => {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) return walk(full);
      if (!entry.name.endsWith(".json")) return;
      const rel = path.relative(releaseDir, full).replace(/\\/g, "/");
      files[rel] = { size: fs.statSync(full).size, hash: sha1File(full) };
    });
  }
  walk(releaseDir);
  writeJson(path.join(releaseDir, "manifest.json"), {
    success: true,
    schemaVersion: 2,
    releaseVersion: version,
    version,
    term: "2025-2026-2",
    updatedAt: "2026-06-15T00:00:00.000Z",
    cacheEpoch: 1,
    forceRefreshToken: `${version}:1`,
    termConfig: { term: "2025-2026-2", termStartDate: "2026-03-09", totalWeeks: 20 },
    files,
  });
  return releaseDir;
}

async function expectReject(fn, code) {
  let failed = false;
  try {
    await fn();
  } catch (error) {
    failed = true;
    assert.strictEqual(error.code, code, `expected ${code}, got ${error.code}: ${error.message}`);
  }
  assert(failed, `expected rejection ${code}`);
}

async function run() {
  restoreEnv();
  const changed = await publisher.main(["--mode=routine", ...trustedTestTermArgs, `--run-id=${runId("changed")}`]);
  assert.strictEqual(changed.success, true);
  assert.strictEqual(changed.oracleStatus, "published");
  assert.strictEqual(changed.cloudbaseStatus, "mirrored");
  assert(changed.canonicalHash, "changed run should record canonicalHash");
  assert(changed.oracleVerification && changed.oracleVerification.mode === "oracle-only", "changed run should verify Oracle before CloudBase");
  assert(fs.existsSync(changed.receiptPaths.diffReport), "changed run should write diff-report.json");
  const changedState = JSON.parse(fs.readFileSync(changed.receiptPaths.state, "utf8"));
  assert(changedState.completedStages.indexOf("verifying-oracle-only") < changedState.completedStages.indexOf("cloudbase-preflight-and-mirror"), "Oracle-only smoke should run before CloudBase mirror");
  assert(changedState.completedStages.indexOf("cloudbase-preflight-and-mirror") < changedState.completedStages.indexOf("verifying-cloudbase-and-dual-source"), "dual-source smoke should run after CloudBase mirror");

  restoreEnv();
  process.env.FOSU_PUBLISHER_MOCK_NO_CHANGE = "1";
  const noChange = await publisher.main(["--mode=routine", ...trustedTestTermArgs, `--run-id=${runId("no-change")}`]);
  assert.strictEqual(noChange.status, "no-change");
  assert.strictEqual(noChange.cloudbaseStatus, "same-and-healthy");
  assert(noChange.uploadResult && noChange.uploadResult.unchanged, "no-change should record an unchanged upload marker");
  assert(noChange.liveSmoke && noChange.liveSmoke.mode === "dual-source-full", "no-change should still run lightweight dual-source health");

  restoreEnv();
  const resumeId = runId("resume");
  const resumeDir = path.join(runsRoot, resumeId);
  fs.mkdirSync(resumeDir, { recursive: true });
  writeJson(path.join(resumeDir, "state.json"), {
    schemaVersion: 1,
    runId: resumeId,
    mode: "resume",
    originalMode: "full",
    originalArgs: { mode: "full", term: "2025-2026-2", termStartDate: "2026-03-09", totalWeeks: "20" },
    status: "running",
    completedStages: ["local-preflight"],
    summary: { "local-preflight": { success: true, preloaded: true } },
    startedAt: new Date().toISOString(),
  });
  const resumed = await publisher.main(["--mode=resume", ...trustedTestTermArgs, `--run-id=${resumeId}`]);
  assert.strictEqual(resumed.success, true);

  restoreEnv();
  fs.mkdirSync(runsRoot, { recursive: true });
  writeJson(lockPath, { runId: "alive", pid: process.pid, createdAt: new Date().toISOString() });
  await expectReject(async () => {
    const runObj = new publisher.PublisherRun({ mode: "routine", args: {}, runId: runId("lock") });
    publisher.acquireLock(runObj, { commandLine: "node tools/fosu-publisher/publish.js" });
  }, "PUBLISHER_LOCKED");

  restoreEnv();
  writeJson(lockPath, { runId: "stale", pid: 99999999, createdAt: "2000-01-01T00:00:00.000Z" });
  const staleRun = new publisher.PublisherRun({ mode: "routine", args: {}, runId: runId("stale-lock") });
  publisher.acquireLock(staleRun);
  const staleLock = JSON.parse(fs.readFileSync(lockPath, "utf8"));
  assert.strictEqual(staleLock.runId, staleRun.runId);
  fs.rmSync(lockPath, { force: true });

  restoreEnv();
  process.env.FOSU_PUBLISHER_MOCK_ORACLE_UPLOAD_FAIL = "1";
  await expectReject(() => publisher.main(["--mode=routine", ...trustedTestTermArgs, `--run-id=${runId("upload-fail")}`]), "MOCK_ORACLE_UPLOAD_FAILED");

  restoreEnv();
  process.env.FOSU_PUBLISHER_MOCK_ORACLE_PUBLISH_FAIL = "1";
  await expectReject(() => publisher.main(["--mode=routine", ...trustedTestTermArgs, `--run-id=${runId("publish-fail")}`]), "MOCK_ORACLE_PUBLISH_FAILED");

  restoreEnv();
  process.env.FOSU_PUBLISHER_MOCK_CLOUDBASE_FAIL = "1";
  const partial = await publisher.main(["--mode=routine", ...trustedTestTermArgs, `--run-id=${runId("cloudbase-fail")}`]);
  assert.strictEqual(partial.status, "partial-success");
  assert.strictEqual(partial.cloudbaseStatus, "cloudbase-mirror-pending");

  restoreEnv();
  const mirror = await publisher.main(["--mode=mirror-only", ...trustedTestTermArgs, `--run-id=${runId("mirror")}`]);
  assert.strictEqual(mirror.success, true);
  assert.strictEqual(mirror.cloudbaseStatus, "mirrored");

  restoreEnv();
  const tempReleaseRoot = path.join(os.tmpdir(), `fosu-publisher-release-${process.pid}-${Date.now()}`);
  const version = "publisher-test-release";
  buildRelease(tempReleaseRoot, version);
  const exported = await publisher.main([
    "--mode=export-cloudbase",
    ...trustedTestTermArgs,
    `--release=${version}`,
    `--output-root=${tempReleaseRoot}`,
    `--run-id=${runId("export")}`,
  ]);
  assert.strictEqual(exported.success, true);
  assert(fs.existsSync(path.join(exported.manualPackage.manualRoot, "runtime", "active.json")), "manual package should include runtime pointer");
  assert(fs.existsSync(path.join(exported.manualPackage.manualRoot, "README-CLOUDBASE-MANUAL-UPLOAD.txt")), "manual package should include upload instructions");

  console.log("test-fosu-publisher passed");
}

run().finally(() => {
  testIds.forEach((id) => {
    fs.rmSync(path.join(runsRoot, id), { recursive: true, force: true });
  });
  if (originalLock) {
    fs.mkdirSync(path.dirname(lockPath), { recursive: true });
    fs.writeFileSync(lockPath, originalLock);
  } else {
    fs.rmSync(lockPath, { force: true });
  }
}).catch((error) => {
  console.error(error);
  process.exit(1);
});
