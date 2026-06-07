const assert = require("assert");

process.env.FOSU_STATIC_TICKET_SECRET = "test-static-ticket-secret";
delete process.env.FOSU_STATIC_TICKET_SECRET_CURRENT;
delete process.env.FOSU_STATIC_TICKET_SECRET_PREVIOUS;

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

process.env.FOSU_STATIC_TICKET_SECRET_CURRENT = "new-static-secret";
process.env.FOSU_STATIC_TICKET_SECRET_PREVIOUS = "old-static-secret";
const previousTicket = createStaticAccessTicket({
  releaseVersion: "2026-06-05T12-39-28",
  pathPrefix: "/static/releases/2026-06-05T12-39-28/",
  ttlSeconds: 60,
}, { secret: "old-static-secret" });
result = verifyStaticAccessTicket(previousTicket, {
  releaseVersion: "2026-06-05T12-39-28",
  path: "/static/releases/2026-06-05T12-39-28/manifest.json",
});
assert.strictEqual(result.valid, true, "previous static ticket key should verify during rotation");

result = verifyStaticAccessTicket(previousTicket, {
  releaseVersion: "2026-06-05T12-39-28",
  path: "/static/releases/2026-06-05T12-39-28/%252e%252e/manifest.json",
});
assert.strictEqual(result.valid, false);
assert.strictEqual(result.code, "STATIC_PATH_UNSAFE_ENCODING");

const longTtlTicket = createStaticAccessTicket({
  releaseVersion: "2026-06-05T12-39-28",
  pathPrefix: "/static/releases/2026-06-05T12-39-28/",
  ttlSeconds: 99999,
});
const payload = JSON.parse(Buffer.from(longTtlTicket.split(".")[0].replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8"));
assert(payload.exp - payload.iat <= 15 * 60, "static ticket ttl must be capped by the server");

console.log("test-static-ticket passed");
