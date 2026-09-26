const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");

process.env.CAMPUS_SYNC_OPS_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "fosu-sync-ops-"));
const telemetry = require("../server/src/services/campusSyncTelemetryService");

function run() {
  telemetry.resetForTests();
  telemetry.record({
    t: Date.now(),
    status: "completed",
    resultCode: "OK",
    durationMs: 800,
    queueWaitMs: 100,
    courseCount: 23,
    jobId: "abc12345ffffffffffffffff",
    ownerKey: "hashprefixvalue",
    password: "school-secret",
    studentId: "202500000303",
  });
  telemetry.record({ t: Date.now(), status: "failed", resultCode: "INVALID_CREDENTIALS", durationMs: 100 });
  telemetry.record({ t: Date.now(), status: "failed", resultCode: "TIMEOUT", durationMs: 9000 });
  const view = telemetry.overview("24h");
  assert.ok(view.success >= 1);
  assert.ok(view.credentialFailures >= 1);
  assert.ok(view.systemFailures >= 1);
  assert.ok(view.successRate > 0);
  const listed = telemetry.listRecent({ limit: 50 });
  const serialized = JSON.stringify(listed);
  assert.ok(!serialized.includes("school-secret"));
  assert.ok(!serialized.includes("202500000303"));
  assert.strictEqual(listed.events[0].courseCount === 23 || listed.events.some((item) => item.courseCount === 23), true);
  telemetry.flushNow();
  const stats = telemetry.storageStats();
  assert.ok(stats.storageCapBytes <= 100 * 1024 * 1024);
  assert.strictEqual(stats.eventRetentionDays, 14);
  assert.strictEqual(stats.hourRetentionDays, 90);
  const dumped = fs.readdirSync(process.env.CAMPUS_SYNC_OPS_DIR).map((name) => fs.readFileSync(path.join(process.env.CAMPUS_SYNC_OPS_DIR, name), "utf8")).join("\n");
  assert.ok(!dumped.includes("school-secret"));
  assert.ok(!dumped.includes("202500000303"));
  console.log("campus-sync-telemetry PASS");
}

run();
