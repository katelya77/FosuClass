const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");

const tempRoot = path.join(os.tmpdir(), `fosu-release-pack-api-${process.pid}-${Date.now()}`);
process.env.FOSU_STORAGE_DIR = path.join(tempRoot, "storage");
process.env.NODE_ENV = "production";

const express = require("../server/node_modules/express");
const fosuRouter = require("../server/src/routes/fosu");
const releaseService = require("../server/src/services/releaseService");

function buildSnapshot(version) {
  const course = {
    courseName: "Release Pack API 课程",
    teacherName: "Release Pack API 教师",
    classroom: "C7-303",
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
    generatedAt: "2026-06-02T00:00:00.000Z",
    updatedAt: "2026-06-02T00:00:00.000Z",
    catalog: { colleges: [{ code: "04", name: "测试学院" }], grades: ["2025"] },
    majors: [{ collegeCode: "04", code: "0401", name: "测试专业", grade: "2025" }],
    classSchedules: [{
      className: "25接口1班",
      semester: "2025-2026-2",
      collegeCode: "04",
      collegeName: "测试学院",
      grade: "2025",
      majorCode: "0401",
      majorName: "测试专业",
      courses: [course],
    }],
    resources: {
      teachers: [{ teacherName: "Release Pack API 教师", collegeName: "测试学院" }],
      classrooms: [{ roomName: "C7-303", campus: "仙溪" }],
      courses: [{ courseName: "Release Pack API 课程" }],
      teacherSchedules: [{ teacherName: "Release Pack API 教师", semester: "2025-2026-2", courses: [course] }],
      classroomSchedules: [{ roomName: "C7-303", semester: "2025-2026-2", courses: [course] }],
      courseSchedules: [{ courseName: "Release Pack API 课程", semester: "2025-2026-2", courses: [course] }],
    },
  };
}

function listen(app) {
  return new Promise((resolve) => {
    const server = app.listen(0, "127.0.0.1", () => resolve(server));
  });
}

async function getJson(baseUrl, pathname) {
  const response = await fetch(`${baseUrl}${pathname}`);
  return {
    status: response.status,
    cacheControl: response.headers.get("cache-control") || "",
    data: await response.json(),
  };
}

function cleanup() {
  const resolvedRoot = path.resolve(tempRoot);
  const relativeRoot = path.relative(os.tmpdir(), resolvedRoot);
  if (!relativeRoot || relativeRoot.startsWith("..") || path.isAbsolute(relativeRoot) || !path.basename(resolvedRoot).startsWith("fosu-release-pack-api-")) {
    throw new Error(`refusing to remove unexpected temp directory: ${resolvedRoot}`);
  }
  fs.rmSync(resolvedRoot, { recursive: true, force: true });
}

async function run() {
  const version = "release-pack-api-2026-06-02";
  releaseService.activateReleaseFromSnapshot(buildSnapshot(version));

  const app = express();
  app.use("/api/fosu", fosuRouter);
  const server = await listen(app);
  const baseUrl = `http://127.0.0.1:${server.address().port}`;

  try {
    const activeManifest = await getJson(baseUrl, "/api/fosu/release-pack/manifest");
    assert.strictEqual(activeManifest.status, 200);
    assert(activeManifest.cacheControl.includes("no-store"), "active manifest should be no-store");
    assert.strictEqual(activeManifest.data.releaseVersion, version);
    assert(activeManifest.data.files["index/class.json"].hash, "manifest should include file hash");

    const versionedManifest = await getJson(baseUrl, `/api/fosu/release-pack/manifest?releaseVersion=${encodeURIComponent(version)}`);
    assert.strictEqual(versionedManifest.status, 200);
    assert(versionedManifest.cacheControl.includes("public") && versionedManifest.cacheControl.includes("max-age"), "versioned manifest should be cacheable");

    const classIndex = await getJson(baseUrl, `/api/fosu/release-pack/index/class?term=2025-2026-2&releaseVersion=${encodeURIComponent(version)}`);
    assert.strictEqual(classIndex.status, 200);
    assert(classIndex.cacheControl.includes("public"), "versioned index should be cacheable");
    assert.strictEqual(classIndex.data.success, true);
    assert.strictEqual(classIndex.data.items.length, 1);
    const detailId = classIndex.data.items[0].id;

    const termMajorsPath = path.join(process.env.FOSU_STORAGE_DIR, "terms", "2025-2026-2", "majors-index.json");
    assert.strictEqual(fs.existsSync(termMajorsPath), false, "fixture must reproduce a release-only activation without term majors storage");

    const majors = await getJson(baseUrl, "/api/fosu/majors?term=2025-2026-2&collegeCode=04&grade=2025");
    assert.strictEqual(majors.status, 200);
    assert.strictEqual(majors.data.success, true, "healthy release class index must be sufficient for major selection");
    assert.strictEqual(majors.data.term, "2025-2026-2");
    assert.strictEqual(majors.data.releaseVersion, version);
    assert.strictEqual(majors.data.dataSource, "release-class-index");
    assert.deepStrictEqual(majors.data.majors, [{ code: "0401", name: "测试专业" }]);

    const detail = await getJson(baseUrl, `/api/fosu/release-pack/detail/class/${encodeURIComponent(detailId)}?term=2025-2026-2&releaseVersion=${encodeURIComponent(version)}`);
    assert.strictEqual(detail.status, 200);
    assert(detail.cacheControl.includes("public"), "versioned detail should be cacheable");
    assert.strictEqual(detail.data.success, true);
    assert(Array.isArray(detail.data.schedule.courses), "detail should include schedule courses");

    const missing = await getJson(baseUrl, `/api/fosu/release-pack/detail/class/not-found?term=2025-2026-2&releaseVersion=${encodeURIComponent(version)}`);
    assert.strictEqual(missing.status, 404);
    assert.strictEqual(missing.data.success, false);
    assert.strictEqual(missing.data.reasonCode, "NOT_FOUND");

    const emptyRoom = await getJson(baseUrl, `/api/fosu/release-pack/empty-room?term=2025-2026-2&releaseVersion=${encodeURIComponent(version)}`);
    assert.strictEqual(emptyRoom.status, 200);
    assert.strictEqual(emptyRoom.data.success, true);
    assert(Array.isArray(emptyRoom.data.rooms) && emptyRoom.data.rooms.length === 1, "empty-room endpoint should expose prebuilt rooms");
  } finally {
    server.close();
    cleanup();
  }

  console.log("test-release-pack-api passed");
}

run().catch((error) => {
  console.error(error);
  try { cleanup(); } catch (cleanupError) {}
  process.exit(1);
});
