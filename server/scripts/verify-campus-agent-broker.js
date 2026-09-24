const crypto = require("crypto");
const http = require("http");
const { signRequest } = require("../src/security/campusAgentSignature");

const base = new URL(process.env.CAMPUS_AGENT_VERIFY_BASE_URL || "http://127.0.0.1:3000");
const token = String(process.env.CAMPUS_AGENT_TOKEN || "");
const secret = String(process.env.CAMPUS_AGENT_SIGNING_SECRET || "");
const agentId = String(process.env.CAMPUS_AGENT_ID || "wyz-campus-01");
const pathName = "/api/campus-agent/v1/health";

function request(headers) {
  return new Promise((resolve, reject) => {
    const req = http.request({
      protocol: base.protocol,
      hostname: base.hostname,
      port: base.port,
      path: pathName,
      method: "GET",
      headers,
      timeout: 8000,
    }, (res) => {
      res.resume();
      res.on("end", () => resolve(res.statusCode));
    });
    req.on("error", reject);
    req.end();
  });
}

function signed(options) {
  const timestamp = String(options.timestamp || Date.now());
  const nonce = options.nonce || crypto.randomBytes(16).toString("hex");
  const signature = signRequest(secret, {
    method: "GET",
    path: pathName,
    timestamp,
    nonce,
    body: Buffer.alloc(0),
  });
  return {
    Authorization: `Bearer ${options.token || token}`,
    "X-Campus-Agent-ID": options.agentId || agentId,
    "X-Campus-Timestamp": timestamp,
    "X-Campus-Nonce": nonce,
    "X-Campus-Signature": signature,
  };
}

async function expectStatus(label, status, headers) {
  const actual = await request(headers || {});
  if (actual !== status) {
    console.error(`${label} expected ${status} got ${actual}`);
    process.exitCode = 1;
  } else {
    console.log(`${label} ${actual}`);
  }
}

async function main() {
  if (!token || !secret || token === secret) {
    console.error("campus agent secrets are missing or identical");
    process.exit(1);
  }
  await expectStatus("no-token", 404);
  await expectStatus("wrong-token", 404, signed({ token: "0".repeat(64) }));
  await expectStatus("wrong-agent", 404, signed({ agentId: "other-agent" }));
  await expectStatus("expired-timestamp", 403, signed({ timestamp: Date.now() - 120000 }));
  const nonce = crypto.randomBytes(16).toString("hex");
  await expectStatus("valid", 200, signed({ nonce }));
  await expectStatus("replayed-nonce", 403, signed({ nonce }));
  if (process.exitCode) process.exit(process.exitCode);
  console.log("campus-agent-broker-verify ok");
}

main().catch((error) => {
  console.error(error && error.code ? error.code : "verify-failed");
  process.exit(1);
});
