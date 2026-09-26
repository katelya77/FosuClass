const assert = require("assert");
const { canRetrySchoolGet, retryMatrix, RETRY_PAUSE_MS } = require("../miniprogram/services/fosuDirectRetry");

const matrix = retryMatrix();
assert.ok(matrix.never.includes("INVALID_CREDENTIALS"));
assert.ok(matrix.never.includes("INTERACTIVE_CHALLENGE_REQUIRED"));
assert.ok(matrix.never.includes("PROFILE_ID_MISMATCH"));
assert.ok(matrix.never.includes("STRUCTURE_CHANGED"));
assert.strictEqual(matrix.loginPost, "never");
assert.strictEqual(matrix.profileGet, "soft-fail-without-retry");
assert.ok(matrix.onceForIdempotentGet.includes("ECONNRESET"));
assert.ok(matrix.onceForIdempotentGet.includes("HTTP_5XX"));
assert.ok(RETRY_PAUSE_MS > 0 && RETRY_PAUSE_MS <= 1000);

function denied(spec, error, status) {
  assert.strictEqual(canRetrySchoolGet(spec, error, status), false);
}

denied({ method: "POST", stage: "login-post" }, { code: "DIRECT_NETWORK_ERROR" }, 0);
denied({ method: "POST", stage: "captcha-check" }, { code: "TIMEOUT" }, 0);
denied({ method: "POST", stage: "semester-switch" }, null, 503);
denied({ method: "GET", stage: "profile-fetch" }, { code: "DIRECT_NETWORK_ERROR" }, 0);
denied({ method: "GET", stage: "timetable-fetch" }, { code: "INTERACTIVE_CHALLENGE_REQUIRED" }, 0);
denied({ method: "GET", stage: "timetable-fetch" }, { code: "INVALID_CREDENTIALS" }, 0);
denied({ method: "GET", stage: "timetable-fetch" }, { code: "PROFILE_ID_MISMATCH" }, 0);
denied({ method: "GET", stage: "timetable-fetch" }, { code: "STRUCTURE_CHANGED" }, 0);
denied({ method: "GET", stage: "timetable-fetch", _retried: true }, { code: "ECONNRESET" }, 0);
denied({ method: "GET", stage: "timetable-fetch" }, null, 404);
denied({ method: "GET", stage: "timetable-fetch" }, null, 302);

assert.strictEqual(canRetrySchoolGet({ method: "GET", stage: "timetable-fetch" }, { code: "ECONNRESET" }, 0), true);
assert.strictEqual(canRetrySchoolGet({ method: "GET", stage: "timetable-fetch" }, { code: "ENOTFOUND" }, 0), true);
assert.strictEqual(canRetrySchoolGet({ method: "GET", stage: "timetable-fetch" }, { code: "ETIMEDOUT" }, 0), true);
assert.strictEqual(canRetrySchoolGet({ method: "GET", stage: "timetable-fetch" }, { code: "DIRECT_NETWORK_ERROR" }, 0), true);
assert.strictEqual(canRetrySchoolGet({ method: "GET", stage: "xs-main" }, null, 502), true);
assert.strictEqual(canRetrySchoolGet({ method: "GET", stage: "timetable-fetch" }, null, 500), true);

console.log("campus-sync-retry-contract PASS");
