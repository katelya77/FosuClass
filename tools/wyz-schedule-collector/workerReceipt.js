"use strict";
// Preload before sync.js so import-time failures also leave a private receipt.
// Exception messages, stderr, stacks, URLs and Session contents are never saved.
const fs = require("fs"), path = require("path");
const PHASES = new Set(["bootstrap", "term-config", "preflight", "campus-diagnosis", "browser-launch", "session-check", "directory-fetch", "schedule-fetch", "resource-build", "validate"]);
let phase = "bootstrap";
function normalizeCode(error, current = phase) {
  const code = error && error.code;
  if (["MODULE_NOT_FOUND", "ERR_MODULE_NOT_FOUND"].includes(code)) return "COLLECTOR_WORKER_MODULE_MISSING";
  if (["EROFS", "EACCES", "EPERM", "ENOSPC"].includes(code)) return "COLLECTOR_WORKER_" + code;
  if (error && error.name === "TimeoutError") return ["session-check", "directory-fetch", "schedule-fetch"].includes(current) ? "SCHOOL_NETWORK_TIMEOUT" : "COLLECTOR_WORKER_TIMEOUT";
  if (/^(?:SCHOOL|SESSION|COLLECTOR|SYNC|PLAYWRIGHT|BROWSER|DIRECT|TERM|RUN|SAMPLE|CHECKPOINT|ORACLE)_[A-Z0-9_]{1,60}$/.test(code || "") || code === "INVALID_CREDENTIALS") return code;
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
  const receipt = { success: false, code, failurePhase: phase, workerExitCode: Number.isInteger(exitCode) ? exitCode : 1 };
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
module.exports = { durable, failureReceipt, getPhase, install, normalizeCode, setPhase };
if (process.execArgv.some(arg => arg.endsWith("/workerReceipt.js"))) install();
