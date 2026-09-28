const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");

process.env.CAMPUS_SYNC_OPS_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "fosu-stage-"));
const telemetry = require("../server/src/services/campusSyncTelemetryService");

function run() {
  telemetry.resetForTests();
  const secret = "stage-secret-password";
  const studentId = "202500009999";
  telemetry.record({
    t: Date.now(),
    status: "completed",
    resultCode: "OK",
    jobId: "job1234567890abcd",
    ownerKey: "hashowner12345678",
    principalHashPrefix: "hashowne",
    durationMs: 4200,
    queueWaitMs: 1800,
    jobQueuedAt: 1000,
    agentClaimedAt: 2800,
    courseCount: 18,
    password: secret,
    studentId,
    studentName: "不应出现",
    className: "班级不应出现",
    openid: "openid-secret",
    cookie: "CASTGC=secret",
    wxCode: "wx-code-secret",
    stageTimings: {
      schoolLoginMs: 900,
      scheduleFetchMs: 700,
      profileFetchMs: 400,
      normalizeMs: 20,
      previewBuildMs: 30,
      password: secret,
    },
  });
  telemetry.record({
    t: Date.now(),
    status: "failed",
    resultCode: "INTERACTIVE_CHALLENGE_REQUIRED",
    durationMs: 500,
    queueWaitMs: 100,
  });
  telemetry.record({
    t: Date.now(),
    status: "failed",
    resultCode: "INVALID_CREDENTIALS",
    durationMs: 200,
  });
  telemetry.record({
    t: Date.now(),
    status: "failed",
    resultCode: "TIMEOUT",
    durationMs: 8000,
  });
  const view = telemetry.overview("24h");
  assert.strictEqual(view.schoolChallenges, 1);
  assert.strictEqual(view.credentialFailures, 1);
  assert.strictEqual(view.systemFailures, 1);
  assert.ok(view.stageLatency.total.samples >= 1);
  assert.ok(view.stageLatency.total.p50 != null);
  assert.ok(view.stageLatency.login.samples === 1);
  assert.ok(view.stageLatency.schedule.p95 != null);
  assert.strictEqual(view.stageLatency.profile.samples, 1);
  const listed = telemetry.listRecent({ limit: 10 });
  const text = JSON.stringify(listed);
  ["stage-secret-password", studentId, "不应出现", "班级不应出现", "openid-secret", "CASTGC", "wx-code-secret"].forEach((needle) => {
    assert.ok(!text.includes(needle), needle);
  });
  const row = listed.events.find((item) => item.courseCount === 18);
  assert.strictEqual(row.schoolLoginMs, 900);
  assert.strictEqual(row.scheduleFetchMs, 700);
  assert.strictEqual(row.profileFetchMs, 400);
  assert.strictEqual(row.jobQueuedAt, 1000);
  assert.strictEqual(row.agentClaimedAt, 2800);
  assert.strictEqual(row.principalHashPrefix, "hashowne");
  telemetry.resetForTests();
  const empty = telemetry.overview("24h");
  assert.strictEqual(empty.stageLatency.login.samples, 0);
  assert.strictEqual(empty.stageLatency.login.p50, null);
  assert.strictEqual(empty.stageLatency.profile.p95, null);
  console.log("campus-sync-stage-timing PASS");
}

run();
