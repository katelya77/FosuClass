const assert = require("assert");
const mockEnv = require("./mock-env");

mockEnv.clearStorage();

const platformDataService = require("../miniprogram/services/platformDataService");

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function run() {
  let periodicCalls = 0;
  global.wx.mockRequest = (options) => {
    if (options.url.indexOf("/api/fosu/periodic-data") >= 0) periodicCalls += 1;
    setTimeout(() => options.success({ statusCode: 200, data: { success: true, activeSnapshot: { releaseVersion: "v1" } } }), 5);
  };

  require("../miniprogram/pages/ai-assistant/ai-assistant.js");
  const page = mockEnv.createPageInstance();
  page.onLoad({});
  await wait(10);
  assert.strictEqual(periodicCalls, 0, "AI page onLoad must not request periodic-data");

  mockEnv.clearStorage();
  global.wx.setStorageSync(platformDataService.PLATFORM_PERIODIC_CACHE_KEY, {
    success: true,
    savedAt: Date.now(),
    activeSnapshot: { releaseVersion: "cached" },
  });
  const cached = await platformDataService.loadPeriodicData({ silent: true });
  assert.strictEqual(cached.activeSnapshot.releaseVersion, "cached");
  assert.strictEqual(periodicCalls, 0, "fresh periodic cache should avoid network");

  mockEnv.clearStorage();
  periodicCalls = 0;
  const [left, right] = await Promise.all([
    platformDataService.loadPeriodicData({ silent: true }),
    platformDataService.loadPeriodicData({ silent: true }),
  ]);
  assert.strictEqual(periodicCalls, 1, "periodic network refresh should be singleflight");
  assert.strictEqual(left.activeSnapshot.releaseVersion, "v1");
  assert.strictEqual(right.activeSnapshot.releaseVersion, "v1");

  mockEnv.clearStorage();
  const lastGood = {
    success: true,
    savedAt: Date.now() - 3600 * 1000,
    activeSnapshot: { releaseVersion: "last-good" },
  };
  global.wx.setStorageSync(platformDataService.PLATFORM_PERIODIC_CACHE_KEY, lastGood);
  let modalCount = 0;
  let toastCount = 0;
  global.wx.onModal = () => { modalCount += 1; };
  global.wx.onToast = () => { toastCount += 1; };
  global.wx.mockRequest = (options) => {
    periodicCalls += 1;
    setTimeout(() => options.fail({ errMsg: "request:fail timeout" }), 1);
  };
  const fallback = await platformDataService.loadPeriodicData({ silent: true, timeout: 1, retries: 0 });
  assert.strictEqual(fallback.activeSnapshot.releaseVersion, "last-good", "timeout should preserve last-known-good cache");
  assert.strictEqual(modalCount, 0, "background timeout should not show modal");
  assert.strictEqual(toastCount, 0, "background timeout should not show toast");

  console.log("test-ai-periodic-data-isolation passed");
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
