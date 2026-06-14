const assert = require("assert");
const crypto = require("crypto");
const fs = require("fs");
const os = require("os");
const path = require("path");

const tempRoot = path.join(os.tmpdir(), `fosu-cloudbase-release-tools-${process.pid}-${Date.now()}`);
process.env.FOSU_STORAGE_DIR = path.join(tempRoot, "storage");

const utils = require("./cloudbase/release-pack-utils");

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
  assert.strictEqual(dryRun.planned[0].cloudPath, `releases/${version}`);
  assert.strictEqual(dryRun.planned[1].cloudPath, "runtime/active.json");

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
  assert.deepStrictEqual(interruptedCalls, [`releases/${version}`], "active pointer must be deployed only after release verification");

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

  cleanup();
  console.log("test-cloudbase-release-tools passed");
}

run().catch((error) => {
  console.error(error);
  try { cleanup(); } catch (cleanupError) {}
  process.exit(1);
});
