const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");

const tempRoot = path.join(os.tmpdir(), `fosu-upload-skip-${process.pid}-${Date.now()}`);
process.env.FOSU_STORAGE_DIR = path.join(tempRoot, "storage");
process.env.FOSU_DATA_DIR = path.join(tempRoot, "data");
process.env.ADMIN_API_TOKEN = "test-admin-token";
process.env.ADMIN_PASSWORD = "test-admin-password";
process.env.NODE_ENV = "test";

const express = require("../server/node_modules/express");
const adminRouter = require("../server/src/routes/admin");
const releaseService = require("../server/src/services/releaseService");
const upload = require("./fosu-sync-client/upload");

function snapshot(version) {
  const course = {
    courseName: "跳过上传课程",
    teacherName: "王老师",
    classroom: "C7-119",
    weekday: 1,
    startSection: 1,
    endSection: 2,
    sections: [1, 2],
    weeks: [1, 2],
  };
  return {
    schemaVersion: "1.0",
    releaseVersion: version,
    version,
    term: "2025-2026-2",
    semester: "2025-2026-2",
    termStartDate: "2026-03-09",
    generatedAt: "2026-06-04T00:00:00.000Z",
    updatedAt: "2026-06-04T00:00:00.000Z",
    catalog: { colleges: [{ code: "04", name: "测试学院" }], grades: ["2025"] },
    majors: [{ collegeCode: "04", code: "0401", name: "测试专业", grade: "2025" }],
    classSchedules: [{ className: "25跳过1班", courses: [course] }],
    resources: {
      teachers: [{ teacherName: "王老师" }],
      classrooms: [{ roomName: "C7-119" }],
      courses: [{ courseName: "跳过上传课程" }],
      teacherSchedules: [{ teacherName: "王老师", courses: [course] }],
      classroomSchedules: [{ roomName: "C7-119", courses: [course] }],
      courseSchedules: [{ courseName: "跳过上传课程", courses: [course] }],
    },
  };
}

function cleanup() {
  const resolved = path.resolve(tempRoot);
  if (!path.basename(resolved).startsWith("fosu-upload-skip-")) {
    throw new Error(`refusing cleanup: ${resolved}`);
  }
  fs.rmSync(resolved, { recursive: true, force: true });
}

function listen(app) {
  return new Promise((resolve) => {
    const server = app.listen(0, "127.0.0.1", () => resolve(server));
  });
}

async function run() {
  releaseService.activateReleaseFromSnapshot(snapshot("active-same"));
  const uploadDir = path.join(tempRoot, "upload");
  fs.mkdirSync(uploadDir, { recursive: true });
  const filePath = path.join(uploadDir, "2025-2026-2-full.json");
  fs.writeFileSync(filePath, JSON.stringify(snapshot("local-different-version"), null, 2), "utf-8");

  const app = express();
  app.use(express.json({ limit: "2mb" }));
  app.use("/api/admin", adminRouter);
  const server = await listen(app);
  const baseUrl = `http://127.0.0.1:${server.address().port}`;
  try {
    const result = await upload.uploadStagingFile({
      filePath,
      server: baseUrl,
      token: "test-admin-token",
      authMode: "admin",
      params: {},
    });
    assert.strictEqual(result.skipped, true);
    assert.strictEqual(result.reason, "active-release");
    assert(!fs.existsSync(`${filePath}.gz`), "skip should happen before gzip");
  } finally {
    server.close();
  }
  cleanup();
  console.log("test-upload-skip-unchanged passed");
}

run().catch((error) => {
  console.error(error);
  try { cleanup(); } catch (cleanupError) {}
  process.exit(1);
});
