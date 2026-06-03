const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");

const tempRoot = path.join(os.tmpdir(), `fosu-empty-room-api-test-${process.pid}-${Date.now()}`);
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
    updatedAt: "2026-06-02T00:00:00.000Z",
    catalog: { colleges: [{ code: "04", name: "测试学院" }], grades: ["2025"] },
    majors: [{ collegeCode: "04", code: "0401", name: "测试专业", grade: "2025" }],
    classSchedules: [{
      className: "25空教室API测试1班",
      semester: "2025-2026-2",
      courses: [{ courseName: "测试课程", classroom: "C7-201", weekday: 2, startSection: 3, endSection: 4 }],
    }],
    resources: {
      teachers: [{ teacherName: "API教师" }],
      classrooms: [{ roomName: "C7-201" }, { roomName: "C7-202" }],
      courses: [{ courseName: "API课程" }],
      teacherSchedules: [{
        teacherName: "API教师",
        courses: [{ courseName: "API课程", weekday: 2, startSection: 3, endSection: 4 }],
      }],
      classroomSchedules: [
        {
          roomName: "C7-201",
          courses: [{ courseName: "占用课程", teacherName: "教师A", weekday: 2, startSection: 3, endSection: 4, weeks: [13] }],
        },
        {
          roomName: "C7-202",
          courses: [{ courseName: "下一节课程", teacherName: "教师B", weekday: 2, startSection: 6, endSection: 7, weeks: [13] }],
        },
      ],
      courseSchedules: [{
        courseName: "API课程",
        courses: [{ courseName: "API课程", weekday: 2, startSection: 3, endSection: 4 }],
      }],
    },
  };
}

function listen(app) {
  return new Promise((resolve) => {
    const server = app.listen(0, "127.0.0.1", () => resolve(server));
  });
}

async function getJson(baseUrl, requestPath) {
  const response = await fetch(`${baseUrl}${requestPath}`);
  return {
    status: response.status,
    cacheControl: response.headers.get("cache-control") || "",
    data: await response.json(),
  };
}

async function run() {
  const version = "empty-room-api-2026-06-02";
  releaseService.activateReleaseFromSnapshot(buildSnapshot(version));

  const app = express();
  app.use("/api/fosu", fosuRouter);
  const server = await listen(app);
  const baseUrl = `http://127.0.0.1:${server.address().port}`;

  try {
    const active = await getJson(baseUrl, "/api/fosu/empty-classrooms?date=2026-06-02&week=13&weekday=2&sections=3-4&building=C7");
    assert.strictEqual(active.status, 200);
    assert(active.cacheControl.includes("no-store"), "active empty-classrooms without releaseVersion should be no-store");
    assert.strictEqual(active.data.success, true);
    assert(active.data.rooms.some((room) => room.roomName === "C7-202"), "active API should return free C7-202");

    const versioned = await getJson(baseUrl, `/api/fosu/empty-classrooms?date=2026-06-02&week=13&weekday=2&sections=3-4&building=C7&releaseVersion=${encodeURIComponent(version)}`);
    assert.strictEqual(versioned.status, 200);
    assert(versioned.cacheControl.includes("public") && versioned.cacheControl.includes("max-age=600"), "versioned empty-classrooms should be cacheable");
    assert.strictEqual(versioned.data.releaseVersion, version);
    assert.strictEqual(versioned.data.query.sections, "3-4");
    assert(Array.isArray(versioned.data.rooms), "rooms should be an array");
    assert.strictEqual(versioned.data.rooms[0].capacityText, "容量未知");
  } finally {
    server.close();
    const resolvedRoot = path.resolve(tempRoot);
    const relativeRoot = path.relative(os.tmpdir(), resolvedRoot);
    if (!relativeRoot || relativeRoot.startsWith("..") || path.isAbsolute(relativeRoot) || !path.basename(resolvedRoot).startsWith("fosu-empty-room-api-test-")) {
      throw new Error(`refusing to remove unexpected temp directory: ${resolvedRoot}`);
    }
    fs.rmSync(resolvedRoot, { recursive: true, force: true });
  }

  console.log("test-empty-room-api passed");
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
