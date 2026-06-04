const assert = require("assert");
const mockEnv = require("./mock-env");
const releasePackService = require("../miniprogram/services/releasePackService");
const request = require("../miniprogram/utils/request");

mockEnv.clearStorage();

const term = "2025-2026-2";
const releaseVersion = "settings-diagnosis";
mockEnv.storage.set(releasePackService.getLastGoodCacheKey(term), {
  savedAt: Date.now(),
  term,
  releaseVersion,
  manifest: {
    success: true,
    term,
    releaseVersion,
    version: releaseVersion,
    cacheEpoch: 1780540000000,
    forceRefreshToken: "settings-token",
    updatedAt: "2026-06-04T00:00:00.000Z",
  },
});

mockEnv.storage.set(releasePackService.getIndexCacheKey(term, releaseVersion, "class"), {
  savedAt: Date.now(),
  data: { success: true, type: "class", term, releaseVersion, items: [{ id: "class-1" }] },
});

request.normalizeRequestError({ errMsg: "request:fail timeout" }, {
  url: "https://example.test/api?token=secret",
  elapsedMs: 99,
});
mockEnv.storage.set(request.REQUEST_DIAG_KEY, {
  lastError: { code: "TIMEOUT", url: "/api?token=[redacted]", elapsedMs: 99 },
  lastSuccess: { url: "/api/fosu/bootstrap", elapsedMs: 88 },
});

global.wx.mockRequest = (options) => {
  setTimeout(() => options.success({
    statusCode: 200,
    data: {
      success: true,
      version: releaseVersion,
      semester: term,
      updatedAt: "2026-06-04T00:00:00.000Z",
      counts: { classScheduleCount: 1 },
    },
  }), 1);
};

require("../miniprogram/pages/settings/settings.js");

async function run() {
  const page = mockEnv.createPageInstance();
  page.setData({ settings: { semesterId: term, semester: term } });
  page.showDataVersionDetail();
  await new Promise((resolve) => setTimeout(resolve, 30));
  assert.strictEqual(page.data.versionData.localActiveReleaseVersion, releaseVersion);
  assert.strictEqual(page.data.versionData.lastGoodReleaseVersion, releaseVersion);
  assert.strictEqual(page.data.versionData.classIndexCount, 1);
  page.toggleAdvancedDiagnosis();
  assert.strictEqual(page.data.diagnosisExpanded, true);
  page.exportDiagnosisLog();
  const clipboard = mockEnv.storage.get("__clipboard") || "";
  assert(!clipboard.includes("secret"), "diagnosis export should redact sensitive values");
  console.log("test-settings-data-diagnosis passed");
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
