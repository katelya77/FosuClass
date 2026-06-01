const assert = require("assert");

process.env.NODE_ENV = "development";
process.env.ADMIN_PASSWORD = "test-admin-password";
process.env.ADMIN_API_TOKEN = "test-admin-token";

const adminAuth = require("../server/src/services/adminAuth");
const adminRouter = require("../server/src/routes/admin");
const { verifyAdminWriteAccess } = adminRouter._test;

function runMiddleware(req) {
  let statusCode = 200;
  let body = null;
  let nextCalled = false;
  const res = {
    status(code) {
      statusCode = code;
      return this;
    },
    json(payload) {
      body = payload;
      return this;
    },
  };
  verifyAdminWriteAccess(req, res, () => {
    nextCalled = true;
  });
  return { statusCode, body, nextCalled };
}

const sessionToken = adminAuth.createSessionToken();
const cookieResult = runMiddleware({
  headers: {
    cookie: `${adminAuth.ADMIN_SESSION_COOKIE}=${encodeURIComponent(sessionToken)}`,
  },
});
assert.strictEqual(cookieResult.nextCalled, true, "Cookie session should access admin sync/status routes");

const bearerResult = runMiddleware({
  headers: {
    authorization: "Bearer test-admin-token",
  },
});
assert.strictEqual(bearerResult.nextCalled, true, "Bearer ADMIN_API_TOKEN should access admin write routes");

const headerResult = runMiddleware({
  headers: {
    "x-admin-token": "test-admin-token",
  },
});
assert.strictEqual(headerResult.nextCalled, true, "x-admin-token should access admin write routes");

const deniedResult = runMiddleware({ headers: {} });
assert.strictEqual(deniedResult.nextCalled, false, "Missing Cookie and token should fail");
assert.strictEqual(deniedResult.statusCode, 401, "Missing Cookie and token should return 401");

const fs = require("fs");
const path = require("path");
const checkScript = fs.readFileSync(path.join(__dirname, "check-admin-inline-script.js"), "utf-8");
const adminPages = fs.readFileSync(path.join(__dirname, "../server/src/routes/adminPages.js"), "utf-8");
function extractFunctionBody(source, functionName) {
  const match = new RegExp("\\bfunction\\s+" + functionName + "\\s*\\(").exec(source);
  if (!match) return "";
  const openBrace = source.indexOf("{", match.index);
  let depth = 0;
  for (let i = openBrace; i < source.length; i += 1) {
    if (source[i] === "{") depth += 1;
    if (source[i] === "}") depth -= 1;
    if (depth === 0) return source.slice(openBrace + 1, i);
  }
  return "";
}
const healthBody = extractFunctionBody(adminPages, "runHealthChecks");
assert(adminPages.includes("function safeFetch("), "admin page should define safeFetch");
assert(healthBody.includes("safeFetch(a.path)"), "health checks should use safeFetch");
assert(!/\bapi\s*\(/.test(healthBody), "health checks must not call api()");
assert(checkScript.includes("runHealthChecks() must use safeFetch()"), "inline-script checker should enforce health-check fetch mode");

console.log("Admin auth mode tests passed.");
