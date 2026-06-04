const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const mockEnv = require("./mock-env");

const tempRoot = path.join(os.tmpdir(), `fosu-teacher-real-${process.pid}-${Date.now()}`);
process.env.FOSU_STORAGE_DIR = path.join(tempRoot, "storage");
process.env.FOSU_STATIC_RELEASE_BASE_URL = "https://class.katelya.eu.org/static/releases";
process.env.NODE_ENV = "test";

mockEnv.clearStorage();
const releaseService = require("../server/src/services/releaseService");
const releasePackService = require("../miniprogram/services/releasePackService");

const term = "2025-2026-2";
const version = "teacher-real-2026-06-04";
const calls = [];

function snapshot() {
  const course = {
    courseName: "教师搜索课程",
    teacherName: "谭杰安",
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
    term,
    semester: term,
    termStartDate: "2026-03-09",
    generatedAt: "2026-06-04T00:00:00.000Z",
    updatedAt: "2026-06-04T00:00:00.000Z",
    catalog: { colleges: [{ code: "04", name: "测试学院" }], grades: ["2025"] },
    majors: [{ collegeCode: "04", code: "0401", name: "测试专业", grade: "2025" }],
    classSchedules: [{ className: "25教师1班", courses: [course] }],
    resources: {
      teachers: [{ name: "谭杰安", professionalTitle: "副教授", collegeName: "测试学院" }],
      classrooms: [{ roomName: "B8-202" }],
      courses: [{ courseName: "教师搜索课程" }],
      teacherSchedules: [{ teacherName: "谭杰安", courses: [course] }],
      classroomSchedules: [{ roomName: "B8-202", courses: [course] }],
      courseSchedules: [{ courseName: "教师搜索课程", courses: [course] }],
    },
  };
}

function cleanup() {
  const resolved = path.resolve(tempRoot);
  if (!path.basename(resolved).startsWith("fosu-teacher-real-")) {
    throw new Error(`refusing cleanup: ${resolved}`);
  }
  fs.rmSync(resolved, { recursive: true, force: true });
}

async function run() {
  releaseService.activateReleaseFromSnapshot(snapshot());
  const files = releaseService.getReleaseFiles(version);
  const teacherIndex = JSON.parse(fs.readFileSync(files.teacherIndexAllPath, "utf-8"));
  assert.strictEqual(teacherIndex.success, true);
  assert(teacherIndex.items[0].searchableName, "teacher index should include searchableName");
  assert(Array.isArray(teacherIndex.items[0].keywords), "teacher index should include keywords");

  global.wx.setStorageSync(releasePackService.LOCAL_ACTIVE_RELEASE_KEY, {
    savedAt: Date.now(),
    term,
    releaseVersion: version,
    manifest: {
      success: true,
      term,
      releaseVersion: version,
      indexUrls: {
        teacher: `https://class.katelya.eu.org/static/releases/${version}/index/teacher/all.json`,
      },
    },
  });

  global.wx.mockRequest = (options) => {
    calls.push(options.url);
    const url = new URL(options.url, "https://class.katelya.eu.org");
    if (url.pathname === `/static/releases/${version}/index/teacher/all.json`) {
      setTimeout(() => options.success({ statusCode: 200, data: teacherIndex }), 1);
      return;
    }
    if (url.pathname.includes("/api/fosu/search-index")) {
      setTimeout(() => options.fail({ errMsg: "dynamic API should not be used" }), 1);
      return;
    }
    setTimeout(() => options.fail({ errMsg: `unexpected request ${options.url}` }), 1);
  };

  const byChinese = await releasePackService.searchIndex("teacher", {
    term,
    releaseVersion: version,
    keyword: "谭",
  }, { forceNetwork: true, retries: 0 });
  assert.strictEqual(byChinese.items.length, 1);
  assert.strictEqual(byChinese.items[0].teacherName, "谭杰安");

  const byTitle = await releasePackService.searchIndex("teacher", {
    term,
    releaseVersion: version,
    keyword: "副 教 授",
  });
  assert.strictEqual(byTitle.items.length, 1);

  const empty = await releasePackService.searchIndex("teacher", {
    term,
    releaseVersion: version,
    keyword: "不存在",
  });
  assert.strictEqual(empty.items.length, 0);
  assert(!calls.some((item) => item.includes("/api/fosu/search-index")), "teacher search should not fallback to dynamic API");
  cleanup();
  console.log("test-teacher-static-search-real-index passed");
}

run().catch((error) => {
  console.error(error);
  try { cleanup(); } catch (cleanupError) {}
  process.exit(1);
});
