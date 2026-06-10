const assert = require("assert");

const calls = [];
global.wx = {
  getStorageSync() { return null; },
  setStorageSync() {},
  request(options) {
    calls.push(String(options.url));
    if (String(options.url).includes("/static/runtime/active.json")) {
      return options.success({ statusCode: 200, data: {
        success: true,
        activeTerm: "2025-2026-2",
        releaseVersion: "cold-v1",
        termConfig: { term: "2025-2026-2", termStartDate: "2026-03-09", totalWeeks: 20 },
        urls: {},
      } });
    }
    options.success({ statusCode: 200, data: { success: true } });
  },
};
global.getApp = () => ({ globalData: {} });

const coordinator = require("../miniprogram/services/startupCoordinator");
coordinator.resolveCriticalRuntime().then(() => {
  assert(calls.length <= 1, `critical runtime should need at most 1 request, got ${calls.length}`);
  assert(!calls.some((url) => url.includes("/periodic-data")), "periodic-data must not be in critical path");
  console.log("test-cold-start-request-budget passed");
});
