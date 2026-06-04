const assert = require("assert");
const mockEnv = require("./mock-env");
const releasePackService = require("../miniprogram/services/releasePackService");

mockEnv.clearStorage();
require("../miniprogram/pages/school/school.js");

const term = "2025-2026-2";
const releaseVersion = "last-good-2026-06-02";

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
    updatedAt: "2026-06-02T00:00:00.000Z",
    cacheEpoch: 1780378986408,
    files: {},
  },
});

global.wx.mockRequest = (options) => {
  setTimeout(() => options.success({
    statusCode: 200,
    data: { success: false, code: "OFFLINE", reasonCode: "OFFLINE" },
  }), 1);
};

async function run() {
  const page = mockEnv.createPageInstance();
  page._schoolRequestSeq = 0;
  page._activeInitSeq = 0;
  const result = await page.resolveActiveSnapshot({ forceNetwork: true });
  assert.strictEqual(result.source, "release-pack-last-good");
  assert.strictEqual(result.fromStorage, true);
  assert.strictEqual(result.activeSnapshot.term, term);
  assert.strictEqual(result.activeSnapshot.releaseVersion, releaseVersion);
  assert.strictEqual(mockEnv.storage.get("FOSU_ACTIVE_SNAPSHOT").releaseVersion, releaseVersion);

  console.log("test-school-last-known-good passed");
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
