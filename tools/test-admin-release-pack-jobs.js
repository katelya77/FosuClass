const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");

const tempRoot = path.join(os.tmpdir(), `fosu-admin-jobs-${process.pid}-${Date.now()}`);
process.env.FOSU_STORAGE_DIR = path.join(tempRoot, "storage");
process.env.FOSU_DATA_DIR = path.join(tempRoot, "data");
process.env.NODE_ENV = "development";
process.env.ADMIN_API_TOKEN = "test-admin-token";
process.env.ADMIN_PASSWORD = "test-admin-password";

const express = require("../server/node_modules/express");
const adminRouter = require("../server/src/routes/admin");
const releaseService = require("../server/src/services/releaseService");
const jobService = require("../server/src/services/jobService");

function snapshot(version) {
  const course = {
    courseName: "Job 课程",
    teacherName: "Job 教师",
    classroom: "C7-305",
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
    termStartDate: "2026-03-02",
    generatedAt: "2026-06-04T00:00:00.000Z",
    updatedAt: "2026-06-04T00:00:00.000Z",
    catalog: { colleges: [{ code: "04", name: "测试学院" }], grades: ["2025"] },
    majors: [{ collegeCode: "04", code: "0401", name: "测试专业", grade: "2025" }],
    classSchedules: [{ className: "25Job1班", collegeCode: "04", grade: "2025", majorCode: "0401", courses: [course] }],
    resources: {
      teachers: [{ teacherName: "Job 教师" }],
      classrooms: [{ roomName: "C7-305" }],
      courses: [{ courseName: "Job 课程" }],
      teacherSchedules: [{ teacherName: "Job 教师", courses: [course] }],
      classroomSchedules: [{ roomName: "C7-305", courses: [course] }],
      courseSchedules: [{ courseName: "Job 课程", courses: [course] }],
    },
  };
}

function cleanup() {
  const resolvedRoot = path.resolve(tempRoot);
  const relativeRoot = path.relative(os.tmpdir(), resolvedRoot);
  if (!relativeRoot || relativeRoot.startsWith("..") || path.isAbsolute(relativeRoot) || !path.basename(resolvedRoot).startsWith("fosu-admin-jobs-")) {
    throw new Error(`refusing to remove unexpected temp directory: ${resolvedRoot}`);
  }
  fs.rmSync(resolvedRoot, { recursive: true, force: true });
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
  for (let index = 0; index < 50; index += 1) {
    const status = await requestJson(baseUrl, `/api/admin/jobs/${encodeURIComponent(id)}`);
    const job = status.data.job;
    if (job.status === "success" || job.status === "failed") return job;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error(`job ${id} did not finish`);
}

async function run() {
  const version = "admin-job-2026-06-04";
  releaseService.activateReleaseFromSnapshot(snapshot(version));

  const app = express();
  app.use(express.json({ limit: "2mb" }));
  app.use("/api/admin", adminRouter);
  const server = await listen(app);
  const baseUrl = `http://127.0.0.1:${server.address().port}`;

  try {
    const status = await requestJson(baseUrl, "/api/admin/sync/status");
    assert.strictEqual(status.status, 200);
    assert.strictEqual(status.data.success, true);
    assert(status.data.data.releasePackStatus.durationMs < 300, "sync/status should use quick health");
    assert(!("detailCounts" in status.data.data.releasePackStatus), "sync/status must not expose deep detail counts");

    const deepStart = await requestJson(baseUrl, "/api/admin/release-pack/deep-health/start", {
      method: "POST",
      body: JSON.stringify({ version }),
    });
    assert.strictEqual(deepStart.status, 202);
    const deepJob = await waitJob(baseUrl, deepStart.data.job.id);
    assert.strictEqual(deepJob.status, "success");
    assert(deepJob.result.status.healthy, "deep health job should compute healthy status");
    assert(fs.existsSync(path.join(jobService.JOBS_DIR, `${deepJob.id}.json`)), "job status should persist to storage/jobs");

    const rebuildStart = await requestJson(baseUrl, "/api/admin/release-pack/rebuild/start", {
      method: "POST",
      body: JSON.stringify({ version }),
    });
    assert.strictEqual(rebuildStart.status, 202);
    const rebuildJob = await waitJob(baseUrl, rebuildStart.data.job.id);
    assert.strictEqual(rebuildJob.status, "success");
    assert(rebuildJob.result.manifest.staticBaseUrl, "rebuild job should return manifest with staticBaseUrl");

    const publishVersion = `${version}-published`;
    const publishSnapshot = snapshot(publishVersion);
    publishSnapshot.classSchedules[0].courses[0].courseName = "Job 课程 Published";
    publishSnapshot.resources.teacherSchedules[0].courses[0].courseName = "Job 课程 Published";
    publishSnapshot.resources.classroomSchedules[0].courses[0].courseName = "Job 课程 Published";
    publishSnapshot.resources.courseSchedules[0].courseName = "Job 课程 Published";
    publishSnapshot.resources.courseSchedules[0].courses[0].courseName = "Job 课程 Published";
    publishSnapshot.resources.courses[0].courseName = "Job 课程 Published";
    fs.mkdirSync(process.env.FOSU_STORAGE_DIR, { recursive: true });
    fs.writeFileSync(
      path.join(process.env.FOSU_STORAGE_DIR, "staging-latest.json"),
      JSON.stringify(publishSnapshot, null, 2),
      "utf-8"
    );

    const publishStart = await requestJson(baseUrl, "/api/admin/sync/staging/publish/start", {
      method: "POST",
      body: JSON.stringify({ force: false }),
    });
    assert.strictEqual(publishStart.status, 202);
    const publishJob = await waitJob(baseUrl, publishStart.data.job.id);
    assert.strictEqual(publishJob.status, "success", JSON.stringify(publishJob, null, 2));
    assert.strictEqual(publishJob.result.releaseVersion, publishVersion);
    assert(publishJob.result.quickHealth.healthy, "publish job should finish with quick static health");
    assert(
      fs.existsSync(path.join(process.env.FOSU_STORAGE_DIR, "public", "releases", publishVersion, "manifest.json")),
      "publish job should mirror static release files"
    );

    const verifyStart = await requestJson(baseUrl, "/api/admin/release-pack/verify/start", {
      method: "POST",
      body: JSON.stringify({ version: publishVersion }),
    });
    assert.strictEqual(verifyStart.status, 202);
    const verifyJob = await waitJob(baseUrl, verifyStart.data.job.id);
    assert.strictEqual(verifyJob.status, "success");
    assert(verifyJob.result.classIndexCount > 0, "verify job should read static class index");

    const load = await requestJson(baseUrl, "/api/admin/system/load");
    assert.strictEqual(load.status, 200);
    assert.strictEqual(load.data.success, true);
    assert(load.data.memory && typeof load.data.memory.usedRatio === "number", "load endpoint should expose memory ratio");
  } finally {
    server.close();
  }

  cleanup();
  console.log("test-admin-release-pack-jobs passed");
}

run().catch((error) => {
  console.error(error);
  try { cleanup(); } catch (cleanupError) {}
  process.exit(1);
});
