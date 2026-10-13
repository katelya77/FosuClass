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
