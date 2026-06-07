const assert = require("assert");

process.env.FOSU_RATE_DYNAMIC_READ_LIMIT = "1";
process.env.FOSU_RATE_DYNAMIC_READ_BURST = "1";

const { checkRateLimit } = require("../server/src/services/rateLimitService");

let first = checkRateLimit("dynamic-read", "session-a");
let second = checkRateLimit("dynamic-read", "session-a");
let third = checkRateLimit("dynamic-read", "session-a");

assert.strictEqual(first.allowed, true);
assert.strictEqual(second.allowed, true, "configured burst allows one extra request");
assert.strictEqual(third.allowed, false);
assert(third.retryAfterSeconds >= 1);

console.log("test-rate-limit-service passed");
