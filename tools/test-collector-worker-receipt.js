"use strict";
const test = require("node:test"), assert = require("node:assert/strict"), fs = require("fs"), os = require("os"), path = require("path"), { spawnSync } = require("child_process");
const receipt = require("./wyz-schedule-collector/workerReceipt");
function fixture(fn) { const dir = fs.mkdtempSync(path.join(os.tmpdir(), "fosu-worker-receipt-")); try { fn(dir); } finally { fs.rmSync(dir, { recursive: true, force: true }); } }
test("import-time module failure retains typed receipt before main loads", () => fixture(dir => {
  const result = path.join(dir, "sync-result.json");
  const proc = spawnSync(process.execPath, ["--require", "./tools/wyz-schedule-collector/workerReceipt.js", "-e", "require('fixture-not-an-installed-module')"], { cwd: path.resolve(__dirname, ".."), env: { ...process.env, FOSU_COLLECTOR_MODE: "1", FOSU_COLLECTOR_RESULT_FILE: result }, encoding: "utf8" });
  assert.equal(proc.status, 1);
  const saved = JSON.parse(fs.readFileSync(result));
  assert.equal(saved.code, "COLLECTOR_WORKER_MODULE_MISSING");
  assert.equal(saved.failurePhase, "bootstrap");
  assert.equal(saved.success, false);
  assert.equal(JSON.stringify(saved).includes("fixture-not-an-installed-module"), false);
}));
test("uncaught filesystem failure is typed and private", () => fixture(dir => {
  const result = path.join(dir, "sync-result.json");
  const proc = spawnSync(process.execPath, ["--require", "./tools/wyz-schedule-collector/workerReceipt.js", "-e", "throw Object.assign(new Error('fixture-private-details'),{code:'EROFS'})"], { env: { ...process.env, FOSU_COLLECTOR_MODE: "1", FOSU_COLLECTOR_RESULT_FILE: result }, encoding: "utf8" });
  assert.equal(proc.status, 1);
  const saved = fs.readFileSync(result, "utf8");
  assert.equal(JSON.parse(saved).code, "COLLECTOR_WORKER_EROFS");
  assert.equal(saved.includes("fixture-private-details"), false);
}));
test("exit without receipt is explicit and does not invent request counts", () => fixture(dir => {
  const result = path.join(dir, "sync-result.json");
  spawnSync(process.execPath, ["--require", "./tools/wyz-schedule-collector/workerReceipt.js", "-e", "process.exit(3)"], { env: { ...process.env, FOSU_COLLECTOR_MODE: "1", FOSU_COLLECTOR_RESULT_FILE: result } });
  const saved = JSON.parse(fs.readFileSync(result));
  assert.equal(saved.code, "COLLECTOR_WORKER_RESULT_MISSING"); assert.equal(saved.workerExitCode, 3);
  assert.equal(Object.hasOwn(saved, "schoolRequestCount"), false);
}));
test("an explicit earlier failure receipt survives process exit", () => fixture(dir => {
  const result = path.join(dir, "sync-result.json");
  const content = '{"success":false,"code":"SESSION_EXPIRED"}';
  fs.writeFileSync(result, content);
  spawnSync(process.execPath, ["--require", "./tools/wyz-schedule-collector/workerReceipt.js", "-e", "process.exit(2)"], { env: { ...process.env, FOSU_COLLECTOR_MODE: "1", FOSU_COLLECTOR_RESULT_FILE: result } });
  assert.equal(fs.readFileSync(result, "utf8"), content);
}));
test("timeouts classified by phase and unsafe codes discarded", () => {
  assert.equal(receipt.normalizeCode({ name: "TimeoutError" }, "session-check"), "SCHOOL_NETWORK_TIMEOUT");
  assert.equal(receipt.normalizeCode({ name: "TimeoutError" }, "browser-launch"), "COLLECTOR_WORKER_TIMEOUT");
  assert.equal(receipt.normalizeCode({ code: "fixture-private-value" }), "COLLECTOR_WORKER_UNTYPED_FAILURE");
});
test("a successful worker has a terminal local status", () => fixture(dir => {
  const result = path.join(dir, "sync-result.json");
  const proc = spawnSync(process.execPath, ["--require", "./tools/wyz-schedule-collector/workerReceipt.js", "-e", "require('fs').writeFileSync(process.env.FOSU_COLLECTOR_RESULT_FILE,JSON.stringify({success:true}))"], { env: { ...process.env, FOSU_COLLECTOR_MODE: "1", FOSU_COLLECTOR_RESULT_FILE: result } });
  assert.equal(proc.status, 0);
  assert.equal(JSON.parse(fs.readFileSync(path.join(dir, "worker-status.json"))).status, "COMPLETED");
}));
test("normal Windows/manual flow does not create Collector receipts", () => fixture(dir => {
  const result = path.join(dir, "sync-result.json");
  spawnSync(process.execPath, ["--require", "./tools/wyz-schedule-collector/workerReceipt.js", "-e", "process.exit(3)"], { env: { ...process.env, FOSU_COLLECTOR_MODE: "0", FOSU_COLLECTOR_RESULT_FILE: result } });
  assert.equal(fs.existsSync(result), false);
}));

test("plain browser session-check failure retains a safe specific reason and source site", () => fixture(dir => {
  const result = path.join(dir, "sync-result.json");
  const error = new Error("page.content: Unable to retrieve content because the page is navigating and changing the content. fixture-private-cookie=SECRET");
  error.stack = "Error: fixture-private-details\n    at checkSession (/private/release/tools/fosu-sync-client/sync.js:3902:30)";
  receipt.setPhase("session-check", { FOSU_COLLECTOR_MODE: "1" });
  receipt.failureReceipt(error, 1, { FOSU_COLLECTOR_RESULT_FILE: result });
  const saved = JSON.parse(fs.readFileSync(result));
  assert.equal(saved.code, "SCHOOL_SESSION_PAGE_UNSTABLE");
  assert.deepEqual(saved.diagnostic, { exceptionType: "Error", browserFailure: "PAGE_NAVIGATION_IN_PROGRESS", sourceSite: { module: "sync", line: 3902, column: 30 } });
  const text = JSON.stringify(saved);
  for (const secret of ["SECRET", "private-details", "/private/release", "page.content:"]) assert.equal(text.includes(secret), false);
  assert.equal(Object.hasOwn(saved, "schoolRequestCount"), false);
}));

test("transport and runtime errors keep finite safe classes, including TLS refusal", () => {
  for (const [message, expected] of [["page.goto: net::ERR_CONNECTION_RESET at https://private.invalid/?ticket=SECRET", "SCHOOL_CONNECTION_RESET"], ["net::ERR_CERT_AUTHORITY_INVALID", "SCHOOL_TLS_CERTIFICATE_REJECTED"], ["Target page, context or browser has been closed", "COLLECTOR_BROWSER_TARGET_CLOSED"]]) {
    const error = new Error(message);
    assert.equal(receipt.normalizeCode(error, "session-check"), expected);
    assert.equal(JSON.stringify(receipt.diagnostic(error)).includes("SECRET"), false);
  }
  assert.equal(receipt.normalizeCode(new ReferenceError("SECRET")), "COLLECTOR_WORKER_REFERENCE_ERROR");
  assert.equal(receipt.normalizeCode({ code: "CAMPUS_NETWORK_BLOCKED" }), "CAMPUS_NETWORK_BLOCKED");
  assert.deepEqual(receipt.diagnostic({ name: "SECRET", message: "SECRET", stack: "SECRET" }), { exceptionType: "UNKNOWN", browserFailure: null, sourceSite: null });
});
