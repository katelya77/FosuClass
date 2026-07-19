const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");

const root = fs.mkdtempSync(path.join(os.tmpdir(), "fosu-audit-operation-"));
process.env.FOSU_DATA_DIR = path.join(root, "data");

try {
  const service = require("../server/src/services/adminAuditService");
  const operationId = "c1op_1234567890abcdef1234567890abcdef";
  const event = {
    time: "2026-07-19T02:00:00.000Z",
    action: "save",
    module: "settings",
    target: "admin-config",
    summary: { changedFields: ["appName"] },
    operationId,
  };

  const first = service.appendOperation(event, operationId);
  assert.strictEqual(first.duplicate, false);
  assert.match(first.eventSha256, /^[a-f0-9]{64}$/);

  const sameSemanticDifferentOrder = {
    operationId,
    summary: { changedFields: ["appName"] },
    target: "admin-config",
    module: "settings",
    action: "save",
    time: "2026-07-19T02:00:00.000Z",
  };
  const duplicate = service.appendOperation(sameSemanticDifferentOrder, operationId);
  assert.strictEqual(duplicate.duplicate, true);
  assert.strictEqual(duplicate.eventSha256, first.eventSha256);
  assert.strictEqual(service.readAll().filter((entry) => entry.operationId === operationId).length, 1);

  const found = service.findOperation(operationId);
  assert.strictEqual(found.event.operationId, operationId);
  assert.strictEqual(found.eventSha256, first.eventSha256);

  assert.throws(
    () => service.appendOperation({ ...event, target: "different-target" }, operationId),
    (error) => error && error.code === "AUDIT_OPERATION_COLLISION"
  );
  assert.strictEqual(service.readAll().filter((entry) => entry.operationId === operationId).length, 1);

  const lines = fs.readFileSync(service.AUDIT_LOG_PATH, "utf8").trim().split(/\r?\n/).map(JSON.parse);
  assert.strictEqual(lines[0].eventSha256, first.eventSha256, "durable event must carry its canonical digest");

  console.log(JSON.stringify({ ok: true, operationId, eventSha256: first.eventSha256 }, null, 2));
} finally {
  fs.rmSync(root, { recursive: true, force: true });
}
