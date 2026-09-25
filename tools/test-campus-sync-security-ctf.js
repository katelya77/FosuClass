const assert = require("assert");
const crypto = require("crypto");
const fs = require("fs");
const http = require("http");
const os = require("os");
const path = require("path");

const agentMaterial = ["0123456789abcdef", "0123456789abcdef"].join("");
const agentMac = ["fedcba9876543210", "fedcba9876543210"].join("");
process.env.CAMPUS_SYNC_OPS_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "fosu-sync-ctf-"));
process.env.FOSU_SESSION_SECRET_CURRENT = "ctf-session-secret-value";
process.env.CAMPUS_AGENT_TOKEN = agentMaterial;
process.env.CAMPUS_AGENT_SIGNING_SECRET = agentMac;
process.env.CAMPUS_AGENT_ID = "wyz-campus-01";
process.env.NODE_ENV = "test";
process.env.ADMIN_PASSWORD = "ctf-admin-password";

const express = require("../server/node_modules/express");
const { createSessionToken } = require("../server/src/utils/apiSecurity");
const { setExchangeForTests } = require("../server/src/services/wechatIdentityService");
const { signRequest, resetNonces } = require("../server/src/security/campusAgentSignature");
const broker = require("../server/src/services/campusSyncBroker");
const proof = require("../server/src/services/campusSyncProof");
const telemetry = require("../server/src/services/campusSyncTelemetryService");

const results = [];
const PASSWORD = "school-secret-ctf";
const STUDENT = "202500000303";

function record(id, ok, detail) {
  results.push({ id, ok, detail: detail || "" });
  console.log(`${ok ? "PASS" : "FAIL"} ${id}${detail ? " " + detail : ""}`);
}

function check(id, fn) {
  try {
    fn();
    record(id, true);
  } catch (error) {
    record(id, false, error && error.message);
  }
}

async function checkAsync(id, fn) {
  try {
    await fn();
    record(id, true);
  } catch (error) {
    record(id, false, error && error.message);
  }
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
      headers: Object.assign({}, headers || {}, payload ? { "content-type": headers && headers["content-type"] || "application/json", "content-length": payload.length } : {}),
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

function sessionFor(openid, options) {
  const created = createSessionToken({ appid: (options && options.appid) || "wx-test", openid }, options || {});
  if (options && options.expired) {
    const payload = JSON.parse(Buffer.from(created.token.split(".")[0], "base64url").toString("utf8"));
    payload.exp = Math.floor(Date.now() / 1000) - 120;
    const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
    const signature = crypto.createHmac("sha256", process.env.FOSU_SESSION_SECRET_CURRENT).update(body).digest("base64url");
    return `${body}.${signature}`;
  }
  return created.token;
}

function jobBody(wxCode) {
  return { studentId: STUDENT, password: PASSWORD, semester: "2025-2026-1", wxCode };
}

async function run() {
  proof.resetForTests();
  broker.resetCampusSyncForTests();
  telemetry.resetForTests();
  resetNonces();
  const users = { a: "openid-user-a", b: "openid-user-b" };
  setExchangeForTests((code) => {
    if (code.indexOf("user-b") >= 0) return { appid: "wx-test", openid: users.b };
    if (code.indexOf("bad") >= 0) {
      const error = new Error("bad");
      error.code = "WECHAT_SESSION_FAILED";
      throw error;
    }
    if (code.indexOf("mismatch") >= 0) return { appid: "wx-test", openid: "other-person" };
    return { appid: "wx-test", openid: users.a };
  });
  const server = express();
  server.use(express.json({ limit: "8kb", verify: (req, res, buf) => { req.rawBody = buf; } }));
  server.use("/api/campus-sync", require("../server/src/routes/campusSync"));
  server.use("/api/campus-agent/v1", require("../server/src/routes/campusAgent"));
  server.use("/api/admin", require("../server/src/modules/campus-sync-ops/routes"));
  server.use((error, req, res, next) => {
    if (error && (error.type === "entity.too.large" || error.status === 413)) {
      return res.status(413).json({ success: false, code: "CAMPUS_SYNC_BODY_REJECTED" });
    }
    return next(error);
  });
  const handle = await listen(server);
  const tokenA = sessionFor(users.a);
  const tokenB = sessionFor(users.b);
  const headerA = { "x-fosu-session": tokenA, "user-agent": "MicroMessenger", origin: "https://evil.example", referer: "https://evil.example/x" };

  await checkAsync("A1", async () => {
    const response = await request(handle, "POST", "/api/campus-sync/jobs", {}, jobBody("code-a1-user"));
    assert.strictEqual(response.status, 401);
  });
  await checkAsync("A2", async () => {
    const response = await request(handle, "POST", "/api/campus-sync/jobs", { "x-fosu-session": "not-a-token" }, jobBody("code-a2-user"));
    assert.strictEqual(response.status, 401);
  });
  await checkAsync("A3", async () => {
    const response = await request(handle, "POST", "/api/campus-sync/jobs", { "x-fosu-session": `${tokenA.slice(0, -4)}abcd` }, jobBody("code-a3-user"));
    assert.strictEqual(response.status, 401);
  });
  await checkAsync("A4", async () => {
    const response = await request(handle, "POST", "/api/campus-sync/jobs", { "x-fosu-session": sessionFor(users.a, { expired: true }) }, jobBody("code-a4-user"));
    assert.strictEqual(response.status, 401);
  });
  await checkAsync("A5", async () => {
    process.env.WECHAT_APPID = "wx-expected";
    const response = await request(handle, "POST", "/api/campus-sync/jobs", { "x-fosu-session": sessionFor(users.a, { appid: "wx-other" }) }, jobBody("code-a5-user"));
    delete process.env.WECHAT_APPID;
    assert.strictEqual(response.status, 401);
  });
  await checkAsync("A6", async () => {
    const response = await request(handle, "POST", "/api/campus-sync/jobs", headerA, jobBody("bad-code-1"));
    assert.strictEqual(response.json.code, "CAMPUS_SYNC_WECHAT_PROOF_INVALID");
  });
  await checkAsync("A7", async () => {
    const response = await request(handle, "POST", "/api/campus-sync/jobs", headerA, jobBody("mismatch1"));
    assert.strictEqual(response.json.code, "CAMPUS_SYNC_WECHAT_IDENTITY_MISMATCH");
  });
  let jobId = "";
  await checkAsync("A8", async () => {
    const created = await request(handle, "POST", "/api/campus-sync/jobs", headerA, jobBody("code-a8-user"));
    assert.strictEqual(created.status, 202);
    jobId = created.json.jobId;
    const replay = await request(handle, "POST", "/api/campus-sync/jobs", headerA, jobBody("code-a8-user"));
    assert.strictEqual(replay.json.code, "CAMPUS_SYNC_REPLAY_BLOCKED");
  });
  await checkAsync("A9", async () => {
    const response = await request(handle, "GET", `/api/campus-sync/jobs/${jobId}`, { "x-fosu-session": tokenB });
    assert.strictEqual(response.status, 404);
    assert.ok(!/exist/i.test(response.text));
  });
  await checkAsync("A10", async () => {
    const response = await request(handle, "POST", `/api/campus-sync/jobs/${jobId}/cancel`, { "x-fosu-session": tokenB }, {});
    assert.strictEqual(response.status, 404);
  });
  await checkAsync("A11", async () => {
    const response = await request(handle, "POST", `/api/campus-sync/jobs/${jobId}/discard`, { "x-fosu-session": tokenB }, {});
    assert.strictEqual(response.status, 404);
  });
  await checkAsync("A12", async () => {
    const response = await request(handle, "GET", "/api/campus-sync/jobs/0123456789abcdef0123456789abcdef", { "x-fosu-session": tokenA });
    assert.strictEqual(response.status, 404);
  });
  await checkAsync("A13", async () => {
    const response = await request(handle, "POST", "/api/campus-sync/jobs", Object.assign({}, headerA, { "user-agent": "curl/8.0" }), jobBody("code-a13user"));
    assert.notStrictEqual(response.json && response.json.code, "BAD_USER_AGENT");
    assert.ok(response.status === 400 || response.status === 401 || response.status === 429);
  });
  await checkAsync("A14", async () => {
    const response = await request(handle, "GET", `/api/campus-sync/jobs/${jobId}`, Object.assign({ "x-fosu-session": tokenA }, { origin: "https://attacker.example" }));
    assert.strictEqual(response.status, 200);
  });
  await checkAsync("A15", async () => {
    const response = await request(handle, "GET", `/api/campus-sync/jobs/${jobId}`, { "x-fosu-session": tokenA, referer: "https://attacker.example/stolen" });
    assert.strictEqual(response.status, 200);
  });
  await checkAsync("A16", async () => {
    const first = await request(handle, "POST", "/api/campus-sync/jobs", Object.assign({}, headerA, { "x-forwarded-for": "1.2.3.4" }), jobBody("code-a16user"));
    const second = await request(handle, "POST", "/api/campus-sync/jobs", Object.assign({}, headerA, { "x-forwarded-for": "8.8.8.8" }), jobBody("code-a16bbb"));
    assert.notStrictEqual(second.status, 202);
  });
  await checkAsync("A17", async () => {
    const response = await request(handle, "POST", "/api/campus-sync/jobs", headerA, Object.assign(jobBody("code-a17user"), { password: "x".repeat(500) }));
    assert.strictEqual(response.json.code, "CAMPUS_SYNC_BODY_REJECTED");
  });
  await checkAsync("A18", async () => {
    const response = await request(handle, "POST", "/api/campus-sync/jobs", headerA, "{");
    assert.ok(response.status >= 400);
  });
  await checkAsync("A19", async () => {
    const response = await request(handle, "POST", "/api/campus-sync/jobs", headerA, { studentId: STUDENT, password: PASSWORD, semester: "", wxCode: "code-a19user", constructor: "polluted" });
    assert.strictEqual(response.json.code, "CAMPUS_SYNC_BODY_REJECTED");
  });
  await checkAsync("A20", async () => {
    let limited = 0;
    for (let index = 0; index < 6; index += 1) {
      const code = `user-b-burst${index}`;
      const response = await request(handle, "POST", "/api/campus-sync/jobs", { "x-fosu-session": tokenB }, jobBody(code));
      if (response.status === 202 && response.json.jobId) {
        await request(handle, "POST", `/api/campus-sync/jobs/${response.json.jobId}/cancel`, { "x-fosu-session": tokenB }, {});
      }
      if (response.status === 429) limited += 1;
    }
    assert.ok(limited >= 1);
  });
  await checkAsync("A21", async () => {
    const owner = { fosuSession: { openidHash: "daily-limit-user" } };
    for (let index = 0; index < 5; index += 1) {
      const created = broker.createJob(owner, { studentId: STUDENT, password: PASSWORD, semester: "" });
      broker.cancelJob(owner, created.jobId);
    }
    assert.throws(() => broker.createJob(owner, { studentId: STUDENT, password: PASSWORD, semester: "" }), (error) => error.code === "CAMPUS_SYNC_RATE_LIMITED");
  });
  await checkAsync("A22", async () => {
    const response = await request(handle, "POST", "/api/campus-sync/jobs", headerA, jobBody("code-a22user"));
    assert.notStrictEqual(response.status, 202);
  });
  await checkAsync("A23", async () => {
    broker.resetCampusSyncForTests();
    for (let index = 0; index < 10; index += 1) {
      broker.createJob({ fosuSession: { openidHash: `cap-${index}` } }, { studentId: STUDENT, password: PASSWORD, semester: "" });
    }
    assert.throws(() => broker.createJob({ fosuSession: { openidHash: "cap-over" } }, { studentId: STUDENT, password: PASSWORD, semester: "" }), (error) => error.code === "CAMPUS_SYNC_BUSY");
  });
  await checkAsync("A24", async () => {
    process.env.CAMPUS_SYNC_POLL_LIMIT = "3";
    let limited = false;
    for (let index = 0; index < 5; index += 1) {
      const response = await request(handle, "GET", `/api/campus-sync/jobs/${jobId}`, { "x-fosu-session": tokenA });
      if (response.status === 429) limited = true;
    }
    delete process.env.CAMPUS_SYNC_POLL_LIMIT;
    assert.strictEqual(limited, true);
  });
  await checkAsync("A25", async () => {
    broker.resetCampusSyncForTests();
    const owner = { fosuSession: { openidHash: "cancel-owner" } };
    const created = broker.createJob(owner, { studentId: STUDENT, password: PASSWORD, semester: "" });
    broker.cancelJob(owner, created.jobId);
    assert.throws(() => broker.finishJob(created.jobId, { success: true, timetableBodyBase64: Buffer.from("x").toString("base64") }), (error) => error.code === "JOB_NOT_FOUND");
  });
  await checkAsync("A26", async () => {
    broker.resetCampusSyncForTests();
    const owner = { fosuSession: { openidHash: "expire-owner" } };
    const created = broker.createJob(owner, { studentId: STUDENT, password: PASSWORD, semester: "" });
    broker.expireJobsForTests(Date.now() + 10000);
    const view = broker.readJob(owner, created.jobId);
    assert.strictEqual(view.status, "expired");
    assert.ok(!JSON.stringify(view).includes(PASSWORD));
  });
  await checkAsync("A27", async () => {
    const response = await request(handle, "GET", "/api/campus-agent/v1/health", { authorization: "Bearer dummy-wrong-agent-material", "x-campus-agent-id": "wyz-campus-01" });
    assert.strictEqual(response.status, 404);
  });
  await checkAsync("A28", async () => {
    const stamp = Date.now();
    const nonce = crypto.randomBytes(8).toString("hex");
    const response = await request(handle, "POST", "/api/campus-agent/v1/heartbeat", {
      authorization: `Bearer ${process.env.CAMPUS_AGENT_TOKEN}`,
      "x-campus-agent-id": "wyz-campus-01",
      "x-campus-timestamp": String(stamp),
      "x-campus-nonce": nonce,
      "x-campus-signature": "deadbeef",
    }, {});
    assert.strictEqual(response.status, 403);
  });
  await checkAsync("A29", async () => {
    const stamp = Date.now();
    const nonce = "replayed-nonce";
    const signature = signRequest(process.env.CAMPUS_AGENT_SIGNING_SECRET, { method: "POST", path: "/api/campus-agent/v1/heartbeat", timestamp: stamp, nonce, body: "{}" });
    const headers = {
      authorization: `Bearer ${process.env.CAMPUS_AGENT_TOKEN}`,
      "x-campus-agent-id": "wyz-campus-01",
      "x-campus-timestamp": String(stamp),
      "x-campus-nonce": nonce,
      "x-campus-signature": signature,
    };
    const first = await request(handle, "POST", "/api/campus-agent/v1/heartbeat", headers, {});
    const second = await request(handle, "POST", "/api/campus-agent/v1/heartbeat", headers, {});
    assert.strictEqual(first.status, 200);
    assert.strictEqual(second.status, 403);
  });
  await checkAsync("A30", async () => {
    const stamp = Date.now();
    const nonce = crypto.randomBytes(8).toString("hex");
    const signature = signRequest(process.env.CAMPUS_AGENT_SIGNING_SECRET, { method: "POST", path: "/api/campus-agent/v1/heartbeat", timestamp: stamp, nonce, body: "{}" });
    const response = await request(handle, "POST", "/api/campus-agent/v1/heartbeat", {
      authorization: `Bearer ${process.env.CAMPUS_AGENT_TOKEN}`,
      "x-campus-agent-id": "wyz-campus-01",
      "x-campus-timestamp": String(stamp),
      "x-campus-nonce": nonce,
      "x-campus-signature": signature,
    }, { tampered: true });
    assert.strictEqual(response.status, 403);
  });

  const adminAuth = require("../server/src/services/adminAuth");
  const syncPolicy = require("../server/src/services/campusSyncPolicyService");
  const syncQuota = require("../server/src/services/campusSyncQuotaStore");
  const sessionToken = adminAuth.createSessionToken();
  const csrf = adminAuth.createCsrfToken(sessionToken);
  const adminCookie = `${adminAuth.ADMIN_SESSION_COOKIE}=${encodeURIComponent(sessionToken)}`;
  await checkAsync("A31", async () => {
    const response = await request(handle, "GET", "/api/admin/campus-sync/policy");
    assert.ok(response.status === 401 || response.status === 503);
  });
  await checkAsync("A32", async () => {
    const response = await request(handle, "GET", "/api/admin/campus-sync/policy", { "x-fosu-session": tokenA });
    assert.ok(response.status === 401 || response.status === 503);
  });
  await checkAsync("A33", async () => {
    const response = await request(handle, "PUT", "/api/admin/campus-sync/policy", { cookie: adminCookie }, { dailyLimit: 8 });
    assert.strictEqual(response.status, 403);
  });
  await checkAsync("A34", async () => {
    const response = await request(handle, "PUT", "/api/admin/campus-sync/policy", { cookie: adminCookie, "x-fosu-csrf": "bad.csrf" }, { dailyLimit: 8 });
    assert.strictEqual(response.status, 403);
  });
  await checkAsync("A35", async () => {
    const response = await request(handle, "GET", "/api/admin/campus-sync/policy", { cookie: `${adminAuth.ADMIN_SESSION_COOKIE}=forged.session` });
    assert.ok(response.status === 401 || response.status === 503);
  });
  async function rejectPolicy(id, body) {
    await checkAsync(id, async () => {
      const response = await request(handle, "PUT", "/api/admin/campus-sync/policy", { cookie: adminCookie, "x-fosu-csrf": csrf }, body);
      assert.strictEqual(response.json && response.json.code, "CAMPUS_SYNC_POLICY_REJECTED");
    });
  }
  await rejectPolicy("A36", { dailyLimit: 0 });
  await rejectPolicy("A37", { dailyLimit: -1 });
  await rejectPolicy("A38", { dailyLimit: 999999 });
  await rejectPolicy("A39", { rateWindowSeconds: "ten-minutes" });
  await rejectPolicy("A40", { constructor: { prototype: { dailyLimit: 1 } } });
  await rejectPolicy("A41", { perUserConcurrency: 4 });
  await checkAsync("A42", async () => {
    const response = await request(handle, "PUT", "/api/admin/campus-sync/policy", { cookie: adminCookie, "x-fosu-csrf": csrf }, { dailyLimit: 2, rateLimit: 5, rateWindowSeconds: 600, globalActiveCap: 10 });
    assert.strictEqual(response.status, 200);
    assert.strictEqual(syncPolicy.current().dailyLimit, 2);
    const owner = { fosuSession: { openidHash: "policy-now-user" } };
    const first = broker.createJob(owner, { studentId: STUDENT, password: PASSWORD, semester: "" });
    broker.cancelJob(owner, first.jobId);
    const second = broker.createJob(owner, { studentId: STUDENT, password: PASSWORD, semester: "" });
    broker.cancelJob(owner, second.jobId);
    assert.throws(() => broker.createJob(owner, { studentId: STUDENT, password: PASSWORD, semester: "" }), (error) => error.code === "CAMPUS_SYNC_DAILY_LIMIT");
  });
  await checkAsync("A43", async () => {
    syncPolicy.reload();
    assert.strictEqual(syncPolicy.current().dailyLimit, 2);
  });
  await checkAsync("A44", async () => {
    const owner = "quota-restart-user";
    syncQuota.consume(owner, Date.parse("2026-09-25T02:00:00.000Z"));
    syncQuota.flushNow();
    syncQuota.reload();
    assert.strictEqual(syncQuota.acceptedFor(owner, Date.parse("2026-09-25T02:00:00.000Z")), 1);
  });
  await checkAsync("A45", async () => {
    syncPolicy.update({ dailyLimit: 1, rateLimit: 5, rateWindowSeconds: 600, globalActiveCap: 10 }, "ctf");
    const owner = "rollover-user";
    const late = Date.UTC(2026, 8, 25, 15, 59, 0);
    const early = Date.UTC(2026, 8, 25, 16, 1, 0);
    assert.strictEqual(syncQuota.consume(owner, late).ok, true);
    assert.strictEqual(syncQuota.consume(owner, early).ok, true);
    assert.notStrictEqual(syncQuota.shanghaiDate(late), syncQuota.shanghaiDate(early));
  });
  await checkAsync("A46", async () => {
    syncPolicy.update({ dailyLimit: 1, rateLimit: 5, rateWindowSeconds: 600, globalActiveCap: 10 }, "ctf");
    const now = Date.parse("2026-09-25T03:00:00.000Z");
    assert.strictEqual(syncQuota.consume("user-a-quota", now).ok, true);
    assert.strictEqual(syncQuota.consume("user-a-quota", now + 1000).code, "CAMPUS_SYNC_DAILY_LIMIT");
    assert.strictEqual(syncQuota.consume("user-b-quota", now).ok, true);
  });
  await checkAsync("A47", async () => {
    const before = syncQuota.acceptedFor("spoof-target", Date.now());
    broker.resetCampusSyncForTests();
    const response = await request(handle, "POST", "/api/campus-sync/jobs", headerA, Object.assign(jobBody("code-a47user"), { principalHash: "spoof-target" }));
    assert.strictEqual(syncQuota.acceptedFor("spoof-target", Date.now()), 0);
    assert.notStrictEqual(response.status, 202);
  });
  await checkAsync("A48", async () => {
    broker.resetCampusSyncForTests();
    const owner = { fosuSession: { openidHash: "parallel-owner" } };
    const outcomes = await Promise.all([0, 1].map(() => Promise.resolve().then(() => broker.createJob(owner, { studentId: STUDENT, password: PASSWORD, semester: "" })).then(() => "ok").catch((error) => error.code)));
    assert.strictEqual(outcomes.filter((item) => item === "ok").length, 1);
  });
  await checkAsync("A49", async () => {
    broker.resetCampusSyncForTests();
    syncPolicy.update({ globalActiveCap: 1, dailyLimit: 10, rateLimit: 5, rateWindowSeconds: 600 }, "ctf");
    broker.createJob({ fosuSession: { openidHash: "cap-a" } }, { studentId: STUDENT, password: PASSWORD, semester: "" });
    assert.throws(() => broker.createJob({ fosuSession: { openidHash: "cap-b" } }, { studentId: STUDENT, password: PASSWORD, semester: "" }), (error) => error.code === "CAMPUS_SYNC_BUSY");
  });
  await checkAsync("A50", async () => {
    const response = await request(handle, "GET", "/api/admin/campus-sync/policy", { cookie: adminCookie });
    const text = response.text || "";
    assert.ok(!text.includes(process.env.CAMPUS_AGENT_TOKEN));
    assert.ok(!text.includes(process.env.CAMPUS_AGENT_SIGNING_SECRET));
    assert.ok(!text.includes(PASSWORD));
  });

  const blob = JSON.stringify(telemetry.listRecent({ limit: 50 })) + JSON.stringify(broker.metrics());
  check("secrets-absent", () => {
    [PASSWORD, STUDENT, process.env.CAMPUS_AGENT_TOKEN, process.env.CAMPUS_AGENT_SIGNING_SECRET, tokenA].forEach((secret) => {
      assert.ok(!blob.includes(secret), secret.slice(0, 8));
    });
  });
  handle.close();
  const failed = results.filter((item) => !item.ok);
  if (failed.length) {
    console.error(failed);
    process.exit(1);
  }
  console.log("campus-sync-security-ctf PASS");
}

run().catch((error) => {
  console.error(error && error.stack || error);
  process.exit(1);
});
