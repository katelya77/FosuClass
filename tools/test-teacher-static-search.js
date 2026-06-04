const assert = require("assert");
const mockEnv = require("./mock-env");

mockEnv.clearStorage();
const releasePackService = require("../miniprogram/services/releasePackService");

const term = "2025-2026-2";
const version = "teacher-search-2026-06-04";
const calls = [];

function teacherIndex() {
  return {
    success: true,
    type: "teacher",
    term,
    releaseVersion: version,
    items: [
      {
        id: "teacher-1",
        name: "",
        teacherName: "张三",
        displayName: "张三 副教授",
        title: "副教授",
        collegeName: "测试学院",
        courses: [],
      },
      {
        id: "teacher-2",
        name: "李四",
        displayName: "李四",
        teacherTitle: "讲师",
        collegeName: "测试学院",
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
  const pathname = url.pathname;
  if (pathname === `/static/releases/${version}/index/teacher/all.json`) {
    setTimeout(() => options.success({ statusCode: 200, data: teacherIndex() }), 1);
    return;
  }
  if (pathname.includes("/api/fosu/search-index")) {
    setTimeout(() => options.fail({ errMsg: "slow dynamic teacher API should not be used" }), 1);
    return;
  }
  setTimeout(() => options.fail({ errMsg: `unexpected request ${options.url}` }), 1);
};

async function run() {
  const byName = await releasePackService.searchIndex("teacher", {
    term,
    releaseVersion: version,
    keyword: "张",
  }, {
    forceNetwork: true,
    retries: 0,
  });
  assert.strictEqual(byName.items.length, 1);
  assert.strictEqual(byName.items[0].teacherName, "张三");

  const byDisplayName = await releasePackService.searchIndex("teacher", {
    term,
    releaseVersion: version,
    keyword: "副教授",
  });
  assert.strictEqual(byDisplayName.items.length, 1);
  assert.strictEqual(byDisplayName.items[0].displayName, "张三 副教授");

  const byTitle = await releasePackService.searchIndex("teacher", {
    term,
    releaseVersion: version,
    title: "讲师",
  });
  assert.strictEqual(byTitle.items.length, 1);
  assert.strictEqual(byTitle.items[0].name, "李四");

  const empty = await releasePackService.searchIndex("teacher", {
    term,
    releaseVersion: version,
    keyword: "不存在",
  });
  assert.strictEqual(empty.items.length, 0, "empty static teacher search should be a normal empty result");

  assert(calls.some((url) => url.includes(`/static/releases/${version}/index/teacher/all.json`)), "teacher search should use static teacher index");
  assert(!calls.some((url) => url.includes("/api/fosu/search-index")), "teacher search should not fallback to slow dynamic API");

  console.log("test-teacher-static-search passed");
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
