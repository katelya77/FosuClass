const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");

const tempRoot = path.join(os.tmpdir(), `fosu-schedule-detail-test-${process.pid}-${Date.now()}`);
process.env.FOSU_STORAGE_DIR = path.join(tempRoot, "storage");

const express = require("../server/node_modules/express");
const fosuRouter = require("../server/src/routes/fosu");
const releaseService = require("../server/src/services/releaseService");

function buildSnapshot(version) {
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
      classId: "detail-class-1",
      className: "25详情测试1班",
      semester: "2025-2026-2",
      courses: [{
        courseName: "详情测试课程",
        teacherName: "详情教师",
        classroom: "C7-102",
        weekday: 2,
        startSection: 3,
        endSection: 4,
      }],
    }],
    resources: {
      teachers: [{ teacherName: "详情教师" }],
      classrooms: [{ roomName: "C7-102" }],
      courses: [{ courseName: "详情测试课程" }],
      teacherSchedules: [{
        teacherName: "详情教师",
        courses: [{ courseName: "详情测试课程", weekday: 2, startSection: 3, endSection: 4 }],
      }],
      classroomSchedules: [{
        roomName: "C7-102",
        courses: [{ courseName: "详情测试课程", weekday: 2, startSection: 3, endSection: 4 }],
      }],
      courseSchedules: [{
        courseName: "详情测试课程",
        courses: [{ courseName: "详情测试课程", weekday: 2, startSection: 3, endSection: 4 }],
      }],
    },
  };
}

function listen(app) {
  return new Promise((resolve) => {
    const server = app.listen(0, "127.0.0.1", () => resolve(server));
  });
}

async function getJson(baseUrl, requestPath) {
  const response = await fetch(`${baseUrl}${requestPath}`);
  return {
    status: response.status,
    cacheControl: response.headers.get("cache-control") || "",
    data: await response.json(),
  };
}

async function run() {
  const version = "detail-2026-06-02";
  releaseService.activateReleaseFromSnapshot(buildSnapshot(version));

  const app = express();
  app.use("/api/fosu", fosuRouter);
  const server = await listen(app);
  const baseUrl = `http://127.0.0.1:${server.address().port}`;

  try {
    const index = await getJson(baseUrl, "/api/fosu/search-index?type=class");
    assert.strictEqual(index.status, 200);
    assert.strictEqual(index.data.success, true);
    assert(index.cacheControl.includes("no-store"), "active search-index without releaseVersion should be no-store");
    const item = index.data.items[0];
    assert(item && item.id, "search-index should return lightweight id");
    assert(!item.courses, "search-index item should not include full schedule details");

    const activeDetail = await getJson(baseUrl, `/api/fosu/schedule-detail?type=class&id=${encodeURIComponent(item.id)}&term=2025-2026-2`);
    assert.strictEqual(activeDetail.status, 200);
    assert.strictEqual(activeDetail.data.success, true);
    assert(activeDetail.cacheControl.includes("no-store"), "active detail without releaseVersion should be no-store");
    assert(Array.isArray(activeDetail.data.classes[0].courses), "detail endpoint should return full course list");

    const versionedDetail = await getJson(baseUrl, `/api/fosu/schedule-detail?type=class&id=${encodeURIComponent(item.id)}&term=2025-2026-2&releaseVersion=${encodeURIComponent(version)}`);
    assert.strictEqual(versionedDetail.status, 200);
    assert.strictEqual(versionedDetail.data.success, true);
    assert(versionedDetail.cacheControl.includes("public") && versionedDetail.cacheControl.includes("max-age=3600"), "versioned detail should be cacheable");
    assert.strictEqual(versionedDetail.data.meta.releaseVersion, version);
  } finally {
    server.close();
    const resolvedRoot = path.resolve(tempRoot);
    const relativeRoot = path.relative(os.tmpdir(), resolvedRoot);
    if (!relativeRoot || relativeRoot.startsWith("..") || path.isAbsolute(relativeRoot) || !path.basename(resolvedRoot).startsWith("fosu-schedule-detail-test-")) {
      throw new Error(`refusing to remove unexpected temp directory: ${resolvedRoot}`);
    }
    fs.rmSync(resolvedRoot, { recursive: true, force: true });
  }

  console.log("test-fosu-schedule-detail-contract passed");
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
