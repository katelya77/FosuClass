const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");

const tempRoot = path.join(os.tmpdir(), `fosu-client-diagnosis-test-${process.pid}-${Date.now()}`);
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
    catalog: {
      colleges: [{ code: "04", name: "测试学院" }],
      grades: ["2025"],
    },
    majors: [{ collegeCode: "04", code: "0401", name: "测试专业", grade: "2025" }],
    classSchedules: [{
      className: "25诊断测试1班",
      semester: "2025-2026-2",
      courses: [{
        courseName: "诊断测试课程",
        teacherName: "诊断教师",
        classroom: "C7-101",
        weekday: 1,
        startSection: 1,
        endSection: 2,
      }],
    }],
    resources: {
      teachers: [{ teacherName: "诊断教师" }],
      classrooms: [{ roomName: "C7-101" }],
      courses: [{ courseName: "诊断测试课程" }],
      teacherSchedules: [{
        teacherName: "诊断教师",
        courses: [{ courseName: "诊断测试课程", weekday: 1, startSection: 1, endSection: 2 }],
      }],
      classroomSchedules: [{
        roomName: "C7-101",
        courses: [{ courseName: "诊断测试课程", weekday: 1, startSection: 1, endSection: 2 }],
      }],
      courseSchedules: [{
        courseName: "诊断测试课程",
        courses: [{ courseName: "诊断测试课程", weekday: 1, startSection: 1, endSection: 2 }],
      }],
    },
  };
}

function listen(app) {
  return new Promise((resolve) => {
    const server = app.listen(0, "127.0.0.1", () => resolve(server));
  });
}

async function run() {
  const version = "diagnosis-2026-06-02";
  releaseService.activateReleaseFromSnapshot(buildSnapshot(version));

  const app = express();
  app.use("/api/fosu", fosuRouter);
  const server = await listen(app);
  const baseUrl = `http://127.0.0.1:${server.address().port}`;

  try {
    const response = await fetch(`${baseUrl}/api/fosu/client-diagnosis?term=2025-2026-2&releaseVersion=${encodeURIComponent(version)}`);
    const body = await response.json();
    assert.strictEqual(response.status, 200);
    assert.strictEqual(body.success, true);
    assert.strictEqual(body.activeReleaseVersion, version);
    assert.strictEqual(body.term, "2025-2026-2");
    assert.strictEqual(body.indexExists.class, true);
    assert.strictEqual(body.indexExists.teacher, true);
    assert.strictEqual(body.indexExists.classroom, true);
    assert.strictEqual(body.indexExists.course, true);
    assert.strictEqual(body.releaseCounts.classScheduleCount, 1);
    assert.strictEqual(body.indexCounts.class, 1);
    assert(body.counts.indexes.class === 1, "diagnosis counts should expose index counts separately");
    assert(body.cacheStatus.class.includes("index"), "diagnosis should expose index cache source");
    assert(body.serverTime, "diagnosis should include serverTime");
  } finally {
    server.close();
    const resolvedRoot = path.resolve(tempRoot);
    const relativeRoot = path.relative(os.tmpdir(), resolvedRoot);
    if (!relativeRoot || relativeRoot.startsWith("..") || path.isAbsolute(relativeRoot) || !path.basename(resolvedRoot).startsWith("fosu-client-diagnosis-test-")) {
      throw new Error(`refusing to remove unexpected temp directory: ${resolvedRoot}`);
    }
    fs.rmSync(resolvedRoot, { recursive: true, force: true });
  }

  console.log("test-fosu-client-diagnosis passed");
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
