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

// Startup chooses a term from a cached pointer/bootstrap, rather than guessing
// from unrelated historical LKG records or a hardcoded semester default.
releasePackService.writeRuntimePointerCache({
  success: true, term, activeTerm: term, releaseVersion,
  updatedAt: "2026-06-04T00:00:00.000Z", cacheEpoch: 1780540000000,
  forceRefreshToken: "startup-token",
});
mockEnv.storage.set(releasePackService.getLastGoodCacheKey("2024-2025-2"), {
  savedAt: Date.now() + 1, term: "2024-2025-2", releaseVersion: "unrelated-history",
  manifest: { success: true, term: "2024-2025-2", releaseVersion: "unrelated-history", files: {} },
});
mockEnv.storage.set(require("../miniprogram/utils/storage").BOOTSTRAP_CACHE_KEY, {
  term: "2024-2025-2", releaseVersion: "unrelated-history",
});

global.wx.mockRequest = (options) => {
  setTimeout(() => options.fail({ errMsg: "request:fail timeout" }), 1);
};

require("../miniprogram/app.js");
const app = mockEnv.createAppInstance();
app.onLaunch();

assert(app.globalData.activeRelease, "app should expose local active release immediately");
assert.strictEqual(app.globalData.activeRelease.releaseVersion, releaseVersion);
assert.strictEqual(app.globalData.activeRelease.term, term, "startup must preserve the cached authoritative term");

setTimeout(() => {
  console.log("test-startup-last-good-first passed");
}, 20);
