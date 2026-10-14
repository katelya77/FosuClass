"use strict";
// Preload before sync.js so import-time failures also leave a private receipt.
// Exception messages, stderr, stacks, URLs and Session contents are never saved.
const fs = require("fs"), path = require("path");
const PHASES = new Set(["bootstrap", "term-config", "preflight", "campus-diagnosis", "browser-launch", "session-check", "directory-fetch", "schedule-fetch", "resource-build", "validate"]);
let phase = "bootstrap";
const EXCEPTIONS = new Set(["Error", "TimeoutError", "TypeError", "ReferenceError", "SyntaxError", "RangeError", "URIError", "EvalError"]);
const TRANSPORT = new Map([
  ["ERR_CONNECTION_RESET", "SCHOOL_CONNECTION_RESET"], ["ERR_CONNECTION_CLOSED", "SCHOOL_CONNECTION_CLOSED"],
  ["ERR_CONNECTION_REFUSED", "SCHOOL_CONNECTION_REFUSED"], ["ERR_CONNECTION_TIMED_OUT", "SCHOOL_NETWORK_TIMEOUT"],
  ["ERR_TIMED_OUT", "SCHOOL_NETWORK_TIMEOUT"], ["ERR_NAME_NOT_RESOLVED", "SCHOOL_DNS_FAILED"],
  ["ERR_ADDRESS_UNREACHABLE", "SCHOOL_NETWORK_UNREACHABLE"], ["ERR_NETWORK_CHANGED", "SCHOOL_NETWORK_CHANGED"],
  ["ERR_CERT_AUTHORITY_INVALID", "SCHOOL_TLS_CERTIFICATE_REJECTED"], ["ERR_CERT_DATE_INVALID", "SCHOOL_TLS_CERTIFICATE_REJECTED"],
  ["ERR_CERT_COMMON_NAME_INVALID", "SCHOOL_TLS_CERTIFICATE_REJECTED"], ["ERR_SSL_PROTOCOL_ERROR", "SCHOOL_TLS_HANDSHAKE_FAILED"],
  ["ERR_ABORTED", "SCHOOL_BROWSER_REQUEST_ABORTED"], ["ERR_FAILED", "SCHOOL_BROWSER_REQUEST_FAILED"],
]);
function diagnostic(error) {
  // Inspect bounded strings locally; never retain an exception message or stack.
  const name = error && error.name, message = typeof error?.message === "string" ? error.message.slice(0, 8192) : "";
  let browserFailure = null;
  if (message.includes("Unable to retrieve content because the page is navigating and changing the content")) browserFailure = "PAGE_NAVIGATION_IN_PROGRESS";
  else if (message.includes("Target page, context or browser has been closed") || message.includes("Target closed")) browserFailure = "TARGET_CLOSED";
  else { const found = message.match(/\bnet::(ERR_[A-Z_]+)\b/); if (found && TRANSPORT.has(found[1])) browserFailure = found[1]; }
  const stack = typeof error?.stack === "string" ? error.stack.slice(0, 16384) : "";
  // Only a static module identifier and numeric source position may leave here.
  const site = stack.match(/(?:^|[\s(])[^\r\n]*[\\/]tools[\\/](fosu-sync-client[\\/]sync\.js|wyz-schedule-collector[\\/]workerReceipt\.js):(\d{1,7}):(\d{1,5})(?:\)|\s|$)/m);
  return { exceptionType: EXCEPTIONS.has(name) ? name : "UNKNOWN", browserFailure,
    sourceSite: site ? { module: site[1].startsWith("fosu-sync-client") ? "sync" : "worker-receipt", line: Number(site[2]), column: Number(site[3]) } : null };
}
function normalizeCode(error, current = phase) {
  const code = error && error.code;
  if (["MODULE_NOT_FOUND", "ERR_MODULE_NOT_FOUND"].includes(code)) return "COLLECTOR_WORKER_MODULE_MISSING";
  if (["EROFS", "EACCES", "EPERM", "ENOSPC"].includes(code)) return "COLLECTOR_WORKER_" + code;
  if (error && error.name === "TimeoutError") return ["session-check", "directory-fetch", "schedule-fetch"].includes(current) ? "SCHOOL_NETWORK_TIMEOUT" : "COLLECTOR_WORKER_TIMEOUT";
  if (/^(?:SCHOOL|SESSION|COLLECTOR|SYNC|PLAYWRIGHT|BROWSER|DIRECT|TERM|RUN|SAMPLE|CHECKPOINT|ORACLE|CAMPUS)_[A-Z0-9_]{1,60}$/.test(code || "") || code === "INVALID_CREDENTIALS") return code;
  const detail = diagnostic(error);
  if (detail.browserFailure === "PAGE_NAVIGATION_IN_PROGRESS") return "SCHOOL_SESSION_PAGE_UNSTABLE";
  if (detail.browserFailure === "TARGET_CLOSED") return "COLLECTOR_BROWSER_TARGET_CLOSED";
  if (TRANSPORT.has(detail.browserFailure)) return TRANSPORT.get(detail.browserFailure);
  if (["TypeError", "ReferenceError", "SyntaxError", "RangeError", "URIError", "EvalError"].includes(detail.exceptionType)) return "COLLECTOR_WORKER_" + detail.exceptionType.replace(/Error$/, "_ERROR").toUpperCase();
  return "COLLECTOR_WORKER_UNTYPED_FAILURE";
}
function durable(file, value) {
  if (!path.isAbsolute(file) || fs.existsSync(file) && !fs.lstatSync(file).isFile()) throw new Error("COLLECTOR_RECEIPT_PATH_REJECTED");
  const tmp = file + "." + process.pid + ".next";
  const fd = fs.openSync(tmp, "wx", 0o600);
  try { fs.writeFileSync(fd, JSON.stringify(value)); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
  try { fs.renameSync(tmp, file); } catch (error) { fs.unlinkSync(tmp); throw error; }
  if (process.platform !== "win32") { const dir = fs.openSync(path.dirname(file), "r"); try { fs.fsyncSync(dir); } finally { fs.closeSync(dir); } }
}
function files(env) {
  const result = env.FOSU_COLLECTOR_RESULT_FILE;
  return result && path.isAbsolute(result) ? { result, status: path.join(path.dirname(result), "worker-status.json") } : null;
}
function setPhase(value, env = process.env) {
  if (env.FOSU_COLLECTOR_MODE !== "1" || !PHASES.has(value)) return;
  phase = value;
  const f = files(env);
  if (f) durable(f.status, { schema: "collector-worker-status.v1", status: "RUNNING", failurePhase: phase });
}
function getPhase() { return phase; }
function failureReceipt(error, exitCode, env = process.env) {
  const f = files(env);
  if (!f) return;
  const code = error ? normalizeCode(error) : "COLLECTOR_WORKER_RESULT_MISSING";
  const receipt = { success: false, code, failurePhase: phase, workerExitCode: Number.isInteger(exitCode) ? exitCode : 1, ...(error ? { diagnostic: diagnostic(error) } : {}) };
  if (!fs.existsSync(f.result)) durable(f.result, receipt);
  durable(f.status, { schema: "collector-worker-status.v1", status: "FAILED", ...receipt });
}
function install(env = process.env, proc = process) {
  if (env.FOSU_COLLECTOR_MODE !== "1" || !files(env)) return;
  setPhase("bootstrap", env);
  proc.once("uncaughtExceptionMonitor", error => { try { failureReceipt(error, 1, env); } catch (_) { /* The parent detects a missing receipt. */ } });
  proc.once("exit", code => {
    try {
      const f = files(env);
      if (code !== 0 && !fs.existsSync(f.result)) { failureReceipt(null, code, env); return; }
      if (!fs.existsSync(f.result) || !fs.lstatSync(f.result).isFile() || fs.statSync(f.result).size > 65536) return;
      const result = JSON.parse(fs.readFileSync(f.result, "utf8"));
      if (code === 0 && result.success === true) durable(f.status, { schema: "collector-worker-status.v1", status: "COMPLETED", success: true, workerExitCode: code });
      else if (result.success === false) durable(f.status, { schema: "collector-worker-status.v1", status: "FAILED", success: false, code: normalizeCode(result), failurePhase: phase, workerExitCode: code });
    } catch (_) { /* The parent retains the numeric exit. */ }
  });
}
module.exports = { diagnostic, durable, failureReceipt, getPhase, install, normalizeCode, setPhase };
if (process.execArgv.some(arg => arg.endsWith("/workerReceipt.js"))) install();
