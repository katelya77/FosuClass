const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");

const tempRoot = path.join(os.tmpdir(), `fosu-verify-live-${process.pid}-${Date.now()}`);
process.env.FOSU_STORAGE_DIR = path.join(tempRoot, "storage");

const express = require("../server/node_modules/express");
const healthRouter = require("../server/src/routes/health");
const fosuRouter = require("../server/src/routes/fosu");
const releaseService = require("../server/src/services/releaseService");
const { runVerify } = require("./verify-release-live");

function buildSnapshot(version) {
  const course = {
    courseName: "Verify Live 课程",
    teacherName: "Verify Live 教师",
    classroom: "C7-201",
    weekday: 1,
    startSection: 1,
    endSection: 2,
    sections: [1, 2],
    weeks: [1, 2],
  };
  return {
    schemaVersion: 1,
    version,
    releaseVersion: version,
    term: "2025-2026-2",
    semester: "2025-2026-2",
    updatedAt: "2026-06-04T00:00:00.000Z",
    catalog: { colleges: [{ code: "04", name: "测试学院" }], grades: ["2025"] },
    majors: [{ collegeCode: "04", code: "0401", name: "测试专业", grade: "2025" }],
    classSchedules: [{
      className: "25验证1班",
      semester: "2025-2026-2",
      collegeCode: "04",
      collegeName: "测试学院",
      grade: "2025",
      majorCode: "0401",
      majorName: "测试专业",
      courses: [course],
    }],
    resources: {
      teachers: [{ teacherName: "Verify Live 教师" }],
      classrooms: [{ roomName: "C7-201" }],
      courses: [{ courseName: "Verify Live 课程" }],
      teacherSchedules: [{ teacherName: "Verify Live 教师", semester: "2025-2026-2", courses: [course] }],
      classroomSchedules: [{ roomName: "C7-201", semester: "2025-2026-2", courses: [course] }],
      courseSchedules: [{ courseName: "Verify Live 课程", semester: "2025-2026-2", courses: [course] }],
    },
  };
}

function cleanup() {
  const resolvedRoot = path.resolve(tempRoot);
  const relativeRoot = path.relative(os.tmpdir(), resolvedRoot);
  if (!relativeRoot || relativeRoot.startsWith("..") || path.isAbsolute(relativeRoot) || !path.basename(resolvedRoot).startsWith("fosu-verify-live-")) {
    throw new Error(`refusing to remove unexpected temp directory: ${resolvedRoot}`);
  }
  fs.rmSync(resolvedRoot, { recursive: true, force: true });
}

async function run() {
  const version = "verify-live-2026-06-04";
  releaseService.activateReleaseFromSnapshot(buildSnapshot(version));

  const app = express();
  app.use("/api/health", healthRouter);
  app.use("/api/fosu", fosuRouter);
  const server = await new Promise((resolve) => {
    const instance = app.listen(0, "127.0.0.1", () => resolve(instance));
  });

  try {
    const result = await runVerify({
      server: `http://127.0.0.1:${server.address().port}`,
      term: "2025-2026-2",
    });
    assert.strictEqual(result.success, true);
    assert.strictEqual(result.releaseVersion, version);
    assert(result.summary.some((item) => item.path.includes("/release-pack/detail/class/")), "class detail should be sampled");
  } finally {
    server.close();
    cleanup();
  }

  console.log("test-verify-release-live-script passed");
}

run().catch((error) => {
  console.error(error);
  try { cleanup(); } catch (cleanupError) {}
  process.exit(1);
});
