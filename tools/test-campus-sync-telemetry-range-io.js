const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "fosu-range-io-"));
process.env.CAMPUS_SYNC_OPS_DIR = dir;
const telemetry = require("../server/src/services/campusSyncTelemetryService");
telemetry.resetForTests();
const now = Date.parse("2026-09-26T12:00:00.000Z");
const sentinel = "school-password-sentinel-9f3a";
for (let index = 0; index < 90; index += 1) {
  const day = new Date(now - index * 86400000).toISOString().slice(0, 10);
  const key = new Date(now - index * 86400000).toISOString().slice(0, 13);
  fs.writeFileSync(path.join(dir, `hours-${day}.json`), JSON.stringify({
    [key]: { attempts: 1, success: 1, failed: 0, histogram: [1], errors: { OK: 1 }, password: sentinel, studentId: "202500000303", studentName: "张三", openid: "openid-secret" },
  }));
}
assert.ok(telemetry.requiredHourFiles("24h", now).length <= 3);
assert.ok(telemetry.requiredHourFiles("7d", now).length <= 9);
assert.ok(telemetry.requiredHourFiles("30d", now).length <= 32);
telemetry.timeseries("24h", now);
const first = telemetry.lastIo();
assert.ok(first.filesRead <= 3, `24h read ${first.filesRead}`);
assert.ok(first.filesRead < 90);
telemetry.timeseries("24h", now);
assert.strictEqual(telemetry.lastIo().filesRead, 0);
assert.strictEqual(telemetry.lastIo().cacheHit, true);
telemetry.resetForTests();
telemetry.timeseries("7d", now);
assert.ok(telemetry.lastIo().filesRead <= 9);
telemetry.resetForTests();
telemetry.timeseries("30d", now);
assert.ok(telemetry.lastIo().filesRead <= 32);
const blob = telemetry.cacheAuditBlob();
["password", "studentId", "studentName", "className", "openid", "cookie", "ticket", sentinel, "202500000303", "张三"].forEach((secret) => {
  assert.ok(!blob.includes(secret), secret);
});
console.log("campus-sync-telemetry-range-io PASS");
