const assert = require("assert");
const fs = require("fs");
const path = require("path");
const broker = require("../server/src/services/campusSyncBroker");

function owner(id) {
  return { fosuSession: { openidHash: id } };
}

function run() {
  broker.resetCampusSyncForTests();
  const first = broker.createJob(owner("a"), { studentId: "202500000303", password: "school-secret", semester: "2025-2026-1" });
  assert.throws(() => broker.cancelJob(owner("b"), first.jobId), (error) => error.code === "JOB_NOT_FOUND");
  assert.strictEqual(broker.cancelJob(owner("a"), first.jobId).status, "cancelled");
  assert.strictEqual(broker.inspectJob(first.jobId).password, "");
  assert.strictEqual(broker.discardJob(owner("a"), first.jobId).status, "gone");
  assert.strictEqual(broker.inspectJob(first.jobId), null);

  broker.heartbeat();
  const open = broker.availability();
  assert.strictEqual(open.status, "available");
  assert.strictEqual(open.online, true);
  assert.ok(!JSON.stringify(open).includes("wyz"));

  for (let index = 0; index < 10; index += 1) {
    broker.createJob(owner(`user-${index}`), { studentId: "202500000303", password: "school-secret", semester: "" });
  }
  assert.throws(() => broker.createJob(owner("overflow"), { studentId: "202500000303", password: "school-secret", semester: "" }), (error) => error.code === "CAMPUS_SYNC_BUSY");
  assert.strictEqual(broker.availability().status, "busy");
  const metrics = broker.metrics();
  assert.strictEqual(metrics.queuedJobs, 10);
  assert.ok(!JSON.stringify(metrics).includes("school-secret"));
  assert.ok(!JSON.stringify(metrics).includes("202500000303"));

  const unit = fs.readFileSync(path.join(__dirname, "../deploy/wyz-campus-agent/wyz-campus-agent.service"), "utf8");
  ["User=fosu-campus-agent", "NoNewPrivileges=yes", "PrivateTmp=yes", "ProtectHome=yes", "ProtectSystem=strict", "MemoryMax=256M", "TasksMax=64", "Restart=always"].forEach((line) => {
    assert.ok(unit.includes(line), line);
  });
  assert.ok(!unit.includes("PrivateNetwork"));
  const install = fs.readFileSync(path.join(__dirname, "../deploy/wyz-campus-agent/install-wyz.sh"), "utf8");
  assert.ok(install.includes("useradd --system"));
  console.log("campus-sync-lifecycle PASS");
}

run();
