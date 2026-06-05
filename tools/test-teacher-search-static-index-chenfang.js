const assert = require("assert");
const mockEnv = require("./mock-env");

mockEnv.clearStorage();
const releasePackService = require("../miniprogram/services/releasePackService");

const term = "2025-2026-2";
const version = "teacher-search-chenfang-2026-06-05";
const calls = [];

function teacherIndex() {
  return {
    success: true,
    type: "teacher",
    term,
    semester: term,
    releaseVersion: version,
    items: [
      {
        id: "teacher-chenfang",
        name: "陈芳",
        teacherName: "陈芳",
        displayName: "陈芳",
        collegeName: "",
        titleCode: "",
        title: "",
        hasDetail: false,
        courseCount: 3,
        courses: [],
      },
      {
        id: "teacher-anzheming",
        name: "安哲明",
        teacherName: "安哲明",
        displayName: "安哲明",
        collegeName: "测试学院",
        titleCode: "lecturer",
        title: "讲师",
        courseCount: 1,
        courses: [],
      },
      {
        id: "teacher-baiyinshan",
        name: "白银山",
        teacherName: "白银山",
        displayName: "白银山",
        collegeName: "测试学院",
        titleCode: "associate",
        title: "副教授",
        courseCount: 2,
        courses: [],
      },
    ],
  };
}

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
    setTimeout(() => options.success({ statusCode: 200, data: teacherIndex() }), 1);
    return;
  }
  if (url.pathname.includes("/api/fosu/search-index")) {
    setTimeout(() => options.fail({ errMsg: "dynamic teacher API should not be used" }), 1);
    return;
  }
  setTimeout(() => options.fail({ errMsg: `unexpected request ${options.url}` }), 1);
};

async function search(keyword, extra = {}) {
  return releasePackService.searchIndex("teacher", Object.assign({
    term,
    releaseVersion: version,
    keyword,
  }, extra), {
    forceNetwork: true,
    retries: 0,
    skipFallback: true,
  });
}

async function run() {
  const chenfang = await search("陈芳");
  assert.strictEqual(chenfang.items.length, 1);
  assert.strictEqual(chenfang.items[0].teacherName, "陈芳");
  assert.strictEqual(chenfang.debug.teacherIndexTotal, 3);
  assert.strictEqual(chenfang.debug.keywordHitCount, 1);
  assert.strictEqual(chenfang.debug.sampleItems[0].teacherName, "陈芳");

  const singleChen = await search("陈");
  assert.strictEqual(singleChen.items.length, 1, "single Chinese char should search static teacher names");
  assert.strictEqual(singleChen.items[0].teacherName, "陈芳");

  const singleFang = await search("芳");
  assert.strictEqual(singleFang.items.length, 1, "single Chinese char suffix should search static teacher names");
  assert.strictEqual(singleFang.items[0].teacherName, "陈芳");

  const anzheming = await search("安哲明");
  assert.strictEqual(anzheming.items.length, 1);
  assert.strictEqual(anzheming.items[0].teacherName, "安哲明");

  const baiyinshan = await search("白银山");
  assert.strictEqual(baiyinshan.items.length, 1);
  assert.strictEqual(baiyinshan.items[0].teacherName, "白银山");

  const emptyCollege = await search("陈芳", { collegeName: "任意学院" });
  assert.strictEqual(emptyCollege.items.length, 1, "missing teacher college must not block keyword hits");
  assert.strictEqual(emptyCollege.debug.collegeFilteredCount, 1);

  const emptyTitle = await search("陈芳", { titleCode: "正高级" });
  assert.strictEqual(emptyTitle.items.length, 1, "missing teacher title must not block keyword hits");

  assert(calls.some((url) => url.includes(`/static/releases/${version}/index/teacher/all.json`)), "teacher search should read static index");
  assert(!calls.some((url) => url.includes("/api/fosu/search-index")), "teacher search should not use dynamic search-index API");

  console.log("test-teacher-search-static-index-chenfang passed");
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
