const http = require("http");
const https = require("https");
const crypto = require("crypto");
const path = require("path");
const { URL } = require("url");
const { signRequest } = require("./signature");

const DEFAULT_POLL_MS = 3000;
const DEFAULT_HEARTBEAT_MS = 30000;
const HEARTBEAT_PATH = "/api/campus-agent/v1/heartbeat";
const CLAIM_PATH = "/api/campus-agent/v1/jobs/claim";

function clientFactory() {
  const root = process.env.FOSU_DIRECT_CLIENT_DIR || path.join(__dirname, "..", "vendor");
  return require(path.join(root, "fosuDirectClient")).createFosuDirectClient;
}

function loadIconv() {
  try { return require("iconv-lite"); } catch (error) {}
  try { return require(path.join(__dirname, "..", "vendor", "iconv-lite")); } catch (error) {}
  return null;
}

function decodeSchoolHtml(data, contentType) {
  const root = process.env.FOSU_DIRECT_CLIENT_DIR || path.join(__dirname, "..", "vendor");
  const decoder = require(path.join(root, "schoolHtmlCharset")).decodeSchoolHtml;
  return decoder(data, contentType, loadIconv());
}

function loadSchoolUserAgent() {
  const root = process.env.FOSU_DIRECT_CLIENT_DIR || path.join(__dirname, "..", "vendor");
  try {
    return require(path.join(root, "fosuDirectConfig")).SCHOOL_MOBILE_USER_AGENT;
  } catch (error) {
    return require(path.join(__dirname, "..", "..", "..", "miniprogram", "services", "fosuDirectConfig")).SCHOOL_MOBILE_USER_AGENT;
  }
}

function trustedSchoolHeaders(input) {
  const headers = {};
  const source = input && typeof input === "object" ? input : {};
  Object.keys(source).forEach((key) => {
    if (/^user-agent$/i.test(key)) return;
    headers[key] = source[key];
  });
  headers["User-Agent"] = loadSchoolUserAgent();
  return headers;
}

function createNodeTransport(deps) {
  const requestFor = deps && deps.requestFor ? deps.requestFor : (protocol) => (protocol === "http:" ? http : https);
  return {
    manualRedirect: true,
    request(spec) {
      return new Promise((resolve, reject) => {
        const url = new URL(spec.url);
        const lib = requestFor(url.protocol);
        const headers = trustedSchoolHeaders(spec.header);
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

function intervalMs(value, fallback) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 1000) return fallback;
  return Math.floor(parsed);
}

function parseRetryAfter(value) {
  if (value == null || value === "") return 0;
  const seconds = Number(value);
  if (Number.isFinite(seconds)) return Math.max(0, Math.floor(seconds * 1000));
  const when = Date.parse(String(value));
  if (Number.isNaN(when)) return 0;
  return Math.max(0, when - Date.now());
}

function retryDelay(statusCode, retryAfter) {
  if (statusCode === 429) return Math.max(10000, parseRetryAfter(retryAfter));
  if (statusCode === 404 || statusCode === 403) return 10000;
  return 3000;
}

function brokerFailure(statusCode, retryAfter) {
  const error = new Error("BROKER_STATUS");
  error.statusCode = statusCode || 0;
  error.delayMs = retryDelay(error.statusCode, retryAfter);
  return error;
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
        resolve({
          statusCode: res.statusCode,
          body: parsed,
          retryAfter: res.headers["retry-after"] || "",
        });
      });
    });
    req.on("error", reject);
    req.on("timeout", () => req.destroy(new Error("timeout")));
    if (body.length) req.write(body);
    req.end();
  });
}

function safeCode(error) {
  const code = error && error.code || "";
  if (code === "INVALID_CREDENTIALS" || code === "LOGIN_REJECTED") return "INVALID_CREDENTIALS";
  if (code === "INTERACTIVE_CHALLENGE_REQUIRED") return "INTERACTIVE_CHALLENGE_REQUIRED";
  if (code === "PROFILE_ID_MISMATCH") return "PROFILE_ID_MISMATCH";
  if (code === "STRUCTURE_CHANGED" || code === "AUTH_PAGE_CHANGED" || code === "LOGIN_PAGE_CHANGED") return "STRUCTURE_CHANGED";
  if (code === "EMPTY_PERSONAL_SCHEDULE" || code === "SCHEDULE_ROWS_EMPTY" || code === "SCHEDULE_EMPTY") return "EMPTY_PERSONAL_SCHEDULE";
  if (code === "SCHOOL_UNAVAILABLE" || code === "DIRECT_NETWORK_ERROR" || code === "SCHEDULE_PAGE_UNREACHABLE") return "SCHOOL_UNAVAILABLE";
  if (/TIMEOUT/i.test(code)) return "TIMEOUT";
  if (code === "AGENT_OFFLINE") return "AGENT_OFFLINE";
  return "AGENT_OFFLINE";
}

function defaultLog(entry) {
  const hidden = /token|secret|password|authorization|signature|cookie|ticket|studentid/i;
  const banned = [process.env.CAMPUS_AGENT_TOKEN, process.env.CAMPUS_AGENT_SIGNING_SECRET].filter(Boolean);
  const out = {};
  Object.entries(entry || {}).forEach(([key, value]) => {
    if (hidden.test(key)) return;
    if (typeof value === "string" && (hidden.test(value) || banned.some((item) => item && value.includes(item)))) return;
    out[key] = value;
  });
  console.log(JSON.stringify(out));
}

function shortId(value) {
  return String(value || "").slice(0, 8);
}

function publicStage(progress) {
  if (progress === "timetable-fetch" || progress === "profile-fetch" || progress === "semester-switch") return "reading";
  if (progress === "cas-bootstrap" || progress === "auth-page" || progress === "login-post" || progress === "cas-callback" || progress === "xs-main") return "verifying";
  return "";
}

function publicAuthMode(value) {
  return value === "mobile" || value === "cas" || value === "authenticated-session" ? value : "";
}

function resultTimings(result) {
  const source = result && result.stageTimings || {};
  const out = {};
  ["schoolLoginMs", "scheduleFetchMs", "profileFetchMs", "normalizeMs"].forEach((key) => {
    const value = Number(source[key]);
    if (Number.isFinite(value) && value >= 0 && value < 600000) out[key] = Math.round(value);
  });
  return out;
}

async function runClaimedJob(job, request, log) {
  const createFosuDirectClient = clientFactory();
  let lastStage = "";
  const client = createFosuDirectClient({
    transport: createNodeTransport(),
    decodeSchoolHtml,
    onProgress: (progress) => {
      const stage = publicStage(progress);
      if (!stage || stage === lastStage) return;
      lastStage = stage;
      Promise.resolve(request("POST", `/api/campus-agent/v1/jobs/${job.jobId}/stage`, { stage })).catch(() => {});
    },
  });
  let password = job.password;
  const jobId = shortId(job.jobId);
  try {
    const result = await client.readTimetable({
      studentId: job.studentId,
      password,
      semester: job.semester || "",
    });
    password = "";
    const hint = result.profileHint || {};
    const profileStatus = ["ok", "partial", "unavailable"].indexOf(hint.profileStatus) >= 0 ? hint.profileStatus : "unavailable";
    log({ event: "profile-fetched", status: profileStatus });
    const successBody = {
      jobId: job.jobId,
      success: true,
      semester: job.semester || "",
      timetableBodyBase64: result.timetableBodyBase64,
      contentType: result.contentType || "text/html",
      profileHint: {
        studentName: hint.studentName || "",
        className: hint.className || "",
        studentIdMasked: hint.studentIdMasked || "",
        studentIdMatched: hint.studentIdMatched === true,
        source: hint.source || "",
        profileStatus,
      },
      stageTimings: resultTimings(result),
    };
    const successMode = publicAuthMode(result && result.authMode);
    if (successMode) successBody.authMode = successMode;
    const posted = await request("POST", `/api/campus-agent/v1/jobs/${job.jobId}/result`, successBody);
    if (!posted || posted.statusCode < 200 || posted.statusCode >= 300) {
      throw brokerFailure(posted && posted.statusCode, posted && posted.retryAfter);
    }
    log({ event: "job-finished", jobId, code: "OK", status: posted.statusCode });
  } catch (error) {
    password = "";
    if (error && error.delayMs) throw error;
    const code = safeCode(error);
    if (code === "PROFILE_ID_MISMATCH") log({ event: "profile-fetched", status: "id_mismatch" });
    const failureBody = {
      jobId: job.jobId,
      success: false,
      code,
      stageTimings: resultTimings(error),
    };
    const failureMode = publicAuthMode(error && error.authMode);
    if (failureMode) failureBody.authMode = failureMode;
    const posted = await request("POST", `/api/campus-agent/v1/jobs/${job.jobId}/result`, failureBody);
    log({ event: "job-finished", jobId, code, status: posted && posted.statusCode || 0 });
    if (!posted || posted.statusCode < 200 || posted.statusCode >= 300) {
      throw brokerFailure(posted && posted.statusCode, posted && posted.retryAfter);
    }
  } finally {
    password = "";
    client.clearSecrets();
  }
}

function createRunControl() {
  let stopped = false;
  let wake = null;
  return {
    stop() {
      stopped = true;
      if (wake) wake();
    },
    stopped() {
      return stopped;
    },
    sleep(ms) {
      if (stopped) return Promise.resolve();
      return new Promise((resolve) => {
        const timer = setTimeout(finish, ms);
        wake = () => {
          clearTimeout(timer);
          finish();
        };
        function finish() {
          wake = null;
          resolve();
        }
      });
    },
  };
}

async function runAgentLoop(options) {
  const pollMs = intervalMs(options.pollMs, DEFAULT_POLL_MS);
  const heartbeatMs = intervalMs(options.heartbeatMs, DEFAULT_HEARTBEAT_MS);
  const request = options.brokerRequest;
  const sleep = options.sleep;
  const now = options.now || (() => Date.now());
  const log = options.log || defaultLog;
  const shouldStop = options.shouldStop || (() => false);
  const runJob = options.runJob;
  let lastHeartbeatAt = null;

  log({
    event: "agent-started",
    brokerHost: options.brokerHost || "",
    agentId: options.agentId || "",
    pollMs,
    heartbeatMs,
  });

  while (!shouldStop()) {
    let delay = pollMs;
    try {
      const clock = now();
      if (lastHeartbeatAt == null || clock - lastHeartbeatAt >= heartbeatMs) {
        const heartbeat = await request("POST", HEARTBEAT_PATH, {});
        if (!heartbeat || heartbeat.statusCode < 200 || heartbeat.statusCode >= 300) {
          throw brokerFailure(heartbeat && heartbeat.statusCode, heartbeat && heartbeat.retryAfter);
        }
        lastHeartbeatAt = now();
        log({ event: "heartbeat", status: heartbeat.statusCode });
      }
      if (shouldStop()) break;
      const claimed = await request("POST", CLAIM_PATH, {});
      if (claimed && claimed.statusCode === 204) {
        // Idle. Do not log every empty claim.
      } else if (claimed && claimed.statusCode === 200 && claimed.body && claimed.body.jobId) {
        log({ event: "job-claimed", jobId: shortId(claimed.body.jobId) });
        await runJob(claimed.body);
      } else {
        throw brokerFailure(claimed && claimed.statusCode, claimed && claimed.retryAfter);
      }
    } catch (error) {
      delay = error && error.delayMs ? error.delayMs : 3000;
      const status = error && error.statusCode || 0;
      const event = status === 429 ? "broker-rate-limited" : (status === 404 || status === 403 ? "broker-auth-failed" : "broker-failed");
      log({ event, status, retryMs: delay });
    }
    if (shouldStop()) break;
    await sleep(delay);
  }
  log({ event: "agent-stopped" });
}

async function main() {
  if (process.env.CAMPUS_AGENT_ENABLED !== "true") return;
  if (!process.env.CAMPUS_AGENT_BROKER_URL || !process.env.CAMPUS_AGENT_TOKEN || !process.env.CAMPUS_AGENT_SIGNING_SECRET) {
    throw new Error("CAMPUS_AGENT_CONFIG_REQUIRED");
  }
  const broker = new URL(process.env.CAMPUS_AGENT_BROKER_URL);
  const control = createRunControl();
  process.on("SIGTERM", () => control.stop());
  process.on("SIGINT", () => control.stop());
  await runAgentLoop({
    brokerRequest,
    sleep: (ms) => control.sleep(ms),
    shouldStop: () => control.stopped(),
    pollMs: process.env.CAMPUS_AGENT_POLL_INTERVAL_MS,
    heartbeatMs: process.env.CAMPUS_AGENT_HEARTBEAT_INTERVAL_MS,
    brokerHost: broker.host,
    agentId: process.env.CAMPUS_AGENT_ID || "wyz-campus-01",
    runJob: (job) => runClaimedJob(job, brokerRequest, defaultLog),
  });
}

if (require.main === module) {
  main().catch(() => process.exit(1));
}

module.exports = {
  brokerRequest,
  createRunControl,
  intervalMs,
  retryDelay,
  runAgentLoop,
  safeCode,
  publicStage,
  resultTimings,
  createNodeTransport,
  trustedSchoolHeaders,
  publicAuthMode,
  DEFAULT_POLL_MS,
  DEFAULT_HEARTBEAT_MS,
};
