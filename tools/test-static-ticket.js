const assert = require("assert");

process.env.FOSU_STATIC_TICKET_SECRET = "test-static-ticket-secret";

const {
  createStaticAccessTicket,
  verifyStaticAccessTicket,
} = require("../server/src/utils/staticAccessTicket");

const ticket = createStaticAccessTicket({
  releaseVersion: "2026-06-05T12-39-28",
  pathPrefix: "/index/class",
  ttlSeconds: 60,
});

let result = verifyStaticAccessTicket(ticket, {
  releaseVersion: "2026-06-05T12-39-28",
  path: "/index/class/all.json",
});
assert.strictEqual(result.valid, true, "valid ticket should verify");

result = verifyStaticAccessTicket(ticket, {
  releaseVersion: "2026-06-01T00-00-00",
  path: "/index/class/all.json",
});
assert.strictEqual(result.valid, false);
assert.strictEqual(result.code, "STATIC_TICKET_WRONG_RELEASE");

result = verifyStaticAccessTicket(ticket, {
  releaseVersion: "2026-06-05T12-39-28",
  path: "/detail/class/abc.json",
});
assert.strictEqual(result.valid, false);
assert.strictEqual(result.code, "STATIC_TICKET_PATH_SCOPE");

const expired = createStaticAccessTicket({
  releaseVersion: "2026-06-05T12-39-28",
  pathPrefix: "/index/class",
  exp: Math.floor(Date.now() / 1000) - 1,
});
result = verifyStaticAccessTicket(expired, {
  releaseVersion: "2026-06-05T12-39-28",
  path: "/index/class/all.json",
});
assert.strictEqual(result.valid, false);
assert.strictEqual(result.code, "STATIC_TICKET_EXPIRED");

console.log("test-static-ticket passed");
