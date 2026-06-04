const assert = require("assert");
const mockEnv = require("./mock-env");

mockEnv.clearStorage();
const releasePackService = require("../miniprogram/services/releasePackService");

const term = "2025-2026-2";
const version = "mini-static-2026-06-04";
const calls = [];
let failStaticClass = false;

function manifest() {
  return {
    success: true,
    schemaVersion: 2,
    term,
    semester: term,
    releaseVersion: version,
    version,
    updatedAt: "2026-06-04T00:00:00.000Z",
    cacheEpoch: 1,
    forceRefreshToken: `${version}:1`,
    staticBaseUrl: "https://static-class.katelya.top/static/releases",
    indexUrls: {
      class: `https://static-class.katelya.top/static/releases/${version}/index/class/all.json`,
      teacher: `https://static-class.katelya.top/static/releases/${version}/index/teacher/all.json`,
      classroom: `https://static-class.katelya.top/static/releases/${version}/index/classroom/all.json`,
      course: `https://static-class.katelya.top/static/releases/${version}/index/course/all.json`,
    },
    emptyRoomUrl: `https://static-class.katelya.top/static/releases/${version}/empty-room/index.json`,
    detailUrlPattern: `https://static-class.katelya.top/static/releases/${version}/detail/{type}/{id}.json`,
    shards: {
      class: {
        all: `https://static-class.katelya.top/static/releases/${version}/index/class/all.json`,
        byMajor: {
          "04-2025-0401": `https://static-class.katelya.top/static/releases/${version}/index/class/by-major/04-2025-0401.json`,
        },
      },
    },
  };
}

function indexPayload(type, source) {
  return {
    success: true,
    type,
    term,
    releaseVersion: version,
    items: [{
      id: `${type}-1`,
      name: `${source}-${type}`,
      className: type === "class" ? "25静态1班" : "",
      semester: term,
      collegeCode: "04",
      collegeName: "测试学院",
      grade: "2025",
      majorCode: "0401",
      majorName: "测试专业",
    }],
  };
}

global.wx.mockRequest = (options) => {
  calls.push(options.url);
  const url = new URL(options.url, "https://class.katelya.eu.org");
  const pathname = url.pathname;
  if (pathname.endsWith("/api/fosu/release-pack/manifest")) {
    setTimeout(() => options.success({ statusCode: 200, data: manifest() }), 1);
    return;
  }
  if (pathname.includes("/static/releases/") && pathname.includes("/index/class/") && failStaticClass) {
    setTimeout(() => options.fail({ errMsg: "request:fail timeout" }), 1);
    return;
  }
  const staticMatch = pathname.match(/\/static\/releases\/[^/]+\/index\/([^/]+)(?:\/all|\/by-major\/[^/]+)?\.json$/);
  if (staticMatch) {
    const type = staticMatch[1];
    setTimeout(() => options.success({ statusCode: 200, data: indexPayload(type, "static") }), 1);
    return;
  }
  const apiMatch = pathname.match(/\/api\/fosu\/release-pack\/index\/([^/]+)$/);
  if (apiMatch) {
    const type = apiMatch[1];
    setTimeout(() => options.success({ statusCode: 200, data: indexPayload(type, "api") }), 1);
    return;
  }
  setTimeout(() => options.fail({ errMsg: "request:fail timeout" }), 1);
};

async function run() {
  const switched = await releasePackService.switchReleaseSafely({
    term,
    retryBaseDelayMs: 1,
    retryMaxDelayMs: 1,
  });
  assert.strictEqual(switched.releaseVersion, version);
  assert(calls.some((url) => url.includes("/static/releases/") && url.includes("/index/class/all.json")), "switch should load static class index");
  assert(!calls.some((url) => url.includes("/index/teacher/all.json")), "switch should not warmup teacher index");
  assert(!calls.some((url) => url.includes("/index/classroom/all.json")), "switch should not warmup classroom index");
  assert(!calls.some((url) => url.includes("/index/course/all.json")), "switch should not warmup course index");

  calls.length = 0;
  const teacher = await releasePackService.loadIndex("teacher", { term, releaseVersion: version }, { forceNetwork: true });
  assert.strictEqual(teacher.items[0].name, "static-teacher");
  assert(calls.some((url) => url.includes("/index/teacher/all.json")), "teacher should lazy-load static URL");

  calls.length = 0;
  const shard = await releasePackService.searchIndex("class", {
    term,
    releaseVersion: version,
    collegeCode: "04",
    grade: "2025",
    majorCode: "0401",
  }, { forceNetwork: true });
  assert.strictEqual(shard.items[0].name, "static-class");
  assert(calls.some((url) => url.includes("/index/class/by-major/04-2025-0401.json")), "class search should prefer by-major shard");

  calls.length = 0;
  failStaticClass = true;
  const fallback = await releasePackService.loadIndex("class", { term, releaseVersion: version }, { forceNetwork: true, retryBaseDelayMs: 1, retryMaxDelayMs: 1 });
  assert.strictEqual(fallback.items[0].name, "api-class");
  assert(calls.some((url) => url.includes("/api/fosu/release-pack/index/class")), "static failure should fallback to API wrapper");

  console.log("test-miniprogram-static-release passed");
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
