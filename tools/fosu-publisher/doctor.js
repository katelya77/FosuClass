#!/usr/bin/env node

const fs = require("fs");
const os = require("os");
const path = require("path");
const axios = require("axios");
const { runProcess } = require("../shared/processRunner");
const {
  probeCampusNetwork,
} = require("../fosu-sync-client/networkProbe");
const {
  DIRECT_NO_PROXY_HOSTS,
  PROXY_ENV_NAMES,
  loadSyncClientEnv,
  prepareDirectNetworkEnvironment,
} = require("../fosu-sync-client/syncEnv");
const {
  SESSION_PATH,
  verifySession,
} = require("../fosu-sync-client/sessionVerifier");
const {
  inspectPublisherLock,
} = require("./publish");
const {
  getPublisherAdminToken,
} = require("./admin-token-utils");
const {
  verify: verifyAdminToken,
} = require("./verify-admin-token");

const PROJECT_ROOT = path.resolve(__dirname, "..", "..");

function check(level, name, message, extra = {}) {
  return Object.assign({ level, name, message }, extra);
}

function isBlocked(item) {
  return item.level === "BLOCKED";
}

function runVersion(name, command, args) {
  const result = runProcess(command, args, {
    cwd: PROJECT_ROOT,
    timeoutMs: 30000,
    tailChars: 1000,
  });
  return result.ok
    ? check("PASS", name, String(result.stdout || "").trim())
    : check("BLOCKED", name, result.stderrTail || result.error && result.error.message || `${command} failed`, {
        code: result.failureCode || result.error && result.error.code || `EXIT_${result.status}`,
      });
}

function projectWritable() {
  const runsRoot = path.join(PROJECT_ROOT, ".local", "publisher-runs");
  const probePath = path.join(runsRoot, `.doctor-${process.pid}-${Date.now()}.tmp`);
  try {
    fs.mkdirSync(runsRoot, { recursive: true });
    fs.writeFileSync(probePath, "ok", "utf8");
    fs.unlinkSync(probePath);
    return check("PASS", "project-write", ".local/publisher-runs writable");
  } catch (error) {
    return check("BLOCKED", "project-write", error.message);
  }
}

function diskSpace() {
  try {
    if (typeof fs.statfsSync !== "function") {
      return check("WARN", "disk-space", "statfs unavailable on this Node runtime");
    }
    const stat = fs.statfsSync(PROJECT_ROOT);
    const free = Number(stat.bavail || 0) * Number(stat.bsize || 0);
    const freeGb = free / 1024 / 1024 / 1024;
    return freeGb >= 2
      ? check("PASS", "disk-space", `${freeGb.toFixed(2)} GB free`)
      : check("BLOCKED", "disk-space", `${freeGb.toFixed(2)} GB free`);
  } catch (error) {
    return check("WARN", "disk-space", error.message);
  }
}

async function oracleHealth(env) {
  if (env.FOSU_PUBLISHER_MOCK === "1") return check("PASS", "oracle-health", "mock");
  const base = String(env.FOSU_API_BASE || "https://class.katelya.eu.org").replace(/\/+$/g, "");
  try {
    const response = await axios.get(`${base}/api/health`, {
      timeout: 15000,
      proxy: false,
      validateStatus: () => true,
    });
    return response.status >= 200 && response.status < 500
      ? check("PASS", "oracle-health", `HTTP ${response.status}`)
      : check("BLOCKED", "oracle-health", `HTTP ${response.status}`);
  } catch (error) {
    return check("BLOCKED", "oracle-health", error.message, { code: error.code || "ORACLE_HEALTH_FAILED" });
  }
}

function cloudbasePreflight(env) {
  if (env.FOSU_PUBLISHER_MOCK === "1") return check("PASS", "cloudbase-preflight", "mock");
  const result = runProcess(process.execPath, [path.join(PROJECT_ROOT, "tools", "cloudbase", "preflight.js")], {
    cwd: PROJECT_ROOT,
    timeoutMs: Number(env.FOSU_DOCTOR_CLOUDBASE_TIMEOUT_MS || 180000),
    tailChars: 2000,
  });
  return result.ok
    ? check("PASS", "cloudbase-preflight", "ok")
    : check("BLOCKED", "cloudbase-preflight", result.stderrTail || result.stdoutTail || "CloudBase preflight failed", {
        code: result.error && result.error.code || `EXIT_${result.status}`,
      });
}

async function buildDoctorReport(options = {}) {
  const env = options.env || process.env;
  loadSyncClientEnv({ env });
  const proxy = prepareDirectNetworkEnvironment(env, { axios });
  const checks = [];

  checks.push(runVersion("node", process.execPath, ["--version"]));
  checks.push(runVersion("npm", "npm", ["--version"]));

  const token = getPublisherAdminToken({ allowOracleAlias: false });
  checks.push(token.token
    ? check("PASS", "admin-api-token", `configured via ${token.source || "process"}`)
    : check("BLOCKED", "admin-api-token", "ADMIN_API_TOKEN missing"));

  if (token.token) {
    const tokenVerify = env.FOSU_PUBLISHER_MOCK === "1"
      ? { ok: true, status: 200 }
      : await verifyAdminToken({ timeoutMs: 15000 });
    checks.push(tokenVerify.ok
      ? check("PASS", "token-verify", `HTTP ${tokenVerify.status || 200}`)
      : check("BLOCKED", "token-verify", tokenVerify.message || tokenVerify.code || "token verify failed", { code: tokenVerify.code }));
  }

  const lock = inspectPublisherLock();
  checks.push(lock.locked && lock.isPublisherProcess && !lock.canUnlock
    ? check("BLOCKED", "publisher-lock", "已有同步正在运行", { runId: lock.runId, pid: lock.pid, currentStage: lock.currentStage })
    : check(lock.locked ? "WARN" : "PASS", "publisher-lock", lock.locked ? `可安全处理锁: ${lock.reason}` : "not locked", { runId: lock.runId || "", pid: lock.pid || "" }));

  checks.push(projectWritable());

  checks.push(proxy.detectedProxyNames.length
    ? check("WARN", "proxy-env", `detected: ${proxy.detectedProxyNames.join(", ")}; direct mode=${proxy.disableProxy}`)
    : check("PASS", "proxy-env", `not detected; NO_PROXY=${DIRECT_NO_PROXY_HOSTS.join(",")}`));

  const network = env.FOSU_PUBLISHER_MOCK === "1"
    ? { readiness: "ready", dns: { ok: true }, tcp: { ok: true }, warnings: [], blockers: [] }
    : await probeCampusNetwork({ env });
  checks.push(network.readiness === "blocked"
    ? check("BLOCKED", "campus-dns", (network.blockers || []).join("; ") || "blocked")
    : check(network.readiness === "ready-with-warning" ? "WARN" : "PASS", "campus-dns", network.dns && network.dns.addresses ? network.dns.addresses.join(", ") : network.readiness));
  checks.push(network.readiness === "blocked"
    ? check("BLOCKED", "campus-route", (network.blockers || []).join("; ") || "blocked")
    : check(network.readiness === "ready-with-warning" ? "WARN" : "PASS", "campus-route", network.warnings && network.warnings.join("; ") || network.readiness));

  let sessionFileOk = env.FOSU_PUBLISHER_MOCK === "1";
  if (!sessionFileOk) {
    try {
      const stat = fs.existsSync(SESSION_PATH) ? fs.statSync(SESSION_PATH) : null;
      sessionFileOk = Boolean(stat && stat.size >= 20);
    } catch (error) {
      sessionFileOk = false;
    }
  }
  checks.push(sessionFileOk
    ? check("PASS", "session-file", "present")
    : check("BLOCKED", "session-file", "missing; run npm run sync:login"));

  const session = env.FOSU_PUBLISHER_MOCK === "1"
    ? { ok: true, code: "SESSION_VALID" }
    : await verifySession({ headless: true }).catch((error) => ({ ok: false, code: error.code || "SESSION_EXPIRED", message: error.message }));
  checks.push(session.ok
    ? check("PASS", "playwright-session", "SESSION_VALID")
    : check("BLOCKED", "playwright-session", session.message || "请运行 npm run sync:login", { code: "SESSION_EXPIRED" }));

  checks.push(await oracleHealth(env));
  checks.push(cloudbasePreflight(env));
  checks.push(diskSpace());

  const blocked = checks.filter(isBlocked);
  const report = {
    checks,
    canStartPublisher: blocked.length === 0,
    proxy: {
      detectedProxyNames: proxy.detectedProxyNames,
      disabled: proxy.disableProxy,
    },
    networkReadiness: network.readiness,
    generatedAt: new Date().toISOString(),
  };
  return report;
}

function printReport(report) {
  report.checks.forEach((item) => {
    const details = [item.message, item.code ? `code=${item.code}` : ""].filter(Boolean).join(" ");
    console.log(`${item.level} ${item.name}: ${details}`);
  });
  console.log(`canStartPublisher=${report.canStartPublisher ? "true" : "false"}`);
}

async function main(argv = process.argv.slice(2)) {
  const json = argv.includes("--json");
  const report = await buildDoctorReport();
  if (json) console.log(JSON.stringify(report, null, 2));
  else printReport(report);
  return report.canStartPublisher ? 0 : 1;
}

if (require.main === module) {
  main().then((code) => {
    process.exitCode = code;
  }).catch((error) => {
    console.error(JSON.stringify({
      success: false,
      code: error.code || "PUBLISHER_DOCTOR_FAILED",
      message: error.message,
    }, null, 2));
    process.exitCode = 1;
  });
}

module.exports = {
  buildDoctorReport,
  main,
  printReport,
};
