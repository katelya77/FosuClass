const assert = require("assert");
const fs = require("fs");
const path = require("path");

process.env.NODE_ENV = "development";
process.env.ADMIN_PASSWORD = "test-admin-password";
process.env.ADMIN_API_TOKEN = "test-admin-token";

const adminAuth = require("../server/src/services/adminAuth");

function runCsrf(req) {
  return adminAuth.verifyAdminCsrf(req);
}

const sessionToken = adminAuth.createSessionToken();
const csrfToken = adminAuth.createCsrfToken(sessionToken);

assert.strictEqual(
  runCsrf({
    method: "POST",
    headers: {
      cookie: `${adminAuth.ADMIN_SESSION_COOKIE}=${encodeURIComponent(sessionToken)}`,
      "x-fosu-csrf": csrfToken,
    },
  }),
  true,
  "cookie + csrf should pass"
);

assert.strictEqual(
  runCsrf({
    method: "POST",
    headers: {
      cookie: `${adminAuth.ADMIN_SESSION_COOKIE}=${encodeURIComponent(sessionToken)}`,
    },
  }),
  false,
  "cookie without csrf must fail"
);

assert.strictEqual(
  runCsrf({
    method: "POST",
    headers: {
      authorization: "Bearer test-admin-token",
      "x-fosu-client": "service",
    },
  }),
  true,
  "service client token without origin may skip csrf"
);

assert.strictEqual(
  runCsrf({
    method: "POST",
    headers: {
      authorization: "Bearer test-admin-token",
      origin: "https://evil.example",
    },
  }),
  false,
  "browser-like token-only write with Origin must fail csrf gate"
);

const adminPages = fs.readFileSync(path.join(__dirname, "../server/src/routes/adminPages.js"), "utf8");
assert(
  adminPages.includes('headers["X-Fosu-CSRF"] = state.csrfToken') ||
    adminPages.includes("headers[\"X-Fosu-CSRF\"] = state.csrfToken"),
  "uploadRawChunk must attach CSRF header"
);
assert(/function uploadRawChunk[\s\S]*X-Fosu-CSRF/.test(adminPages), "uploadRawChunk body must set CSRF");

console.log("Chunk upload CSRF tests passed.");
