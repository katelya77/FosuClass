const assert = require("assert");
const mockEnv = require("./mock-env");

mockEnv.clearStorage();
const request = require("../miniprogram/utils/request");

let calls = 0;
global.wx.mockRequest = (options) => {
  calls += 1;
  if (calls < 3) {
    setTimeout(() => options.fail({ errMsg: "request:fail timeout" }), 1);
    return;
  }
  setTimeout(() => options.success({ statusCode: 200, data: { success: true, ok: true } }), 1);
};

request.get("/api/fosu/release-pack/index/class", { term: "2025-2026-2", releaseVersion: "retry-test" }, {
  showLoading: false,
  retryBaseDelayMs: 1,
  retryMaxDelayMs: 1,
}).then((data) => {
  assert.strictEqual(data.ok, true);
  assert.strictEqual(calls, 3, "index request should retry twice before success");
  console.log("test-request-retry-timeout passed");
}).catch((error) => {
  console.error(error);
  process.exit(1);
});
