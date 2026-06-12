const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { performance } = require("perf_hooks");

const tempRoot = path.join(os.tmpdir(), `fosu-public-api-concurrency-${process.pid}-${Date.now()}`);
process.env.FOSU_STORAGE_DIR = path.join(tempRoot, "storage");
process.env.FOSU_DATA_DIR = path.join(tempRoot, "data");
process.env.ADMIN_API_TOKEN = "test-admin-token";
process.env.ADMIN_PASSWORD = "test-admin-password";
process.env.FOSU_SESSION_SECRET_CURRENT = "test-session-secret";
process.env.NODE_ENV = "test";

const express = require("../server/node_modules/express");
const fosuRouter = require("../server/src/routes/fosu");
const healthRouter = require("../server/src/routes/health");
const releaseService = require("../server/src/services/releaseService");
const runtimePointerService = require("../server/src/services/runtimePointerService");
const performanceMonitorService = require("../server/src/services/performanceMonitorService");
const { createSessionToken } = require("../server/src/utils/apiSecurity");

function snapshot(version) {
  const course = {
    courseName: "Concurrency Course",
    teacherName: "Concurrency Teacher",
    classroom: "C-101",
    weekday: 1,
    startSection: 1,
    endSection: 2,
    sections: [1, 2],
    weeks: [1, 2, 3],
  };
  const classSchedules = Array.from({ length: 80 }, (_, index) => ({
    className: `25 Concurrency ${String(index + 1).padStart(2, "0")}`,
    semester: "2025-2026-2",
    collegeCode: "04",
    collegeName: "Concurrency College",
    grade: "2025",
    majorCode: "0401",
    majorName: "Concurrency Major",
    courses: [course],
  }));
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
    generatedAt: "2026-06-12T00:00:00.000Z",
    updatedAt: "2026-06-12T00:00:00.000Z",
    catalog: { colleges: [{ code: "04", name: "Concurrency College" }], grades: ["2025"] },
    majors: [{ collegeCode: "04", code: "0401", name: "Concurrency Major", grade: "2025" }],
    classSchedules,
    resources: {
      teachers: [{ teacherName: "Concurrency Teacher" }],
      classrooms: [{ roomName: "C-101" }],
      courses: [{ courseName: "Concurrency Course" }],
      teacherSchedules: [{ teacherName: "Concurrency Teacher", semester: "2025-2026-2", courses: [course] }],
      classroomSchedules: [{ roomName: "C-101", semester: "2025-2026-2", courses: [course] }],
      courseSchedules: [{ courseName: "Concurrency Course", semester: "2025-2026-2", courses: [course] }],
    },
  };
}

function listen(app) {
  return new Promise((resolve) => {
    const server = app.listen(0, "127.0.0.1", () => resolve(server));
  });
}

function percentile(values, p) {
  const sorted = values.slice().sort((a, b) => a - b);
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
  return Number((sorted[index] || 0).toFixed(2));
}

async function timedFetch(baseUrl, pathname, headers) {
  const startedAt = performance.now();
  const response = await fetch(baseUrl + pathname, { headers });
  await response.text();
  return {
    pathname,
    status: response.status,
    durationMs: Number((performance.now() - startedAt).toFixed(2)),
  };
}

async function run() {
  fs.mkdirSync(process.env.FOSU_STORAGE_DIR, { recursive: true });
  const version = "concurrency-2026-06-12";
  releaseService.activateReleaseFromSnapshot(snapshot(version));
  runtimePointerService.ensureActivePointer();
  performanceMonitorService.resetHistogram();

  const app = express();
  app.use(express.json({ limit: "2mb" }));
  app.use(performanceMonitorService.middleware);
  app.use("/health", healthRouter);
  app.use("/api/fosu", fosuRouter);

  const server = await listen(app);
  const baseUrl = `http://127.0.0.1:${server.address().port}`;
  const session = createSessionToken({ openid: "concurrency-openid" });
  const headers = {
    "user-agent": "Mozilla/5.0 MicroMessenger",
    "x-fosu-session": session.token,
  };

  try {
    const paths = [
      "/health/live",
      "/api/fosu/runtime/active",
      "/api/fosu/app-config",
      "/api/fosu/bootstrap",
      `/api/fosu/release-pack/manifest?releaseVersion=${encodeURIComponent(version)}`,
      `/api/fosu/release-pack/index/class?releaseVersion=${encodeURIComponent(version)}&term=2025-2026-2`,
    ];
    const requests = [];
    for (let round = 0; round < 30; round += 1) {
      for (const pathname of paths) {
        requests.push(timedFetch(baseUrl, pathname, headers));
      }
    }
    const results = await Promise.all(requests);
    const statusCounts = results.reduce((acc, item) => {
      acc[item.status] = (acc[item.status] || 0) + 1;
      return acc;
    }, {});
    const badGatewayCount = results.filter((item) => item.status === 503 || item.status === 504).length;
    const serverErrorCount = results.filter((item) => item.status >= 500).length;
    const durations = results.map((item) => item.durationMs);
    const report = {
      success: true,
      requests: results.length,
      statusCounts,
      badGatewayCount,
      serverErrorCount,
      p95Ms: percentile(durations, 95),
      maxMs: Number(Math.max(...durations).toFixed(2)),
    };
    console.log(JSON.stringify(report, null, 2));
    assert.strictEqual(badGatewayCount, 0, "high concurrency public APIs should not return 503/504");
    assert.strictEqual(serverErrorCount, 0, "high concurrency public APIs should not return 5xx");
    console.log("test-public-api-high-concurrency passed");
  } finally {
    server.close();
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
