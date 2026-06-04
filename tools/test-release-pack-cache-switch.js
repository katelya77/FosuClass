const assert = require("assert");
const mockEnv = require("./mock-env");
const releasePackService = require("../miniprogram/services/releasePackService");

mockEnv.clearStorage();

const term = "2025-2026-2";
let activeVersion = "release-pack-v1";
let failTeacherIndex = false;

function manifest(version) {
  return {
    success: true,
    schemaVersion: 2,
    term,
    semester: term,
    releaseVersion: version,
    version,
    updatedAt: "2026-06-02T00:00:00.000Z",
    cacheEpoch: version,
    files: {
      "index/class.json": { size: 1, hash: `${version}-class` },
      "index/teacher.json": { size: 1, hash: `${version}-teacher` },
      "index/classroom.json": { size: 1, hash: `${version}-classroom` },
      "index/course.json": { size: 1, hash: `${version}-course` },
    },
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
      semester: term,
      className: type === "class" ? `班级 ${version}` : undefined,
    }],
  };
}

global.wx.mockRequest = (options) => {
  const url = new URL(options.url);
  const pathname = url.pathname;
  const releaseVersion = (options.data && options.data.releaseVersion) || url.searchParams.get("releaseVersion") || activeVersion;
  if (pathname.endsWith("/api/fosu/release-pack/manifest")) {
    options.success({ statusCode: 200, data: manifest(activeVersion) });
    return;
  }
  const match = pathname.match(/\/api\/fosu\/release-pack\/index\/([^/]+)$/);
  if (match) {
    const type = match[1];
    if (failTeacherIndex && releaseVersion === "release-pack-v2" && type === "teacher") {
      options.success({ statusCode: 200, data: { success: false, code: "BROKEN_INDEX" } });
      return;
    }
    options.success({ statusCode: 200, data: indexPayload(type, releaseVersion) });
    return;
  }
  options.fail({ errMsg: `unexpected request ${pathname}` });
};

async function run() {
  const first = await releasePackService.switchReleaseSafely({ term });
  assert.strictEqual(first.switched, true);
  assert.strictEqual(first.releaseVersion, "release-pack-v1");
  assert.strictEqual(releasePackService.getLastKnownGood(term).releaseVersion, "release-pack-v1");
  assert.strictEqual(releasePackService.readCachedSearchIndex("class", {
    term,
    releaseVersion: "release-pack-v1",
  }).items[0].className, "班级 release-pack-v1");

  activeVersion = "release-pack-v2";
  failTeacherIndex = true;
  const second = await releasePackService.switchReleaseSafely({ term });
  assert.strictEqual(second.switched, false, "broken v2 should not switch active manifest");
  assert.strictEqual(second.fromStorage, true);
  assert.strictEqual(second.releaseVersion, "release-pack-v1");
  assert.strictEqual(releasePackService.getLastKnownGood(term).releaseVersion, "release-pack-v1");
  const activeManifest = await releasePackService.getActiveManifest({ term });
  assert.strictEqual(activeManifest.releaseVersion, "release-pack-v1", "manifest cache should remain last good");

  console.log("test-release-pack-cache-switch passed");
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
