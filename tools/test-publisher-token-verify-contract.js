const assert = require("assert");
const http = require("http");
const { verify } = require("./fosu-publisher/verify-admin-token");

function startServer(handler) {
  const server = http.createServer(handler);
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      resolve({ server, baseUrl: `http://127.0.0.1:${address.port}` });
    });
  });
}

function closeServer(server) {
  return new Promise((resolve) => server.close(resolve));
}

async function runCase(status, payload, expected) {
  const token = "verify-contract-token";
  const started = await startServer((req, res) => {
    assert.strictEqual(req.method, "GET");
    assert.strictEqual(req.url, "/api/admin/publisher/receipt");
    assert.strictEqual(req.headers["x-admin-token"], token);
    assert.strictEqual(req.headers.authorization, `Bearer ${token}`);
    res.writeHead(status, { "content-type": "application/json" });
    res.end(JSON.stringify(payload));
  });
  try {
    const result = await verify({ baseUrl: started.baseUrl, token, timeoutMs: 3000 });
    assert.strictEqual(result.status, expected.status);
    assert.strictEqual(result.ok, expected.ok);
    if (expected.code) assert.strictEqual(result.code, expected.code);
    assert(!JSON.stringify(result).includes(token), "verify result must not contain token");
  } finally {
    await closeServer(started.server);
  }
}

async function run() {
  await runCase(200, { success: true }, { status: 200, ok: true });
  await runCase(401, { success: false, code: "ADMIN_AUTH_FAILED" }, {
    status: 401,
    ok: false,
    code: "ADMIN_API_TOKEN_MISMATCH",
  });
  await runCase(503, { success: false, code: "ADMIN_NOT_CONFIGURED" }, {
    status: 503,
    ok: false,
    code: "SERVER_ADMIN_TOKEN_NOT_CONFIGURED",
  });
  console.log("test-publisher-token-verify-contract passed");
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
