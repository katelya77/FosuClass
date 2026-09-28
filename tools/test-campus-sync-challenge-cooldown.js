const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");

process.env.CAMPUS_SYNC_OPS_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "fosu-challenge-"));
process.env.CAMPUS_SYNC_CHALLENGE_COOLDOWN_SECONDS = "600";

const cooldown = require("../server/src/services/campusSyncChallengeCooldown");
const broker = require("../server/src/services/campusSyncBroker");

function run() {
  assert.strictEqual(cooldown.cooldownSeconds(), 600);
  cooldown.resetForTests();
  broker.resetCampusSyncForTests();
  const owner = { fosuSession: { openidHash: "principal-hash-aaaabbbb" }, ip: "10.1.1.1" };
  const other = { fosuSession: { openidHash: "principal-hash-ccccdddd" }, ip: "10.1.1.1" };
  const created = broker.createJob(owner, { studentId: "202500000303", password: "school-secret", semester: "2025-2026-1" });
  return broker.claimJob("wyz-campus-01", 0).then((job) => {
    assert.ok(job);
    const payload = broker.claimPayload(job);
    broker.finishJob(payload.jobId, { success: false, code: "INTERACTIVE_CHALLENGE_REQUIRED", password: "school-secret", studentId: "202500000303" });
    assert.throws(() => broker.createJob(owner, { studentId: "202500000303", password: "school-secret" }), (error) => {
      assert.strictEqual(error.code, "INTERACTIVE_CHALLENGE_REQUIRED");
      assert.ok(error.retryAfterSeconds > 0 && error.retryAfterSeconds <= 600);
      return true;
    });
    const again = broker.createJob(other, { studentId: "202500000404", password: "other-secret" });
    assert.strictEqual(again.status, "queued");
    assert.notStrictEqual(again.jobId, created.jobId);
    const dumped = JSON.stringify(broker.readJob(other, again.jobId));
    assert.ok(!dumped.includes("school-secret"));
    assert.ok(!dumped.includes("other-secret"));
    assert.ok(!dumped.includes("202500000303"));
    cooldown.resetForTests();
    console.log("campus-sync-challenge-cooldown PASS");
  });
}

run().catch((error) => {
  console.error(error && error.stack || error);
  process.exit(1);
});
