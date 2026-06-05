const assert = require("assert");
const { spawn } = require("child_process");
const fs = require("fs");
const http = require("http");
const os = require("os");
const path = require("path");

const tempRoot = path.join(os.tmpdir(), `fosu-static-reconcile-${process.pid}-${Date.now()}`);
const storageDir = path.join(tempRoot, "storage");
const openrestyDir = path.join(tempRoot, "openresty-releases");

process.env.FOSU_STORAGE_DIR = storageDir;
process.env.FOSU_DATA_DIR = path.join(tempRoot, "data");
process.env.RELEASE_PACK_SRC = path.join(storageDir, "public", "releases");
process.env.OPENRESTY_STATIC_RELEASE_DIR = openrestyDir;
process.env.STATIC_RELEASE_SYNC_ENABLED = "true";
process.env.STATIC_RELEASE_KEEP_LATEST = "3";
process.env.NODE_ENV = "test";

const releaseService = require("../server/src/services/releaseService");
const staticReleaseSyncService = require("../server/src/services/staticReleaseSyncService");

function snapshot(version) {
  const course = {
    courseName: "Reconcile Course",
    teacherName: "Teacher R",
    classroom: "R-101",
    weekday: 1,
    startSection: 1,
    endSection: 2,
    sections: [1, 2],
    weeks: [1, 2],
  };
  return {
    schemaVersion: "1.0",
    version,
    releaseVersion: version,
    term: "2025-2026-2",
    semester: "2025-2026-2",
    termStartDate: "2026-03-09",
    generatedAt: "2026-06-05T00:00:00.000Z",
    updatedAt: "2026-06-05T00:00:00.000Z",
    catalog: { colleges: [{ code: "04", name: "Test College" }], grades: ["2025"] },
    majors: [{ collegeCode: "04", code: "0401", name: "Test Major", grade: "2025" }],
    classSchedules: [{ className: "25 Reconcile 1", courses: [course] }],
    resources: {
      teachers: [{ teacherName: "Teacher R" }],
      classrooms: [{ roomName: "R-101" }],
      courses: [{ courseName: "Reconcile Course" }],
      teacherSchedules: [{ teacherName: "Teacher R", courses: [course] }],
      classroomSchedules: [{ roomName: "R-101", courses: [course] }],
      courseSchedules: [{ courseName: "Reconcile Course", courses: [course] }],
    },
  };
}

function cleanup() {
  const resolvedRoot = path.resolve(tempRoot);
  const relativeRoot = path.relative(os.tmpdir(), resolvedRoot);
  if (!relativeRoot || relativeRoot.startsWith("..") || path.isAbsolute(relativeRoot) || !path.basename(resolvedRoot).startsWith("fosu-static-reconcile-")) {
    throw new Error(`refusing cleanup: ${resolvedRoot}`);
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
      etag: `"${path.basename(filePath)}"`,
    });
    if (req.method === "HEAD") {
      res.end();
      return;
    }
    res.end(fs.readFileSync(filePath));
  });
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => resolve(server));
  });
}

function makeRequiredFiles(root, version) {
  const releaseDir = path.join(root, version);
  fs.mkdirSync(path.join(releaseDir, "index", "class"), { recursive: true });
  fs.mkdirSync(path.join(releaseDir, "empty-room"), { recursive: true });
  fs.writeFileSync(path.join(releaseDir, "manifest.json"), JSON.stringify({ releaseVersion: version }), "utf-8");
  fs.writeFileSync(path.join(releaseDir, "index", "class", "all.json"), JSON.stringify({ success: true, items: [] }), "utf-8");
  fs.writeFileSync(path.join(releaseDir, "empty-room", "index.json"), JSON.stringify({ success: true, rooms: [] }), "utf-8");
  return releaseDir;
}

function runReconcileScript(version) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [path.join(__dirname, "..", "server", "scripts", "reconcile-static-release.js"), `--version=${version}`], {
      cwd: path.join(__dirname, ".."),
      env: Object.assign({}, process.env, { STATIC_RELEASE_SYNC_HTTP_TIMEOUT_MS: "1000" }),
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => { stdout += chunk.toString(); });
    child.stderr.on("data", (chunk) => { stderr += chunk.toString(); });
    child.on("close", (status) => resolve({ status, stdout, stderr }));
  });
}

(async () => {
  const version = "static-reconcile-2026-06-05";
  fs.mkdirSync(openrestyDir, { recursive: true });
  const server = await listenStatic(openrestyDir);
  process.env.PUBLIC_BASE_URL = `http://127.0.0.1:${server.address().port}/static/releases`;

  try {
    releaseService.activateReleaseFromSnapshot(snapshot(version));

    const first = await staticReleaseSyncService.syncStaticRelease(version, { timeoutMs: 1000 });
    assert.strictEqual(first.status, "success");
    assert(first.filesCopied > 0, "first sync should copy release files");

    const unchanged = await staticReleaseSyncService.reconcileStaticRelease(version, { timeoutMs: 1000 });
    assert.strictEqual(unchanged.status, "unchanged");
    assert.strictEqual(unchanged.filesCopied, 0, "idempotent reconcile should not recopy unchanged files");

    fs.unlinkSync(path.join(openrestyDir, version, "manifest.json"));
    let status = staticReleaseSyncService.getSyncStatus({ version });
    assert.strictEqual(status.needsSync, true);
    assert.strictEqual(status.needsSyncReason, "required-files-missing");
    const repaired = await staticReleaseSyncService.reconcileStaticRelease(version, { timeoutMs: 1000 });
    assert.strictEqual(repaired.status, "success");
    assert(fs.existsSync(path.join(openrestyDir, version, "manifest.json")), "reconcile should repair missing required files");

    const script = await runReconcileScript(version);
    assert.strictEqual(script.status, 0, script.stderr || script.stdout);
    const scriptOutput = JSON.parse(script.stdout);
    assert.strictEqual(scriptOutput.success, true);
    assert.strictEqual(scriptOutput.staticSync.releaseVersion, version);

    const oldGood = "static-reconcile-old-good";
    const stale = ["static-reconcile-stale-1", "static-reconcile-stale-2", "static-reconcile-stale-3"];
    [oldGood].concat(stale).forEach((item, index) => {
      const dir = makeRequiredFiles(openrestyDir, item);
      const time = new Date(Date.now() - (10 + index) * 3600000);
      fs.utimesSync(dir, time, time);
    });
    fs.writeFileSync(path.join(storageDir, "static-release-sync-status.json"), JSON.stringify({
      status: "success",
      success: true,
      releaseVersion: oldGood,
      syncedReleaseVersion: oldGood,
      verifiedUrls: [],
    }, null, 2), "utf-8");

    await staticReleaseSyncService.syncStaticRelease(version, { timeoutMs: 1000 });
    assert(fs.existsSync(path.join(openrestyDir, version)), "active release must be preserved");
    assert(fs.existsSync(path.join(openrestyDir, oldGood)), "previous synced last-known-good candidate must be preserved");

    server.close();
    cleanup();
    console.log("test-static-reconcile passed");
  } catch (error) {
    server.close();
    try { cleanup(); } catch (cleanupError) {}
    throw error;
  }
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
