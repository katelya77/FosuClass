const assert = require("assert");
const mockEnv = require("./mock-env");

mockEnv.clearStorage();

const staticOriginService = require("../miniprogram/services/staticOriginService");
const releasePackService = require("../miniprogram/services/releasePackService");

const term = "2025-2026-2";
const previousVersion = "cloudbase-static-prev-2026-06-14";
const nextVersion = "cloudbase-static-next-2026-06-14";

function manifest(version, source) {
  return {
    success: true,
    schemaVersion: 2,
    term,
    semester: term,
    releaseVersion: version,
    version,
    updatedAt: "2026-06-14T00:00:00.000Z",
    cacheEpoch: version === previousVersion ? 1 : 2,
    forceRefreshToken: `${version}:${version === previousVersion ? 1 : 2}`,
    staticBaseUrl: `https://${source}.example.com/releases`,
    indexUrls: {
      class: `https://${source}.example.com/releases/${version}/index/class/all.json`,
      teacher: `https://${source}.example.com/releases/${version}/index/teacher/all.json`,
      classroom: `https://${source}.example.com/releases/${version}/index/classroom/all.json`,
      course: `https://${source}.example.com/releases/${version}/index/course/all.json`,
    },
    emptyRoomUrl: `https://${source}.example.com/releases/${version}/empty-room/index.json`,
    detailUrlPattern: `https://${source}.example.com/releases/${version}/detail/{type}/{id}.json`,
  };
}

function indexPayload(version, source) {
  return {
    success: true,
    type: "class",
    term,
    releaseVersion: version,
    version,
    items: [{
      id: "class-1",
      name: `${source}-class`,
      className: "25云开发1班",
      semester: term,
    }],
  };
}

function runtimePointer(version, source) {
  return {
    success: true,
    activeTerm: term,
    term,
    releaseVersion: version,
    updatedAt: "2026-06-14T00:00:00.000Z",
    cacheEpoch: 1,
    forceRefreshToken: `${version}:1`,
    termConfig: { term, releaseVersion: version, termStartDate: "2026-03-09", semesterText: "2025-2026 学年第二学期" },
    urls: {
      manifest: `https://${source}.example.com/releases/${version}/manifest.json`,
      classIndex: `https://${source}.example.com/releases/${version}/index/class/all.json`,
    },
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
      .catch((error) => {
        options.fail({ errMsg: error.message || "request:fail timeout" });
      });
  };
}

async function testCloudbasePreferred() {
  mockEnv.clearStorage();
  staticOriginService.__setTestConfig({
    cloudbase: { CLOUDBASE_HOSTING_BASE_URL: "https://cloud.example.com", CLOUDBASE_HOSTING_READY: true },
  });
  const calls = [];
  installMock((options) => {
    calls.push(options);
    const url = new URL(options.url);
    if (url.hostname === "cloud.example.com" && url.pathname.endsWith("/manifest.json")) {
      return manifest(previousVersion, "cloud");
    }
    if (url.hostname === "class.katelya.eu.org" && url.pathname.endsWith("/manifest.json")) {
      return manifest(previousVersion, "oracle");
    }
    return { fail: true };
  });

  const payload = await staticOriginService.fetchManifest(previousVersion, { skipSession: true, timeout: 50, retries: 0 });
  assert.strictEqual(payload.staticOrigin, "cloudbase");
  assert.strictEqual(payload.releaseVersion, previousVersion);
  assert.strictEqual(new URL(calls[0].url).hostname, "cloud.example.com");
  assert.strictEqual(calls.length, 1, "CloudBase success should not call Oracle");
}

async function testHostingReadyFalseSkipsCloudbase() {
  mockEnv.clearStorage();
  staticOriginService.__setTestConfig({
    cloudbase: {
      CLOUDBASE_HOSTING_ENABLED: true,
      CLOUDBASE_HOSTING_READY: false,
      CLOUDBASE_HOSTING_BASE_URL: "https://cloud.example.com",
    },
  });
  const calls = [];
  installMock((options) => {
    calls.push(options.url);
    const url = new URL(options.url);
    if (url.hostname === "cloud.example.com") {
      throw new Error("CloudBase should not be touched while CLOUDBASE_HOSTING_READY=false");
    }
    if (url.hostname === "class.katelya.eu.org" && url.pathname.endsWith("/manifest.json")) {
      return manifest(previousVersion, "oracle");
    }
    return { fail: true };
  });

  const snapshot = staticOriginService.getOriginSnapshot();
  assert.strictEqual(snapshot.some((origin) => origin.name === "cloudbase"), false, "READY=false should remove CloudBase from readable origins");
  const payload = await staticOriginService.fetchManifest(previousVersion, { skipSession: true, timeout: 50, retries: 0 });
  assert.strictEqual(payload.staticOrigin, "oracle");
  assert.strictEqual(new URL(calls[0]).hostname, "class.katelya.eu.org", "READY=false should read Oracle directly");
}

async function testCloudbaseFailureFallsBackToOracle() {
  mockEnv.clearStorage();
  staticOriginService.__setTestConfig({
    cloudbase: { CLOUDBASE_HOSTING_BASE_URL: "https://cloud.example.com", CLOUDBASE_HOSTING_READY: true },
  });
  const calls = [];
  installMock((options) => {
    calls.push(options.url);
    const url = new URL(options.url);
    if (url.hostname === "cloud.example.com") return { fail: true };
    if (url.hostname === "class.katelya.eu.org" && url.pathname.endsWith("/manifest.json")) {
      return manifest(previousVersion, "oracle");
    }
    return { fail: true };
  });

  const payload = await staticOriginService.fetchManifest(previousVersion, { skipSession: true, timeout: 50, retries: 0 });
  assert.strictEqual(payload.staticOrigin, "oracle");
  assert(calls[0].includes("cloud.example.com"), "CloudBase should be first");
  assert(calls.some((url) => url.includes("class.katelya.eu.org")), "Oracle should be tried after CloudBase failure");
}

async function testRuntimePointerUsesBucket() {
  mockEnv.clearStorage();
  staticOriginService.__setTestConfig({
    cloudbase: { CLOUDBASE_HOSTING_BASE_URL: "https://cloud.example.com", CLOUDBASE_HOSTING_READY: true },
  });
  const calls = [];
  installMock((options) => {
    calls.push(options.url);
    return runtimePointer(previousVersion, "cloud");
  });
  const pointer = await staticOriginService.fetchRuntimePointer({ skipSession: true, timeout: 50, retries: 0 });
  assert.strictEqual(pointer.staticOrigin, "cloudbase");
  assert(/\/runtime\/active\.json\?bucket=\d+/.test(calls[0]), "runtime pointer should use minute bucket cache buster");
}

async function testLastKnownGoodSurvivesAllNetworkFailures() {
  mockEnv.clearStorage();
  staticOriginService.__setTestConfig({
    cloudbase: { CLOUDBASE_HOSTING_BASE_URL: "https://cloud.example.com", CLOUDBASE_HOSTING_READY: true },
  });
  let failAll = false;
  const calls = [];
  installMock((options) => {
    calls.push(options.url);
    if (failAll) return { fail: true };
    const url = new URL(options.url);
    const version = url.pathname.includes(nextVersion) ? nextVersion : previousVersion;
    if (url.pathname.endsWith("/manifest.json")) return manifest(version, url.hostname === "cloud.example.com" ? "cloud" : "oracle");
    if (url.pathname.endsWith("/index/class/all.json")) return indexPayload(version, url.hostname === "cloud.example.com" ? "cloud" : "oracle");
    return { fail: true };
  });

  const first = await releasePackService.switchReleaseSafely({
    term,
    releaseVersion: previousVersion,
    forceNetwork: true,
    retryBaseDelayMs: 1,
    retryMaxDelayMs: 1,
    timeout: 50,
    retries: 0,
  });
  assert.strictEqual(first.switched, true);
  assert.strictEqual(first.releaseVersion, previousVersion);

  failAll = true;
  calls.length = 0;
  const fallback = await releasePackService.switchReleaseSafely({
    term,
    releaseVersion: nextVersion,
    forceNetwork: true,
    retryBaseDelayMs: 1,
    retryMaxDelayMs: 1,
    timeout: 50,
    retries: 0,
  });
  assert.strictEqual(fallback.switched, false, "failed new release should not become active");
  assert.strictEqual(fallback.fromStorage, true);
  assert.strictEqual(fallback.releaseVersion, previousVersion, "last-known-good release should remain visible");
  assert(releasePackService.getLastKnownGood(term), "last-known-good cache should not be cleared");
  assert(calls.some((url) => url.includes("cloud.example.com")), "CloudBase should be attempted");
  assert(calls.some((url) => url.includes("class.katelya.eu.org")), "Oracle should be attempted");
}

async function run() {
  await testCloudbasePreferred();
  await testHostingReadyFalseSkipsCloudbase();
  await testCloudbaseFailureFallsBackToOracle();
  await testRuntimePointerUsesBucket();
  await testLastKnownGoodSurvivesAllNetworkFailures();
  staticOriginService.__resetForTest();
  console.log("test-cloudbase-static-origin passed");
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
