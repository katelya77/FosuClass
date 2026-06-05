const assert = require("assert");
const { redactSecrets } = require("../server/src/utils/safeLogger");

const redacted = redactSecrets({
  username: "student",
  password: "secret",
  nested: {
    token: "abc",
    url: "https://example.test/path?ticket=TICKET&password=PASS&safe=1",
    headers: {
      authorization: "Bearer secret",
      cookie: "JSESSIONID=abc123; theme=light",
    },
  },
});

assert.strictEqual(redacted.username, "student");
assert.strictEqual(redacted.password, "[REDACTED]");
assert.strictEqual(redacted.nested.token, "[REDACTED]");
assert.strictEqual(redacted.nested.headers.authorization, "[REDACTED]");
assert.strictEqual(redacted.nested.headers.cookie, "[REDACTED]");
assert(redacted.nested.url.includes("ticket=[REDACTED]"));
assert(redacted.nested.url.includes("password=[REDACTED]"));
assert(redacted.nested.url.includes("safe=1"));

console.log("test-logs-mask-sensitive-values passed");
