const assert = require("assert");
const mockEnv = require("./mock-env");

mockEnv.clearStorage();
const releasePackService = require("../miniprogram/services/releasePackService");

const term = "2025-2026-2";
const version = "detail-first-2026-06-04";
const detailId = "teacher-zhang";
const calls = [];
let failStaticDetail = false;

function schedule(source) {
  return {
    success: true,
    type: "teacher",
    id: detailId,
    term,
    releaseVersion: version,
    source,
    schedule: {
      teacherName: "张三",
      courses: [{ courseName: `${source} detail course`, weekday: 1, startSection: 1, endSection: 2 }],
    },
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
    detailUrlPattern: `https://class.katelya.eu.org/static/releases/${version}/detail/{type}/{id}.json`,
  },
});

global.wx.mockRequest = (options) => {
  calls.push(options.url);
  const url = new URL(options.url, "https://class.katelya.eu.org");
  const pathname = url.pathname;
  if (pathname === `/static/releases/${version}/detail/teacher/${detailId}.json`) {
    if (failStaticDetail) {
      setTimeout(() => options.fail({ errMsg: "request:fail timeout" }), 1);
      return;
    }
    setTimeout(() => options.success({ statusCode: 200, data: schedule("static") }), 1);
    return;
  }
  if (pathname === "/api/fosu/schedule-detail") {
    setTimeout(() => options.success({ statusCode: 200, data: schedule("api") }), 1);
    return;
  }
  setTimeout(() => options.fail({ errMsg: `unexpected request ${options.url}` }), 1);
};

async function run() {
  const first = await releasePackService.loadDetail("teacher", detailId, {
    term,
    releaseVersion: version,
  }, {
    forceNetwork: true,
    retries: 0,
    timeout: 50,
  });
  assert.strictEqual(first.schedule.courses[0].courseName, "static detail course");
  assert(calls[0].includes(`/static/releases/${version}/detail/teacher/${detailId}.json`), "detail should try static URL first");
  assert(!calls.some((url) => url.includes("/api/fosu/schedule-detail")), "dynamic schedule-detail should not run when static detail works");

  calls.length = 0;
  failStaticDetail = true;
  const fallback = await releasePackService.loadDetail("teacher", detailId, {
    term,
    releaseVersion: version,
  }, {
    forceNetwork: true,
    retries: 0,
    timeout: 50,
  });
  assert.strictEqual(fallback.schedule.courses[0].courseName, "api detail course");
  assert(calls[0].includes(`/static/releases/${version}/detail/teacher/${detailId}.json`), "fallback should still try static first");
  assert(calls.some((url) => url.includes("/api/fosu/schedule-detail")), "dynamic schedule-detail may fallback after static failure");

  calls.length = 0;
  await assert.rejects(
    () => releasePackService.loadDetail("teacher", "", { term, releaseVersion: version }, { forceNetwork: true }),
    /INVALID_RELEASE_PACK_DETAIL_TARGET/
  );
  assert(!calls.some((url) => url.includes("/api/fosu/schedule-detail")), "invalid detail target must not request dynamic schedule-detail");

  console.log("test-static-detail-first passed");
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
