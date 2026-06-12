const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawn } = require("child_process");
const { performance } = require("perf_hooks");

const root = path.resolve(__dirname, "..");
const tempRoot = path.join(os.tmpdir(), `fosu-event-loop-latency-${process.pid}-${Date.now()}`);
process.env.FOSU_STORAGE_DIR = path.join(tempRoot, "storage");
process.env.FOSU_DATA_DIR = path.join(tempRoot, "data");
process.env.ADMIN_API_TOKEN = "test-admin-token";
process.env.ADMIN_PASSWORD = "test-admin-password";
process.env.FOSU_SESSION_SECRET_CURRENT = "test-session-secret";
process.env.NODE_ENV = "test";

const perfSource = fs.readFileSync(path.join(root, "server/src/services/performanceMonitorService.js"), "utf-8");
const healthSource = fs.readFileSync(path.join(root, "server/src/routes/health.js"), "utf-8");
const appSource = fs.readFileSync(path.join(root, "server/src/app.js"), "utf-8");

assert(perfSource.includes("monitorEventLoopDelay"), "performance monitor should record event loop delay");
assert(perfSource.includes("eventLoopUtilization"), "performance monitor should record event loop utilization");
assert(perfSource.includes("routeSamples"), "performance monitor should keep route duration ring buffer");
assert(healthSource.includes('"/live"'), "health live route should exist");
assert(healthSource.includes('"/ready"'), "health ready route should exist");
assert(appSource.includes("performanceMonitorService.middleware"), "route duration middleware should be installed");
const liveBody = healthSource.slice(healthSource.indexOf('router.get("/live"'), healthSource.indexOf('router.get("/ready"'));
assert(!/fs\.|releaseService|getReleasePackStatus|listReleases/.test(liveBody), "/health/live must not touch disk or release state");

const express = require("../server/node_modules/express");
const fosuRouter = require("../server/src/routes/fosu");
const adminRouter = require("../server/src/routes/admin");
const healthRouter = require("../server/src/routes/health");
const releaseService = require("../server/src/services/releaseService");
const runtimePointerService = require("../server/src/services/runtimePointerService");
const performanceMonitorService = require("../server/src/services/performanceMonitorService");
const { createSessionToken } = require("../server/src/utils/apiSecurity");

function snapshot(version) {
  const course = {
    courseName: "Latency Course",
    teacherName: "Latency Teacher",
    classroom: "L-101",
    weekday: 1,
    startSection: 1,
    endSection: 2,
    sections: [1, 2],
    weeks: [1, 2, 3],
  };
  const classSchedules = Array.from({ length: 20 }, (_, index) => ({
    className: `25 Latency ${String(index + 1).padStart(2, "0")}`,
    semester: "2025-2026-2",
    collegeCode: "04",
    collegeName: "Latency College",
    grade: "2025",
    majorCode: "0401",
    majorName: "Latency Major",
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
      semesterText: "2025-2026 second term",
      termStartDate: "2026-03-09",
      weekStart: "monday",
      totalWeeks: 19,
    },
    generatedAt: "2026-06-11T00:00:00.000Z",
    updatedAt: "2026-06-11T00:00:00.000Z",
    catalog: { colleges: [{ code: "04", name: "Latency College" }], grades: ["2025"] },
    majors: [{ collegeCode: "04", code: "0401", name: "Latency Major", grade: "2025" }],
    classSchedules,
    resources: {
      teachers: [{ teacherName: "Latency Teacher" }],
      classrooms: [{ roomName: "L-101" }],
      courses: [{ courseName: "Latency Course" }],
      teacherSchedules: [{ teacherName: "Latency Teacher", semester: "2025-2026-2", courses: [course] }],
      classroomSchedules: [{ roomName: "L-101", semester: "2025-2026-2", courses: [course] }],
      courseSchedules: [{ courseName: "Latency Course", semester: "2025-2026-2", courses: [course] }],
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

function stats(values) {
  return {
    count: values.length,
    p50: percentile(values, 50),
    p95: percentile(values, 95),
    max: Number((values.length ? Math.max(...values) : 0).toFixed(2)),
  };
}

function runClientLoad(baseUrl, publicHeaders, adminHeaders, startDelayMs = 0) {
  const clientCode = `
const { performance } = require("perf_hooks");
function percentile(values, p) {
  const sorted = values.slice().sort((a, b) => a - b);
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
  return Number((sorted[index] || 0).toFixed(2));
}
function stats(values) {
  return {
    count: values.length,
    p50: percentile(values, 50),
    p95: percentile(values, 95),
    max: Number((values.length ? Math.max(...values) : 0).toFixed(2)),
  };
}
async function timed(baseUrl, label, pathname, options, samples) {
  const start = performance.now();
  const response = await fetch(baseUrl + pathname, options);
  const text = await response.text();
  const duration = performance.now() - start;
  if (!samples[label]) samples[label] = [];
  samples[label].push(duration);
  if (response.status >= 500) {
    throw new Error(label + " returned " + response.status + ": " + text.slice(0, 200));
  }
}
(async () => {
  const baseUrl = process.env.BASE_URL;
  const publicHeaders = JSON.parse(process.env.PUBLIC_HEADERS);
  const adminHeaders = JSON.parse(process.env.ADMIN_HEADERS);
  const startDelayMs = Number(process.env.START_DELAY_MS || 0) || 0;
  if (startDelayMs > 0) {
    await new Promise((resolve) => setTimeout(resolve, startDelayMs));
  }
  const samples = {};
  const publicPaths = [
    ["/health/live", "health-live"],
    ["/api/fosu/runtime/active", "runtime-active"],
    ["/api/fosu/app-config", "app-config"],
    ["/api/fosu/bootstrap", "bootstrap"],
    ["/api/fosu/prefetch", "prefetch"],
  ];
  const adminPaths = [
    ["/api/admin/sync/status", "admin-sync-status"],
    ["/api/admin/staging/upload?limit=50", "upload-records"],
  ];
  for (const [pathname, label] of publicPaths) {
    await timed(baseUrl, "warmup-" + label, pathname, { headers: publicHeaders }, samples);
  }
  for (const [pathname, label] of adminPaths) {
    await timed(baseUrl, "warmup-" + label, pathname, { headers: adminHeaders }, samples);
  }
  Object.keys(samples).forEach((key) => {
    if (key.startsWith("warmup-")) delete samples[key];
  });
  const waves = [];
  for (let index = 0; index < 20; index += 1) {
    const [pathname, label] = publicPaths[index % publicPaths.length];
    waves.push(timed(baseUrl, label, pathname, { headers: publicHeaders }, samples));
  }
  for (let index = 0; index < 10; index += 1) {
    const [pathname, label] = adminPaths[index % adminPaths.length];
    waves.push(timed(baseUrl, label, pathname, { headers: adminHeaders }, samples));
  }
  await Promise.all(waves);
  console.log(JSON.stringify(Object.fromEntries(Object.entries(samples).map(([label, values]) => [label, stats(values)]))));
})().catch((error) => {
  console.error(error.stack || error.message);
  process.exit(1);
});
`;
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ["-e", clientCode], {
      env: Object.assign({}, process.env, {
        BASE_URL: baseUrl,
        PUBLIC_HEADERS: JSON.stringify(publicHeaders),
        ADMIN_HEADERS: JSON.stringify(adminHeaders),
        START_DELAY_MS: String(startDelayMs),
      }),
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => { stdout += chunk.toString(); });
    child.stderr.on("data", (chunk) => { stderr += chunk.toString(); });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code !== 0) {
        reject(new Error(stderr || stdout || `client load exited ${code}`));
        return;
      }
      try {
        resolve(JSON.parse(stdout.trim()));
      } catch (error) {
        reject(new Error(`invalid client load output: ${stdout}\n${stderr}`));
      }
    });
  });
}

async function timed(baseUrl, label, pathname, options, samples) {
  const start = performance.now();
  const response = await fetch(`${baseUrl}${pathname}`, options);
  const text = await response.text();
  const duration = performance.now() - start;
  if (!samples[label]) samples[label] = [];
  samples[label].push(duration);
  assert(response.status < 500, `${label} returned ${response.status}: ${text.slice(0, 200)}`);
  return { response, text, duration };
}

async function run() {
  fs.mkdirSync(process.env.FOSU_STORAGE_DIR, { recursive: true });
  const version = "latency-2026-06-11";
  releaseService.activateReleaseFromSnapshot(snapshot(version));
  runtimePointerService.ensureActivePointer();
  performanceMonitorService.resetHistogram();

  const app = express();
  app.use(express.json({ limit: "2mb" }));
  app.use(performanceMonitorService.middleware);
  app.use("/health", healthRouter);
  app.use("/api/fosu", fosuRouter);
  app.use("/api/admin", adminRouter);
  const server = await listen(app);
  const baseUrl = `http://127.0.0.1:${server.address().port}`;
  const session = createSessionToken({ openid: "latency-openid" });
  const publicHeaders = {
    "user-agent": "Mozilla/5.0 MicroMessenger",
    "x-fosu-session": session.token,
  };
  const adminHeaders = {
    "x-admin-token": "test-admin-token",
    "content-type": "application/json",
  };
  const samples = {};

  try {
    const deepStart = await timed(baseUrl, "deep-health-start", `/api/admin/release-pack/deep-health/start?version=${encodeURIComponent(version)}`, {
      method: "POST",
      headers: adminHeaders,
    }, samples);
    assert.strictEqual(deepStart.response.status, 202, deepStart.text);
    assert(deepStart.duration < 500, `deep health POST took ${deepStart.duration.toFixed(2)}ms`);
    await new Promise((resolve) => setTimeout(resolve, 120));
    performanceMonitorService.resetHistogram();

    const clientPromise = runClientLoad(baseUrl, publicHeaders, adminHeaders, 150);
    await new Promise((resolve) => setTimeout(resolve, 60));
    performanceMonitorService.resetHistogram();
    const clientResult = await clientPromise;
    await new Promise((resolve) => setTimeout(resolve, 1000));

    const ready = await timed(baseUrl, "health-ready", "/health/ready", {}, samples);
    const readyBody = JSON.parse(ready.text);
    const result = Object.assign({}, clientResult, Object.fromEntries(Object.entries(samples).map(([label, values]) => [label, stats(values)])));
    result.eventLoopDelay = readyBody.eventLoopDelay;
    result.routes = readyBody.routes;

    console.log(JSON.stringify({ success: true, latency: result }, null, 2));

    assert(result["health-live"].p95 < 100, `health/live p95 ${result["health-live"].p95}ms`);
    assert(result["runtime-active"].p95 < 100, `runtime active p95 ${result["runtime-active"].p95}ms`);
    assert(result["app-config"].p95 < 100, `app-config p95 ${result["app-config"].p95}ms`);
    assert(result.bootstrap.p95 < 100, `bootstrap p95 ${result.bootstrap.p95}ms`);
    assert(readyBody.eventLoopDelay.p95Ms < 50, `event loop p95 ${readyBody.eventLoopDelay.p95Ms}ms`);

    console.log("test-event-loop-latency passed");
  } finally {
    server.close();
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
