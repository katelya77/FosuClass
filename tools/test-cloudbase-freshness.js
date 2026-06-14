const assert = require("assert");
const mockEnv = require("./mock-env");

const staticOriginService = require("../miniprogram/services/staticOriginService");
const releasePackService = require("../miniprogram/services/releasePackService");

const term = "2025-2026-2";

function setup() {
  mockEnv.clearStorage();
  releasePackService.__resetForTest();
  staticOriginService.__setTestConfig({
    cloudbase: {
      CLOUDBASE_HOSTING_ENABLED: true,
      CLOUDBASE_HOSTING_READY: true,
      CLOUDBASE_HOSTING_BASE_URL: "https://cloud.example.com",
    },
  });
}

function pointer(version, source, cacheEpoch) {
  return {
    success: true,
    activeTerm: term,
    term,
    releaseVersion: version,
    updatedAt: cacheEpoch >= 200 ? "2026-06-14T00:00:00.000Z" : "2026-06-13T00:00:00.000Z",
    cacheEpoch,
    forceRefreshToken: `${version}:${cacheEpoch}`,
    termConfig: { term, releaseVersion: version },
    urls: {
      manifest: `https://${source}.example.com/releases/${version}/manifest.json`,
      classIndex: `https://${source}.example.com/releases/${version}/index/class/all.json`,
    },
  };
}

function manifest(version, source, cacheEpoch) {
  return {
    success: true,
    schemaVersion: 2,
    term,
    releaseVersion: version,
    version,
    cacheEpoch,
    forceRefreshToken: `${version}:${cacheEpoch}`,
    updatedAt: cacheEpoch >= 200 ? "2026-06-14T00:00:00.000Z" : "2026-06-13T00:00:00.000Z",
    indexUrls: {
      class: `https://${source}.example.com/releases/${version}/index/class/all.json`,
      teacher: `https://${source}.example.com/releases/${version}/index/teacher/all.json`,
      classroom: `https://${source}.example.com/releases/${version}/index/classroom/all.json`,
      course: `https://${source}.example.com/releases/${version}/index/course/all.json`,
    },
    detailUrlPattern: `https://${source}.example.com/releases/${version}/detail/{type}/{id}.json`,
    files: {
      "index/class/all.json": { size: 1, hash: "h1" },
    },
  };
}

function indexPayload(version, source) {
  return {
    success: true,
    type: "class",
    term,
    releaseVersion: version,
    items: [{ id: "class-1", name: `${source}-class`, semester: term }],
  };
}

function installMock(handler) {
  global.wx.mockRequest = (options) => {
    Promise.resolve()
      .then(() => handler(options))
      .then((payload) => {
        if (payload && payload.fail) {
          setTimeout(() => options.fail({ errMsg: payload.errMsg || "request:fail timeout" }), payload.delay || 0);
          return;
        }
        setTimeout(() => options.success({ statusCode: 200, data: payload }), payload && payload.delay || 0);
      })
      .catch((error) => options.fail({ errMsg: error.message || "request:fail timeout" }));
  };
}

async function seedCloudbase(version, cacheEpoch) {
  installMock((options) => {
    const url = new URL(options.url);
    if (url.hostname === "cloud.example.com" && url.pathname.endsWith(`/${version}/manifest.json`)) {
      return manifest(version, "cloud", cacheEpoch);
    }
    if (url.hostname === "cloud.example.com" && url.pathname.endsWith(`/${version}/index/class/all.json`)) {
      return indexPayload(version, "cloud");
    }
    return { fail: true };
  });
  const result = await releasePackService.switchReleaseSafely({
    term,
    releaseVersion: version,
    forceOrigin: "cloudbase",
    forceNetwork: true,
    warmupTypes: ["class"],
    timeout: 50,
    retries: 0,
    skipSession: true,
  });
  assert.strictEqual(result.switched, true);
}

async function testCloudbaseNewerStaysCloudbase() {
  setup();
  await seedCloudbase("cloud-new", 300);
  installMock((options) => {
    const url = new URL(options.url);
    if (url.hostname === "class.katelya.eu.org" && url.pathname.endsWith("/runtime/active.json")) {
      return pointer("oracle-old", "oracle", 200);
    }
    return { fail: true };
  });
  const result = await releasePackService.checkStaticOriginFreshness({
    force: true,
    cloudbasePointer: Object.assign(pointer("cloud-new", "cloud", 300), { staticOrigin: "cloudbase" }),
    timeout: 50,
  });
  assert.strictEqual(result.freshnessStatus, "cloudbase-newer");
  assert.strictEqual(releasePackService.getLocalActiveRelease(term).releaseVersion, "cloud-new");
}

async function testCloudbaseStaleSwitchesOracle() {
  setup();
  await seedCloudbase("cloud-old", 100);
  const calls = [];
  installMock((options) => {
    calls.push(options.url);
    const url = new URL(options.url);
    if (url.hostname === "class.katelya.eu.org" && url.pathname.endsWith("/runtime/active.json")) {
      return pointer("oracle-new", "oracle", 200);
    }
    if (url.hostname === "class.katelya.eu.org" && url.pathname.endsWith("/oracle-new/manifest.json")) {
      return manifest("oracle-new", "oracle", 200);
    }
    if (url.hostname === "class.katelya.eu.org" && url.pathname.endsWith("/oracle-new/index/class/all.json")) {
      return indexPayload("oracle-new", "oracle");
    }
    return { fail: true };
  });
  const result = await releasePackService.checkStaticOriginFreshness({
    force: true,
    cloudbasePointer: Object.assign(pointer("cloud-old", "cloud", 100), { staticOrigin: "cloudbase" }),
    timeout: 50,
    manifestTimeout: 50,
  });
  assert.strictEqual(result.freshnessStatus, "cloudbase-stale-switched-oracle");
  assert.strictEqual(releasePackService.getLocalActiveRelease(term).releaseVersion, "oracle-new");
  assert(calls.every((url) => !url.includes("cloud.example.com")), "stale switch should fetch Oracle only");
}

async function testOracleTimeoutDoesNotBlockCloudbase() {
  setup();
  await seedCloudbase("cloud-active", 100);
  installMock((options) => {
    const url = new URL(options.url);
    if (url.hostname === "class.katelya.eu.org" && url.pathname.endsWith("/runtime/active.json")) {
      return { fail: true, delay: 5 };
    }
    return { fail: true };
  });
  const startedAt = Date.now();
  const result = await releasePackService.checkStaticOriginFreshness({
    force: true,
    cloudbasePointer: Object.assign(pointer("cloud-active", "cloud", 100), { staticOrigin: "cloudbase" }),
    timeout: 20,
  });
  assert(Date.now() - startedAt < 500, "freshness timeout should be bounded and background-safe");
  assert.strictEqual(result.freshnessStatus, "oracle-unavailable");
  assert.strictEqual(releasePackService.getLocalActiveRelease(term).releaseVersion, "cloud-active");
}

async function testSamePointerDoesNotRepeatSwitch() {
  setup();
  await seedCloudbase("same-version", 100);
  let oracleCalls = 0;
  installMock((options) => {
    const url = new URL(options.url);
    if (url.hostname === "class.katelya.eu.org" && url.pathname.endsWith("/runtime/active.json")) {
      oracleCalls += 1;
      return pointer("same-version", "oracle", 100);
    }
    return { fail: true };
  });
  const first = await releasePackService.checkStaticOriginFreshness({
    force: true,
    cloudbasePointer: Object.assign(pointer("same-version", "cloud", 100), { staticOrigin: "cloudbase" }),
    timeout: 50,
  });
  const second = await releasePackService.checkStaticOriginFreshness({
    cloudbasePointer: Object.assign(pointer("same-version", "cloud", 100), { staticOrigin: "cloudbase" }),
    timeout: 50,
  });
  assert.strictEqual(first.freshnessStatus, "healthy");
  assert.strictEqual(second.freshnessStatus, "healthy");
  assert.strictEqual(oracleCalls, 1, "second check in same cold start should use stored freshness result");
}

async function run() {
  await testCloudbaseNewerStaysCloudbase();
  await testCloudbaseStaleSwitchesOracle();
  await testOracleTimeoutDoesNotBlockCloudbase();
  await testSamePointerDoesNotRepeatSwitch();
  staticOriginService.__resetForTest();
  releasePackService.__resetForTest();
  console.log("test-cloudbase-freshness passed");
}

run().catch((error) => {
  console.error(error);
  staticOriginService.__resetForTest();
  releasePackService.__resetForTest();
  process.exit(1);
});
