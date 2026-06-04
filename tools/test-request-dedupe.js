const assert = require("assert");
const mockEnv = require("./mock-env");

mockEnv.clearStorage();
const request = require("../miniprogram/utils/request");

let calls = 0;
global.wx.mockRequest = (options) => {
  calls += 1;
  setTimeout(() => {
    options.success({ statusCode: 200, data: { success: true, requestNo: calls } });
  }, 20);
};

Promise.all([
  request.get("/api/fosu/release-pack/manifest", { term: "2025-2026-2" }, { showLoading: false }),
  request.get("/api/fosu/release-pack/manifest", { term: "2025-2026-2" }, { showLoading: false }),
]).then((results) => {
  assert.strictEqual(calls, 1, "identical GET requests should share one in-flight request");
  assert.strictEqual(results[0], results[1], "deduped callers should receive the same payload object");
  console.log("test-request-dedupe passed");
}).catch((error) => {
  console.error(error);
  process.exit(1);
});
