const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");

const express = require("../server/node_modules/express");
const { uploadStagingFile } = require("./fosu-sync-client/upload");

const tempRoot = path.join(os.tmpdir(), `fosu-upload-concurrency-${process.pid}-${Date.now()}`);

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function snapshot() {
  const course = {
    courseName: "并发上传测试",
    teacherName: "测试教师",
    classroom: "C7-101",
    weekday: 1,
    startSection: 1,
    endSection: 2,
    weeks: [1, 2],
  };
  return {
    schemaVersion: "1.0",
    releaseVersion: "upload-concurrency-test",
    version: "upload-concurrency-test",
    term: "2025-2026-2",
    semester: "2025-2026-2",
    termStartDate: "2026-03-09",
    generatedAt: "2026-06-04T00:00:00.000Z",
    updatedAt: "2026-06-04T00:00:00.000Z",
    catalog: { colleges: [{ code: "04", name: "测试学院" }], grades: ["2025"] },
    majors: [{ collegeCode: "04", code: "0401", name: "测试专业", grade: "2025" }],
    classSchedules: [{ className: "25测试1班", courses: [course] }],
    resources: {
      teachers: [{ teacherName: "测试教师" }],
      classrooms: [{ roomName: "C7-101" }],
      courses: [{ courseName: "并发上传测试" }],
      teacherSchedules: [{ teacherName: "测试教师", courses: [course] }],
      classroomSchedules: [{ roomName: "C7-101", courses: [course] }],
      courseSchedules: [{ courseName: "并发上传测试", courses: [course] }],
    },
    padding: "x".repeat(16000),
  };
}

function cleanup() {
  const resolved = path.resolve(tempRoot);
  if (!path.basename(resolved).startsWith("fosu-upload-concurrency-")) {
    throw new Error(`refusing cleanup: ${resolved}`);
  }
  fs.rmSync(resolved, { recursive: true, force: true });
}

function listen(app) {
  return new Promise((resolve) => {
    const server = app.listen(0, "127.0.0.1", () => resolve(server));
  });
}

async function main() {
  fs.mkdirSync(tempRoot, { recursive: true });
  const filePath = path.join(tempRoot, "2025-2026-2-full.json");
  fs.writeFileSync(filePath, JSON.stringify(snapshot(), null, 2), "utf-8");

  const received = [];
  let active = 0;
  let maxActive = 0;

  const app = express();
  app.get("/api/admin/staging/fingerprint", (req, res) => {
    res.json({ success: true, sameAsActive: false, sameAsStaging: false });
  });
  app.post("/api/admin/staging/upload/init", express.json({ limit: "2mb" }), (req, res) => {
    assert(req.body.totalChunks > 3, "fixture should create multiple upload chunks");
    res.json({ success: true, uploadId: "concurrency-test-upload" });
  });
  app.post("/api/admin/staging/upload/chunk", express.raw({ type: "*/*", limit: "2mb" }), async (req, res) => {
    const chunkIndex = Number(req.query.chunkIndex);
    active += 1;
    maxActive = Math.max(maxActive, active);
    await delay(50);
    received.push(chunkIndex);
    active -= 1;
    res.json({ success: true, upload: { receivedCount: received.length } });
  });
  app.post("/api/admin/staging/upload/finalize", express.json({ limit: "2mb" }), (req, res) => {
    assert.strictEqual(received.length, req.body.totalChunks, "all chunks should arrive before finalize");
    res.json({
      success: true,
      status: "pending-review",
      data: {
        status: "pending-review",
        term: "2025-2026-2",
        releaseVersion: "upload-concurrency-test",
      },
    });
  });

  const server = await listen(app);
  try {
    await uploadStagingFile({
      filePath,
      server: `http://127.0.0.1:${server.address().port}`,
      token: "test-admin-token",
      authMode: "admin",
      params: {
        "chunk-mb": "0.001",
        "upload-concurrency": "3",
        "no-gzip": true,
        "force-upload": true,
      },
    });
    assert(maxActive > 1, `expected concurrent chunk uploads, got maxActive=${maxActive}`);
    assert(maxActive <= 3, `upload concurrency should be capped by option, got ${maxActive}`);
    assert.deepStrictEqual(
      received.slice().sort((a, b) => a - b),
      Array.from({ length: received.length }, (_, index) => index),
      "received chunk indexes should be complete"
    );
  } finally {
    await new Promise((resolve) => server.close(resolve));
    cleanup();
  }
  console.log("test-sync-upload-concurrency passed");
}

main().catch((error) => {
  console.error(error.stack || error.message);
  try { cleanup(); } catch (cleanupError) {}
  process.exit(1);
});
