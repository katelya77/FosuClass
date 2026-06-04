const assert = require("assert");
const mockEnv = require("./mock-env");
const releasePackService = require("../miniprogram/services/releasePackService");

mockEnv.clearStorage();
require("../miniprogram/pages/school/school.js");

const term = "2025-2026-2";
let activeVersion = "school-v1";
let failClassV2 = false;

function manifest(version) {
  return {
    success: true,
    schemaVersion: 2,
    term,
    semester: term,
    releaseVersion: version,
    version,
    updatedAt: "2026-06-04T00:00:00.000Z",
    cacheEpoch: version === "school-v1" ? 1 : 2,
    forceRefreshToken: `${version}-token`,
    files: {},
  };
}

function indexPayload(type, version) {
  return {
    success: true,
    type,
    term,
    semester: term,
    releaseVersion: version,
    version,
    items: [{
      id: `${type}-${version}`,
      name: `${type} ${version}`,
      className: type === "class" ? `25测试${version}班` : "",
      collegeCode: "04",
      collegeName: "测试学院",
      grade: "2025",
      majorCode: "0401",
      majorName: "测试专业",
    }],
  };
}

global.wx.mockRequest = (options) => {
  const url = new URL(options.url);
  const pathname = url.pathname;
  const releaseVersion = options.data && options.data.releaseVersion || activeVersion;
  if (pathname.endsWith("/api/fosu/release-pack/manifest")) {
    setTimeout(() => options.success({ statusCode: 200, data: manifest(activeVersion) }), 1);
    return;
  }
  const match = pathname.match(/\/api\/fosu\/release-pack\/index\/([^/]+)$/);
  if (match) {
    const type = match[1];
    if (failClassV2 && releaseVersion === "school-v2" && type === "class") {
      setTimeout(() => options.fail({ errMsg: "request:fail timeout" }), 1);
      return;
    }
    setTimeout(() => options.success({ statusCode: 200, data: indexPayload(type, releaseVersion) }), 1);
    return;
  }
  setTimeout(() => options.fail({ errMsg: "request:fail timeout" }), 1);
};

async function run() {
  const first = await releasePackService.switchReleaseSafely({
    term,
    retryBaseDelayMs: 1,
    retryMaxDelayMs: 1,
  });
  assert.strictEqual(first.releaseVersion, "school-v1");
  assert(releasePackService.readCachedSearchIndex("class", { term, releaseVersion: "school-v1" }));

  activeVersion = "school-v2";
  failClassV2 = true;
  const second = await releasePackService.switchReleaseSafely({
    term,
    forceNetwork: true,
    retryBaseDelayMs: 1,
    retryMaxDelayMs: 1,
  });
  assert.strictEqual(second.switched, false, "broken v2 must not switch active release");
  assert.strictEqual(second.releaseVersion, "school-v1", "last-good should stay active");
  assert(releasePackService.readCachedSearchIndex("class", { term, releaseVersion: "school-v1" }), "old index should remain readable");

  const page = mockEnv.createPageInstance();
  page._schoolRequestSeq = 0;
  page._activeInitSeq = 0;
  assert.strictEqual(page.getStateFromError({ code: "TIMEOUT" }), "timeout");
  const resolved = await page.resolveActiveSnapshot({ forceNetwork: true });
  assert.strictEqual(resolved.activeSnapshot.releaseVersion, "school-v1");
  assert.strictEqual(resolved.fromStorage, true);

  console.log("test-school-stable-release-pack passed");
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
