"use strict";
require("./fixture-network-only");
const test = require("node:test"), assert = require("node:assert/strict"), http = require("node:http");
const { fetchLoopback } = require("./oracle-sample/loopback-http");
test("maintenance auth uses fresh real connections and preserves response cookies", async () => {
  let sockets = 0; const methods = [];
  const server = http.createServer((req, res) => { methods.push(req.method); res.setHeader("set-cookie", ["fixture_session=fixture; HttpOnly", "fixture_other=fixture"]); res.end(JSON.stringify({ ok: true })); });
  server.on("connection", () => sockets++); server.keepAliveTimeout = 1;
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  try {
    const url = "http://127.0.0.1:" + server.address().port + "/fixture";
    const first = await fetchLoopback(url); assert.deepEqual(await first.json(), { ok: true }); assert.equal(first.headers.getSetCookie().length, 2);
    // A long local fingerprint comparison must not reuse a socket whose server
    // timeout elapsed. Authentication is submitted once on a new connection.
    const until = Date.now() + 25; while (Date.now() < until) {}
    const second = await fetchLoopback(url, { method: "POST", headers: { "content-type": "application/json" }, body: '{"fixture":true}' });
    assert.deepEqual(await second.json(), { ok: true }); assert.deepEqual(methods, ["GET", "POST"]); assert.equal(sockets, 2);
  } finally { await new Promise(resolve => server.close(resolve)); }
});
test("host helper cannot send credentials outside loopback", () => {
  assert.throws(() => fetchLoopback("https://example.test/private", { method: "POST" }), { code: "HOST_LOOPBACK_ONLY" });
  const authenticatedUrl = new URL("http://127.0.0.1:18318/private"); authenticatedUrl.username = "fixture-user"; authenticatedUrl.password = "fixture-value";
  assert.throws(() => fetchLoopback(authenticatedUrl), { code: "HOST_LOOPBACK_ONLY" });
});
