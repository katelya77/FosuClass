const assert = require("assert");
const express = require("../server/node_modules/express");

process.env.NODE_ENV = "development";
process.env.ADMIN_API_TOKEN = "test-admin-token";
process.env.ADMIN_PASSWORD = "test-admin-password";
process.env.FOSU_SESSION_SECRET = "test-session-secret";
process.env.FOSU_BLOCK_BAD_UA = "true";
process.env.FOSU_DYNAMIC_BODY_LIMIT_BYTES = "64";
delete process.env.WECHAT_APPID;
delete process.env.WECHAT_APPSECRET;
delete process.env.WX_APPID;
delete process.env.WX_APPSECRET;

const fosuRouter = require("../server/src/routes/fosu");
const { createSessionToken, optionalSessionGuard, validateJsonBody } = require("../server/src/utils/apiSecurity");

function listen(app) {
  return new Promise((resolve) => {
    const server = app.listen(0, "127.0.0.1", () => resolve(server));
  });
}

async function requestJson(baseUrl, pathname, options = {}) {
  const response = await fetch(`${baseUrl}${pathname}`, Object.assign({
    headers: { "Content-Type": "application/json", "User-Agent": "FosuClass-Test" },
  }, options));
  return {
    status: response.status,
    data: await response.json(),
  };
}

function runMiddleware(middleware, req) {
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
  middleware(req, res, () => {
    nextCalled = true;
  });
  return { statusCode, body, nextCalled };
}

async function run() {
  const app = express();
  app.use(express.json({ limit: "2mb" }));
  app.use("/api/fosu", fosuRouter);
  const server = await listen(app);
  const baseUrl = `http://127.0.0.1:${server.address().port}`;

  try {
    const bootstrap = await requestJson(baseUrl, "/api/fosu/session/bootstrap", {
      method: "POST",
      body: JSON.stringify({ code: "dev-code" }),
    });
    assert.strictEqual(bootstrap.status, 200);
    assert.strictEqual(bootstrap.data.success, true);
    assert(bootstrap.data.sessionToken, "session bootstrap should return token");
    assert.strictEqual(typeof bootstrap.data.expiresAt, "string");
    assert.strictEqual(typeof bootstrap.data.securityMode, "string");
    assert.strictEqual(bootstrap.data.openidHash, undefined, "session bootstrap must not return openidHash");

    const badUa = await fetch(`${baseUrl}/api/fosu/bootstrap`, {
      headers: { "User-Agent": "curl/8.0" },
    });
    assert.strictEqual(badUa.status, 403, "bad automation user-agent should be blocked when enabled");

    const largeBody = await requestJson(baseUrl, "/api/fosu/class-schedule", {
      method: "POST",
      body: JSON.stringify({ semester: termString(), className: "x".repeat(100) }),
    });
    assert.strictEqual(largeBody.status, 413, "oversized dynamic API body should be rejected");
  } finally {
    server.close();
  }

  const invalidJson = runMiddleware(validateJsonBody(["code"]), {
    method: "POST",
    body: { code: "ok", password: "must-not-pass" },
  });
  assert.strictEqual(invalidJson.nextCalled, false);
  assert.strictEqual(invalidJson.statusCode, 400);
  assert.deepStrictEqual(invalidJson.body.fields, ["password"]);

  process.env.FOSU_DYNAMIC_API_SESSION_REQUIRED = "true";
  const missingSession = runMiddleware(optionalSessionGuard, { headers: {}, path: "/search-index" });
  assert.strictEqual(missingSession.nextCalled, false);
  assert.strictEqual(missingSession.statusCode, 401);

  const token = createSessionToken({ appid: "test-appid", openid: "openid-1" }).token;
  const validSession = runMiddleware(optionalSessionGuard, {
    headers: { "x-fosu-session": token },
    path: "/search-index",
  });
  assert.strictEqual(validSession.nextCalled, true, "valid x-fosu-session should allow guarded dynamic APIs");

  console.log("test-api-security passed");
}

function termString() {
  return "2025-2026-2";
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
