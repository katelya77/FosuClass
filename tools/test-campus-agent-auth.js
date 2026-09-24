const assert = require("assert");
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const { signRequest, resetNonces, verifySignedRequest } = require("../server/src/security/campusAgentSignature");
const broker = require("../server/src/services/campusSyncBroker");

const TOKEN = "0123456789abcdef0123456789abcdef";
const SECRET = "fedcba9876543210fedcba9876543210";

function decide(pathname, headers) {
  return verifySignedRequest({
    method: "GET",
    originalUrl: pathname,
    headers: headers || {},
    rawBody: Buffer.alloc(0),
  }, Date.now()).status || 200;
}

function signed(path, options) {
  const stamp = options.timestamp || Date.now();
  const nonce = options.nonce || crypto.randomBytes(16).toString("hex");
  const body = Buffer.alloc(0);
  const signature = signRequest(SECRET, { method: "GET", path, timestamp: stamp, nonce, body });
  return {
    Authorization: `Bearer ${options.token || TOKEN}`,
    "X-Campus-Agent-ID": options.agentId || "wyz-campus-01",
    "X-Campus-Timestamp": String(stamp),
    "X-Campus-Nonce": nonce,
    "X-Campus-Signature": signature,
  };
}

async function run() {
  process.env.CAMPUS_AGENT_TOKEN = TOKEN;
  process.env.CAMPUS_AGENT_SIGNING_SECRET = SECRET;
  process.env.CAMPUS_AGENT_ID = "wyz-campus-01";
  resetNonces();
  broker.resetCampusSyncForTests();
  const health = "/api/campus-agent/v1/health";
  assert.strictEqual(decide(health), 404);
  assert.strictEqual(decide(health, signed(health, { token: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" })), 404);
  assert.strictEqual(decide(health, signed(health, { agentId: "other-agent" })), 404);
  assert.strictEqual(decide(health, signed(health, { timestamp: Date.now() - 120000 })), 403);
  const nonce = "same-nonce-value";
  assert.strictEqual(decide(health, signed(health, { nonce })), 200);
  assert.strictEqual(decide(health, signed(health, { nonce })), 403);
  const nginx = fs.readFileSync(path.join(__dirname, "../deploy/agent-broker/nginx.conf"), "utf8");
  assert.ok(nginx.includes("return 404;"));
  assert.ok(nginx.includes("127.0.0.1:18318"));
  assert.ok(!/location\s+\/api\/campus-sync/.test(nginx));
  assert.ok(!/Access-Control-Allow-Origin/.test(nginx));

  const owner = { fosuSession: { openidHash: "owner-a" } };
  const other = { fosuSession: { openidHash: "owner-b" } };
  const created = broker.createJob(owner, { studentId: "202500000303", password: "school-secret", semester: "" });
  assert.throws(() => broker.createJob(owner, { studentId: "202500000303", password: "school-secret", semester: "" }), (error) => error.code === "JOB_ALREADY_ACTIVE");
  const first = await broker.claimJob("wyz-campus-01", 0);
  const second = await broker.claimJob("wyz-campus-01", 0);
  assert.ok(first && first.password === "school-secret");
  assert.strictEqual(second, null);
  broker.finishJob(first.jobId, { success: false, code: "INVALID_CREDENTIALS" });
  const cleared = broker.inspectJob(first.jobId);
  assert.strictEqual(cleared.password, "");
  assert.strictEqual(cleared.studentId, "");
  const queued = broker.createJob(owner, { studentId: "202500000303", password: "school-secret", semester: "" });
  broker.expireJobsForTests(Date.now() + 130000);
  const expired = broker.inspectJob(queued.jobId);
  assert.strictEqual(expired.status, "expired");
  assert.strictEqual(expired.password, "");
  assert.throws(() => broker.readJob(other, created.jobId), (error) => error.code === "JOB_NOT_FOUND");
  const own = broker.readJob(owner, created.jobId);
  assert.ok(!JSON.stringify(own).includes("school-secret"));
  assert.ok(!JSON.stringify(own).includes("202500000303"));
  console.log("campus-agent-auth PASS");
}

run().catch((error) => {
  console.error(error && error.stack || error);
  process.exit(1);
});
