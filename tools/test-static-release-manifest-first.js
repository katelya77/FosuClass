const assert = require("assert");
const mockEnv = require("./mock-env");

mockEnv.clearStorage();
const releasePackService = require("../miniprogram/services/releasePackService");

const term = "2025-2026-2";
const version = "manifest-first-2026-06-04";
const calls = [];
let failStaticManifest = false;
let failApiManifest = false;

function manifest(sourceVersion = version) {
  return {
    success: true,
    schemaVersion: 2,
    term,
    semester: term,
    releaseVersion: sourceVersion,
    version: sourceVersion,
    updatedAt: "2026-06-04T00:00:00.000Z",
    cacheEpoch: 1,
    forceRefreshToken: `${sourceVersion}:1`,
    indexUrls: {
      class: `https://class.katelya.eu.org/static/releases/${sourceVersion}/index/class/all.json`,
    },
  };
}

function classIndex(sourceVersion = version) {
  return {
    success: true,
    type: "class",
    term,
    releaseVersion: sourceVersion,
    items: [{
      id: "class-1",
      name: "static class",
      className: "25 Test 1",
      collegeCode: "04",
      grade: "2025",
      majorCode: "0401",
    }],
  };
}

global.wx.setStorageSync(releasePackService.LOCAL_ACTIVE_RELEASE_KEY, {
  savedAt: Date.now(),
  term,
  releaseVersion: version,
  manifest: manifest(version),
});

global.wx.mockRequest = (options) => {
  calls.push(options.url);
  const url = new URL(options.url, "https://class.katelya.eu.org");
  const pathname = url.pathname;
  if (pathname === `/static/releases/${version}/manifest.json`) {
    if (failStaticManifest) {
      setTimeout(() => options.fail({ errMsg: "request:fail timeout" }), 1);
      return;
    }
    setTimeout(() => options.success({ statusCode: 200, data: manifest(version) }), 1);
    return;
  }
  if (pathname === "/api/fosu/release-pack/manifest") {
    if (failApiManifest) {
      setTimeout(() => options.fail({ errMsg: "request:fail timeout" }), 1);
      return;
    }
    setTimeout(() => options.success({ statusCode: 200, data: manifest(version) }), 1);
    return;
  }
  if (pathname === `/static/releases/${version}/index/class/all.json`) {
    setTimeout(() => options.success({ statusCode: 200, data: classIndex(version) }), 1);
    return;
  }
  setTimeout(() => options.fail({ errMsg: `unexpected request ${options.url}` }), 1);
};

async function run() {
  const first = await releasePackService.switchReleaseSafely({
    term,
    forceNetwork: true,
    retryBaseDelayMs: 1,
    retryMaxDelayMs: 1,
  });
  assert.strictEqual(first.releaseVersion, version);
  assert(calls[0].includes(`/static/releases/${version}/manifest.json`), "manifest fetch should start with static manifest");
  assert(!calls.some((url) => url.includes("/api/fosu/release-pack/manifest")), "dynamic manifest should not run when static manifest works");

  calls.length = 0;
  failStaticManifest = true;
  await releasePackService.getActiveManifest({
    term,
    forceNetwork: true,
    dedupe: false,
    retryBaseDelayMs: 1,
    retryMaxDelayMs: 1,
  });
  assert(calls[0].includes(`/static/releases/${version}/manifest.json`), "fallback path should still try static first");
  assert(calls.some((url) => url.includes("/api/fosu/release-pack/manifest")), "dynamic manifest may fallback after static failure");

  calls.length = 0;
  failApiManifest = true;
  const lastGood = await releasePackService.getActiveManifest({
    term,
    forceNetwork: true,
    dedupe: false,
    retryBaseDelayMs: 1,
    retryMaxDelayMs: 1,
  });
  assert.strictEqual(lastGood.releaseVersion, version, "failed refresh must keep last-known-good manifest");
  assert.strictEqual(lastGood.fromStorage, true, "failed refresh should surface cached manifest");

  console.log("test-static-release-manifest-first passed");
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
