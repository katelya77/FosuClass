const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");

process.env.CAMPUS_SYNC_OPS_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "fosu-sync-ops-console-"));
process.env.ADMIN_PASSWORD = "ops-console-test-password";

const broker = require("../server/src/services/campusSyncBroker");
const ops = require("../server/src/services/campusSyncOpsService");
const control = require("../server/src/services/campusSyncControl");
const adminHtml = require("../server/src/routes/adminPages").adminConsoleHtml;

function run() {
  broker.resetCampusSyncForTests();
  ops.resetDiagnoseForTests();
  broker.heartbeat();
  const open = ops.overview();
  assert.strictEqual(open.status, "normal");
  assert.strictEqual(open.agent.online, true);
  assert.ok(open.queue.cap === 10);
  control.pause("admin");
  assert.strictEqual(broker.availability().status, "maintenance");
  assert.throws(() => broker.createJob({ fosuSession: { openidHash: "maint" } }, { studentId: "202500000303", password: "secret", semester: "" }), (error) => error.code === "CAMPUS_SYNC_MAINTENANCE");
  control.resume();
  assert.strictEqual(broker.availability().status, "available");
  const report = ops.diagnose();
  assert.strictEqual(report.broker, "ok");
  assert.throws(() => ops.diagnose(), (error) => error.code === "DIAGNOSE_COOLDOWN");
  const config = ops.runtimeConfig();
  assert.strictEqual(config.workerConcurrency, 1);
  assert.ok(config.secrets.campusAgentToken === "Configured" || config.secrets.campusAgentToken === "Not configured");
  assert.ok(!JSON.stringify(config).includes(process.env.CAMPUS_AGENT_TOKEN || "no-token-value"));
  assert.ok(adminHtml.includes('id="section-campus-sync"'));
  assert.ok(adminHtml.includes("个人课表同步"));
  assert.ok(adminHtml.includes("/api/admin/campus-sync/overview"));
  assert.ok(!adminHtml.includes("CAMPUS_AGENT_TOKEN"));
  console.log("campus-sync-operations-console PASS");
}

run();
