const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");

const tempRoot = path.join(os.tmpdir(), `fosu-admin-upload-${process.pid}-${Date.now()}`);
process.env.FOSU_STORAGE_DIR = path.join(tempRoot, "storage");
process.env.FOSU_DATA_DIR = path.join(tempRoot, "data");
process.env.ADMIN_API_TOKEN = "test-admin-token";
process.env.ADMIN_PASSWORD = "test-admin-password";
process.env.NODE_ENV = "test";

const express = require("../server/node_modules/express");
const adminRouter = require("../server/src/routes/admin");
const releaseService = require("../server/src/services/releaseService");

function snapshot(version, className = "25上传1班") {
  const course = {
    courseName: "上传课程",
    teacherName: "刘老师",
    classroom: "B8-202",
    weekday: 2,
    startSection: 3,
    endSection: 4,
    sections: [3, 4],
    weeks: [1, 2],
  };
  return {
    schemaVersion: "1.0",
    releaseVersion: version,
    version,
    term: "2025-2026-2",
    semester: "2025-2026-2",
    termStartDate: "2026-03-09",
    termConfig: { term: "2025-2026-2", termStartDate: "2026-03-09", totalWeeks: 20, weekStart: "monday" },
    generatedAt: "2026-06-04T00:00:00.000Z",
    updatedAt: "2026-06-04T00:00:00.000Z",
    catalog: { colleges: [{ code: "04", name: "测试学院" }], grades: ["2025"] },
    majors: [{ collegeCode: "04", code: "0401", name: "测试专业", grade: "2025" }],
    classSchedules: [{ className, courses: [course] }],
    resources: {
      teachers: [{ teacherName: "刘老师" }],
      classrooms: [{ roomName: "B8-202" }],
      courses: [{ courseName: "上传课程" }],
      teacherSchedules: [{ teacherName: "刘老师", courses: [course] }],
      classroomSchedules: [{ roomName: "B8-202", courses: [course] }],
      courseSchedules: [{ courseName: "上传课程", courses: [course] }],
    },
  };
}

function cleanup() {
  const resolved = path.resolve(tempRoot);
  if (!path.basename(resolved).startsWith("fosu-admin-upload-")) {
    throw new Error(`refusing cleanup: ${resolved}`);
  }
  fs.rmSync(resolved, { recursive: true, force: true });
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
  return { status: response.status, data: await response.json() };
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
  releaseService.activateReleaseFromSnapshot(snapshot("active-upload", "25线上1班"));
  const app = express();
  app.use(express.json({ limit: "2mb" }));
  app.use("/api/admin", adminRouter);
  const server = await listen(app);
  const baseUrl = `http://127.0.0.1:${server.address().port}`;

  try {
    const changedPayload = JSON.stringify(snapshot("staging-upload", "25新增1班"));
    const start = Date.now();
    const upload = await fetch(`${baseUrl}/api/admin/sync/staging/upload`, {
      method: "POST",
      headers: { "x-admin-token": "test-admin-token", "Content-Type": "application/json" },
      body: changedPayload,
    });
    const elapsed = Date.now() - start;
    const uploadBody = await upload.json();
    assert.strictEqual(upload.status, 202);
    assert(elapsed < 1000, `upload endpoint should return fast, got ${elapsed}ms`);
    assert(uploadBody.job && uploadBody.job.id, "upload should return job id");
    const job = await waitJob(baseUrl, uploadBody.job.id);
    assert.strictEqual(job.status, "success", JSON.stringify(job, null, 2));
    assert.strictEqual(job.result.data.counts.classScheduleCount, 1);

    const unchanged = await fetch(`${baseUrl}/api/admin/sync/staging/upload`, {
      method: "POST",
      headers: { "x-admin-token": "test-admin-token", "Content-Type": "application/json" },
      body: JSON.stringify(snapshot("active-copy", "25线上1班")),
    });
    assert.strictEqual(unchanged.status, 202);
    const unchangedBody = await unchanged.json();
    const unchangedJob = await waitJob(baseUrl, unchangedBody.job.id);
    assert.strictEqual(unchangedJob.status, "success");
    assert.strictEqual(unchangedJob.result.skipped, true);
    assert.strictEqual(unchangedJob.result.reason, "active-release");
  } finally {
    server.close();
  }
  cleanup();
  console.log("test-admin-upload-jobs passed");
}

run().catch((error) => {
  console.error(error);
  try { cleanup(); } catch (cleanupError) {}
  process.exit(1);
});
