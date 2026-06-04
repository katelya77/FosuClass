const assert = require("assert");
const mockEnv = require("./mock-env");

mockEnv.clearStorage();
const request = require("../miniprogram/utils/request");

const timeout = request.normalizeRequestError({ errMsg: "request:fail timeout" }, {
  url: "https://example.test/api/fosu/release-pack/index/class?token=secret",
  elapsedMs: 8010,
});
assert.strictEqual(timeout.code, "TIMEOUT");
assert.strictEqual(timeout.reasonCode, "REQUEST_TIMEOUT");
assert.strictEqual(timeout.retriable, true);
assert(timeout.url.includes("[redacted]"), "sensitive query values should be redacted");

const http5xx = request.normalizeRequestError(new Error("HTTP status error: 503"), {
  statusCode: 503,
  url: "/api/fosu/bootstrap",
  elapsedMs: 120,
});
assert.strictEqual(http5xx.code, "HTTP_5XX");
assert.strictEqual(http5xx.retriable, true);

const http4xx = request.normalizeRequestError(new Error("HTTP status error: 404"), {
  statusCode: 404,
  url: "/api/fosu/release-pack/detail/class/not-found",
  elapsedMs: 60,
});
assert.strictEqual(http4xx.code, "HTTP_4XX");
assert.strictEqual(http4xx.retriable, false);

console.log("test-request-error-normalize passed");
