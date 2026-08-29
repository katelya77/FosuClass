const assert = require("assert");

const calls = [];
global.wx = {
  getStorageSync() { return null; },
  setStorageSync() {},
  request(options) {
    calls.push(String(options.url));
    if (String(options.url).includes("/runtime/active.json")) {
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
  const pointerCalls = calls.filter((url) => url.includes("/runtime/active.json"));
  const otherCalls = calls.filter((url) => !url.includes("/runtime/active.json"));
  assert(pointerCalls.length >= 1, "critical runtime must read the runtime pointer");
  assert(pointerCalls.length <= 2, `runtime pointer fan-out must stay within ready origins, got ${pointerCalls.length}`);
  assert.deepStrictEqual(otherCalls, [], `critical path must not issue non-pointer requests: ${otherCalls.join(", ")}`);
  assert(!calls.some((url) => url.includes("/periodic-data")), "periodic-data must not be in critical path");
  console.log("test-cold-start-request-budget passed");
});
