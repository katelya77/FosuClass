const assert = require("assert");
const mockEnv = require("./mock-env");

mockEnv.clearStorage();

const staticOriginService = require("../miniprogram/services/staticOriginService");
const releasePackService = require("../miniprogram/services/releasePackService");
const startupCoordinator = require("../miniprogram/services/startupCoordinator");

const term = "2025-2026-2";
const previousVersion = "pointer-prev-2026-06-14";
const nextVersion = "pointer-next-2026-06-14";

function manifest(version, source) {
  const cacheEpoch = version === previousVersion ? 100 : 200;
  return {
    success: true,
    schemaVersion: 2,
    term,
    semester: term,
    releaseVersion: version,
    version,
    updatedAt: version === previousVersion ? "2026-06-13T00:00:00.000Z" : "2026-06-14T00:00:00.000Z",
    cacheEpoch,
    forceRefreshToken: `${version}:${cacheEpoch}`,
    staticBaseUrl: `https://${source}.example.com/releases`,
    indexUrls: {
      class: `https://${source}.example.com/releases/${version}/index/class/all.json`,
      teacher: `https://${source}.example.com/releases/${version}/index/teacher/all.json`,
      classroom: `https://${source}.example.com/releases/${version}/index/classroom/all.json`,
      course: `https://${source}.example.com/releases/${version}/index/course/all.json`,
    },
    emptyRoomUrl: `https://${source}.example.com/releases/${version}/empty-room/index.json`,
    detailUrlPattern: `https://${source}.example.com/releases/${version}/detail/{type}/{id}.json`,
    files: {
      "index/class/all.json": { size: 1, hash: "h1" },
      "index/teacher/all.json": { size: 1, hash: "h2" },
      "index/classroom/all.json": { size: 1, hash: "h3" },
      "index/course/all.json": { size: 1, hash: "h4" },
      "empty-room/index.json": { size: 1, hash: "h5" },
    },
    shards: {
      class: {
        all: `https://${source}.example.com/releases/${version}/index/class/all.json`,
        byMajor: {
          "04-2025-0401": `https://${source}.example.com/releases/${version}/index/class/by-major/04-2025-0401.json`,
        },
      },
    },
  };
}

function pointer(version) {
  const cacheEpoch = version === previousVersion ? 100 : 200;
  return {
    success: true,
    activeTerm: term,
    term,
    releaseVersion: version,
    updatedAt: version === previousVersion ? "2026-06-13T00:00:00.000Z" : "2026-06-14T00:00:00.000Z",
    cacheEpoch,
    forceRefreshToken: `${version}:${cacheEpoch}`,
    termConfig: { term, releaseVersion: version, termStartDate: "2026-03-09" },
    urls: {
      manifest: `https://cloud.example.com/releases/${version}/manifest.json`,
      classIndex: `https://cloud.example.com/releases/${version}/index/class/all.json`,
    },
  };
}

function indexPayload(version, source, pathLabel) {
  return {
    success: true,
    type: "class",
    term,
    releaseVersion: version,
    version,
    items: [{
      id: "class-1",
      name: `${source}-${pathLabel || "all"}`,
      className: "Pointer Test Class",
      semester: term,
      collegeCode: "04",
      grade: "2025",
      majorCode: "0401",
    }],
  };
}

function installMock(handler) {
  global.wx.mockRequest = (options) => {
    Promise.resolve()
      .then(() => handler(options))
      .then((payload) => {
        if (payload && payload.fail) {
          options.fail({ errMsg: payload.errMsg || "request:fail timeout" });
          return;
        }
        options.success({ statusCode: 200, data: payload });
      })
      .catch((error) => options.fail({ errMsg: error.message || "request:fail timeout" }));
  };
}

function setupOrigins() {
  staticOriginService.__setTestConfig({
    cloudbase: {
      CLOUDBASE_HOSTING_ENABLED: true,
      CLOUDBASE_HOSTING_READY: true,
      CLOUDBASE_HOSTING_BASE_URL: "https://cloud.example.com",
    },
  });
}

async function seedPreviousRelease() {
  installMock((options) => {
    const url = new URL(options.url);
    if (url.pathname.endsWith(`/${previousVersion}/manifest.json`)) return manifest(previousVersion, "cloud");
    if (url.pathname.endsWith(`/${previousVersion}/index/class/all.json`)) return indexPayload(previousVersion, "cloud");
    return { fail: true };
  });
  const seeded = await releasePackService.switchReleaseSafely({
    term,
    releaseVersion: previousVersion,
    forceNetwork: true,
    forceOrigin: "cloudbase",
    warmupTypes: ["class"],
    timeout: 50,
    retries: 0,
    skipSession: true,
  });
  assert.strictEqual(seeded.switched, true);
}

async function testPointerDoesNotOverwriteManifest() {
  mockEnv.clearStorage();
  setupOrigins();
  await seedPreviousRelease();

  installMock((options) => {
    const url = new URL(options.url);
    if (url.pathname.endsWith("/runtime/active.json")) return pointer(nextVersion);
    if (url.pathname.endsWith(`/${nextVersion}/manifest.json`)) return { fail: true };
    return { fail: true };
  });

  const resolved = await releasePackService.resolveRuntimePointer({
    timeout: 50,
    manifestTimeout: 50,
    retries: 0,
    dedupe: false,
    forceNetwork: true,
  });
  assert.strictEqual(resolved.releaseVersion, nextVersion);
  assert.strictEqual(resolved.manifestStatus, "pointer-only");
  assert.strictEqual(releasePackService.readRuntimePointerCache(term).releaseVersion, nextVersion);
  const failedActivation = await releasePackService.ensureRuntimePointerManifest(resolved, {
    manifestTimeout: 50,
    retries: 0,
  });
  assert.strictEqual(failedActivation.switched, false, "real manifest failure must not switch active release");
  assert.strictEqual(failedActivation.fromStorage, true, "manifest failure should fall back to last-known-good");

  const active = releasePackService.getLocalActiveRelease(term);
  const lastGood = releasePackService.getLastKnownGood(term);
  assert.strictEqual(active.releaseVersion, previousVersion);
  assert.strictEqual(lastGood.releaseVersion, previousVersion);
  const activeManifest = await releasePackService.getActiveManifest({ term });
  assert.strictEqual(activeManifest.releaseVersion, previousVersion, "pointer-only must not be returned as active manifest");
}

async function testStartupPointerOnlyDoesNotCreateManifest() {
  mockEnv.clearStorage();
  setupOrigins();
  installMock((options) => {
    const url = new URL(options.url);
    if (url.pathname.endsWith("/runtime/active.json")) return pointer(nextVersion);
    if (url.pathname.endsWith(`/${nextVersion}/manifest.json`)) return { fail: true };
    return { fail: true };
  });
  const resolved = await startupCoordinator.resolveRuntimePointer({
    timeout: 50,
    manifestTimeout: 50,
    retries: 0,
    dedupe: false,
    forceNetwork: true,
    skipManifestActivation: true,
    skipFreshnessCheck: true,
  });
  const app = getApp();
  assert.strictEqual(resolved.releaseVersion, nextVersion);
  assert.strictEqual(app.globalData.activeRelease.manifestStatus, "pointer-only");
  assert.strictEqual(app.globalData.activeRelease.manifest, undefined);
  assert.strictEqual(releasePackService.getLocalActiveRelease(term), null);
}

async function testSwitchAfterManifestAndWarmup() {
  mockEnv.clearStorage();
  setupOrigins();
  const calls = [];
  installMock((options) => {
    calls.push(options.url);
    const url = new URL(options.url);
    if (url.pathname.endsWith("/runtime/active.json")) return pointer(nextVersion);
    if (url.pathname.endsWith(`/${nextVersion}/manifest.json`)) return manifest(nextVersion, "cloud");
    if (url.pathname.endsWith(`/${nextVersion}/index/class/all.json`)) return indexPayload(nextVersion, "cloud");
    return { fail: true };
  });
  const resolved = await releasePackService.resolveRuntimePointer({
    timeout: 50,
    manifestTimeout: 50,
    retries: 0,
    dedupe: false,
    forceNetwork: true,
  });
  assert.strictEqual(resolved.manifestStatus, "pointer-only");
  const activation = await releasePackService.ensureRuntimePointerManifest(resolved, {
    manifestTimeout: 50,
    retries: 0,
  });
  assert.strictEqual(activation.switched, true);
  assert(calls.some((url) => url.includes(`/${nextVersion}/manifest.json`)), "real manifest must be fetched");
  assert(calls.some((url) => url.includes(`/${nextVersion}/index/class/all.json`)), "class index must be warmed before switch");
  assert.strictEqual(releasePackService.getLocalActiveRelease(term).releaseVersion, nextVersion);
}

async function testCloudbaseShardPathWorks() {
  mockEnv.clearStorage();
  setupOrigins();
  const calls = [];
  installMock((options) => {
    calls.push(options.url);
    const url = new URL(options.url);
    if (url.pathname.endsWith("/runtime/active.json")) return pointer(nextVersion);
    if (url.pathname.endsWith(`/${nextVersion}/manifest.json`)) return manifest(nextVersion, "cloud");
    if (url.pathname.endsWith(`/${nextVersion}/index/class/all.json`)) return indexPayload(nextVersion, "cloud", "all");
    if (url.pathname.endsWith(`/${nextVersion}/index/class/by-major/04-2025-0401.json`)) {
      return indexPayload(nextVersion, "cloud", "major");
    }
    return { fail: true };
  });
  await releasePackService.resolveRuntimePointer({
    timeout: 50,
    manifestTimeout: 50,
    retries: 0,
    dedupe: false,
    forceNetwork: true,
  });
  await releasePackService.ensureRuntimePointerManifest(pointer(nextVersion), {
    manifestTimeout: 50,
    retries: 0,
  });
  const result = await releasePackService.searchIndex("class", {
    term,
    releaseVersion: nextVersion,
    collegeCode: "04",
    grade: "2025",
    majorCode: "0401",
  }, {
    forceNetwork: true,
    forceOrigin: "cloudbase",
    timeout: 50,
    retries: 0,
  });
  assert.strictEqual(result.items[0].name, "cloud-major");
  assert(calls.some((url) => url.includes("/releases/") && url.includes("/index/class/by-major/04-2025-0401.json")));
}

async function run() {
  await testPointerDoesNotOverwriteManifest();
  await testStartupPointerOnlyDoesNotCreateManifest();
  await testSwitchAfterManifestAndWarmup();
  await testCloudbaseShardPathWorks();
  staticOriginService.__resetForTest();
  console.log("test-runtime-pointer-manifest passed");
}

run().catch((error) => {
  console.error(error);
  staticOriginService.__resetForTest();
  process.exit(1);
});
