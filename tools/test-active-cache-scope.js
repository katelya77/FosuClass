const assert = require("assert");

const store = {};
global.wx = {
  getStorageSync(key) { return store[key]; },
  setStorageSync(key, value) { store[key] = value; },
  getStorageInfoSync() { return { keys: Object.keys(store) }; },
  removeStorageSync(key) { delete store[key]; },
  request(options) {
    const url = String(options.url || "");
    if (url.includes("/static/releases/")) return options.fail({ errMsg: "missing static" });
    options.success({ statusCode: 200, data: {
      success: true,
      term: "2024-2025-2",
      activeTerm: "2025-2026-2",
      releaseVersion: "history-v1",
      termConfig: { term: "2024-2025-2", termStartDate: "2025-03-03", totalWeeks: 20 },
    } });
  },
};
global.getApp = () => ({ globalData: {} });

const service = require("../miniprogram/services/releasePackService");
service.getActiveManifest({ term: "2024-2025-2", forceNetwork: true, skipSession: true })
  .then(() => {
    assert(store[service.getLocalActiveReleaseKey("2024-2025-2")], "historical term cache should be written");
    assert(!store[service.LOCAL_ACTIVE_RELEASE_KEY], "global active cache must not be overwritten by historical manifest");
    console.log("test-active-cache-scope passed");
  });
