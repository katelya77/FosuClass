const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");

const tempRoot = path.join(os.tmpdir(), `fosu-periodic-light-${process.pid}-${Date.now()}`);
process.env.FOSU_STORAGE_DIR = path.join(tempRoot, "storage");
process.env.NODE_ENV = "test";

const express = require("../server/node_modules/express");
const releaseService = require("../server/src/services/releaseService");
const termRegistryService = require("../server/src/services/termRegistryService");
const termReleaseIndexService = require("../server/src/services/termReleaseIndexService");
const runtimePointerService = require("../server/src/services/runtimePointerService");
const fosuRouter = require("../server/src/routes/fosu");

function snapshot(version) {
  const course = { courseName: "Light", teacherName: "T", classroom: "C7-101", weekday: 1, startSection: 1, endSection: 2, sections: [1, 2], weeks: [1] };
  return {
    version,
    releaseVersion: version,
    term: "2025-2026-2",
    semester: "2025-2026-2",
    termConfig: { term: "2025-2026-2", semesterText: "2025-2026学年第二学期", termStartDate: "2026-03-09", totalWeeks: 20, weekStart: "monday", releaseVersion: version },
    updatedAt: "2026-06-10T00:00:00.000Z",
    catalog: { colleges: [{ code: "01", name: "A" }], grades: ["2025"] },
    majors: [{ collegeCode: "01", code: "0101", name: "M", grade: "2025" }],
    classSchedules: [{ semester: "2025-2026-2", className: "A1", courses: [course] }],
    resources: {
      teachers: [{ teacherName: "T" }],
      classrooms: [{ roomName: "C7-101" }],
      courses: [{ courseName: "Light" }],
      teacherSchedules: [{ teacherName: "T", courses: [course] }],
      classroomSchedules: [{ roomName: "C7-101", courses: [course] }],
      courseSchedules: [{ courseName: "Light", courses: [course] }],
    },
  };
}

function listen(app) {
  return new Promise((resolve) => {
    const server = app.listen(0, "127.0.0.1", () => resolve(server));
  });
}

(async () => {
  try {
    const version = "periodic-light-v1";
    termRegistryService.writeRegistry({ activeTerm: "2025-2026-2", terms: [{
      term: "2025-2026-2", semesterText: "2025-2026学年第二学期", termStartDate: "2026-03-09", totalWeeks: 20, weekStart: "monday", status: "current", releaseVersion: version, dataAvailable: true,
    }] }, { backup: false });
    termReleaseIndexService.activateTerm("2025-2026-2", version);
    const written = releaseService.writeReleaseSnapshot(snapshot(version));
    runtimePointerService.writeActivePointerForManifest(written.manifest, { allowInactiveTerm: true });

    releaseService.readActiveIndex = () => { throw new Error("readActiveIndex should not be called"); };
    releaseService.readEmptyRoomIndex = () => { throw new Error("readEmptyRoomIndex should not be called"); };

    const app = express();
    app.use("/api/fosu", fosuRouter);
    const server = await listen(app);
    const base = `http://127.0.0.1:${server.address().port}`;
    const started = Date.now();
    const response = await fetch(`${base}/api/fosu/periodic-data?releaseVersion=${version}`);
    const data = await response.json();
    server.close();
    assert.strictEqual(data.success, true);
    assert(Date.now() - started < 1000, "fixture periodic-data should respond quickly");
    assert(data.indexes.class.count >= 1);
    assert(!JSON.stringify(data).includes('"items"'), "payload must not include full index arrays");
    console.log("test-periodic-data-lightweight passed");
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
})();
