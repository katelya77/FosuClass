const assert = require("assert");
const mockEnv = require("./mock-env");
const releasePackService = require("../miniprogram/services/releasePackService");

mockEnv.clearStorage();

const term = "2025-2026-2";
const releaseVersion = "startup-last-good";
mockEnv.storage.set(releasePackService.getLastGoodCacheKey(term), {
  savedAt: Date.now(),
  term,
  releaseVersion,
  manifest: {
    success: true,
    term,
    semester: term,
    releaseVersion,
    version: releaseVersion,
    updatedAt: "2026-06-04T00:00:00.000Z",
    cacheEpoch: 1780540000000,
    forceRefreshToken: "startup-token",
    files: {},
  },
});

global.wx.mockRequest = (options) => {
  setTimeout(() => options.fail({ errMsg: "request:fail timeout" }), 1);
};

require("../miniprogram/app.js");
const app = mockEnv.createAppInstance();
app.onLaunch();

assert(app.globalData.activeRelease, "app should expose local active release immediately");
assert.strictEqual(app.globalData.activeRelease.releaseVersion, releaseVersion);

setTimeout(() => {
  console.log("test-startup-last-good-first passed");
}, 20);
