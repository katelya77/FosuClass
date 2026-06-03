const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const axios = require("axios");

process.env.NO_PROXY = "*";
process.env.no_proxy = "*";
axios.defaults.proxy = false;

const externalApiBase = process.env.TEST_API_BASE || "";
const tempRoot = path.join(os.tmpdir(), `fosu-miniprogram-cache-version-test-${process.pid}-${Date.now()}`);

if (!externalApiBase) {
  process.env.FOSU_STORAGE_DIR = path.join(tempRoot, "storage");
}

const express = require("../node_modules/express");
const fosuRouter = require("../src/routes/fosu");
const releaseService = require("../src/services/releaseService");

function buildSnapshot(version) {
  return {
    schemaVersion: 1,
    version,
    releaseVersion: version,
    term: "2025-2026-2",
    semester: "2025-2026-2",
    termStartDate: "2026-03-09",
    updatedAt: "2026-06-02T00:00:00.000Z",
    catalog: {
      semesters: [{ value: "2025-2026-2", label: "2025-2026-2" }],
      colleges: [{ code: "04", name: "测试学院" }],
      grades: ["2025"],
      weeks: [],
      sections: [],
    },
    majors: [{ collegeCode: "04", code: "0401", name: "测试专业", grade: "2025" }],
    classSchedules: [{
      classId: "cache-version-class-1",
      className: "25缓存测试1班",
      semester: "2025-2026-2",
      collegeCode: "04",
      grade: "2025",
      majorCode: "0401",
      courses: [{
        courseName: "缓存测试课程",
        teacherName: "缓存测试教师",
        classroom: "C7-101",
        weekday: 2,
        startSection: 3,
        endSection: 4,
      }],
    }],
    resources: {
      teachers: [{ teacherName: "缓存测试教师" }],
      classrooms: [{ roomName: "C7-101" }, { roomName: "C7-102" }],
      courses: [{ courseName: "缓存测试课程" }],
      teacherSchedules: [{
        teacherName: "缓存测试教师",
        courses: [{ courseName: "缓存测试课程", weekday: 2, startSection: 3, endSection: 4 }],
      }],
      classroomSchedules: [{
        roomName: "C7-101",
        courses: [{ courseName: "缓存测试课程", weekday: 2, startSection: 3, endSection: 4, weeks: [13] }],
      }],
      courseSchedules: [{
        courseName: "缓存测试课程",
        courses: [{ courseName: "缓存测试课程", weekday: 2, startSection: 3, endSection: 4 }],
      }],
    },
  };
}

function listen(app) {
  return new Promise((resolve) => {
    const server = app.listen(0, "127.0.0.1", () => resolve(server));
  });
}

function cleanup() {
  if (externalApiBase) return;
  const resolvedRoot = path.resolve(tempRoot);
  const relativeRoot = path.relative(os.tmpdir(), resolvedRoot);
  if (!relativeRoot || relativeRoot.startsWith("..") || path.isAbsolute(relativeRoot) || !path.basename(resolvedRoot).startsWith("fosu-miniprogram-cache-version-test-")) {
    throw new Error(`refusing to remove unexpected temp directory: ${resolvedRoot}`);
  }
  fs.rmSync(resolvedRoot, { recursive: true, force: true });
}

async function run() {
  console.log("=== 开始测试 test-miniprogram-cache-version.js ===");

  let server = null;
  let apiBase = externalApiBase;

  if (!apiBase) {
    releaseService.activateReleaseFromSnapshot(buildSnapshot("cache-version-2026-06-02"));
    const app = express();
    app.use("/api/fosu", fosuRouter);
    server = await listen(app);
    apiBase = `http://127.0.0.1:${server.address().port}`;
  }

  try {
    const endpoints = ["/api/fosu/app-config", "/api/fosu/bootstrap"];
    for (const ep of endpoints) {
      const url = `${apiBase}${ep}?ts=${Date.now()}`;
      const res = await axios.get(url, { proxy: false });
      console.log(`Endpoint ${ep} 状态码:`, res.status);

      const cc = res.headers["cache-control"];
      const pragma = res.headers["pragma"];
      console.log(`Headers for ${ep}: Cache-Control=${cc}, Pragma=${pragma}`);

      assert(cc && cc.includes("no-store"), `${ep} 接口应该被设置为 no-store 以防止小程序读取过期的 CDN 缓存`);

      const data = res.data;
      assert(data.success, `${ep} 接口响应失败`);

      if (ep === "/api/fosu/app-config") {
        const payload = data.data || {};
        console.log("app-config fields check:", {
          term: payload.term,
          releaseVersion: payload.releaseVersion,
          publishedAt: payload.publishedAt,
          cacheVersion: payload.cacheVersion,
          cacheEpoch: payload.cacheEpoch,
        });
        assert(payload.releaseVersion, "app-config 缺少 releaseVersion");
        assert(payload.term, "app-config 缺少 term");
        assert(payload.cacheVersion, "app-config 缺少 cacheVersion");
        assert(payload.cacheEpoch, "app-config 缺少 cacheEpoch");
      }
    }
  } finally {
    if (server) {
      server.close();
    }
    cleanup();
  }

  console.log("✅ test-miniprogram-cache-version.js 测试通过！");
}

run().catch((err) => {
  console.error("❌ test-miniprogram-cache-version.js 测试失败:", err.message);
  process.exit(1);
});
