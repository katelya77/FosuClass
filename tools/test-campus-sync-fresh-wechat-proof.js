const assert = require("assert");
const crypto = require("crypto");
const fs = require("fs");
const http = require("http");
const os = require("os");
const path = require("path");

process.env.CAMPUS_SYNC_OPS_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "fosu-sync-proof-"));
process.env.FOSU_SESSION_SECRET_CURRENT = "test-session-secret-value";
process.env.NODE_ENV = "test";

const express = require("../server/node_modules/express");
const { createSessionToken } = require("../server/src/utils/apiSecurity");
const { setExchangeForTests, resetForTests } = require("../server/src/services/wechatIdentityService");
const proof = require("../server/src/services/campusSyncProof");
const broker = require("../server/src/services/campusSyncBroker");

function app() {
  const server = express();
  server.use(express.json({ limit: "8kb" }));
  server.use("/api/campus-sync", require("../server/src/routes/campusSync"));
  server.use((error, req, res, next) => {
    if (error && error.type === "entity.too.large") {
      return res.status(413).json({ success: false, code: "CAMPUS_SYNC_BODY_REJECTED" });
    }
    return next(error);
  });
  return server;
}

function listen(server) {
  return new Promise((resolve) => {
    const handle = server.listen(0, "127.0.0.1", () => resolve(handle));
  });
}

function request(handle, method, urlPath, headers, body) {
  return new Promise((resolve, reject) => {
    const payload = body == null ? null : Buffer.from(typeof body === "string" ? body : JSON.stringify(body));
    const req = http.request({
      hostname: "127.0.0.1",
      port: handle.address().port,
      path: urlPath,
      method,
      headers: Object.assign({ "content-type": "application/json" }, headers || {}, payload ? { "content-length": payload.length } : {}),
    }, (res) => {
      const chunks = [];
      res.on("data", (chunk) => chunks.push(chunk));
      res.on("end", () => {
        const text = Buffer.concat(chunks).toString("utf8");
        let json = null;
        try { json = JSON.parse(text); } catch (error) { json = null; }
        resolve({ status: res.statusCode, json, text });
      });
    });
    req.on("error", reject);
    if (payload) req.write(payload);
    req.end();
  });
}

async function run() {
  resetForTests();
  proof.resetForTests();
  broker.resetCampusSyncForTests();
  const openid = "fresh-user-a";
  setExchangeForTests((code) => {
    if (code === "badcode12") {
      const error = new Error("WECHAT_SESSION_FAILED");
      error.code = "WECHAT_SESSION_FAILED";
      throw error;
    }
    if (code === "otheropen") return { appid: "wx-test", openid: "someone-else" };
    return { appid: "wx-test", openid };
  });
  const session = createSessionToken({ appid: "wx-test", openid });
  const handle = await listen(app());
  const headers = { "x-fosu-session": session.token };
  const body = { studentId: "202500000303", password: "school-secret", semester: "2025-2026-1", wxCode: "codeuserA1" };
  const created = await request(handle, "POST", "/api/campus-sync/jobs", headers, body);
  assert.strictEqual(created.status, 202, created.text);
  const replay = await request(handle, "POST", "/api/campus-sync/jobs", headers, body);
  assert.strictEqual(replay.status, 401);
  assert.strictEqual(replay.json.code, "CAMPUS_SYNC_REPLAY_BLOCKED");
  const fake = await request(handle, "POST", "/api/campus-sync/jobs", headers, Object.assign({}, body, { wxCode: "badcode12" }));
  assert.strictEqual(fake.json.code, "CAMPUS_SYNC_WECHAT_PROOF_INVALID");
  const mismatch = await request(handle, "POST", "/api/campus-sync/jobs", headers, Object.assign({}, body, { wxCode: "otheropen" }));
  assert.strictEqual(mismatch.json.code, "CAMPUS_SYNC_WECHAT_IDENTITY_MISMATCH");
  assert.ok(!created.text.includes("school-secret"));
  handle.close();
  console.log("campus-sync-fresh-wechat-proof PASS");
}

run().catch((error) => {
  console.error(error && error.stack || error);
  process.exit(1);
});
