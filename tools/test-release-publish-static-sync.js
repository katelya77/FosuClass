const assert = require("assert");
const fs = require("fs");
const http = require("http");
const os = require("os");
const path = require("path");

const tempRoot = path.join(os.tmpdir(), `fosu-publish-static-sync-${process.pid}-${Date.now()}`);
const storageDir = path.join(tempRoot, "storage");
const openrestyDir = path.join(tempRoot, "openresty-releases");
const openrestyRuntimeDir = path.join(tempRoot, "openresty-runtime");

process.env.FOSU_STORAGE_DIR = storageDir;
process.env.FOSU_DATA_DIR = path.join(tempRoot, "data");
process.env.OPENRESTY_STATIC_RELEASE_DIR = openrestyDir;
process.env.OPENRESTY_STATIC_RUNTIME_DIR = openrestyRuntimeDir;
process.env.RELEASE_PACK_SRC = path.join(storageDir, "public", "releases");
process.env.RUNTIME_POINTER_SRC = path.join(storageDir, "public", "runtime");
process.env.STATIC_RELEASE_SYNC_ENABLED = "true";
process.env.STATIC_RELEASE_KEEP_LATEST = "3";
process.env.NODE_ENV = "development";
process.env.ADMIN_API_TOKEN = "test-admin-token";
process.env.ADMIN_PASSWORD = "test-admin-password";

function snapshot(version) {
  const course = {
    courseName: "Static Sync Course",
    teacherName: "张三",
    classroom: "C7-306",
    weekday: 1,
    startSection: 1,
    endSection: 2,
    sections: [1, 2],
    weeks: [1, 2, 3],
  };
  return {
    schemaVersion: 1,
    version,
    releaseVersion: version,
    term: "2025-2026-2",
    semester: "2025-2026-2",
    termStartDate: "2026-03-09",
    totalWeeks: 19,
    termConfig: {
      term: "2025-2026-2",
      semesterText: "2025-2026 学年第二学期",
      termStartDate: "2026-03-09",
      weekStart: "monday",
      totalWeeks: 19,
    },
    generatedAt: "2026-06-04T00:00:00.000Z",
    updatedAt: "2026-06-04T00:00:00.000Z",
    catalog: { colleges: [{ code: "04", name: "测试学院" }], grades: ["2025"] },
    majors: [{ collegeCode: "04", code: "0401", name: "测试专业", grade: "2025" }],
    classSchedules: [{
      className: "25静态同步1班",
      semester: "2025-2026-2",
      collegeCode: "04",
      collegeName: "测试学院",
      grade: "2025",
      majorCode: "0401",
      majorName: "测试专业",
      courses: [course],
    }],
    resources: {
      teachers: [{ teacherName: "张三", displayName: "张三", collegeName: "测试学院" }],
      classrooms: [{ roomName: "C7-306" }],
      courses: [{ courseName: "Static Sync Course" }],
      teacherSchedules: [{ teacherName: "张三", semester: "2025-2026-2", courses: [course] }],
      classroomSchedules: [{ roomName: "C7-306", semester: "2025-2026-2", courses: [course] }],
      courseSchedules: [{ courseName: "Static Sync Course", semester: "2025-2026-2", courses: [course] }],
    },
  };
}

function cleanup() {
  const resolvedRoot = path.resolve(tempRoot);
  const relativeRoot = path.relative(os.tmpdir(), resolvedRoot);
  if (!relativeRoot || relativeRoot.startsWith("..") || path.isAbsolute(relativeRoot) || !path.basename(resolvedRoot).startsWith("fosu-publish-static-sync-")) {
    throw new Error(`refusing to remove unexpected temp directory: ${resolvedRoot}`);
  }
  fs.rmSync(resolvedRoot, { recursive: true, force: true });
}

function listenStatic(root, runtimeRoot) {
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, "http://127.0.0.1");
    const releasePrefix = "/static/releases/";
    const runtimePrefix = "/static/runtime/";
    const isRelease = url.pathname.startsWith(releasePrefix);
    const isRuntime = url.pathname.startsWith(runtimePrefix);
    if (!isRelease && !isRuntime) {
      res.writeHead(404);
      res.end("not found");
      return;
    }
    const baseRoot = isRuntime ? runtimeRoot : root;
    const relative = decodeURIComponent(url.pathname.slice(isRuntime ? runtimePrefix.length : releasePrefix.length));
    const filePath = path.resolve(baseRoot, relative);
    if (!filePath.startsWith(path.resolve(baseRoot)) || !fs.existsSync(filePath)) {
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

function listen(app) {
  return new Promise((resolve) => {
    const server = app.listen(0, "127.0.0.1", () => resolve(server));
  });
}

async function requestJson(baseUrl, pathname, options = {}) {
  const response = await fetch(`${baseUrl}${pathname}`, Object.assign({
    headers: { "x-admin-token": "test-admin-token", "Content-Type": "application/json" },
  }, options));
  return {
    status: response.status,
    data: await response.json(),
  };
}

async function waitJob(baseUrl, id) {
  for (let index = 0; index < 60; index += 1) {
    const status = await requestJson(baseUrl, `/api/admin/jobs/${encodeURIComponent(id)}`);
    const job = status.data.job;
    if (job.status === "success" || job.status === "failed") return job;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error(`job ${id} did not finish`);
}

async function run() {
  fs.mkdirSync(storageDir, { recursive: true });
  fs.mkdirSync(openrestyDir, { recursive: true });
  fs.mkdirSync(openrestyRuntimeDir, { recursive: true });

  const staticServer = await listenStatic(openrestyDir, openrestyRuntimeDir);
  process.env.PUBLIC_BASE_URL = `http://127.0.0.1:${staticServer.address().port}/static/releases`;

  const express = require("../server/node_modules/express");
  const adminRouter = require("../server/src/routes/admin");
  const releaseService = require("../server/src/services/releaseService");
  const termRegistryService = require("../server/src/services/termRegistryService");

  const app = express();
  app.use(express.json({ limit: "2mb" }));
  app.use("/api/admin", adminRouter);
  const adminServer = await listen(app);
  const baseUrl = `http://127.0.0.1:${adminServer.address().port}`;

  try {
    const version = "publish-static-sync-2026-06-04";
    fs.mkdirSync(storageDir, { recursive: true });
    termRegistryService.writeRegistry({
      schemaVersion: 1,
      activeTerm: "2025-2026-2",
      updatedAt: "2026-06-04T00:00:00.000Z",
      terms: [{
        term: "2025-2026-2",
        semesterText: "2025-2026 学年第二学期",
        termStartDate: "2026-03-09",
        weekStart: "monday",
        totalWeeks: 19,
        status: "current",
        releaseVersion: "legacy-active",
        dataAvailable: true,
        publishedAt: "2026-06-04T00:00:00.000Z",
        updatedAt: "2026-06-04T00:00:00.000Z",
        source: "test-fixture",
      }],
    }, { backup: false });
    fs.writeFileSync(path.join(storageDir, "staging-latest.json"), JSON.stringify(snapshot(version), null, 2), "utf-8");

    const publishStart = await requestJson(baseUrl, "/api/admin/sync/staging/publish/start", {
      method: "POST",
      body: JSON.stringify({ force: false }),
    });
    assert.strictEqual(publishStart.status, 202, JSON.stringify(publishStart.data));
    const job = await waitJob(baseUrl, publishStart.data.job.id);
    assert.strictEqual(job.status, "success", JSON.stringify(job, null, 2));
    assert.strictEqual(job.result.releaseVersion, version);
    assert(job.result.staticSync && job.result.staticSync.success, "publish job should sync OpenResty static directory");
    assert(fs.existsSync(path.join(openrestyDir, version, "manifest.json")), "OpenResty manifest should exist after publish");
    assert(fs.existsSync(path.join(openrestyRuntimeDir, "active.json")), "OpenResty runtime pointer should exist after publish");
    assert.strictEqual(releaseService.getActiveReleaseInfo().releaseVersion, version, "active pointer should update after static sync");

    const status = await requestJson(baseUrl, "/api/admin/sync/status");
    assert.strictEqual(status.status, 200);
    assert.strictEqual(status.data.data.openRestyStaticSyncStatus, "success");
    assert(status.data.data.staticManifestUrl.includes(`/static/releases/${version}/manifest.json`));
    assert(status.data.data.staticClassIndexUrl.includes(`/static/releases/${version}/index/class/all.json`));
    assert(status.data.data.staticEmptyRoomIndexUrl.includes(`/static/releases/${version}/empty-room/index.json`));

    const nextTerm = "2026-2027-1";
    const nextVersion = "ready-only-2026-08-13";
    const nextSnapshot = snapshot(nextVersion);
    nextSnapshot.term = nextTerm;
    nextSnapshot.semester = nextTerm;
    nextSnapshot.termStartDate = "2026-09-07";
    nextSnapshot.totalWeeks = 20;
    nextSnapshot.termConfig = {
      term: nextTerm,
      semesterText: "2026-2027 学年第一学期",
      termStartDate: "2026-09-07",
      weekStart: "monday",
      totalWeeks: 20,
    };
    nextSnapshot.classSchedules[0].className = "26级待发布测试班";
    termRegistryService.createPlannedTerm({
      term: nextTerm,
      semesterText: "2026-2027 学年第一学期",
      termStartDate: "2026-09-07",
      weekStart: "monday",
      totalWeeks: 20,
      status: "planned",
      releaseVersion: "",
      dataAvailable: false,
      source: "test-fixture",
    });
    fs.writeFileSync(path.join(storageDir, "staging-latest.json"), JSON.stringify(nextSnapshot, null, 2), "utf-8");

    const readyStart = await requestJson(baseUrl, "/api/admin/sync/staging/publish/start", {
      method: "POST",
      body: JSON.stringify({ force: false }),
    });
    assert.strictEqual(readyStart.status, 202, JSON.stringify(readyStart.data));
    const readyJob = await waitJob(baseUrl, readyStart.data.job.id);
    assert.strictEqual(readyJob.status, "success", JSON.stringify(readyJob, null, 2));
    assert.strictEqual(readyJob.result.readyOnly, true, "cross-term planned snapshots must auto-select ready-only publish");
    assert.strictEqual(readyJob.result.releaseVersion, nextVersion);
    assert(fs.existsSync(path.join(openrestyDir, nextVersion, "manifest.json")), "ready-only manifest should be synced");
    assert.strictEqual(releaseService.getActiveReleaseInfo().releaseVersion, version, "ready-only publish must preserve the active pointer");
    const publicRuntimePointer = JSON.parse(fs.readFileSync(path.join(openrestyRuntimeDir, "active.json"), "utf-8"));
    assert.strictEqual(publicRuntimePointer.releaseVersion, version, "ready-only static sync must preserve the public runtime pointer");
    assert.strictEqual(termRegistryService.getActiveTerm().term, "2025-2026-2", "ready-only publish must preserve the active term");
    const readyTerm = termRegistryService.getTerm(nextTerm);
    assert.strictEqual(readyTerm.status, "ready");
    assert.strictEqual(readyTerm.releaseVersion, nextVersion);
    assert.strictEqual(readyTerm.dataAvailable, true);
  } finally {
    adminServer.close();
    staticServer.close();
    cleanup();
  }

  console.log("test-release-publish-static-sync passed");
}

run().catch((error) => {
  console.error(error);
  try { cleanup(); } catch (cleanupError) {}
  process.exit(1);
});
