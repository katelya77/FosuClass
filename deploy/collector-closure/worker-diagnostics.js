"use strict";
// Read only typed worker receipts. Never retain raw stderr, URLs or credential data.
const fs = require("node:fs"), path = require("node:path"), crypto = require("node:crypto");
const PHASES = new Set(["bootstrap", "term-config", "preflight", "campus-diagnosis", "browser-launch", "session-check", "directory-fetch", "schedule-fetch", "resource-build", "validate"]);
const code = value => /^(?:SCHOOL|SESSION|COLLECTOR|SYNC|PLAYWRIGHT|BROWSER|DIRECT|TERM|RUN|SAMPLE|CHECKPOINT|ORACLE)_[A-Z0-9_]{1,60}$/.test(value || "") || value === "INVALID_CREDENTIALS" ? value : null;
const sha = value => crypto.createHash("sha256").update(JSON.stringify(value)).digest("hex");
function safeJson(file, root) {
  if (!fs.existsSync(file)) return { exists: false, data: null };
  let cursor = file;
  while (cursor !== path.dirname(root)) {
    const s = fs.lstatSync(cursor);
    if (s.isSymbolicLink() || (process.platform !== "win32" && (s.uid !== 0 || (cursor === file || cursor === root ? s.mode & 0o077 : s.mode & 0o022))) || cursor === file && (!s.isFile() || s.nlink !== 1 || s.size > 65536)) return { exists: true, data: null, invalid: true };
    cursor = path.dirname(cursor);
  }
  try { return { exists: true, data: JSON.parse(fs.readFileSync(file, "utf8")) }; } catch { return { exists: true, data: null, invalid: true }; }
}
function read(root, approval, workerSourceHash) {
  const receipts = {};
  for (const name of ["worker-status.json", "worker-exit.json", "sync-result.json"]) receipts[name] = safeJson(path.join(root, name), root);
  const a = receipts["worker-status.json"].data, b = receipts["worker-exit.json"].data, c = receipts["sync-result.json"].data;
  const value = { workerReceipts: Object.fromEntries(Object.entries(receipts).map(([k, v]) => [k, v.invalid ? "INVALID" : v.exists ? "PRESENT" : "MISSING"])),
    failurePhase: PHASES.has(a?.failurePhase) ? a.failurePhase : PHASES.has(c?.failurePhase) ? c.failurePhase : "UNKNOWN",
    workerFailureCode: code(c?.code) || code(a?.code) || code(b?.code),
    workerExitCode: Number.isInteger(b?.workerExitCode) && b.workerExitCode >= 0 && b.workerExitCode <= 255 ? b.workerExitCode : null,
    workerSignal: ["SIGTERM", "SIGKILL", "SIGABRT", "SIGSEGV"].includes(b?.signal) ? b.signal : null,
    requestLedger: null, requestEvidence: "UNKNOWN", replayAllowed: false };
  const ledger = safeJson(path.join(root, "client/request-ledger.json"), root);
  if (!ledger.exists) return value;
  const l = ledger.data;
  if (ledger.invalid || l?.schema !== "collector-worker-request-ledger.v1" || l.scope?.runId !== approval.runId || l.scope.term !== approval.term || l.scope.workerSourceHash !== workerSourceHash || l.scope.requestBudget !== approval.requestBudget || l.scope.expiresAt !== (approval.oracleApprovalExpiresAt || approval.expiresAt) || l.scopeHash !== sha(l.scope) || ["reserved", "completed", "failed"].some(k => !Number.isSafeInteger(l[k]) || l[k] < 0) || l.reserved > approval.requestBudget || typeof l.stopped !== "boolean" || (l.pending === null ? l.completed + l.failed !== l.reserved : !l.pending || l.pending.ordinal !== l.reserved || l.completed + l.failed !== l.reserved - 1)) {
    value.requestEvidence = "INVALID"; return value;
  }
  value.requestLedger = { reserved: l.reserved, completed: l.completed, failed: l.failed, unknown: l.pending === null ? 0 : 1, remaining: approval.requestBudget - l.reserved, stoppedForReview: l.stopped };
  value.requestEvidence = l.pending === null ? "LEDGER_ACCOUNTED" : "REQUEST_OUTCOME_UNKNOWN";
  // Reservations do not prove requests reached school, or count login/probes.
  return value;
}
module.exports = { read, safeJson };
