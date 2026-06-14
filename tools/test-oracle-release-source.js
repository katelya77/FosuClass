const assert = require("assert");
const crypto = require("crypto");
const fs = require("fs");
const http = require("http");
const os = require("os");
const path = require("path");

const {
  assertSafeRelativePath,
  downloadReleaseFromOracle,
} = require("./cloudbase/oracle-release-source");

const tempRoot = path.join(os.tmpdir(), `fosu-oracle-release-source-${process.pid}-${Date.now()}`);
const sourceRoot = path.join(tempRoot, "oracle");
const outputRoot = path.join(tempRoot, "downloads");
const term = "2025-2026-2";
const releaseVersion = "oracle-release-source-2026-06-14";

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

function buildRelease(options = {}) {
  const releaseDir = path.join(sourceRoot, "static", "releases", releaseVersion);
  ["class", "teacher", "classroom", "course"].forEach((type) => {
    writeJson(path.join(releaseDir, "index", type, "all.json"), {
      success: true,
      type,
      term,
      releaseVersion,
      items: [{ id: `${type}-1`, name: `${type} sample` }],
    });
    writeJson(path.join(releaseDir, "detail", type, `${type}-1.json`), {
      success: true,
      type,
      id: `${type}-1`,
      term,
      releaseVersion,
      schedule: { id: `${type}-1`, courses: [] },
    });
  });
  writeJson(path.join(releaseDir, "empty-room", "index.json"), {
    success: true,
    term,
    releaseVersion,
    rooms: [],
    buildings: [],
  });
  const files = {};
  listJsonFiles(releaseDir).forEach((filePath) => {
    const relativePath = rel(releaseDir, filePath);
    if (relativePath === "manifest.json") return;
    files[relativePath] = {
      size: fs.statSync(filePath).size,
      hash: sha1(filePath),
    };
  });
  if (options.traversal) {
    files["../evil.json"] = { size: 2, hash: "bad" };
  }
  if (options.hashMismatch) {
    files["index/teacher/all.json"].hash = "0".repeat(40);
  }
  const manifest = {
    success: true,
    schemaVersion: 2,
    term,
    semester: term,
    releaseVersion,
    version: releaseVersion,
    updatedAt: "2026-06-14T00:00:00.000Z",
    cacheEpoch: 1,
    forceRefreshToken: `${releaseVersion}:1`,
    termConfig: {
      term,
      releaseVersion,
      termStartDate: "2026-03-09",
      semesterText: "2025-2026-2",
    },
    files,
  };
  writeJson(path.join(releaseDir, "manifest.json"), manifest);
  writeJson(path.join(sourceRoot, "static", "runtime", "active.json"), {
    success: true,
    activeTerm: term,
    term,
    releaseVersion,
    cacheEpoch: 1,
    forceRefreshToken: `${releaseVersion}:1`,
    termConfig: manifest.termConfig,
  });
  return { releaseDir, manifest };
}

function listenStatic(root, stats) {
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, "http://127.0.0.1");
    let requestPath = url.pathname;
    if (requestPath === "/api/fosu/runtime/active") {
      requestPath = "/static/runtime/active.json";
    }
    const relative = decodeURIComponent(requestPath.replace(/^\/+/, ""));
    const filePath = path.resolve(root, relative);
    if (!filePath.startsWith(path.resolve(root)) || !fs.existsSync(filePath)) {
      res.writeHead(404);
      res.end("not found");
      return;
    }
    const buffer = fs.readFileSync(filePath);
    const range = req.headers.range || "";
    if (range) {
      stats.rangeRequests += 1;
      const match = range.match(/bytes=(\d+)-/);
      const start = match ? Number(match[1]) : 0;
      res.writeHead(206, {
        "content-type": "application/json",
        "content-range": `bytes ${start}-${buffer.length - 1}/${buffer.length}`,
      });
      res.end(buffer.slice(start));
      return;
    }
    res.writeHead(200, { "content-type": "application/json" });
    res.end(buffer);
  });
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => resolve(server));
  });
}

function cleanup() {
  const resolved = path.resolve(tempRoot);
  const relative = path.relative(os.tmpdir(), resolved);
  if (!relative || relative.startsWith("..") || path.isAbsolute(relative) || !path.basename(resolved).startsWith("fosu-oracle-release-source-")) {
    throw new Error(`refusing to remove unexpected temp directory: ${resolved}`);
  }
  fs.rmSync(resolved, { recursive: true, force: true });
}

async function withServer(options, fn) {
  fs.rmSync(sourceRoot, { recursive: true, force: true });
  const built = buildRelease(options);
  const stats = { rangeRequests: 0 };
  const server = await listenStatic(sourceRoot, stats);
  const oracleBaseUrl = `http://127.0.0.1:${server.address().port}`;
  try {
    return await fn({ oracleBaseUrl, built, stats });
  } finally {
    server.close();
  }
}

async function testPullReleaseAndResumePart() {
  await withServer({}, async ({ oracleBaseUrl, built, stats }) => {
    const relativePath = "detail/course/course-1.json";
    const sourceFile = path.join(built.releaseDir, relativePath);
    const partPath = path.join(outputRoot, releaseVersion, relativePath) + ".part";
    fs.mkdirSync(path.dirname(partPath), { recursive: true });
    fs.writeFileSync(partPath, fs.readFileSync(sourceFile).slice(0, 12));
    const result = await downloadReleaseFromOracle({ oracleBaseUrl, outputRoot, concurrency: 2, retryCount: 2 });
    assert.strictEqual(result.success, true);
    assert.strictEqual(result.releaseVersion, releaseVersion);
    assert.strictEqual(result.term, term);
    assert.strictEqual(result.verification.local.samples.length, 4);
    assert.strictEqual(result.verification.privacy.success, true);
    assert(stats.rangeRequests >= 1, "existing .part should trigger a Range resume request");
    assert(!fs.existsSync(partPath), ".part should be atomically renamed after successful resume");
    assert.strictEqual(sha1(path.join(outputRoot, releaseVersion, relativePath)), sha1(sourceFile));
  });
}

async function testTraversalIsBlocked() {
  await withServer({ traversal: true }, async ({ oracleBaseUrl }) => {
    await assert.rejects(
      () => downloadReleaseFromOracle({ oracleBaseUrl, outputRoot: path.join(tempRoot, "traversal") }),
      (error) => error && error.code === "ORACLE_RELEASE_PATH_TRAVERSAL"
    );
  });
  assert.throws(() => assertSafeRelativePath("../evil.json"), /Unsafe release file path/);
}

async function testHashMismatchBlocksPublish() {
  await withServer({ hashMismatch: true }, async ({ oracleBaseUrl }) => {
    await assert.rejects(
      () => downloadReleaseFromOracle({ oracleBaseUrl, outputRoot: path.join(tempRoot, "hash-mismatch") }),
      (error) => error && error.code === "ORACLE_RELEASE_HASH_MISMATCH"
    );
  });
}

async function run() {
  await testPullReleaseAndResumePart();
  await testTraversalIsBlocked();
  await testHashMismatchBlocksPublish();
  cleanup();
  console.log("test-oracle-release-source passed");
}

run().catch((error) => {
  console.error(error);
  try { cleanup(); } catch (cleanupError) {}
  process.exit(1);
});
