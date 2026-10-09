"use strict";
const assert = require("assert/strict"), fs = require("fs"), os = require("os"), path = require("path"), crypto = require("crypto");
const { prepare, values } = require("../server/scripts/prepare-full-sync-env");
const root = fs.mkdtempSync(path.join(os.tmpdir(), "full-sync-env-test-"));
try {
  const target = path.join(root, "incoming.env"), previous = path.join(root, "previous.env");
  const personal = crypto.randomBytes(32).toString("hex");
  fs.writeFileSync(target, "CAMPUS_AGENT_TOKEN=" + personal + "\n", { mode: 0o600 });
  const first = prepare(target);
  const original = values(fs.readFileSync(target, "utf8"));
  assert.equal(first.created, true); assert.equal(original.FULL_SYNC_AGENT_TOKEN.length, 64); assert.equal(original.FULL_SYNC_SIGNING_SECRET.length, 64);
  assert.notEqual(original.FULL_SYNC_AGENT_TOKEN, original.FULL_SYNC_SIGNING_SECRET); assert.notEqual(original.FULL_SYNC_AGENT_TOKEN, personal);
  assert.equal(original.CAMPUS_AGENT_TOKEN, personal);
  fs.copyFileSync(target, previous);
  fs.writeFileSync(target, "CAMPUS_AGENT_TOKEN=" + personal + "\n");
  assert.equal(prepare(target, previous).created, false);
  const restored = values(fs.readFileSync(target, "utf8"));
  assert.equal(restored.FULL_SYNC_AGENT_TOKEN, original.FULL_SYNC_AGENT_TOKEN); assert.equal(restored.FULL_SYNC_SIGNING_SECRET, original.FULL_SYNC_SIGNING_SECRET);
  assert.equal(restored.CAMPUS_AGENT_TOKEN, personal); assert.equal(restored.FOSU_COLLECTOR_TIMER_VERIFIED, "0");
  assert.equal(prepare(target, previous).created, false);
  fs.writeFileSync(target, "CAMPUS_AGENT_TOKEN=" + personal + "\nFULL_SYNC_AGENT_TOKEN=" + personal + "\n");
  assert.throws(() => prepare(target, previous), /ISOLATION_REJECTED/);
  console.log("full-sync-env-persistence: 13 assertions PASS (generation, independent secrets, persistent reuse, personal preservation)");
} finally { fs.rmSync(root, { recursive: true, force: true }); }
