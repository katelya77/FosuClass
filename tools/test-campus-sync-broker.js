const assert = require("assert");
const { availability, claimJob, claimPayload, createJob, finishJob, heartbeat, readJob, resetCampusSyncForTests } = require("../server/src/services/campusSyncBroker");

const HTML = [
  "<table id=\"kbtable\"><tr><td>节次</td><td>星期一</td></tr>",
  "<tr><td>第一大节</td><td>高等数学<br>张三<br>1-16周<br>[01-02]节<br>A101</td></tr></table>",
].join("");

async function run() {
  resetCampusSyncForTests();
  process.env.CAMPUS_AGENT_TOKEN = "0123456789abcdef0123456789abcdef";
  process.env.CAMPUS_AGENT_SIGNING_SECRET = "fedcba9876543210fedcba9876543210";
  const req = { fosuSession: { openidHash: "owner-a" } };
  const created = createJob(req, { studentId: "202500000303", password: "school-secret", semester: "2025-2026-1" });
  assert.strictEqual(created.status, "queued");
  assert.ok(!JSON.stringify(created).includes("school-secret"));
  const job = await claimJob("wyz-campus-01");
  assert.ok(job);
  const payload = claimPayload(job);
  assert.strictEqual(payload.password, "school-secret");
  const held = require("../server/src/services/campusSyncBroker").inspectJob(payload.jobId);
  assert.strictEqual(held.password, "");
  assert.strictEqual(held.studentId, "");
  const done = finishJob(payload.jobId, {
    success: true,
    semester: "2025-2026-1",
    contentType: "text/html; charset=utf-8",
    timetableBodyBase64: Buffer.from(HTML).toString("base64"),
  });
  assert.strictEqual(done.status, "completed");
  const view = readJob(req, created.jobId);
  assert.strictEqual(view.status, "completed");
  assert.ok(view.preview && view.preview.importPreviewToken);
  assert.ok(!JSON.stringify(view).includes("school-secret"));
  heartbeat();
  assert.strictEqual(availability().online, true);
  console.log("campus-sync-broker PASS");
}

run().catch((error) => {
  console.error(error && error.stack || error);
  process.exit(1);
});
