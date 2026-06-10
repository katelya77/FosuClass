const assert = require("assert");

let runtimeCalls = 0;
global.wx = {
  getStorageSync() { return null; },
  setStorageSync() {},
  request(options) {
    if (String(options.url).includes("/static/runtime/active.json")) {
      runtimeCalls += 1;
      return setTimeout(() => options.success({ statusCode: 200, data: {
        success: true,
        activeTerm: "2025-2026-2",
        releaseVersion: "singleflight-v1",
        termConfig: { term: "2025-2026-2", termStartDate: "2026-03-09", totalWeeks: 20 },
        urls: {},
      } }), 5);
    }
    options.fail({ errMsg: "unexpected" });
  },
};
global.getApp = () => ({ globalData: {} });

const coordinator = require("../miniprogram/services/startupCoordinator");
Promise.all([
  coordinator.resolveRuntimePointer(),
  coordinator.resolveRuntimePointer(),
  coordinator.resolveCriticalRuntime(),
]).then(() => {
  assert.strictEqual(runtimeCalls, 1);
  console.log("test-startup-singleflight passed");
});
