const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");

const tempRoot = path.join(os.tmpdir(), `fosu-force-token-${process.pid}-${Date.now()}`);
process.env.FOSU_STORAGE_DIR = path.join(tempRoot, "storage");

const express = require("../server/node_modules/express");
const fosuRouter = require("../server/src/routes/fosu");
const releaseService = require("../server/src/services/releaseService");

function snapshot(version) {
  const course = { courseName: "Token 课程", teacherName: "Token 教师", classroom: "C7-401", weekday: 1, startSection: 1, endSection: 2 };
  return {
    version,
    releaseVersion: version,
    term: "2025-2026-2",
    semester: "2025-2026-2",
    updatedAt: "2026-06-04T00:00:00.000Z",
    catalog: { colleges: [{ code: "04", name: "测试学院" }], grades: ["2025"] },
    majors: [{ collegeCode: "04", code: "0401", name: "测试专业", grade: "2025" }],
    classSchedules: [{ className: "25令牌1班", semester: "2025-2026-2", courses: [course] }],
    resources: {
      teachers: [{ teacherName: "Token 教师" }],
      classrooms: [{ roomName: "C7-401" }],
      courses: [{ courseName: "Token 课程" }],
      teacherSchedules: [{ teacherName: "Token 教师", courses: [course] }],
      classroomSchedules: [{ roomName: "C7-401", courses: [course] }],
      courseSchedules: [{ courseName: "Token 课程", courses: [course] }],
    },
  };
}

function cleanup() {
  const resolvedRoot = path.resolve(tempRoot);
  const relativeRoot = path.relative(os.tmpdir(), resolvedRoot);
  if (!relativeRoot || relativeRoot.startsWith("..") || path.isAbsolute(relativeRoot) || !path.basename(resolvedRoot).startsWith("fosu-force-token-")) {
    throw new Error(`refusing to remove unexpected temp directory: ${resolvedRoot}`);
  }
  fs.rmSync(resolvedRoot, { recursive: true, force: true });
}

async function run() {
  const version = "force-token-2026-06-04";
  releaseService.activateReleaseFromSnapshot(snapshot(version));
  const active = releaseService.getActiveReleaseInfo();

  const app = express();
  app.use("/api/fosu", fosuRouter);
  const server = await new Promise((resolve) => {
    const instance = app.listen(0, "127.0.0.1", () => resolve(instance));
  });

  try {
    const response = await fetch(`http://127.0.0.1:${server.address().port}/api/fosu/release-pack/manifest`);
    const manifest = await response.json();
    const staticManifest = JSON.parse(fs.readFileSync(releaseService.getReleaseFiles(version).manifestPath, "utf8"));
    assert.strictEqual(manifest.releaseVersion, version);
    assert.strictEqual(manifest.cacheEpoch, staticManifest.cacheEpoch);
    assert.strictEqual(manifest.forceRefreshToken, staticManifest.forceRefreshToken);
    assert.strictEqual(manifest.activeCacheEpoch, active.cacheEpoch);
    assert.strictEqual(manifest.activeForceRefreshToken, active.forceRefreshToken);
    assert.strictEqual(manifest.minClientCacheSchema, 5);
    assert(manifest.packStatus && manifest.packStatus.healthy, "manifest should expose packStatus");

    const pointerResponse = await fetch(`http://127.0.0.1:${server.address().port}/api/fosu/runtime/active`);
    const pointer = await pointerResponse.json();
    assert.strictEqual(pointer.releaseVersion, version);
    assert.strictEqual(pointer.cacheEpoch, staticManifest.cacheEpoch);
    assert.strictEqual(pointer.forceRefreshToken, staticManifest.forceRefreshToken);
  } finally {
    server.close();
    cleanup();
  }

  console.log("test-force-refresh-token passed");
}

run().catch((error) => {
  console.error(error);
  try { cleanup(); } catch (cleanupError) {}
  process.exit(1);
});
