const assert = require("assert");
const path = require("path");

process.env.FOSU_IMPORT_RELAY_TOKEN = "unit-relay-token";

const relay = require(path.join(__dirname, "..", "cloudfunctions", "fosuImportRelay", "index.js"));

const sensitive = {
  studentId: "202512340303",
  password: "plain-secret",
  Cookie: "JSESSIONID=abc123; foo=bar",
  ticket: "ticket-raw",
  authorization: "Bearer token-raw",
  nested: {
    html: "<html><body>password=plain-secret&ticket=ticket-raw</body></html>",
  },
};

const redacted = JSON.stringify(relay.redactSecrets(sensitive));
assert(!redacted.includes("plain-secret"), "relay logs must redact password values");
assert(!redacted.includes("abc123"), "relay logs must redact cookie values");
assert(!redacted.includes("ticket-raw"), "relay logs must redact ticket values");
assert(!redacted.includes("token-raw"), "relay logs must redact bearer token values");

const sanitized = relay.sanitizeErrorMessage("<html><body>password=plain-secret Cookie: JSESSIONID=abc ticket=ticket-raw</body></html>");
assert(!sanitized.includes("plain-secret"), "relay error response must not include password");
assert(!sanitized.includes("JSESSIONID=abc"), "relay error response must not include cookie");
assert(!sanitized.includes("ticket-raw"), "relay error response must not include ticket");
assert(!/<html|<body/i.test(sanitized), "relay error response must not include HTML");

const missingTokenRequest = { headers: { authorization: "Bearer wrong" } };
assert.strictEqual(relay.validateRelayToken(missingTokenRequest).ok, false, "wrong relay token should fail");
const validTokenRequest = { headers: { authorization: "Bearer unit-relay-token" } };
assert.strictEqual(relay.validateRelayToken(validTokenRequest).ok, true, "valid relay token should pass");
const customHeaderTokenRequest = { headers: { "x-fosu-relay-token": "unit-relay-token" } };
assert.strictEqual(relay.validateRelayToken(customHeaderTokenRequest).ok, true, "custom relay token header should pass");

assert.strictEqual(relay.normalizeRelayErrorCode({ code: "INVALID_CREDENTIALS" }), "INVALID_CREDENTIALS");
assert.strictEqual(relay.normalizeRelayErrorCode({ code: "ETIMEDOUT" }), "SCHOOL_SYSTEM_TIMEOUT");

console.log("test-fosu-cloudbase-import-relay passed");
