"use strict";
const test = require("node:test"), assert = require("node:assert/strict"), fs = require("fs"), os = require("os"), path = require("path");
const { open } = require("./wyz-schedule-collector/requestLedger");
const scope = () => ({ runId: "sc-ledger-fixture", term: "2026-2027-1", workerSourceHash: "a".repeat(64), requestBudget: 2, expiresAt: new Date(Date.now() + 60000).toISOString() });
function fixture(fn) { const dir = fs.mkdtempSync(path.join(os.tmpdir(), "fosu-ledger-")); try { fn(path.join(dir, "ledger.json")); } finally { fs.rmSync(dir, { recursive: true, force: true }); } }
test("reservation is durable before release; an ambiguous request cannot replay", () => fixture(file => {
  const s = scope(), ledger = open(file, s);
  const ordinal = ledger.reserve("POST", "xhr");
  const saved = JSON.parse(fs.readFileSync(file));
  assert.equal(saved.reserved, 1); assert.equal(saved.pending.ordinal, ordinal);
  assert.throws(() => open(file, s), /OUTCOME_UNKNOWN/);
  assert.throws(() => ledger.reserve("GET", "fetch"), /OUTCOME_UNKNOWN/);
}));
test("completed responses resume with remaining budget rather than resetting", () => fixture(file => {
  const s = scope(); let ledger = open(file, s);
  ledger.complete(ledger.reserve("POST", "xhr"), 200);
  ledger = open(file, s);
  assert.equal(ledger.snapshot().remaining, 1);
  ledger.complete(ledger.reserve("GET", "fetch"), 200);
  assert.throws(() => ledger.reserve("POST", "xhr"), /BUDGET_EXCEEDED/);
  assert.equal(open(file, s).snapshot().remaining, 0);
}));
test("term, source and approval changes cannot reuse a checkpoint", () => fixture(file => {
  const s = scope(); open(file, s);
  for (const change of [{ term: "2025-2026-2" }, { workerSourceHash: "b".repeat(64) }, { runId: "sc-other-fixture" }, { requestBudget: 3 }]) assert.throws(() => open(file, { ...s, ...change }), /CHECKPOINT_INVALID/);
}));
test("deadline stops requests, including after a wait", () => fixture(file => {
  let now = Date.now(); const s = { ...scope(), expiresAt: new Date(now + 100).toISOString() };
  const ledger = open(file, s, () => now);
  now += 101;
  assert.throws(() => ledger.reserve("POST", "xhr"), /APPROVAL_EXPIRED/);
  assert.equal(JSON.parse(fs.readFileSync(file)).reserved, 0);
}));
test("authentication and rate responses persist the stop; no automatic retry", () => {
  for (const status of [401, 403, 429]) fixture(file => {
    const s = scope(), ledger = open(file, s);
    assert.throws(() => ledger.complete(ledger.reserve("POST", "xhr"), status), status === 429 ? /RATE_LIMITED/ : /SESSION_EXPIRED/);
    assert.throws(() => open(file, s), /STOPPED_FOR_REVIEW/);
    assert.equal(JSON.parse(fs.readFileSync(file)).failed, 1);
  });
});
test("receipts are ordered and contain neither URLs nor raw resource values", () => fixture(file => {
  const ledger = open(file, scope());
  const ordinal = ledger.reserve("GET", "fixture-private-resource-value");
  assert.equal(fs.readFileSync(file, "utf8").includes("fixture-private-resource-value"), false);
  assert.throws(() => ledger.complete(ordinal + 1, 200), /RECEIPT_REJECTED/);
  assert.throws(() => ledger.complete(ordinal, 0), /RECEIPT_REJECTED/);
  assert.equal(ledger.snapshot().pending, true);
}));
test("corrupted counters fail closed", () => fixture(file => {
  const s = scope(); open(file, s);
  const saved = JSON.parse(fs.readFileSync(file)); saved.completed = 100;
  fs.writeFileSync(file, JSON.stringify(saved));
  assert.throws(() => open(file, s), /CHECKPOINT_INVALID/);
}));
test("mutating caller options cannot enlarge the approved budget", () => fixture(file => {
  const s = { ...scope(), requestBudget: 1 }, ledger = open(file, s);
  s.requestBudget = 120;
  ledger.complete(ledger.reserve("POST", "xhr"), 200);
  assert.equal(ledger.snapshot().remaining, 0);
  assert.throws(() => ledger.reserve("POST", "xhr"), /BUDGET_EXCEEDED/);
}));
