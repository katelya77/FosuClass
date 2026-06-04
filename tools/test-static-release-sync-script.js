const assert = require("assert");
const { spawn } = require("child_process");
const fs = require("fs");
const http = require("http");
const os = require("os");
const path = require("path");

const tempRoot = path.join(os.tmpdir(), `fosu-static-sync-script-${process.pid}-${Date.now()}`);
const srcRoot = path.join(tempRoot, "src-releases");
const dstRoot = path.join(tempRoot, "openresty-releases");
const storageDir = path.join(tempRoot, "storage");

function writeJson(filePath, data) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2), "utf-8");
}

function makeRequiredFiles(root, version) {
  const releaseDir = path.join(root, version);
  writeJson(path.join(releaseDir, "manifest.json"), { success: true, releaseVersion: version, term: "2025-2026-2" });
  writeJson(path.join(releaseDir, "index", "class", "all.json"), { success: true, type: "class", releaseVersion: version, items: [] });
  writeJson(path.join(releaseDir, "empty-room", "index.json"), { success: true, releaseVersion: version, rooms: [] });
  return releaseDir;
}

function cleanup() {
  const resolvedRoot = path.resolve(tempRoot);
  const relativeRoot = path.relative(os.tmpdir(), resolvedRoot);
  if (!relativeRoot || relativeRoot.startsWith("..") || path.isAbsolute(relativeRoot) || !path.basename(resolvedRoot).startsWith("fosu-static-sync-script-")) {
    throw new Error(`refusing to remove unexpected temp directory: ${resolvedRoot}`);
  }
  fs.rmSync(resolvedRoot, { recursive: true, force: true });
}

function listenStatic(root) {
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, "http://127.0.0.1");
    const prefix = "/static/releases/";
    if (!url.pathname.startsWith(prefix)) {
      res.writeHead(404);
      res.end("not found");
      return;
    }
    const relative = decodeURIComponent(url.pathname.slice(prefix.length));
    const filePath = path.resolve(root, relative);
    if (!filePath.startsWith(path.resolve(root)) || !fs.existsSync(filePath)) {
      res.writeHead(404);
      res.end("not found");
      return;
    }
    res.writeHead(200, {
      "content-type": "application/json",
      "cache-control": "public, max-age=31536000, immutable",
    });
    res.end(fs.readFileSync(filePath));
  });
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => resolve(server));
  });
}

function runScript(env) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [path.join("tools", "sync-static-release.js"), "--version=v4"], {
      cwd: path.join(__dirname, ".."),
      env,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => { stdout += chunk.toString(); });
    child.stderr.on("data", (chunk) => { stderr += chunk.toString(); });
    child.on("close", (status) => resolve({ status, stdout, stderr }));
  });
}

async function run() {
  fs.mkdirSync(srcRoot, { recursive: true });
  fs.mkdirSync(dstRoot, { recursive: true });
  ["v1", "v2", "v3"].forEach((version, index) => {
    const dir = makeRequiredFiles(dstRoot, version);
    const time = new Date(Date.now() - (4 - index) * 60 * 1000);
    fs.utimesSync(dir, time, time);
  });
  makeRequiredFiles(srcRoot, "v4");

  const server = await listenStatic(dstRoot);
  const publicBaseUrl = `http://127.0.0.1:${server.address().port}/static/releases`;
  try {
    const result = await runScript(Object.assign({}, process.env, {
        FOSU_STORAGE_DIR: storageDir,
        RELEASE_PACK_SRC: srcRoot,
        OPENRESTY_STATIC_RELEASE_DIR: dstRoot,
        PUBLIC_BASE_URL: publicBaseUrl,
        STATIC_RELEASE_SYNC_ENABLED: "true",
        STATIC_RELEASE_KEEP_LATEST: "3",
      }));
    assert.strictEqual(result.status, 0, result.stderr || result.stdout);

    const output = JSON.parse(result.stdout);
    assert.strictEqual(output.success, true);
    assert.strictEqual(output.releaseVersion, "v4");
    assert(fs.existsSync(path.join(dstRoot, "v4", "manifest.json")), "synced manifest should exist in OpenResty directory");
    assert(!fs.existsSync(path.join(dstRoot, ".static-release-sync.lock")), "sync lock should be released");
    const releaseDirs = fs.readdirSync(dstRoot, { withFileTypes: true }).filter((entry) => entry.isDirectory()).map((entry) => entry.name);
    assert(releaseDirs.includes("v4"), "new release should be retained");
    assert(releaseDirs.length >= 3, "sync should keep at least 3 releases");
    assert(releaseDirs.length <= 3, "sync should prune releases beyond retention window in this fixture");
    assert(!releaseDirs.includes("v1"), "oldest stale release should be pruned");
  } finally {
    server.close();
    cleanup();
  }

  console.log("test-static-release-sync-script passed");
}

run().catch((error) => {
  console.error(error);
  try { cleanup(); } catch (cleanupError) {}
  process.exit(1);
});
