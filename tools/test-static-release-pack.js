const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");

const tempRoot = path.join(os.tmpdir(), `fosu-static-release-pack-${process.pid}-${Date.now()}`);
process.env.FOSU_STORAGE_DIR = path.join(tempRoot, "storage");
process.env.FOSU_STATIC_RELEASE_BASE_URL = "https://static-class.katelya.top/static/releases";

const express = require("../server/node_modules/express");
const fosuRouter = require("../server/src/routes/fosu");
const releaseService = require("../server/src/services/releaseService");

function snapshot(version) {
  const course = {
    courseName: "静态包课程",
    teacherName: "静态包教师",
    classroom: "B8-209",
    weekday: 2,
    startSection: 3,
    endSection: 4,
    sections: [3, 4],
    weeks: [1, 2, 3],
  };
  return {
    version,
    releaseVersion: version,
    term: "2025-2026-2",
    semester: "2025-2026-2",
    termStartDate: "2026-03-09",
    updatedAt: "2026-06-04T00:00:00.000Z",
    catalog: { colleges: [{ code: "04", name: "测试学院" }], grades: ["2025"] },
    majors: [{ collegeCode: "04", code: "0401", name: "测试专业", grade: "2025" }],
    classSchedules: [{
      className: "25静态1班",
      semester: "2025-2026-2",
      collegeCode: "04",
      collegeName: "测试学院",
      grade: "2025",
      majorCode: "0401",
      majorName: "测试专业",
      courses: [course],
    }],
    resources: {
      teachers: [{ teacherName: "静态包教师", collegeName: "测试学院" }],
      classrooms: [{ roomName: "B8-209", campus: "仙溪" }],
      courses: [{ courseName: "静态包课程" }],
      teacherSchedules: [{ teacherName: "静态包教师", courses: [course] }],
      classroomSchedules: [{ roomName: "B8-209", courses: [course] }],
      courseSchedules: [{ courseName: "静态包课程", courses: [course] }],
    },
  };
}

function cleanup() {
  const resolvedRoot = path.resolve(tempRoot);
  const relativeRoot = path.relative(os.tmpdir(), resolvedRoot);
  if (!relativeRoot || relativeRoot.startsWith("..") || path.isAbsolute(relativeRoot) || !path.basename(resolvedRoot).startsWith("fosu-static-release-pack-")) {
    throw new Error(`refusing to remove unexpected temp directory: ${resolvedRoot}`);
  }
  fs.rmSync(resolvedRoot, { recursive: true, force: true });
}

function listen(app) {
  return new Promise((resolve) => {
    const server = app.listen(0, "127.0.0.1", () => resolve(server));
  });
}

async function run() {
  const version = "static-release-pack-2026-06-04";
  releaseService.activateReleaseFromSnapshot(snapshot(version));
  const files = releaseService.getReleaseFiles(version);
  const publicDir = files.publicReleaseDir;
  const publicManifestPath = path.join(publicDir, "manifest.json");
  const classAllPath = path.join(publicDir, "index", "class", "all.json");
  const majorShardPath = path.join(publicDir, "index", "class", "by-major", "04-2025-0401.json");
  const emptyPath = path.join(publicDir, "empty-room", "index.json");

  assert(fs.existsSync(publicManifestPath), "public manifest should exist");
  assert(fs.existsSync(classAllPath), "public class all index should exist");
  assert(fs.existsSync(majorShardPath), "public class by-major shard should exist");
  assert(fs.existsSync(emptyPath), "public empty-room index should exist");
  assert(fs.existsSync(`${classAllPath}.gz`), "class all index gzip should exist");
  assert(fs.existsSync(`${emptyPath}.gz`), "empty-room gzip should exist");

  const manifest = JSON.parse(fs.readFileSync(publicManifestPath, "utf-8"));
  assert.strictEqual(manifest.staticBaseUrl, "https://static-class.katelya.top/static/releases");
  assert(manifest.indexUrls.class.includes(`/static/releases/${version}/index/class/all.json`), "manifest should expose static class URL");
  assert(manifest.emptyRoomUrl.includes(`/static/releases/${version}/empty-room/index.json`), "manifest should expose static empty-room URL");
  assert(manifest.detailUrlPattern.includes("/detail/{type}/{id}.json"), "manifest should expose detail URL pattern");
  assert(manifest.compression.gzip, "manifest should expose gzip availability");
  assert(manifest.packHealth.emptyRoom.classroomCount >= 1, "manifest should include empty-room health");

  const app = express();
  app.use("/static/releases", express.static(releaseService.PUBLIC_RELEASES_DIR, {
    immutable: true,
    maxAge: "1y",
    setHeaders: (res) => res.setHeader("Cache-Control", "public, max-age=31536000, immutable"),
  }));
  app.use("/api/fosu", fosuRouter);
  const server = await listen(app);
  const baseUrl = `http://127.0.0.1:${server.address().port}`;

  try {
    const staticResponse = await fetch(`${baseUrl}/static/releases/${version}/index/class/all.json`);
    assert.strictEqual(staticResponse.status, 200);
    assert((staticResponse.headers.get("cache-control") || "").includes("immutable"), "static response should be immutable");

    const publicClass = JSON.parse(fs.readFileSync(classAllPath, "utf-8"));
    publicClass.items[0].name = "static-wrapper-proof";
    fs.writeFileSync(classAllPath, JSON.stringify(publicClass, null, 2), "utf-8");

    const wrapperResponse = await fetch(`${baseUrl}/api/fosu/release-pack/index/class?releaseVersion=${encodeURIComponent(version)}`);
    const wrapper = await wrapperResponse.json();
    assert.strictEqual(wrapper.success, true);
    assert.strictEqual(wrapper.items[0].name, "static-wrapper-proof", "API wrapper should prefer public static index");
  } finally {
    server.close();
  }

  cleanup();
  console.log("test-static-release-pack passed");
}

run().catch((error) => {
  console.error(error);
  try { cleanup(); } catch (cleanupError) {}
  process.exit(1);
});
