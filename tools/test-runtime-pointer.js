const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");

const tempRoot = path.join(os.tmpdir(), `fosu-runtime-pointer-${process.pid}-${Date.now()}`);
process.env.FOSU_STORAGE_DIR = path.join(tempRoot, "storage");
process.env.NODE_ENV = "test";

const express = require("../server/node_modules/express");
const fosuRouter = require("../server/src/routes/fosu");
const releaseService = require("../server/src/services/releaseService");
const runtimePointerService = require("../server/src/services/runtimePointerService");
const termRegistryService = require("../server/src/services/termRegistryService");
const { writeJsonAtomic } = require("../server/src/utils/jsonFileStore");

function snapshot(version) {
  const course = {
    courseName: "Runtime Pointer 课程",
    teacherName: "Runtime Pointer 教师",
    classroom: "C7-301",
    weekday: 1,
    startSection: 1,
    endSection: 2,
    sections: [1, 2],
    weeks: [1, 2],
  };
  return {
    version,
    releaseVersion: version,
    term: "2025-2026-2",
    semester: "2025-2026-2",
    termStartDate: "2026-03-09",
    semesterText: "2025-2026学年第二学期",
    updatedAt: "2026-06-05T12:39:28.000Z",
    catalog: { colleges: [{ code: "04", name: "测试学院" }], grades: ["2025"] },
    majors: [{ collegeCode: "04", code: "0401", name: "测试专业", grade: "2025" }],
    classSchedules: [{ className: "25运行1班", semester: "2025-2026-2", collegeCode: "04", grade: "2025", majorCode: "0401", courses: [course] }],
    resources: {
      teachers: [{ teacherName: "Runtime Pointer 教师" }],
      classrooms: [{ roomName: "C7-301" }],
      courses: [{ courseName: "Runtime Pointer 课程" }],
      teacherSchedules: [{ teacherName: "Runtime Pointer 教师", semester: "2025-2026-2", courses: [course] }],
      classroomSchedules: [{ roomName: "C7-301", semester: "2025-2026-2", courses: [course] }],
      courseSchedules: [{ courseName: "Runtime Pointer 课程", semester: "2025-2026-2", courses: [course] }],
    },
  };
}

function listen(app) {
  return new Promise((resolve) => {
    const server = app.listen(0, "127.0.0.1", () => resolve(server));
  });
}

function cleanup() {
  fs.rmSync(tempRoot, { recursive: true, force: true });
}

async function run() {
  const version = "2026-06-05T12-39-28";
  releaseService.activateReleaseFromSnapshot(snapshot(version));
  fs.rmSync(runtimePointerService.ACTIVE_RUNTIME_PATH, { force: true });
  runtimePointerService.clearCache();

  const pointer = runtimePointerService.ensureActivePointer();
  assert.strictEqual(pointer.term, "2025-2026-2");
  assert.strictEqual(pointer.semesterText, "2025-2026学年第二学期");
  assert.strictEqual(pointer.releaseVersion, version);
  assert(pointer.cacheEpoch, "pointer should include cacheEpoch");
  assert(pointer.termConfig && pointer.termConfig.termStartDate === "2026-03-09");
  assert(pointer.urls && pointer.urls.calendar && pointer.urls.bootstrap && pointer.urls.classIndex, "pointer should expose release URLs");
  assert.strictEqual(pointer.calendarUrl, pointer.urls.calendar);
  assert(fs.existsSync(runtimePointerService.ACTIVE_RUNTIME_PATH), "public runtime pointer should be generated");

  fs.rmSync(runtimePointerService.ACTIVE_RUNTIME_PATH, { force: true });
  runtimePointerService.clearCache();

  const app = express();
  app.use("/api/fosu", fosuRouter);
  const server = await listen(app);
  const baseUrl = `http://127.0.0.1:${server.address().port}`;
  try {
    const response = await fetch(`${baseUrl}/api/fosu/runtime/active`);
    assert.strictEqual(response.status, 200, "runtime active API should return 200 without session");
    const body = await response.json();
    assert.strictEqual(body.success, true);
    assert.strictEqual(body.term, "2025-2026-2");
    assert.strictEqual(body.releaseVersion, version);
    assert.strictEqual(body.source, "manifest-fallback");
    assert.strictEqual(fs.existsSync(runtimePointerService.ACTIVE_RUNTIME_PATH), false, "API fallback must not rebuild pointer in request path");
  } finally {
    server.close();
  }

  runtimePointerService.ensureActivePointer();
  const persisted = JSON.parse(fs.readFileSync(runtimePointerService.ACTIVE_RUNTIME_PATH, "utf-8"));
  assert.strictEqual(persisted.term, "2025-2026-2");
  assert.strictEqual(termRegistryService.getActiveTerm().term, "2025-2026-2");

  writeJsonAtomic(runtimePointerService.ACTIVE_RUNTIME_PATH, {
    success: true,
    term: "2025-2026-2",
    releaseVersion: version,
  });
  runtimePointerService.clearCache();
  const healed = runtimePointerService.ensureActivePointer();
  assert(healed.termConfig && healed.termConfig.semesterText, "damaged pointer should be rebuilt with termConfig");
  assert(healed.calendarUrl && healed.bootstrapUrl && healed.classCatalogUrl, "damaged pointer should be rebuilt with release URLs");
  console.log("test-runtime-pointer passed");
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
}).finally(cleanup);
