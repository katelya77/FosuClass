const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const zlib = require("zlib");

const tempRoot = path.join(os.tmpdir(), `fosu-semester-repair-${process.pid}-${Date.now()}`);
process.env.FOSU_STORAGE_DIR = path.join(tempRoot, "storage");
process.env.FOSU_DATA_DIR = path.join(tempRoot, "data");
process.env.NODE_ENV = "development";
process.env.ADMIN_API_TOKEN = "test-admin-token";
process.env.ADMIN_PASSWORD = "test-admin-password";
process.env.STATIC_RELEASE_SYNC_ENABLED = "false";
process.env.OPENRESTY_STATIC_RUNTIME_DIR = path.join(tempRoot, "openresty-runtime");

const express = require("../server/node_modules/express");
const adminRouter = require("../server/src/routes/admin");
const jobService = require("../server/src/services/jobService");
const releaseService = require("../server/src/services/releaseService");
const runtimePointerService = require("../server/src/services/runtimePointerService");
const semesterRepairService = require("../server/src/services/semesterRepairService");
const teachingCalendarService = require("../server/src/services/teachingCalendarService");
const termReadinessService = require("../server/src/services/termReadinessService");
const termRegistryService = require("../server/src/services/termRegistryService");
const termReleaseIndexService = require("../server/src/services/termReleaseIndexService");
const { writeJsonAtomic } = require("../server/src/utils/jsonFileStore");

const OLD_VERSION = "2026-06-05T12-39-28";
const REPAIRED_VERSION = "2026-06-11T10-20-30-calendar-repair";
const sourceCalendar = require("../server/storage/terms/2025-2026-2/teaching-calendar.json");

function course() {
  return {
    courseName: "Repair Test Course",
    teacherName: "Repair Teacher",
    classroom: "C7-306",
    weekday: 1,
    startSection: 1,
    endSection: 2,
    sections: [1, 2],
    weeks: [1, 2, 3],
  };
}

function snapshot(version = OLD_VERSION) {
  const item = course();
  return {
    schemaVersion: 1,
    version,
    releaseVersion: version,
    term: "2025-2026-2",
    semester: "2025-2026-2",
    semesterText: "2025-2026学年第二学期",
    termStartDate: "2026-03-09",
    weekStart: "monday",
    totalWeeks: 20,
    updatedAt: "2026-06-05T12:39:28.000Z",
    catalog: { colleges: [{ code: "04", name: "Test College" }], grades: ["2025"] },
    majors: [{ collegeCode: "04", code: "0401", name: "Test Major", grade: "2025" }],
    classSchedules: [{
      className: "25Repair1",
      semester: "2025-2026-2",
      collegeCode: "04",
      grade: "2025",
      majorCode: "0401",
      courses: [item],
    }],
    resources: {
      teachers: [{ teacherName: "Repair Teacher" }],
      classrooms: [{ roomName: "C7-306" }],
      courses: [{ courseName: "Repair Test Course" }],
      teacherSchedules: [{ teacherName: "Repair Teacher", semester: "2025-2026-2", courses: [item] }],
      classroomSchedules: [{ roomName: "C7-306", semester: "2025-2026-2", courses: [item] }],
      courseSchedules: [{ courseName: "Repair Test Course", semester: "2025-2026-2", courses: [item] }],
    },
  };
}

function cleanup() {
  const resolvedRoot = path.resolve(tempRoot);
  const relativeRoot = path.relative(os.tmpdir(), resolvedRoot);
  if (!relativeRoot || relativeRoot.startsWith("..") || path.isAbsolute(relativeRoot) || !path.basename(resolvedRoot).startsWith("fosu-semester-repair-")) {
    throw new Error(`refusing cleanup: ${resolvedRoot}`);
  }
  fs.rmSync(resolvedRoot, { recursive: true, force: true });
}

function resetStorage() {
  fs.rmSync(tempRoot, { recursive: true, force: true });
  fs.mkdirSync(process.env.FOSU_STORAGE_DIR, { recursive: true });
  fs.mkdirSync(path.join(process.env.FOSU_STORAGE_DIR, "terms", "2025-2026-2"), { recursive: true });
  writeJsonAtomic(path.join(process.env.FOSU_STORAGE_DIR, "terms", "2025-2026-2", "teaching-calendar.json"), sourceCalendar);
  teachingCalendarService.clearCache();
  runtimePointerService.clearCache();
  releaseService.clearDerivedCache();
}

function installLegacyState() {
  resetStorage();
  releaseService.activateReleaseFromSnapshot(snapshot(OLD_VERSION));
  const files = releaseService.getReleaseFiles(OLD_VERSION);
  const oldManifest = JSON.parse(fs.readFileSync(files.manifestPath, "utf-8"));
  delete oldManifest.termConfig;
  delete oldManifest.calendarUrl;
  delete oldManifest.calendarHash;
  delete oldManifest.calendarCount;
  delete oldManifest.calendarUpdatedAt;
  writeJsonAtomic(files.manifestPath, oldManifest);
  writeJsonAtomic(path.join(files.publicReleaseDir, "manifest.json"), oldManifest);
  fs.rmSync(teachingCalendarService.getReleaseCalendarPath(OLD_VERSION, false), { force: true });
  fs.rmSync(teachingCalendarService.getReleaseCalendarPath(OLD_VERSION, true), { force: true });
  fs.rmSync(`${teachingCalendarService.getReleaseCalendarPath(OLD_VERSION, true)}.gz`, { force: true });
  termRegistryService.writeRegistry({
    activeTerm: "2025-2026-2",
    terms: [{
      term: "2025-2026-2",
      semesterText: "2025-2026学年第二学期",
      termStartDate: "2026-03-09",
      weekStart: "monday",
      totalWeeks: 20,
      status: "current",
      releaseVersion: OLD_VERSION,
      dataAvailable: true,
      publishedAt: "2026-06-05T12:39:28.000Z",
      updatedAt: "2026-06-05T12:39:28.000Z",
    }, {
      term: "2026-2027-1",
      semesterText: "2026-2027学年第一学期",
      termStartDate: "2026-09-07",
      weekStart: "monday",
      totalWeeks: 20,
      status: "planned",
      releaseVersion: "",
      dataAvailable: false,
    }],
  }, { backup: false });
  termReleaseIndexService.activateTerm("2025-2026-2", OLD_VERSION);
  runtimePointerService.writeActivePointerForManifest(releaseService.getReleasePackManifest(OLD_VERSION), { allowInactiveTerm: true });
  runtimePointerService.clearCache();
  return fs.readFileSync(files.manifestPath, "utf-8");
}

function assertLegacyStillActive() {
  const active = releaseService.getActiveReleaseInfo();
  assert.strictEqual(active.releaseVersion, OLD_VERSION, "old release should remain active");
  assert.strictEqual(termRegistryService.getTerm("2025-2026-2").releaseVersion, OLD_VERSION, "registry should point to old release");
  assert.strictEqual(Number(termRegistryService.getTerm("2025-2026-2").totalWeeks), 20, "registry should be restored to 20 weeks");
}

function assertNoFinalRepairDir(version) {
  const files = releaseService.getReleaseFiles(version);
  assert(!fs.existsSync(files.releaseDir), "failed repair should not leave final local release dir");
  assert(!fs.existsSync(files.publicReleaseDir), "failed repair should not leave final public release dir");
}

async function testRepairFlow() {
  const oldManifestBefore = installLegacyState();
  const dryRun = await semesterRepairService.repairCurrentTermRelease({
    term: "2025-2026-2",
    sourceReleaseVersion: OLD_VERSION,
    dryRun: true,
    now: new Date("2026-06-11T10:20:30Z"),
  });
  assert.strictEqual(dryRun.dryRun, true);
  assert.strictEqual(dryRun.plan.changes.registry.currentTotalWeeks, 20);
  assert.strictEqual(dryRun.plan.changes.registry.nextTotalWeeks, 19);
  assert.strictEqual(termRegistryService.getTerm("2025-2026-2").totalWeeks, 20, "dry-run must not mutate registry");

  const result = await semesterRepairService.repairCurrentTermRelease({
    term: "2025-2026-2",
    sourceReleaseVersion: OLD_VERSION,
    dryRun: false,
    releaseVersion: REPAIRED_VERSION,
    now: new Date("2026-06-11T10:20:30Z"),
  });
  assert.strictEqual(result.success, true);
  assert.strictEqual(result.releaseVersion, REPAIRED_VERSION);

  const oldFiles = releaseService.getReleaseFiles(OLD_VERSION);
  assert.strictEqual(fs.readFileSync(oldFiles.manifestPath, "utf-8"), oldManifestBefore, "old release manifest must remain unchanged");
  assert(!fs.existsSync(teachingCalendarService.getReleaseCalendarPath(OLD_VERSION, false)), "old release calendar must remain absent");

  const newFiles = releaseService.getReleaseFiles(REPAIRED_VERSION);
  const manifest = JSON.parse(fs.readFileSync(newFiles.manifestPath, "utf-8"));
  const localCalendar = JSON.parse(fs.readFileSync(teachingCalendarService.getReleaseCalendarPath(REPAIRED_VERSION, false), "utf-8"));
  const publicCalendar = JSON.parse(fs.readFileSync(teachingCalendarService.getReleaseCalendarPath(REPAIRED_VERSION, true), "utf-8"));
  assert.deepStrictEqual(localCalendar, publicCalendar, "local and public calendar should match");
  assert.strictEqual(manifest.term, "2025-2026-2");
  assert.strictEqual(manifest.releaseVersion, REPAIRED_VERSION);
  assert.strictEqual(manifest.termConfig.termStartDate, "2026-03-09");
  assert.strictEqual(manifest.termConfig.weekStart, "monday");
  assert.strictEqual(manifest.termConfig.totalWeeks, 19);
  assert.strictEqual(manifest.calendarUrl, `/static/releases/${REPAIRED_VERSION}/calendar.json`);
  assert.strictEqual(manifest.calendarHash, teachingCalendarService.getCalendarHash(localCalendar));
  assert.strictEqual(manifest.calendarCount, 19);
  assert(manifest.calendarUpdatedAt, "manifest should include calendarUpdatedAt");
  assert(fs.existsSync(`${teachingCalendarService.getReleaseCalendarPath(REPAIRED_VERSION, true)}.gz`), "calendar gzip should exist when gzip is enabled");

  const record = termRegistryService.getTerm("2025-2026-2");
  assert.strictEqual(record.releaseVersion, REPAIRED_VERSION);
  assert.strictEqual(record.totalWeeks, 19);
  assert.strictEqual(termRegistryService.getTerm("2026-2027-1").totalWeeks, 20, "other terms must not be migrated");
  assert.strictEqual(releaseService.getActiveReleaseInfo().releaseVersion, REPAIRED_VERSION);
  assert.strictEqual(termReleaseIndexService.getActiveReleaseVersionForTerm("2025-2026-2"), REPAIRED_VERSION);
  assert(fs.existsSync(runtimePointerService.ACTIVE_RUNTIME_PATH), "runtime pointer should be rebuilt");
  assert(fs.existsSync(path.join(process.env.OPENRESTY_STATIC_RUNTIME_DIR, "active.json")), "OpenResty runtime active.json should sync");

  const readiness = termReadinessService.buildTermReadiness("2025-2026-2", REPAIRED_VERSION, {
    autoRepairRuntimePointer: false,
    now: new Date("2026-06-11T12:00:00+08:00"),
  });
  assert.strictEqual(readiness.summary.fail, 0, `readiness should pass: ${readiness.blockers.join(",")}`);
  assert.strictEqual(readiness.calendarSummary.currentWeek, 14);
  assert.strictEqual(readiness.calendarSummary.calendarWeeks, 19);

  const tampered = Object.assign({}, localCalendar, { updatedAt: "tampered" });
  writeJsonAtomic(teachingCalendarService.getReleaseCalendarPath(REPAIRED_VERSION, false), tampered);
  writeJsonAtomic(teachingCalendarService.getReleaseCalendarPath(REPAIRED_VERSION, true), tampered);
  teachingCalendarService.clearCache();
  const hashFailure = termReadinessService.buildTermReadiness("2025-2026-2", REPAIRED_VERSION, { autoRepairRuntimePointer: false });
  const hashCheck = hashFailure.checks.find((item) => item.key === "calendar-hash-match");
  assert.strictEqual(hashCheck.status, "fail", "calendar hash check should fail after tampering");
}

async function testCalendarFileRequired() {
  installLegacyState();
  fs.rmSync(teachingCalendarService.getTermCalendarPath("2025-2026-2"), { force: true });
  teachingCalendarService.clearCache();
  await assert.rejects(
    semesterRepairService.repairCurrentTermRelease({
      term: "2025-2026-2",
      sourceReleaseVersion: OLD_VERSION,
      dryRun: true,
    }),
    (error) => error.code === "TEACHING_CALENDAR_FILE_MISSING"
  );
  assertLegacyStillActive();
}

async function testAtomicFailure(label, hookName) {
  installLegacyState();
  const failingVersion = `${REPAIRED_VERSION}-${label}`;
  await assert.rejects(
    semesterRepairService.repairCurrentTermRelease({
      term: "2025-2026-2",
      sourceReleaseVersion: OLD_VERSION,
      dryRun: false,
      releaseVersion: failingVersion,
      hooks: {
        [hookName]: () => {
          const error = new Error(`injected ${label}`);
          error.code = `INJECTED_${label.toUpperCase()}`;
          throw error;
        },
      },
    }),
    (error) => error.rollbackApplied === true
  );
  assertLegacyStillActive();
  assertNoFinalRepairDir(failingVersion);
}

async function testStaticSyncFailure() {
  installLegacyState();
  const failingVersion = `${REPAIRED_VERSION}-static-sync`;
  await assert.rejects(
    semesterRepairService.repairCurrentTermRelease({
      term: "2025-2026-2",
      sourceReleaseVersion: OLD_VERSION,
      dryRun: false,
      releaseVersion: failingVersion,
      syncOpenResty: true,
      hooks: {
        beforeStaticSync: () => {
          const error = new Error("injected static sync failure");
          error.code = "INJECTED_STATIC_SYNC";
          throw error;
        },
      },
    }),
    (error) => error.rollbackApplied === true
  );
  assertLegacyStillActive();
  assertNoFinalRepairDir(failingVersion);
}

async function testRuntimePointerFailure() {
  installLegacyState();
  const failingVersion = `${REPAIRED_VERSION}-runtime`;
  const original = runtimePointerService.ensureActivePointer;
  runtimePointerService.ensureActivePointer = function injectedRuntimeFailure() {
    const error = new Error("injected runtime pointer failure");
    error.code = "INJECTED_RUNTIME_POINTER";
    throw error;
  };
  try {
    await assert.rejects(
      semesterRepairService.repairCurrentTermRelease({
        term: "2025-2026-2",
        sourceReleaseVersion: OLD_VERSION,
        dryRun: false,
        releaseVersion: failingVersion,
      }),
      (error) => error.rollbackApplied === true
    );
  } finally {
    runtimePointerService.ensureActivePointer = original;
  }
  assertLegacyStillActive();
  assertNoFinalRepairDir(failingVersion);
  const current = JSON.parse(fs.readFileSync(path.join(process.env.FOSU_STORAGE_DIR, "snapshots", "current.json"), "utf-8"));
  assert.strictEqual(current.version, OLD_VERSION, "current snapshot should roll back to old release");
  const gz = JSON.parse(zlib.gunzipSync(fs.readFileSync(path.join(process.env.FOSU_STORAGE_DIR, "snapshots", "current.json.gz"))).toString("utf-8"));
  assert.strictEqual(gz.version, OLD_VERSION, "current snapshot gzip should roll back to old release");
}

async function testIdempotency() {
  installLegacyState();
  await semesterRepairService.repairCurrentTermRelease({
    term: "2025-2026-2",
    sourceReleaseVersion: OLD_VERSION,
    dryRun: false,
    releaseVersion: REPAIRED_VERSION,
  });
  const result = await semesterRepairService.repairCurrentTermRelease({
    term: "2025-2026-2",
    sourceReleaseVersion: OLD_VERSION,
    dryRun: false,
    releaseVersion: `${REPAIRED_VERSION}-second`,
  });
  assert.strictEqual(result.alreadyHealthy, true);
  assert.strictEqual(result.releaseVersion, REPAIRED_VERSION);
  assertNoFinalRepairDir(`${REPAIRED_VERSION}-second`);
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
  for (let index = 0; index < 80; index += 1) {
    const status = await requestJson(baseUrl, `/api/admin/jobs/${encodeURIComponent(id)}`);
    const job = status.data.job;
    if (job && (job.status === "success" || job.status === "failed")) return job;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error(`job ${id} did not finish`);
}

async function testAdminJob() {
  process.env.FOSU_RELEASE_WORKER_ENABLED = "false";
  installLegacyState();
  const app = express();
  app.use(express.json({ limit: "2mb" }));
  app.use("/api/admin", adminRouter);
  const server = await listen(app);
  const baseUrl = `http://127.0.0.1:${server.address().port}`;
  try {
    const dry = await requestJson(baseUrl, "/api/admin/terms/2025-2026-2/repair-release/dry-run", {
      method: "POST",
      body: JSON.stringify({ sourceReleaseVersion: OLD_VERSION }),
    });
    assert.strictEqual(dry.status, 200);
    assert.strictEqual(dry.data.result.dryRun, true);
    assert.strictEqual(termRegistryService.getTerm("2025-2026-2").totalWeeks, 20, "admin dry-run must not mutate files");

    const startDisabled = await requestJson(baseUrl, "/api/admin/terms/2025-2026-2/repair-release/start", {
      method: "POST",
      body: JSON.stringify({ sourceReleaseVersion: OLD_VERSION }),
    });
    assert.strictEqual(startDisabled.status, 503, "disabled worker should fail before long request");

    process.env.FOSU_RELEASE_WORKER_ENABLED = "true";
    const start = await requestJson(baseUrl, "/api/admin/terms/2025-2026-2/repair-release/start", {
      method: "POST",
      body: JSON.stringify({ sourceReleaseVersion: OLD_VERSION }),
    });
    assert.strictEqual(start.status, 202);
    assert(start.data.jobId, "formal run should return jobId");
    const duplicate = await requestJson(baseUrl, "/api/admin/terms/2025-2026-2/repair-release/start", {
      method: "POST",
      body: JSON.stringify({ sourceReleaseVersion: OLD_VERSION }),
    });
    assert.strictEqual(duplicate.status, 409, "duplicate repair should be blocked by release-heavy lock");
    const done = await waitJob(baseUrl, start.data.jobId);
    assert.strictEqual(done.status, "success");
    const logText = JSON.stringify(done.logs || []);
    assert(!/test-admin-token|test-admin-password|SECRET|APPSECRET|Authorization/i.test(logText), "job logs should not leak secrets");
  } finally {
    server.close();
    process.env.FOSU_RELEASE_WORKER_ENABLED = "true";
  }
}

async function run() {
  await testRepairFlow();
  await testCalendarFileRequired();
  await testAtomicFailure("build", "beforeBuild");
  await testStaticSyncFailure();
  await testAtomicFailure("registry", "beforeRegistryWrite");
  await testRuntimePointerFailure();
  await testIdempotency();
  await testAdminJob();
  cleanup();
  console.log("test-semester-repair passed");
}

run().catch((error) => {
  console.error(error);
  try { cleanup(); } catch (cleanupError) {}
  process.exit(1);
});
