const assert = require("assert");
const mockEnv = require("./mock-env");

mockEnv.clearStorage();
require("../miniprogram/pages/today/today.js");

global.wx.mockRequest = (options) => {
  setTimeout(() => options.success({
    statusCode: 200,
    data: {
      success: true,
      data: {
        currentSemester: "2025-2026-2",
        dataVersion: { releaseVersion: "today-defaults" },
      },
    },
  }), 1);
};

async function run() {
  const page = mockEnv.createPageInstance();
  await page.loadPageConfig();
  assert(Array.isArray(page.data.appConfig.notices), "notices should default to array");
  assert(Array.isArray(page.data.appConfig.banners), "banners should default to array");
  assert.strictEqual(page.data.urgentNotice, null, "urgentNotice should not be undefined");
  console.log("test-today-config-defaults passed");
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
