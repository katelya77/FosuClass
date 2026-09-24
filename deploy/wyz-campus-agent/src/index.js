const http = require("http");
const https = require("https");
const crypto = require("crypto");
const path = require("path");
const { URL } = require("url");
const { signRequest } = require("./signature");

function clientFactory() {
  const root = process.env.FOSU_DIRECT_CLIENT_DIR || path.join(__dirname, "..", "vendor");
  return require(path.join(root, "fosuDirectClient")).createFosuDirectClient;
}

function createNodeTransport() {
  return {
    manualRedirect: true,
    request(spec) {
      return new Promise((resolve, reject) => {
        const url = new URL(spec.url);
        const lib = url.protocol === "http:" ? http : https;
        const headers = Object.assign({}, spec.header || {});
        const body = spec.data == null ? null : Buffer.from(String(spec.data));
        if (body) headers["Content-Length"] = String(body.length);
        const req = lib.request({
          protocol: url.protocol,
          hostname: url.hostname,
          path: `${url.pathname}${url.search}`,
          method: spec.method || "GET",
          headers,
          timeout: spec.timeout || 15000,
        }, (res) => {
          const chunks = [];
          res.on("data", (chunk) => chunks.push(chunk));
          res.on("end", () => {
            const data = Buffer.concat(chunks);
            resolve({
              statusCode: res.statusCode,
              header: res.headers,
              data: spec.responseType === "arraybuffer" ? data : data.toString("utf8"),
            });
          });
        });
        req.on("error", () => {
          const error = new Error("DIRECT_NETWORK_ERROR");
          error.code = "DIRECT_NETWORK_ERROR";
          reject(error);
        });
        req.on("timeout", () => req.destroy(new Error("timeout")));
        if (body) req.write(body);
        req.end();
      });
    },
  };
}

function brokerRequest(method, pathname, bodyObject) {
  const base = new URL(process.env.CAMPUS_AGENT_BROKER_URL);
  const body = bodyObject == null ? Buffer.alloc(0) : Buffer.from(JSON.stringify(bodyObject));
  const timestamp = String(Date.now());
  const nonce = crypto.randomBytes(16).toString("hex");
  const signature = signRequest(process.env.CAMPUS_AGENT_SIGNING_SECRET, {
    method,
    path: pathname,
    timestamp,
    nonce,
    body,
  });
  const lib = base.protocol === "http:" ? http : https;
  return new Promise((resolve, reject) => {
    const req = lib.request({
      protocol: base.protocol,
      hostname: base.hostname,
      port: base.port || undefined,
      path: pathname,
      method,
      headers: {
        Authorization: `Bearer ${process.env.CAMPUS_AGENT_TOKEN}`,
        "X-Campus-Agent-ID": process.env.CAMPUS_AGENT_ID || "wyz-campus-01",
        "X-Campus-Timestamp": timestamp,
        "X-Campus-Nonce": nonce,
        "X-Campus-Signature": signature,
        "Content-Type": "application/json",
        "Content-Length": String(body.length),
      },
      timeout: 30000,
    }, (res) => {
      const chunks = [];
      res.on("data", (chunk) => chunks.push(chunk));
      res.on("end", () => {
        const text = Buffer.concat(chunks).toString("utf8");
        let parsed = null;
        if (text) {
          try { parsed = JSON.parse(text); } catch (error) { parsed = null; }
        }
        resolve({ statusCode: res.statusCode, body: parsed });
      });
    });
    req.on("error", reject);
    if (body.length) req.write(body);
    req.end();
  });
}

function safeCode(error) {
  const code = error && error.code || "";
  if (code === "INVALID_CREDENTIALS" || code === "LOGIN_REJECTED") return "INVALID_CREDENTIALS";
  if (code === "INTERACTIVE_CHALLENGE_REQUIRED") return "INTERACTIVE_CHALLENGE_REQUIRED";
  if (/TIMEOUT/i.test(code)) return "TIMEOUT";
  return "AGENT_OFFLINE";
}

async function runClaimedJob(job) {
  const createFosuDirectClient = clientFactory();
  const client = createFosuDirectClient({ transport: createNodeTransport() });
  let password = job.password;
  try {
    const result = await client.readTimetable({
      studentId: job.studentId,
      password,
      semester: job.semester || "",
    });
    password = "";
    await brokerRequest("POST", `/api/campus-agent/v1/jobs/${job.jobId}/result`, {
      jobId: job.jobId,
      success: true,
      semester: job.semester || "",
      timetableBodyBase64: result.timetableBodyBase64,
      contentType: result.contentType || "text/html",
      profileHint: { studentIdMasked: result.profileHint && result.profileHint.studentIdMasked || "" },
    });
  } catch (error) {
    password = "";
    await brokerRequest("POST", `/api/campus-agent/v1/jobs/${job.jobId}/result`, {
      jobId: job.jobId,
      success: false,
      code: safeCode(error),
    });
  } finally {
    client.clearSecrets();
  }
}

async function loop() {
  await brokerRequest("POST", "/api/campus-agent/v1/heartbeat", {});
  const claimed = await brokerRequest("POST", "/api/campus-agent/v1/jobs/claim", {});
  if (claimed.statusCode === 204 || !claimed.body || !claimed.body.jobId) return;
  await runClaimedJob(claimed.body);
}

async function main() {
  if (process.env.CAMPUS_AGENT_ENABLED !== "true") return;
  if (!process.env.CAMPUS_AGENT_BROKER_URL || !process.env.CAMPUS_AGENT_TOKEN || !process.env.CAMPUS_AGENT_SIGNING_SECRET) {
    throw new Error("CAMPUS_AGENT_CONFIG_REQUIRED");
  }
  for (;;) {
    try {
      await loop();
    } catch (error) {
      await new Promise((resolve) => setTimeout(resolve, 3000));
    }
  }
}

if (require.main === module) {
  main().catch(() => process.exit(1));
}

module.exports = { brokerRequest, safeCode };
