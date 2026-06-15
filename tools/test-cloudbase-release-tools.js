const assert = require("assert");
const crypto = require("crypto");
const fs = require("fs");
const os = require("os");
const path = require("path");

const tempRoot = path.join(os.tmpdir(), `fosu-cloudbase-release-tools-${process.pid}-${Date.now()}`);
process.env.FOSU_STORAGE_DIR = path.join(tempRoot, "storage");

const utils = require("./cloudbase/release-pack-utils");
const syncActive = require("./cloudbase/sync-active-release");

function sha1(filePath) {
  return crypto.createHash("sha1").update(fs.readFileSync(filePath)).digest("hex");
}

function writeJson(filePath, payload) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(payload, null, 2), "utf8");
}

function rel(root, filePath) {
  return path.relative(root, filePath).replace(/\\/g, "/");
}

function listJsonFiles(dirPath) {
  if (!fs.existsSync(dirPath)) return [];
  const result = [];
  fs.readdirSync(dirPath, { withFileTypes: true }).forEach((entry) => {
    const fullPath = path.join(dirPath, entry.name);
    if (entry.isDirectory()) {
      result.push.apply(result, listJsonFiles(fullPath));
    } else if (entry.isFile() && entry.name.endsWith(".json")) {
      result.push(fullPath);
    }
  });
  return result;
}

function buildRelease(version, options = {}) {
  const root = path.join(tempRoot, "storage", "public", "releases");
  const releaseDir = path.join(root, version);
  ["class", "teacher", "classroom", "course"].forEach((type) => {
    writeJson(path.join(releaseDir, "index", type, "all.json"), {
      success: true,
      type,
      term: "2025-2026-2",
      releaseVersion: version,
      items: [{ id: `${type}-1`, name: `${type} sample` }],
    });
    writeJson(path.join(releaseDir, "detail", type, `${type}-1.json`), {
      success: true,
      type,
      id: `${type}-1`,
      term: "2025-2026-2",
      releaseVersion: version,
      schedule: { id: `${type}-1`, courses: [] },
    });
  });
  writeJson(path.join(releaseDir, "empty-room", "index.json"), {
    success: true,
    term: "2025-2026-2",
    releaseVersion: version,
    rooms: [],
    buildings: [],
  });
  if (options.secretFile) {
    writeJson(path.join(releaseDir, "debug-secret.json"), {
      token: "abcdefghi123456789",
      password: "not-real-password",
    });
  }
  const files = {};
  listJsonFiles(releaseDir).forEach((filePath) => {
    const relativePath = rel(releaseDir, filePath);
    if (relativePath === "manifest.json") return;
    if (!relativePath.endsWith(".json")) return;
    files[relativePath] = {
      size: fs.statSync(filePath).size,
      hash: sha1(filePath),
    };
  });
  writeJson(path.join(releaseDir, "manifest.json"), {
    success: true,
    schemaVersion: 2,
    term: "2025-2026-2",
    semester: "2025-2026-2",
    releaseVersion: version,
    version,
    updatedAt: "2026-06-14T00:00:00.000Z",
    cacheEpoch: 1,
    forceRefreshToken: `${version}:1`,
    termConfig: {
      term: "2025-2026-2",
      releaseVersion: version,
      termStartDate: "2026-03-09",
      semesterText: "2025-2026 学年第二学期",
    },
    files,
  });
  return { root, releaseDir };
}

function cleanup() {
  const resolved = path.resolve(tempRoot);
  const relative = path.relative(os.tmpdir(), resolved);
  if (!relative || relative.startsWith("..") || path.isAbsolute(relative) || !path.basename(resolved).startsWith("fosu-cloudbase-release-tools-")) {
    throw new Error(`refusing to remove unexpected temp directory: ${resolved}`);
  }
  fs.rmSync(resolved, { recursive: true, force: true });
}

async function run() {
  const version = "cloudbase-release-tools-2026-06-14";
  const good = buildRelease(version);

  const verified = utils.verifyLocalReleasePack({ publicRoot: good.root, releaseVersion: version });
  assert.strictEqual(verified.releaseVersion, version);
  assert.strictEqual(verified.samples.length, 4);
  assert.strictEqual(utils.scanPrivacy(good.releaseDir).success, true);

  const dryRun = await utils.deployReleasePack({ publicRoot: good.root, releaseVersion: version, dryRun: true });
  assert.strictEqual(dryRun.dryRun, true);
  assert(dryRun.planned.some((item) => item.cloudPath === `releases/${version}/manifest.json`));
  assert(dryRun.planned.some((item) => item.cloudPath === `releases/${version}/index/class`));
  assert(dryRun.planned.some((item) => item.cloudPath === `releases/${version}/detail/course`));
  assert(dryRun.planned.every((item) => item.cloudPath.startsWith(`releases/${version}/`)));
  assert(!dryRun.planned.some((item) => item.cloudPath === "runtime/active.json"), "release:auto must not plan runtime/active.json cutover");

  const secretVersion = "cloudbase-release-secret-2026-06-14";
  const secret = buildRelease(secretVersion, { secretFile: true });
  assert.throws(
    () => utils.scanPrivacy(secret.releaseDir),
    (error) => error && error.code === "CLOUDBASE_PRIVACY_SCAN_FAILED",
    "privacy scan should block token/password before upload"
  );

  const interruptedCalls = [];
  await assert.rejects(
    () => utils.deployReleasePack({
      publicRoot: good.root,
      releaseVersion: version,
      execute: true,
      hostingBaseUrl: "https://cloud.example.com",
      commandRunner: (localPath, cloudPath) => {
        interruptedCalls.push(cloudPath);
        return { localPath, cloudPath };
      },
      remoteVerifier: async () => {
        const error = new Error("remote verification failed");
        error.code = "CLOUDBASE_REMOTE_VERIFY_HTTP";
        throw error;
      },
    }),
    (error) => error && error.code === "CLOUDBASE_REMOTE_VERIFY_HTTP",
    "remote verification failure should stop before active pointer update"
  );
  assert.deepStrictEqual(interruptedCalls, dryRun.planned.map((item) => item.cloudPath));
  assert(!interruptedCalls.includes("runtime/active.json"), "active pointer must be deployed only by cutover");

  const cutoverCalls = [];
  const cutover = await utils.cutoverReleasePack({
    publicRoot: good.root,
    releaseVersion: version,
    hostingBaseUrl: "https://cloud.example.com",
    confirmation: "CONFIRM_CLOUDBASE_CUTOVER",
    oracleActiveReleaseVersion: version,
    gitStatusRecorded: true,
    commandRunner: (localPath, cloudPath) => {
      cutoverCalls.push({ localPath, cloudPath });
      return { localPath, cloudPath };
    },
    remoteVerifier: async () => ({ success: true, releaseVersion: version, samples: ["manifest.json"] }),
    runtimePointerVerifier: async () => ({ success: true, releaseVersion: version }),
  });
  assert.strictEqual(cutover.success, true);
  assert.deepStrictEqual(cutoverCalls.map((item) => item.cloudPath), ["runtime/active.json"], "cutover should upload only active pointer after prior release verification");
  assert(cutover.readyRecommendation.includes("CLOUDBASE_HOSTING_READY"), "READY=true recommendation is allowed only after pointer verification");

  const driftPointer = utils.buildCloudbasePointer(verified.manifest, {
    releaseVersion: version,
    hostingBaseUrl: "https://cloud.example.com",
    activePointer: {
      releaseVersion: version,
      term: "2025-2026-2",
      updatedAt: "2026-06-14T01:02:03.000Z",
      cacheEpoch: 12345,
      forceRefreshToken: `${version}:12345`,
      urls: {
        manifest: "/static/releases/wrong/manifest.json",
      },
    },
  });
  assert.strictEqual(driftPointer.cacheEpoch, 12345);
  assert.strictEqual(driftPointer.forceRefreshToken, `${version}:12345`);
  assert.strictEqual(driftPointer.urls.manifest, `https://cloud.example.com/releases/${version}/manifest.json`);
  assert(!JSON.stringify(driftPointer).includes("/static/releases/wrong"), "CloudBase pointer should not keep Oracle/static URLs");

  await assert.rejects(
    () => utils.cutoverReleasePack({
      publicRoot: good.root,
      releaseVersion: version,
      hostingBaseUrl: "https://cloud.example.com",
      confirmation: "WRONG",
      oracleActiveReleaseVersion: version,
      gitStatusRecorded: true,
      remoteVerifier: async () => ({ success: true }),
      runtimePointerVerifier: async () => ({ success: true }),
    }),
    (error) => error && error.code === "CLOUDBASE_CUTOVER_CONFIRMATION_REQUIRED",
    "cutover must require exact confirmation text"
  );

  const invalidVersion = "cloudbase-release-invalid-2026-06-14";
  const invalid = buildRelease(invalidVersion);
  fs.unlinkSync(path.join(invalid.releaseDir, "index", "teacher", "all.json"));
  const invalidCalls = [];
  await assert.rejects(
    () => utils.deployReleasePack({
      publicRoot: invalid.root,
      releaseVersion: invalidVersion,
      execute: true,
      hostingBaseUrl: "https://cloud.example.com",
      commandRunner: (localPath, cloudPath) => {
        invalidCalls.push(cloudPath);
        return { localPath, cloudPath };
      },
      remoteVerifier: async () => ({ success: true }),
    }),
    (error) => error && error.code === "CLOUDBASE_RELEASE_FILE_MISSING",
    "invalid new release should fail before upload"
  );
  assert.deepStrictEqual(invalidCalls, [], "invalid release must not upload files or active pointer");

  const mismatchVersion = "cloudbase-release-hash-mismatch-2026-06-14";
  const mismatch = buildRelease(mismatchVersion);
  writeJson(path.join(mismatch.releaseDir, "index", "course", "all.json"), {
    success: true,
    type: "course",
    term: "2025-2026-2",
    releaseVersion: mismatchVersion,
    items: [{ id: "course-1", name: "tampered course" }],
  });
  const mismatchCalls = [];
  await assert.rejects(
    () => utils.deployReleasePack({
      publicRoot: mismatch.root,
      releaseVersion: mismatchVersion,
      execute: true,
      hostingBaseUrl: "https://cloud.example.com",
      commandRunner: (localPath, cloudPath) => {
        mismatchCalls.push(cloudPath);
        return { localPath, cloudPath };
      },
      remoteVerifier: async () => ({ success: true }),
    }),
    (error) => error && error.code === "CLOUDBASE_RELEASE_HASH_MISMATCH",
    "hash mismatch should stop before CloudBase upload"
  );
  assert.deepStrictEqual(mismatchCalls, [], "hash mismatch must not upload release files");

  const prune = utils.planPruneReleasePack({
    releases: [
      { releaseVersion: "v5", updatedAt: "2026-06-14T00:00:00.000Z" },
      { releaseVersion: "v4", updatedAt: "2026-06-13T00:00:00.000Z" },
      { releaseVersion: "v3", updatedAt: "2026-06-12T00:00:00.000Z" },
      { releaseVersion: "v2", updatedAt: "2026-06-11T00:00:00.000Z" },
      { releaseVersion: "v1", updatedAt: "2026-06-10T00:00:00.000Z" },
    ],
    activeReleaseVersion: "v2",
    lastGoodReleaseVersion: "v1",
    keepLatest: 3,
    dryRun: true,
  });
  assert.strictEqual(prune.dryRun, true);
  assert(!prune.deletions.includes("v2"), "active release should not be pruned");
  assert(!prune.deletions.includes("v1"), "last-good release should not be pruned");
  assert.deepStrictEqual(prune.deletions, [], "latest 3 plus active and last-good should leave no deletion");

  const remoteList = JSON.stringify({
    data: [
      { Path: "releases/r5/manifest.json" },
      { Path: "releases/r4/index/class/all.json" },
      { Path: "releases/r3/manifest.json" },
      { Path: "releases/r2/manifest.json" },
      { Path: "releases/r1/manifest.json" },
      { Path: "runtime/active.json" },
    ],
  });
  const remoteReleases = utils.parseRemoteReleaseVersionsFromHostingList(remoteList);
  assert.deepStrictEqual(remoteReleases.map((item) => item.releaseVersion), ["r5", "r4", "r3", "r2", "r1"]);
  const remotePrune = utils.planRemotePruneReleasePack({
    remoteReleases,
    activePointer: { releaseVersion: "r2", lastGoodReleaseVersion: "r1" },
    keepLatest: 3,
    keep: ["r4"],
    dryRun: true,
  });
  assert.strictEqual(remotePrune.dryRun, true);
  assert(remotePrune.protectedVersions.includes("r2"), "remote active release should be protected");
  assert(remotePrune.protectedVersions.includes("r1"), "remote last-good release should be protected");
  assert(remotePrune.protectedVersions.includes("r4"), "pinned release should be protected");
  assert.deepStrictEqual(remotePrune.deletions, [], "protected active/last-good/latest/pinned should leave no remote deletion");

  const deleteCalls = [];
  const executablePrune = await utils.pruneRemoteReleasePack({
    hostingListOutput: remoteList,
    activePointer: { releaseVersion: "r5" },
    keepLatest: 1,
    keep: ["r2"],
    execute: true,
    confirm: "CONFIRM_DELETE_CLOUDBASE_OLD_RELEASES",
    deleteRunner: (cloudPath, options) => {
      deleteCalls.push({ cloudPath, dir: options.dir, dryRun: options.dryRun });
      return { cloudPath, status: 0 };
    },
  });
  assert(executablePrune.deletions.every((item) => item.path.startsWith("releases/")));
  assert(!executablePrune.deletions.some((item) => item.path === "runtime/active.json"));
  assert(deleteCalls.every((item) => item.dir === true && item.dryRun === false));
  await assert.rejects(
    () => utils.pruneRemoteReleasePack({
      hostingListOutput: remoteList,
      activePointer: { releaseVersion: "r5" },
      keepLatest: 1,
      execute: true,
      confirm: "WRONG",
      deleteRunner: () => ({ status: 0 }),
    }),
    (error) => error && error.code === "CLOUDBASE_PRUNE_CONFIRMATION_REQUIRED",
    "remote prune must require exact confirmation text"
  );

  assert.strictEqual(syncActive.classifyVersions(
    { releaseVersion: "v2", cacheEpoch: 2, pointer: { updatedAt: "2026-06-14T00:00:00.000Z" } },
    { available: true, releaseVersion: "v1", cacheEpoch: 1, pointer: { updatedAt: "2026-06-13T00:00:00.000Z" } }
  ), "oracle-newer");
  assert.strictEqual(syncActive.classifyVersions(
    { releaseVersion: "v1", cacheEpoch: 1, pointer: { updatedAt: "2026-06-13T00:00:00.000Z" } },
    { available: true, releaseVersion: "v2", cacheEpoch: 2, pointer: { updatedAt: "2026-06-14T00:00:00.000Z" } }
  ), "cloudbase-newer");
  assert.strictEqual(syncActive.classifyVersions(
    { releaseVersion: "v2", cacheEpoch: 2 },
    { available: true, releaseVersion: "v2", cacheEpoch: 2 }
  ), "same-and-healthy");
  assert.strictEqual(syncActive.classifyVersions(
    { releaseVersion: "v2", term: "2025-2026-2", cacheEpoch: 3, forceRefreshToken: "v2:3", pointer: { updatedAt: "2026-06-14T00:00:00.000Z" } },
    { available: true, releaseVersion: "v2", term: "2025-2026-2", cacheEpoch: 2, forceRefreshToken: "v2:2", pointer: { updatedAt: "2026-06-14T00:00:00.000Z" } }
  ), "same-release-metadata-drift");
  assert.strictEqual(syncActive.classifyVersions(
    { releaseVersion: "v2", cacheEpoch: 2, manifestHash: "aaa", manifestSize: 100 },
    { available: true, releaseVersion: "v2", cacheEpoch: 2, manifestHash: "bbb", manifestSize: 100 }
  ), "manifest-conflict");
  const sanitizedReceipt = syncActive.sanitizeForReceipt({
    url: "https://example.com/runtime/active.json?ticket=secret-token",
    headers: { cookie: "abc", Authorization: "Bearer secret" },
  });
  assert(!JSON.stringify(sanitizedReceipt).includes("secret-token"));
  assert.strictEqual(sanitizedReceipt.headers.cookie, "[redacted]");

  cleanup();
  console.log("test-cloudbase-release-tools passed");
}

run().catch((error) => {
  console.error(error);
  try { cleanup(); } catch (cleanupError) {}
  process.exit(1);
});
