"use strict";
// Worker-local request reservations, independent of authentication budgets.
// A reserved request without a terminal response is never automatically replayed.
const fs = require("fs"), crypto = require("crypto");
const { durable } = require("./workerReceipt");
const fail = code => { throw Object.assign(new Error(code), { code }); };
function digest(value) { return crypto.createHash("sha256").update(JSON.stringify(value)).digest("hex"); }
function open(file, scope, now = Date.now) {
  if (!scope || !/^sc-[A-Za-z0-9-]{1,100}$/.test(scope.runId || "") || !/^\d{4}-\d{4}-[12]$/.test(scope.term || "") || !/^[a-f0-9]{64}$/.test(scope.workerSourceHash || "") || !Number.isSafeInteger(scope.requestBudget) || scope.requestBudget < 1 || scope.requestBudget > 120 || !Number.isFinite(Date.parse(scope.expiresAt || ""))) fail("COLLECTOR_REQUEST_SCOPE_REJECTED");
  const frozen = { runId: scope.runId, term: scope.term, workerSourceHash: scope.workerSourceHash, requestBudget: scope.requestBudget, expiresAt: scope.expiresAt };
  const scopeHash = digest(frozen);
  let state = { schema: "collector-worker-request-ledger.v1", scope: frozen, scopeHash, reserved: 0, completed: 0, failed: 0, pending: null, stopped: false };
  if (fs.existsSync(file)) {
    if (!fs.lstatSync(file).isFile() || fs.statSync(file).size > 65536) fail("COLLECTOR_REQUEST_CHECKPOINT_INVALID");
    try { state = JSON.parse(fs.readFileSync(file, "utf8")); } catch (_) { fail("COLLECTOR_REQUEST_CHECKPOINT_INVALID"); }
    if (state.schema !== "collector-worker-request-ledger.v1" || state.scopeHash !== scopeHash || digest(state.scope) !== scopeHash || ["reserved", "completed", "failed"].some(k => !Number.isSafeInteger(state[k]) || state[k] < 0) || state.reserved > scope.requestBudget || state.completed + state.failed > state.reserved || typeof state.stopped !== "boolean" || (state.pending === null ? state.completed + state.failed !== state.reserved : !state.pending || state.pending.ordinal !== state.reserved || state.completed + state.failed !== state.reserved - 1)) fail("COLLECTOR_REQUEST_CHECKPOINT_INVALID");
    if (state.pending !== null) fail("COLLECTOR_REQUEST_OUTCOME_UNKNOWN");
    if (state.stopped) fail("COLLECTOR_REQUEST_STOPPED_FOR_REVIEW");
  }
  function check() { if (now() >= Date.parse(frozen.expiresAt)) fail("SCHOOL_ACCESS_APPROVAL_EXPIRED"); }
  check();
  if (!fs.existsSync(file)) durable(file, state);
  return {
    snapshot: () => ({ reserved: state.reserved, completed: state.completed, failed: state.failed, pending: state.pending !== null, remaining: scope.requestBudget - state.reserved }),
    reserve(method, resourceType) {
      check();
      if (state.stopped) fail("COLLECTOR_REQUEST_STOPPED_FOR_REVIEW");
      if (state.pending !== null) fail("COLLECTOR_REQUEST_OUTCOME_UNKNOWN");
      if (state.reserved >= scope.requestBudget) fail("SCHOOL_REQUEST_BUDGET_EXCEEDED");
      if (!["GET", "POST", "HEAD"].includes(method)) fail("SCHOOL_REQUEST_METHOD_REJECTED");
      const ordinal = ++state.reserved;
      state.pending = { ordinal, method, resourceType: ["document", "xhr", "fetch", "script", "stylesheet", "image", "font", "other"].includes(resourceType) ? resourceType : "other" };
      durable(file, state); // Before route.continue: a crash consumes this budget.
      return ordinal;
    },
    complete(ordinal, httpStatus) {
      if (!state.pending || state.pending.ordinal !== ordinal || !Number.isInteger(httpStatus) || httpStatus < 100 || httpStatus > 599) fail("COLLECTOR_REQUEST_RECEIPT_REJECTED");
      httpStatus < 400 ? state.completed++ : state.failed++;
      state.pending = null;
      if ([401, 403, 429].includes(httpStatus)) state.stopped = true;
      durable(file, state);
      if ([401, 403].includes(httpStatus)) fail("SCHOOL_SESSION_EXPIRED");
      if (httpStatus === 429) fail("SCHOOL_RATE_LIMITED");
    },
  };
}
module.exports = { open };
